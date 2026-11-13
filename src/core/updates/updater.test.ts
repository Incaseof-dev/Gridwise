import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readState, updateKbFromWiki, updateSde, type UpdaterPaths } from './updater';

const EVENT_PAGE = `== Activities ==
=== Combat ===
==== Test Site ====
{{NPCTableHead|Warp-in}}
{{NPCTableRow|Frigate|3|Harvest Follower|point=scram}}
|}
`;

let dir: string;
let paths: UpdaterPaths;
let requests: string[];

function stubFetch(handler: (url: URL) => unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input);
      requests.push(url.searchParams.get('titles') ?? url.pathname);
      return new Response(JSON.stringify(handler(url)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eve-upd-'));
  requests = [];
  paths = {
    statePath: join(dir, 'updates.json'),
    sdeDbPath: join(dir, 'sde.sqlite'),
    cacheDir: join(dir, 'cache'),
    sourcesPath: join(dir, 'sources.json'),
    bundledManifestPath: join(dir, 'manifest.json'),
    updateDir: join(dir, 'kb-updates'),
  };
  writeFileSync(
    paths.sourcesPath,
    JSON.stringify({ missionLevels: [], siteCategories: [], eventPages: ['Event A', 'Event B'] }),
  );
  writeFileSync(paths.bundledManifestPath, JSON.stringify({ 'Event A': 100, 'Event B': 200 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe('updateKbFromWiki', () => {
  it('downloads only pages whose revision changed and writes them to the update layer', async () => {
    stubFetch((url) => {
      const titles = url.searchParams.get('titles')!.split('|');
      const withContent = url.searchParams.get('rvprop')!.includes('content');
      return {
        query: {
          pages: titles.map((t) => ({
            title: t,
            revisions: [
              {
                revid: t === 'Event B' ? 201 : 100,
                timestamp: '',
                ...(withContent ? { slots: { main: { content: EVENT_PAGE } } } : {}),
              },
            ],
          })),
        },
      };
    });
    const written = await updateKbFromWiki(paths, null, { now: Date.UTC(2026, 9, 20) });
    expect(written).toBe(1);
    // One revision check for both pages, one content request for the changed page only.
    expect(requests).toEqual(['Event A|Event B', 'Event B']);
    expect(readdirSync(paths.updateDir).sort()).toEqual(['event-b-test-site.yaml', 'manifest.json']);
    expect(JSON.parse(readFileSync(join(paths.updateDir, 'manifest.json'), 'utf8'))).toEqual({ 'Event B': 201 });

    // A week has not passed: no request at all.
    requests = [];
    expect(await updateKbFromWiki(paths, null, { now: Date.UTC(2026, 9, 25) })).toBeNull();
    expect(requests).toEqual([]);

    // Due again and nothing changed since the last update: revision check only.
    expect(await updateKbFromWiki(paths, null, { now: Date.UTC(2026, 9, 28) })).toBe(0);
    expect(requests).toEqual(['Event A|Event B']);
  }, 20_000);

  it('records a failure without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    expect(await updateKbFromWiki(paths, null, { now: Date.UTC(2026, 9, 20) })).toBeNull();
    expect(readState(paths.statePath).lastMessage).toMatch(/^Wiki update failed: wiki API HTTP 500/);
  });
});

describe('updateSde', () => {
  it('asks for the build number at most once a day and downloads nothing when up to date', async () => {
    stubFetch(() => ({ _key: 'sde', buildNumber: 42, releaseDate: '2026-10-12' }));
    expect(await updateSde(paths, 42, { now: Date.UTC(2026, 9, 20, 8) })).toBeNull();
    expect(requests).toHaveLength(1);
    expect(await updateSde(paths, 42, { now: Date.UTC(2026, 9, 20, 20) })).toBeNull();
    expect(requests).toHaveLength(1); // not due yet
    expect(existsSync(paths.sdeDbPath)).toBe(false);
  });
});
