/**
 * SDE index maintenance and lookups.
 *
 *   npm run sde -- update [--zip <file>] [--force]   download (or use a local zip) and build the index
 *   npm run sde -- info
 *   npm run sde -- npc "<name>"                      NPC profile(s): damage, resists, EWAR
 *   npm run sde -- search "<text>" [--kinds mission,dungeon,npc,ship]
 *   npm run sde -- mission "<name>"
 *   npm run sde -- dungeon "<name>"
 *   --db <file> overrides the index location (default: $XDG_DATA_HOME/gridwise/sde/sde.sqlite)
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cacheDir, sdeDbPath } from '../core/paths';
import { downloadSdeZip, fetchLatestSdeInfo } from '../core/sde/download';
import { GameDataService, type NpcProfile, type SearchHit } from '../core/sde/gameData';
import { importSdeZip } from '../core/sde/importer';
import { parseArgs } from './args';

const pct = (r: number) => `${Math.round((1 - r) * 100)}%`;
const n0 = (v: number | null) => (v === null ? '?' : Math.round(v).toLocaleString('en'));

function printNpc(p: NpcProfile): void {
  console.log(`\n${p.type.name}  [type ${p.type.id}, ${p.type.groupName}${p.factionName ? `, ${p.factionName}` : ''}]`);
  console.log(`  HP        shield ${n0(p.hp.shield)} / armor ${n0(p.hp.armor)} / hull ${n0(p.hp.hull)}`);
  for (const layer of ['shield', 'armor', 'hull'] as const) {
    const r = p.resonance[layer];
    console.log(
      `  resist ${layer.padEnd(6)} EM ${pct(r.em)}  TH ${pct(r.thermal)}  KI ${pct(r.kinetic)}  EX ${pct(r.explosive)}`,
    );
  }
  console.log(`  shoot with ${p.recommendedDamage.map((d) => `${d.type} (${n0(d.ehp)} EHP)`).join(' > ')}`);
  const d = p.nominalDps;
  console.log(
    `  deals     ~${d.total.toFixed(0)} nominal dps: EM ${d.em.toFixed(0)} TH ${d.thermal.toFixed(0)} KI ${d.kinetic.toFixed(0)} EX ${d.explosive.toFixed(0)}` +
      (p.missile ? `  (missile: ${p.missile.name})` : ''),
  );
  console.log(
    `  misc      bounty ${n0(p.bounty)} ISK, sig ${n0(p.signatureRadius)} m, speed ${n0(p.maxVelocity)} m/s, orbit ${n0(p.orbitRange)} m, range ${n0(p.attackRange)} m`,
  );
  if (p.capabilities.length === 0) console.log('  ewar      none listed in SDE');
  for (const c of p.capabilities) {
    const extra = [
      c.chance !== null ? `chance ${c.chance}` : null,
      c.range !== null ? `range ${n0(c.range)} m` : null,
      c.strength !== null ? `strength ${c.strength}` : null,
    ].filter(Boolean);
    console.log(`  ewar      ${c.kind.padEnd(18)} ${c.effect}${extra.length ? ` (${extra.join(', ')})` : ''}`);
  }
  if (p.unmappedEffects.length) console.log(`  unmapped  ${p.unmappedEffects.join(', ')}`);
}

async function update(dbPath: string, flags: Map<string, string | true>): Promise<void> {
  let zip = flags.get('zip');
  if (typeof zip !== 'string') {
    const latest = await fetchLatestSdeInfo();
    if (existsSync(dbPath) && !flags.has('force')) {
      const current = new GameDataService(dbPath);
      const build = current.buildNumber;
      current.close();
      if (build === latest.buildNumber) {
        console.log(`SDE build ${build} is up to date.`);
        return;
      }
    }
    mkdirSync(cacheDir(), { recursive: true });
    zip = join(cacheDir(), `sde-${latest.buildNumber}.zip`);
    if (!existsSync(zip)) {
      console.log(`downloading build ${latest.buildNumber} (${latest.releaseDate}) …`);
      let last = 0;
      await downloadSdeZip(zip, {
        buildNumber: latest.buildNumber,
        onProgress: (got, total) => {
          if (got - last < 5_000_000) return;
          last = got;
          process.stdout.write(`\r  ${(got / 1e6).toFixed(0)} / ${total ? (total / 1e6).toFixed(0) : '?'} MB`);
        },
      });
      console.log();
    }
  }
  mkdirSync(dirname(dbPath), { recursive: true });
  console.log(`importing ${zip} → ${dbPath}`);
  const res = await importSdeZip(zip, dbPath, (p) => process.stdout.write(`\r  ${p.file.padEnd(24)} ${p.rows}      `));
  console.log(`\ndone: build ${res.buildNumber} in ${(res.ms / 1000).toFixed(1)} s`);
  for (const [f, c] of Object.entries(res.rows)) console.log(`  ${f.padEnd(24)} ${c}`);
}

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [cmd, arg] = positional;
  const dbPath = typeof flags.get('db') === 'string' ? (flags.get('db') as string) : sdeDbPath();

  if (cmd === 'update') return update(dbPath, flags);
  if (!existsSync(dbPath)) throw new Error(`no SDE index at ${dbPath}; run: npm run sde -- update`);
  const gd = new GameDataService(dbPath);
  try {
    switch (cmd) {
      case 'info':
        console.log(`build ${gd.buildNumber}, released ${gd.meta('releaseDate')}, imported ${gd.meta('importedAt')}`);
        console.log(`index: ${dbPath}`);
        break;
      case 'npc': {
        const types = gd.typesByName(arg ?? '', 11);
        if (!types.length) console.log('no NPC with that exact name; try: npm run sde -- search');
        for (const t of types) printNpc(gd.npcProfile(t.id)!);
        break;
      }
      case 'search': {
        const kinds =
          typeof flags.get('kinds') === 'string'
            ? ((flags.get('kinds') as string).split(',') as SearchHit['kind'][])
            : undefined;
        for (const h of gd.search(arg ?? '', { kinds, limit: 25 })) console.log(`${h.kind.padEnd(8)} ${h.name}`);
        break;
      }
      case 'mission': {
        const variants = gd.missionVariants(arg ?? '');
        console.log(`${variants.length} variant(s)`);
        for (const v of variants) {
          console.log(
            `  #${v.id} ${v.kind} dungeon=${v.dungeonId ?? '-'} objective=${v.objectiveTypeName ?? '-'}${v.objectiveQuantity ? ` ×${v.objectiveQuantity}` : ''}`,
          );
        }
        if (variants[0]?.briefing) console.log(`\n${variants[0].briefing.slice(0, 600)}`);
        break;
      }
      case 'dungeon': {
        const hit = gd.search(arg ?? '', { kinds: ['dungeon'], limit: 1 })[0];
        const d = hit ? gd.dungeon(hit.refId) : null;
        if (!d) {
          console.log('not found');
          break;
        }
        console.log(`${d.name} [${d.id}] ${d.factionName ?? ''}`);
        console.log(
          `gates: ${d.allowedShipGroups ? d.allowedShipGroups.map((g) => g.name).join(', ') : 'no restriction in SDE'}`,
        );
        if (d.description) console.log(`\n${d.description.replace(/<[^>]+>/g, '')}`);
        if (d.gameplayDescription)
          console.log(`\n${d.gameplayDescription.replace(/<br>/g, '\n').replace(/<[^>]+>/g, '')}`);
        break;
      }
      default:
        console.error('commands: update | info | npc <name> | search <text> | mission <name> | dungeon <name>');
        process.exitCode = 2;
    }
  } finally {
    gd.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
