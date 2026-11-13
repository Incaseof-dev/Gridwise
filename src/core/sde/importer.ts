/**
 * Builds the local SDE index from the official JSONL zip (task 013, docs/sde.md).
 * The zip is streamed entry by entry; only the files listed in HANDLERS are read.
 */
import { existsSync, renameSync, rmSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { Readable } from 'node:stream';
import yauzl from 'yauzl';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';

type Row = Record<string, unknown>;
type Localized = { en?: string } | string | undefined;

export interface ImportProgress {
  file: string;
  rows: number;
}

export interface ImportResult {
  buildNumber: number | null;
  releaseDate: string | null;
  rows: Record<string, number>;
  ms: number;
}

const en = (v: unknown): string | null => {
  const x = v as Localized;
  if (x === undefined || x === null) return null;
  return typeof x === 'string' ? x : (x.en ?? null);
};
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const bool = (v: unknown): number => (v ? 1 : 0);
const json = (v: unknown): string | null => (v === undefined ? null : JSON.stringify(v));

interface Context {
  db: DatabaseSync;
  stmt: (sql: string) => StatementSync;
  meta: Map<string, string>;
}

/** One handler per SDE file. Each gets every parsed line. */
const HANDLERS: Record<string, (ctx: Context, r: Row) => void> = {
  '_sde.jsonl': (ctx, r) => {
    if (r.buildNumber !== undefined) ctx.meta.set('buildNumber', String(r.buildNumber));
    if (r.releaseDate !== undefined) ctx.meta.set('releaseDate', String(r.releaseDate));
  },
  'categories.jsonl': (ctx, r) => {
    ctx.stmt('INSERT INTO categories VALUES (?, ?)').run(num(r._key), en(r.name) ?? '');
  },
  'groups.jsonl': (ctx, r) => {
    ctx
      .stmt('INSERT INTO groups VALUES (?, ?, ?, ?)')
      .run(num(r._key), num(r.categoryID), en(r.name) ?? '', bool(r.published));
  },
  'types.jsonl': (ctx, r) => {
    ctx
      .stmt('INSERT INTO types VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(
        num(r._key),
        num(r.groupID),
        en(r.name) ?? '',
        bool(r.published),
        num(r.factionID),
        num(r.raceID),
        num(r.metaGroupID),
      );
    // Every language for now; buildShipNames() keeps only the ships once the groups are known.
    if (r.published && r.name && typeof r.name === 'object') {
      const n = ctx.stmt('INSERT OR IGNORE INTO ship_names VALUES (?, ?, ?)');
      for (const [lang, name] of Object.entries(r.name as Record<string, unknown>))
        if (typeof name === 'string' && name.trim()) n.run(name.trim(), num(r._key), lang);
    }
  },
  'dogmaAttributes.jsonl': (ctx, r) => {
    ctx
      .stmt('INSERT INTO attributes VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        num(r._key),
        String(r.name ?? ''),
        en(r.displayName),
        num(r.unitID),
        r.highIsGood === undefined ? null : bool(r.highIsGood),
        num(r.defaultValue),
      );
  },
  'dogmaEffects.jsonl': (ctx, r) => {
    ctx
      .stmt('INSERT INTO effects VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        num(r._key),
        String(r.name ?? ''),
        en(r.displayName),
        num(r.rangeAttributeID),
        num(r.falloffAttributeID),
        num(r.durationAttributeID),
        num(r.npcActivationChanceAttributeID),
        bool(r.isOffensive),
        bool(r.isAssistance),
      );
  },
  'typeDogma.jsonl': (ctx, r) => {
    const typeId = num(r._key);
    const attrs = (r.dogmaAttributes as { attributeID: number; value: number }[] | undefined) ?? [];
    const effs = (r.dogmaEffects as { effectID: number; isDefault: boolean }[] | undefined) ?? [];
    const a = ctx.stmt('INSERT INTO type_attributes VALUES (?, ?, ?)');
    for (const x of attrs) a.run(typeId, x.attributeID, x.value);
    const e = ctx.stmt('INSERT INTO type_effects VALUES (?, ?, ?)');
    for (const x of effs) e.run(typeId, x.effectID, bool(x.isDefault));
  },
  'factions.jsonl': (ctx, r) => {
    ctx.stmt('INSERT INTO factions VALUES (?, ?)').run(num(r._key), en(r.name) ?? '');
  },
  'mapRegions.jsonl': (ctx, r) => {
    ctx.stmt('INSERT INTO regions VALUES (?, ?)').run(num(r._key), en(r.name) ?? '');
  },
  'mapSolarSystems.jsonl': (ctx, r) => {
    ctx
      .stmt('INSERT INTO systems VALUES (?, ?, ?, ?)')
      .run(num(r._key), en(r.name) ?? '', num(r.regionID), num(r.securityStatus));
  },
  'mapStargates.jsonl': (ctx, r) => {
    const to = num((r.destination as Row | undefined)?.solarSystemID);
    const from = num(r.solarSystemID);
    if (from === null || to === null) return;
    const j = ctx.stmt('INSERT OR IGNORE INTO jumps VALUES (?, ?)');
    j.run(from, to);
    j.run(to, from);
  },
  'missions.jsonl': (ctx, r) => {
    const kill = r.killMission as Row | undefined;
    const courier = r.courierMission as Row | undefined;
    const mission = kill ?? courier ?? {};
    const messages = (r.messages as ({ _key: string } & Row)[] | undefined) ?? [];
    const briefing = messages.find((m) => m._key === 'messages.mission.briefing');
    ctx
      .stmt('INSERT INTO missions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        num(r._key),
        en(r.name) ?? '',
        kill ? 'kill' : courier ? 'courier' : 'other',
        num(mission.dungeonID),
        num(mission.objectiveTypeID),
        num(mission.objectiveQuantity),
        num(mission.dropItemInMissionContainer),
        num(r.factionID),
        num(r.corporationID),
        briefing ? en(briefing) : null,
      );
  },
  'dungeons.jsonl': (ctx, r) => {
    ctx
      .stmt('INSERT INTO dungeons VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(
        num(r._key),
        en(r.name) ?? '',
        num(r.factionID),
        num(r.archetypeID),
        en(r.description),
        en(r.gameplayDescription),
        json(r.allowedShipsList),
      );
  },
  'archetypes.jsonl': (ctx, r) => {
    ctx.stmt('INSERT INTO archetypes VALUES (?, ?, ?)').run(num(r._key), en(r.title), en(r.description));
  },
  'typeLists.jsonl': (ctx, r) => {
    ctx
      .stmt('INSERT INTO type_lists VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(
        num(r._key),
        typeof r.name === 'string' ? r.name : en(r.name),
        json(r.includedGroupIDs),
        json(r.includedTypeIDs),
        json(r.excludedGroupIDs),
        json(r.excludedTypeIDs),
        json(r.includedCategoryIDs),
      );
  },
};

const CATEGORY_SHIP = 6;
const CATEGORY_ENTITY = 11;

/** Fills the FTS search table from the imported tables. One row per distinct name and kind. */
function buildSearch(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO search (name, kind, ref_id)
      SELECT name, 'mission', MIN(id) FROM missions WHERE name <> '' GROUP BY name;
    INSERT INTO search (name, kind, ref_id)
      SELECT name, 'dungeon', MIN(id) FROM dungeons WHERE name <> '' GROUP BY name;
    INSERT INTO search (name, kind, ref_id)
      SELECT t.name, 'npc', MIN(t.id) FROM types t JOIN groups g ON g.id = t.group_id
      WHERE g.category_id = ${CATEGORY_ENTITY} AND t.name <> '' GROUP BY t.name;
    INSERT INTO search (name, kind, ref_id)
      SELECT t.name, 'ship', MIN(t.id) FROM types t JOIN groups g ON g.id = t.group_id
      WHERE g.category_id = ${CATEGORY_SHIP} AND t.published = 1 GROUP BY t.name;
  `);
}

/**
 * Splits a byte stream on "\n" only. node:readline also breaks on U+2028/U+2029, which occur inside
 * mission texts in missions.jsonl and would cut JSON lines apart.
 */
async function* lines(stream: Readable): AsyncGenerator<string> {
  const decoder = new TextDecoder('utf-8');
  let rest = Buffer.alloc(0);
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    const data = rest.length ? Buffer.concat([rest, chunk]) : chunk;
    let start = 0;
    for (let nl = data.indexOf(0x0a); nl >= 0; nl = data.indexOf(0x0a, start)) {
      yield decoder.decode(data.subarray(start, nl));
      start = nl + 1;
    }
    rest = Buffer.from(data.subarray(start));
  }
  if (rest.length) yield decoder.decode(rest);
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.open(path, { lazyEntries: true, autoClose: true }, (err, zip) => (err ? reject(err) : resolve(zip))),
  );
}

function openEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) =>
    zip.openReadStream(entry, (err, stream) => (err ? reject(err) : resolve(stream))),
  );
}

const SHIP_CATEGORY_ID = 6;
/** Drops the names of everything that is not a ship (types.jsonl comes with every type's names). */
const SHIP_NAMES_SQL = `DELETE FROM ship_names WHERE type_id NOT IN (
  SELECT t.id FROM types t JOIN groups g ON g.id = t.group_id WHERE g.category_id = ${SHIP_CATEGORY_ID} AND t.published = 1)`;

/**
 * Imports `zipPath` into a new database at `dbPath`. Writes to `<dbPath>.tmp` first and renames on success,
 * so an existing database at `dbPath` stays usable if the import fails.
 */
export async function importSdeZip(
  zipPath: string,
  dbPath: string,
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportResult> {
  const started = Date.now();
  const tmpPath = `${dbPath}.tmp`;
  rmSync(tmpPath, { force: true });

  const db = new DatabaseSync(tmpPath);
  const statements = new Map<string, StatementSync>();
  const ctx: Context = {
    db,
    meta: new Map(),
    stmt: (sql) => {
      let s = statements.get(sql);
      if (!s) statements.set(sql, (s = db.prepare(sql)));
      return s;
    },
  };
  const rows: Record<string, number> = {};

  try {
    db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;');
    db.exec(SCHEMA_SQL);
    const zip = await openZip(zipPath);

    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName.split('/').pop() ?? entry.fileName;
        const handler = HANDLERS[name];
        if (!handler) {
          zip.readEntry();
          return;
        }
        void (async () => {
          const stream = await openEntry(zip, entry);
          let count = 0;
          db.exec('BEGIN');
          for await (const line of lines(stream)) {
            if (!line.trim()) continue;
            handler(ctx, JSON.parse(line) as Row);
            if (++count % 20000 === 0) onProgress?.({ file: name, rows: count });
          }
          db.exec('COMMIT');
          rows[name] = count;
          onProgress?.({ file: name, rows: count });
          zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });

    const missing = Object.keys(HANDLERS).filter((f) => !(f in rows));
    if (missing.length) throw new Error(`SDE zip is missing: ${missing.join(', ')}`);

    buildSearch(db);
    db.exec(SHIP_NAMES_SQL);
    const meta = db.prepare('INSERT INTO meta VALUES (?, ?)');
    meta.run('schemaVersion', String(SCHEMA_VERSION));
    meta.run('importedAt', new Date().toISOString());
    for (const [k, v] of ctx.meta) meta.run(k, v);
    db.exec('ANALYZE');
    db.exec('VACUUM'); // ship_names drops most of what types.jsonl put in it
    db.close();
  } catch (err) {
    if (db.isOpen) db.close();
    rmSync(tmpPath, { force: true });
    throw err;
  }

  if (existsSync(dbPath)) rmSync(dbPath);
  renameSync(tmpPath, dbPath);
  return {
    buildNumber: ctx.meta.has('buildNumber') ? Number(ctx.meta.get('buildNumber')) : null,
    releaseDate: ctx.meta.get('releaseDate') ?? null,
    rows,
    ms: Date.now() - started,
  };
}
