/**
 * EVE University wiki access (CC BY-SA 4.0) through the MediaWiki API.
 *
 * Politeness rules (the app may run this unattended for many users):
 * - one request at a time, with a pause between requests;
 * - `maxlag` so the wiki can tell us to back off when its database lags;
 * - on 429/503 wait for `Retry-After` (or an increasing delay) and retry a few times, then give up;
 * - 50 pages per request, cached locally; revision ids are checked first so unchanged pages are never re-downloaded;
 * - a descriptive User-Agent.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const UNI_WIKI = 'https://wiki.eveuniversity.org';
const API = `${UNI_WIKI}/api.php`;
const USER_AGENT = 'gridwise/1.0 (passive EVE PvE companion; https://github.com/Incaseof-dev/Gridwise)';

/** Minimum pause between two requests. */
const REQUEST_GAP_MS = 1500;
const MAX_RETRIES = 3;

export interface WikiPage {
  title: string;
  revision: number;
  timestamp: string;
  content: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

/** Serialises all API calls of this process and spaces them out. */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastRequestAt + REQUEST_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      lastRequestAt = Date.now();
    }
  });
  queue = run.catch(() => undefined);
  return run;
}

async function api(params: Record<string, string>): Promise<Record<string, unknown>> {
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params })}`;
  return enqueue(async () => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      const body = res.ok ? ((await res.json()) as Record<string, unknown>) : null;
      const lagged = (body?.error as { code?: string } | undefined)?.code === 'maxlag';
      if (res.ok && !lagged) return body!;
      if ((res.status === 429 || res.status === 503 || lagged) && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000 * 2 ** attempt);
        continue;
      }
      throw new Error(`wiki API ${lagged ? 'is lagging' : `HTTP ${res.status}`}; giving up`);
    }
  });
}

export function pageUrl(title: string): string {
  return `${UNI_WIKI}/${encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/')}`;
}

export async function categoryMembers(category: string): Promise<string[]> {
  const titles: string[] = [];
  let cont: string | undefined;
  do {
    const data = await api({
      action: 'query',
      list: 'categorymembers',
      cmtitle: `Category:${category}`,
      cmlimit: '500',
      cmnamespace: '0',
      ...(cont ? { cmcontinue: cont } : {}),
    });
    const q = data.query as { categorymembers: { title: string }[] };
    titles.push(...q.categorymembers.map((m) => m.title));
    cont = (data.continue as { cmcontinue?: string } | undefined)?.cmcontinue;
  } while (cont);
  return titles;
}

/** Maps the titles the API returns (normalized, redirected) back to the titles that were asked for. */
function titleMap(
  batch: string[],
  q: { redirects?: { from: string; to: string }[]; normalized?: { from: string; to: string }[] },
) {
  const back = new Map<string, string>();
  for (const t of batch) back.set(t, t);
  for (const n of q.normalized ?? []) back.set(n.to, back.get(n.from) ?? n.from);
  for (const r of q.redirects ?? []) back.set(r.to, back.get(r.from) ?? r.from);
  return back;
}

/** Current revision id of each page (no content): the cheap check before downloading anything. */
export async function latestRevisions(titles: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const data = await api({
      action: 'query',
      prop: 'revisions',
      rvprop: 'ids',
      redirects: '1',
      titles: batch.join('|'),
    });
    const q = data.query as {
      pages: { title: string; missing?: boolean; revisions?: { revid: number }[] }[];
      redirects?: { from: string; to: string }[];
      normalized?: { from: string; to: string }[];
    };
    const back = titleMap(batch, q);
    for (const p of q.pages)
      if (!p.missing && p.revisions?.[0]) out.set(back.get(p.title) ?? p.title, p.revisions[0].revid);
  }
  return out;
}

type FetchOptions = {
  cacheDir: string;
  refresh?: boolean;
  knownRevisions?: Map<string, number>;
  onProgress?: (done: number, total: number) => void;
};

/** Like `fetchPageMap`, as a list in the order asked for. */
export async function fetchPages(titles: string[], opts: FetchOptions): Promise<WikiPage[]> {
  const map = await fetchPageMap(titles, opts);
  return titles.map((t) => map.get(t)).filter((p): p is WikiPage => Boolean(p));
}

/**
 * Returns the content of the given pages, keyed by the title asked for (the page itself may carry the wiki's
 * normalized or redirected title). A cached page is reused when `knownRevisions` says it is still current
 * (or, without `knownRevisions`, unless `refresh` is set). Missing pages are left out.
 */
export async function fetchPageMap(titles: string[], opts: FetchOptions): Promise<Map<string, WikiPage>> {
  mkdirSync(opts.cacheDir, { recursive: true });
  const file = (t: string) => join(opts.cacheDir, `${t.replace(/[^\w.-]+/g, '_')}.json`);
  const result = new Map<string, WikiPage>();
  const todo: string[] = [];
  for (const t of titles) {
    const cached = existsSync(file(t)) ? (JSON.parse(readFileSync(file(t), 'utf8')) as WikiPage) : null;
    const current = opts.knownRevisions
      ? cached !== null && opts.knownRevisions.get(t) === cached.revision
      : cached !== null && !opts.refresh;
    if (current) result.set(t, cached!);
    else if (!opts.knownRevisions || opts.knownRevisions.has(t)) todo.push(t);
  }

  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    const data = await api({
      action: 'query',
      prop: 'revisions',
      rvprop: 'ids|timestamp|content',
      rvslots: 'main',
      redirects: '1',
      titles: batch.join('|'),
    });
    const q = data.query as {
      pages: {
        title: string;
        missing?: boolean;
        revisions?: { revid: number; timestamp: string; slots: { main: { content: string } } }[];
      }[];
      redirects?: { from: string; to: string }[];
      normalized?: { from: string; to: string }[];
    };
    const back = titleMap(batch, q);
    for (const p of q.pages) {
      const rev = p.revisions?.[0];
      if (p.missing || !rev) continue;
      const page: WikiPage = {
        title: p.title,
        revision: rev.revid,
        timestamp: rev.timestamp,
        content: rev.slots.main.content,
      };
      const asked = back.get(p.title) ?? p.title;
      writeFileSync(file(asked), JSON.stringify(page));
      result.set(asked, page);
    }
    opts.onProgress?.(Math.min(i + 50, todo.length), todo.length);
  }
  return result;
}
