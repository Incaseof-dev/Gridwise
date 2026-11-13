/**
 * Knowledge base tooling (task 016, docs/knowledge-base.md).
 *
 *   npm run kb -- import-wiki [--set all|missions|sites|event] [--levels 1,2,3] [--page "<event page>"] [--dry-run] [--show-skipped]
 *                             [--faction "Guristas Pirates"] [--refresh] [--dry-run] [--show "<title>"]
 *     Sources come from kb/sources.json; only pages whose wiki revision changed are downloaded.
 *   npm run kb -- import-sitemap [--refresh]  enemy site map (kb/sitemap.json) from the wiki's "Combat site" page
 *   npm run kb -- import-abyss [--refresh]    Abyssal Deadspace data (kb/abyss.json) from the wiki's Abyss pages
 *   npm run kb -- check                 validate bundled + user KB and message texts, cross-check against the SDE
 *   npm run kb -- show "<name>"         print the normalized entry/entries
 *   npm run kb -- brief "<search text>"  the overlay brief of the best search hit, as JSON
 *   npm run kb -- audit-damage          compare documented incoming damage with what the SDE says the NPCs deal
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { EncounterCatalog } from '../core/encounter/catalog';
import { loadKnowledgeBase } from '../core/kb/loader';
import { abyssFromWiki, ABYSS_PAGE, ABYSS_ROOMS_PAGE } from '../core/kb/wiki/abyss';
import { addTranscludedParts, convertItem } from '../core/kb/wiki/build';
import { fetchPageMap, latestRevisions } from '../core/kb/wiki/fetch';
import { siteMapFromWiki, SITEMAP_PAGE } from '../core/kb/wiki/sitemap';
import { listSourceItems, loadSources, type SourceItem } from '../core/kb/wiki/sources';
import { cacheDir, dataDir, sdeDbPath } from '../core/paths';
import { DAMAGE_TYPES, GameDataService, type DamageType } from '../core/sde/gameData';
import { loadTextPool } from '../core/threats/texts';
import { parseArgs } from './args';

const BUNDLED_DIR = join(process.cwd(), 'kb', 'encounters');
const USER_DIR = join(dataDir(), 'kb');
const WIKI_CACHE = join(cacheDir(), 'wiki');

const HEADER = `# Generated from the EVE University wiki (CC BY-SA 4.0) by \`npm run kb -- import-wiki\`.
# Re-running the import overwrites this file unless review is set to "reviewed".
`;

function openSde(): GameDataService | null {
  return existsSync(sdeDbPath()) ? new GameDataService(sdeDbPath()) : null;
}

const SOURCES_FILE = join(process.cwd(), 'kb', 'sources.json');

/**
 * Imports the configured wiki sources (kb/sources.json) into kb/encounters. Unchanged pages come from the local
 * cache: revision ids are checked first, and only changed pages are downloaded.
 */
async function importWiki(flags: Map<string, string | true>): Promise<void> {
  const setFlag = String(flags.get('set') ?? 'all');
  const sets: SourceItem['set'][] | undefined =
    setFlag === 'all' ? undefined : setFlag === 'missions' ? ['mission'] : setFlag === 'sites' ? ['site'] : ['event'];
  if (!['all', 'missions', 'sites', 'event'].includes(setFlag)) throw new Error('--set all | missions | sites | event');
  const dryRun = flags.has('dry-run');
  const show = flags.get('show');
  const faction = flags.get('faction');
  const sources = loadSources(SOURCES_FILE);
  if (typeof flags.get('levels') === 'string')
    sources.missionLevels = String(flags.get('levels')).split(',').map(Number);
  if (typeof flags.get('page') === 'string') sources.eventPages = [String(flags.get('page'))];

  const items = await listSourceItems(sources, { cacheDir: WIKI_CACHE, ...(sets ? { sets } : {}) });
  console.log(`${items.length} pages (${sets?.join(', ') ?? 'all sets'})`);
  const revisions = flags.has('refresh') ? undefined : await latestRevisions(items.map((i) => i.title));
  const pages = await fetchPageMap(
    items.map((i) => i.title),
    {
      cacheDir: WIKI_CACHE,
      refresh: flags.has('refresh'),
      ...(revisions ? { knownRevisions: revisions } : {}),
      onProgress: (d, t) => console.log(`  downloaded ${d}/${t} changed pages`),
    },
  );
  items.push(...(await addTranscludedParts(items, pages, WIKI_CACHE)));
  const byTitle = new Map(items.map((i) => [i.title, i]));
  const retrieved = new Date().toISOString().slice(0, 10);
  const sde = openSde();
  if (!sde) console.log('no SDE index: compressed NPC name lists are expanded heuristically (npm run sde -- update)');
  mkdirSync(BUNDLED_DIR, { recursive: true });

  const stats = { written: 0, protected: 0, filtered: 0, skipped: {} as Record<string, number> };
  const seenIds = new Set<string>();
  for (const [title, page] of pages) {
    for (const { file, skipped } of convertItem(byTitle.get(title)!, page, retrieved, sde)) {
      if (!file) {
        stats.skipped[skipped!] = (stats.skipped[skipped!] ?? 0) + 1;
        if (flags.has('show-skipped')) console.log(`  skip ${title}: ${skipped}`);
        continue;
      }
      if (typeof faction === 'string' && file.enemyFaction !== faction) {
        stats.filtered++;
        continue;
      }
      // The same page can be listed twice (e.g. on two level tabs); write it once.
      if (seenIds.has(String(file.id))) continue;
      seenIds.add(String(file.id));
      const yaml = HEADER + stringify(file, { lineWidth: 0 });
      if (show === page.title) console.log(yaml);
      const path = join(BUNDLED_DIR, `${String(file.id)}.yaml`);
      if (existsSync(path) && /^review:\s*reviewed\s*$/m.test(readFileSync(path, 'utf8'))) {
        stats.protected++;
        continue;
      }
      if (!dryRun) writeFileSync(path, yaml);
      stats.written++;
    }
  }
  sde?.close();
  // Which wiki revision each bundled entry comes from; the in-app updater only refreshes pages that changed since.
  if (!dryRun && !sets && typeof faction !== 'string') {
    const manifest: Record<string, number> = {};
    for (const [title, page] of [...pages].sort((a, b) => a[0].localeCompare(b[0]))) manifest[title] = page.revision;
    writeFileSync(join(process.cwd(), 'kb', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  console.log(
    `${dryRun ? 'would write' : 'wrote'} ${stats.written}, kept ${stats.protected} reviewed, filtered out ${stats.filtered} (faction)`,
  );
  for (const [why, n] of Object.entries(stats.skipped)) console.log(`  skipped ${n}: ${why}`);
}

/**
 * The enemy site map (EVE-74) from the wiki's "Combat site" overview, with SDE dungeon ids, into kb/sitemap.json.
 * Also lists the sites the KB has no entry for.
 */
async function importSitemap(flags: Map<string, string | true>): Promise<void> {
  const refresh = flags.has('refresh');
  const revisions = refresh ? undefined : await latestRevisions([SITEMAP_PAGE]);
  const pages = await fetchPageMap([SITEMAP_PAGE], {
    cacheDir: WIKI_CACHE,
    refresh,
    ...(revisions ? { knownRevisions: revisions } : {}),
  });
  const page = pages.get(SITEMAP_PAGE);
  if (!page) throw new Error(`wiki page "${SITEMAP_PAGE}" not found`);
  const sde = openSde();
  if (!sde) console.log('no SDE index: sites get no SDE dungeon ids (npm run sde -- update)');
  const dungeonIds = (name: string) =>
    sde
      ?.search(name, { kinds: ['dungeon'], limit: 20 })
      .filter((h) => h.name.toLowerCase() === name.toLowerCase())
      .map((h) => h.refId) ?? [];
  const map = siteMapFromWiki(page, new Date().toISOString().slice(0, 10), dungeonIds);
  sde?.close();
  writeFileSync(join(process.cwd(), 'kb', 'sitemap.json'), JSON.stringify(map, null, 1) + '\n');

  const { encounters } = loadKnowledgeBase(BUNDLED_DIR);
  const kbPages = new Set(
    encounters.map((e) =>
      Object.values(e.sources)[0]
        ?.title.replace(/^.* – /, '')
        .toLowerCase(),
    ),
  );
  const noKb = map.sites.filter((s) => !s.page || !kbPages.has(s.page.toLowerCase()));
  const noSde = map.sites.filter((s) => !s.sdeDungeonIds.length);
  console.log(
    `${map.sites.length} sites, ${map.links.length} links (wiki revision ${page.revision}) → kb/sitemap.json`,
  );
  console.log(`  without a KB entry: ${noKb.length}${noKb.length ? ` (${noKb.map((s) => s.name).join(', ')})` : ''}`);
  console.log(
    `  without an SDE dungeon: ${noSde.length}${noSde.length ? ` (${noSde.map((s) => s.name).join(', ')})` : ''}`,
  );
}

function check(): void {
  const { encounters, issues } = loadKnowledgeBase(BUNDLED_DIR, USER_DIR);
  console.log(`${encounters.length} encounters loaded (bundled: ${BUNDLED_DIR}, user: ${USER_DIR})`);
  const texts = loadTextPool([join(process.cwd(), 'messages', 'messages.yaml'), join(dataDir(), 'messages.yaml')]);
  console.log(`${texts.pool.size} message texts (trigger/phase) loaded`);
  for (const i of [...issues, ...texts.issues])
    console.log(`${i.severity.toUpperCase()} ${i.file}:${i.line ?? '?'} ${i.path} ${i.message}`);

  const sde = openSde();
  if (!sde) {
    console.log('no SDE index; skipping SDE cross-check (npm run sde -- update)');
    return;
  }
  const unknownTypes = new Map<string, Set<string>>();
  const note = (name: string, where: string) => {
    if (!sde.typesByName(name, 11).length)
      (unknownTypes.get(name) ?? unknownTypes.set(name, new Set()).get(name)!).add(where);
  };
  let spawnNames = 0;
  for (const e of encounters) {
    for (const [display, k] of Object.entries(e.npcs)) for (const t of k.sdeTypes) note(t, `${e.id} npcs.${display}`);
    for (const p of e.pockets)
      for (const w of p.waves)
        for (const s of w.spawns)
          for (const n of s.names) {
            spawnNames++;
            if (
              !e.npcs[n] &&
              !/\b(structures?|sentry|tower|bunker|pylon|wall|container|habitation|beacon|gate|accl)\b/i.test(
                s.class ?? '',
              )
            ) {
              note(n, e.id);
            }
          }
    for (const id of e.sde.dungeonIds)
      if (!sde.dungeon(id)) console.log(`WARNING ${e.id}: SDE dungeon ${id} not found`);
  }
  sde.close();
  console.log(
    `\n${spawnNames} spawn names checked; ${unknownTypes.size} are neither SDE NPC types nor KB display names:`,
  );
  for (const [name, where] of [...unknownTypes].sort((a, b) => b[1].size - a[1].size).slice(0, 60)) {
    console.log(`  ${name}  (${where.size}× e.g. ${[...where][0]})`);
  }
}

function show(name: string): void {
  const { encounters } = loadKnowledgeBase(BUNDLED_DIR, USER_DIR);
  const hits = encounters.filter((e) => e.name.toLowerCase() === name.toLowerCase() || e.id === name);
  if (!hits.length) console.log('no encounter with that name or id');
  for (const e of hits) console.log(JSON.stringify(e, null, 2));
}

function auditDamage(): void {
  const sde = openSde();
  if (!sde) throw new Error('no SDE index (npm run sde -- update)');
  const { encounters } = loadKnowledgeBase(BUNDLED_DIR, USER_DIR);
  const stats = { documented: 0, agree: 0, disagree: 0, sdeOnly: 0, nothing: 0 };
  for (const e of encounters) {
    const total: Record<DamageType, number> = { em: 0, thermal: 0, kinetic: 0, explosive: 0 };
    for (const p of e.pockets)
      for (const w of p.waves)
        for (const s of w.spawns) {
          const names = s.names.flatMap((n) => e.npcs[n]?.sdeTypes ?? [n]);
          for (const n of names) {
            const t = sde.typesByName(n, 11)[0];
            if (!t) continue;
            const d = sde.npcProfile(t.id)!.nominalDps;
            for (const k of DAMAGE_TYPES) total[k] += d[k] / names.length;
          }
        }
    const sum = DAMAGE_TYPES.reduce((a, k) => a + total[k], 0);
    const top = sum > 0 ? DAMAGE_TYPES.filter((k) => total[k] / sum >= 0.25).sort((a, b) => total[b] - total[a]) : [];
    const documented = e.damage?.resist ?? [];
    if (documented.length) stats.documented++;
    if (documented.length && top.length) {
      if (documented.includes(top[0]!)) stats.agree++;
      else {
        stats.disagree++;
        const sdeText = top.map((k) => `${k} ${Math.round((total[k] / sum) * 100)}%`).join(', ');
        console.log(`DIFF ${e.id}: documented ${documented.join('/')} vs SDE ${sdeText}`);
      }
    } else if (top.length) stats.sdeOnly++;
    else if (!documented.length) stats.nothing++;
  }
  sde.close();
  console.log(stats);
}

function brief(query: string): void {
  const sde = openSde();
  const { encounters } = loadKnowledgeBase(BUNDLED_DIR, USER_DIR);
  const catalog = new EncounterCatalog(encounters, sde);
  const hits = catalog.search(query, 8);
  for (const h of hits) console.error(`  ${h.title} — ${h.subtitle}`);
  if (hits[0]) console.log(JSON.stringify(catalog.brief(hits[0].ref), null, 2));
  sde?.close();
}

/** kb/abyss.json from the wiki's Abyssal Deadspace pages; room NPC names are checked against the SDE. */
async function importAbyss(flags: Map<string, string | true>): Promise<void> {
  const refresh = flags.has('refresh');
  const titles = [ABYSS_PAGE, ABYSS_ROOMS_PAGE];
  const revisions = refresh ? undefined : await latestRevisions(titles);
  const pages = await fetchPageMap(titles, {
    cacheDir: WIKI_CACHE,
    refresh,
    ...(revisions ? { knownRevisions: revisions } : {}),
  });
  const [main, rooms] = titles.map((t) => {
    const p = pages.get(t);
    if (!p) throw new Error(`wiki page "${t}" not found`);
    return p;
  });
  const sde = openSde();
  if (!sde) console.log('no SDE index: room names are not checked (npm run sde -- update)');
  const isNpc = sde ? (name: string) => sde.typesByName(name, 11).length > 0 : undefined;
  const data = abyssFromWiki(main!, rooms!, new Date().toISOString().slice(0, 10), isNpc);
  writeFileSync(join(process.cwd(), 'kb', 'abyss.json'), JSON.stringify(data, null, 1) + '\n');
  const names = [...new Set(data.rooms.flatMap((r) => r.npcs.flatMap((n) => n.names)))];
  const unknown = isNpc ? names.filter((n) => !n.includes('[') && !isNpc(n)) : [];
  sde?.close();
  console.log(
    `${data.rooms.length} rooms, ${data.factions.length} factions, ${data.factions.reduce((a, f) => a + f.roles.length, 0)} name parts → kb/abyss.json`,
  );
  console.log(`  room names not in the SDE: ${unknown.length}${unknown.length ? ` (${unknown.join(', ')})` : ''}`);
}

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [cmd, arg] = positional;
  if (cmd === 'import-wiki') return importWiki(flags);
  if (cmd === 'import-sitemap') return importSitemap(flags);
  if (cmd === 'import-abyss') return importAbyss(flags);
  if (cmd === 'check') return check();
  if (cmd === 'show') return show(arg ?? '');
  if (cmd === 'audit-damage') return auditDamage();
  if (cmd === 'brief') return brief(arg ?? '');
  console.error(
    'commands: import-wiki --set l4|guristas-sites | import-sitemap | import-abyss | check | show <name> | audit-damage',
  );
  process.exitCode = 2;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
