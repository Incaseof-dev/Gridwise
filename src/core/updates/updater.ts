/**
 * Unattended data updates for published builds: the app ships a data pack (SDE index + KB) and refreshes it
 * itself, rarely and cheaply, so many installs do not add up to a load on CCP's or EVE University's servers.
 *
 * - SDE: at most once a day one tiny request for the build number; the ~100 MB zip only when a new build exists.
 * - Wiki: at most once a week; lists + revision ids (~20 small requests, spaced out by the wiki client),
 *   then only pages whose revision differs from what the bundled KB (kb/manifest.json) or an earlier update used.
 *   Regenerated entries go to a separate update layer; reviewed bundled entries are never replaced.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { addTranscludedParts, convertItem } from '../kb/wiki/build';
import { fetchPageMap, latestRevisions } from '../kb/wiki/fetch';
import { listSourceItems, loadSources } from '../kb/wiki/sources';
import { downloadSdeZip, fetchLatestSdeInfo } from '../sde/download';
import type { GameDataService } from '../sde/gameData';
import { importSdeZip } from '../sde/importer';

export const SDE_CHECK_INTERVAL_MS = 24 * 3600_000;
export const WIKI_CHECK_INTERVAL_MS = 7 * 24 * 3600_000;

/** Page title → wiki revision the KB entries were generated from. */
export type KbManifest = Record<string, number>;

export interface UpdateState {
  sdeCheckedAt: string | null;
  wikiCheckedAt: string | null;
  lastMessage: string | null;
}

export interface UpdaterPaths {
  statePath: string;
  /** Where the app keeps its own (updated) SDE index. */
  sdeDbPath: string;
  cacheDir: string;
  sourcesPath: string;
  bundledManifestPath: string;
  updateDir: string;
}

const UPDATE_HEADER = `# Updated automatically from the EVE University wiki (CC BY-SA 4.0) by Gridwise.
# Local copy; it overrides the bundled entry with the same id unless that one is reviewed.
`;

export function readState(path: string): UpdateState {
  try {
    return { sdeCheckedAt: null, wikiCheckedAt: null, lastMessage: null, ...JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    return { sdeCheckedAt: null, wikiCheckedAt: null, lastMessage: null };
  }
}

function writeState(path: string, state: UpdateState): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

function readManifest(path: string): KbManifest {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as KbManifest;
  } catch {
    return {};
  }
}

const due = (checkedAt: string | null, interval: number, now: number) =>
  !checkedAt || now - Date.parse(checkedAt) >= interval;

/**
 * Checks for a newer SDE build and imports it into `paths.sdeDbPath`. Returns the new build number, or null when
 * nothing changed (not due, up to date, or failed — see the state's lastMessage).
 */
export async function updateSde(
  paths: UpdaterPaths,
  currentBuild: number | null,
  opts: { force?: boolean; now?: number; onStatus?: (msg: string) => void } = {},
): Promise<number | null> {
  const now = opts.now ?? Date.now();
  const state = readState(paths.statePath);
  if (!opts.force && !due(state.sdeCheckedAt, SDE_CHECK_INTERVAL_MS, now)) return null;
  state.sdeCheckedAt = new Date(now).toISOString();
  writeState(paths.statePath, state);
  try {
    const latest = await fetchLatestSdeInfo();
    if (currentBuild !== null && latest.buildNumber <= currentBuild) return null;
    mkdirSync(paths.cacheDir, { recursive: true });
    const zip = join(paths.cacheDir, `sde-${latest.buildNumber}.zip`);
    opts.onStatus?.(`Downloading SDE build ${latest.buildNumber}…`);
    if (!existsSync(zip)) await downloadSdeZip(zip, { buildNumber: latest.buildNumber });
    opts.onStatus?.('Importing SDE…');
    mkdirSync(join(paths.sdeDbPath, '..'), { recursive: true });
    await importSdeZip(zip, paths.sdeDbPath);
    rmSync(zip, { force: true }); // ~100 MB; the index is all we need
    state.lastMessage = `SDE updated to build ${latest.buildNumber}`;
    writeState(paths.statePath, state);
    return latest.buildNumber;
  } catch (err) {
    state.lastMessage = `SDE update failed: ${String(err instanceof Error ? err.message : err)}`;
    writeState(paths.statePath, state);
    return null;
  }
}

/**
 * Refreshes KB entries whose wiki page changed. Returns the number of regenerated entries, or null when not due
 * or failed.
 */
export async function updateKbFromWiki(
  paths: UpdaterPaths,
  sde: GameDataService | null,
  opts: { force?: boolean; now?: number; onStatus?: (msg: string) => void } = {},
): Promise<number | null> {
  const now = opts.now ?? Date.now();
  const state = readState(paths.statePath);
  if (!opts.force && !due(state.wikiCheckedAt, WIKI_CHECK_INTERVAL_MS, now)) return null;
  state.wikiCheckedAt = new Date(now).toISOString();
  writeState(paths.statePath, state);
  try {
    opts.onStatus?.('Checking the wiki for changed pages…');
    const items = await listSourceItems(loadSources(paths.sourcesPath), { cacheDir: join(paths.cacheDir, 'wiki') });
    const revisions = await latestRevisions(items.map((i) => i.title));
    const updateManifestPath = join(paths.updateDir, 'manifest.json');
    const known = { ...readManifest(paths.bundledManifestPath), ...readManifest(updateManifestPath) };
    const changed = items.filter((i) => revisions.has(i.title) && revisions.get(i.title) !== known[i.title]);
    if (!changed.length) {
      state.lastMessage = 'Knowledge base is up to date with the wiki';
      writeState(paths.statePath, state);
      return 0;
    }
    opts.onStatus?.(`Downloading ${changed.length} changed wiki page(s)…`);
    const pages = await fetchPageMap(
      changed.map((i) => i.title),
      { cacheDir: join(paths.cacheDir, 'wiki'), knownRevisions: revisions },
    );
    changed.push(...(await addTranscludedParts(changed, pages, join(paths.cacheDir, 'wiki'))));
    mkdirSync(paths.updateDir, { recursive: true });
    const manifest = readManifest(updateManifestPath);
    const retrieved = new Date(now).toISOString().slice(0, 10);
    let written = 0;
    for (const item of changed) {
      const page = pages.get(item.title);
      if (!page) continue;
      for (const { file } of convertItem(item, page, retrieved, sde)) {
        if (!file) continue;
        writeFileSync(
          join(paths.updateDir, `${String(file.id)}.yaml`),
          UPDATE_HEADER + stringify(file, { lineWidth: 0 }),
        );
        written++;
      }
      manifest[item.title] = page.revision;
    }
    writeFileSync(updateManifestPath, JSON.stringify(manifest, null, 2));
    state.lastMessage = `Knowledge base: ${written} entr${written === 1 ? 'y' : 'ies'} updated from ${changed.length} changed wiki page(s)`;
    writeState(paths.statePath, state);
    return written;
  } catch (err) {
    state.lastMessage = `Wiki update failed: ${String(err instanceof Error ? err.message : err)}`;
    writeState(paths.statePath, state);
    return null;
  }
}
