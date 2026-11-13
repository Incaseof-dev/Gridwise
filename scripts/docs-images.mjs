/**
 * Puts the generated screenshots (docs/screenshots/*.png, from `npm run screenshots`) into the DeliveryHub docs
 * (EVE-77): uploads the images that changed, then points every page of the docs app at the new uploads.
 *
 *   npm run docs:images                 # upload changed images, update the pages
 *   npm run docs:images -- --dry-run    # only tell what would change
 *
 * What is up there is remembered in docs/screenshots/uploaded.json (image → content hash and URL), so unchanged
 * images are not uploaded again and pages are only touched where an image changed. A new image is uploaded but
 * not placed: put its URL into a page once, later runs keep it current.
 *
 * Server and token: DH_URL / DH_TOKEN, else the `deliveryhub` MCP server of Claude Code (`claude mcp get
 * deliveryhub`). The token is used, never printed. Docs app: DH_DOCS_APP (default gridwise).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve('docs/screenshots');
const manifestPath = join(dir, 'uploaded.json');
const dryRun = process.argv.includes('--dry-run');
const appSlug = process.env.DH_DOCS_APP ?? 'gridwise';

function server() {
  if (process.env.DH_URL && process.env.DH_TOKEN)
    return { base: process.env.DH_URL, auth: `Bearer ${process.env.DH_TOKEN}` };
  let out;
  try {
    out = execFileSync('claude', ['mcp', 'get', 'deliveryhub'], { encoding: 'utf8' });
  } catch {
    throw new Error('set DH_URL and DH_TOKEN, or configure the deliveryhub MCP server in Claude Code');
  }
  const url = /^\s*URL:\s*(\S+)/m.exec(out)?.[1];
  const auth = /^\s*Authorization:\s*(.+)$/m.exec(out)?.[1]?.trim();
  if (!url || !auth) throw new Error('`claude mcp get deliveryhub` shows no URL or Authorization header');
  return { base: process.env.DH_URL ?? url.replace(/\/mcp\/?$/, '').replace(/\/api$/, ''), auth };
}

const { base, auth } = server();
const api = `${base.replace(/\/$/, '')}/api`;

async function call(method, path, body) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      Authorization: auth,
      ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
const apps = await call('GET', '/admin/docs/apps');
const app = (Array.isArray(apps) ? apps : (apps.apps ?? [])).find((a) => a.slug === appSlug);
if (!app) throw new Error(`docs app "${appSlug}" not found on ${base}`);

/** image name → [old URL, new URL] */
const moved = new Map();
let unchanged = 0;
for (const file of readdirSync(dir)
  .filter((f) => f.endsWith('.png'))
  .sort()) {
  const name = file.replace(/\.png$/, '');
  const bytes = readFileSync(join(dir, file));
  const hash = createHash('sha256').update(bytes).digest('hex');
  const known = manifest[name];
  if (known?.hash === hash) {
    unchanged++;
    continue;
  }
  if (dryRun) {
    console.log(`would upload ${file}${known ? ' (changed)' : ' (new)'}`);
    continue;
  }
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/png' }), file);
  const { url } = await call('POST', `/admin/docs/apps/${app.id}/images`, form);
  console.log(`uploaded ${file} → ${url}`);
  if (known?.url) moved.set(name, [known.url, url]);
  else console.log(`  new image: put ![…](${url}) into a page; later runs keep it current`);
  manifest[name] = { hash, url };
}
console.log(`${unchanged} image(s) unchanged`);

if (moved.size) {
  const pages = await call('GET', `/admin/docs/apps/${app.id}/pages`);
  for (const page of pages) {
    const translations = await call('GET', `/admin/docs/pages/${page.id}/translations`);
    for (const t of translations) {
      let md = t.content_md ?? '';
      for (const [from, to] of moved.values()) md = md.split(from).join(to);
      if (md === t.content_md) continue;
      await call('PUT', `/admin/docs/pages/${page.id}/translations/${t.lang}`, { title: t.title, content_md: md });
      console.log(`updated ${page.slug} (${page.version}, ${t.lang})`);
    }
  }
}
if (!dryRun) writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + '\n');
