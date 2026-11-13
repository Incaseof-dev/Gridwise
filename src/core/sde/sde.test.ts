import { createWriteStream, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import yazl from 'yazl';
import { GameDataService } from './gameData';
import { importSdeZip } from './importer';

/** A tiny SDE with the shapes of the real files (docs/sde.md). Attribute IDs match the real SDE. */
const SDE: Record<string, object[]> = {
  '_sde.jsonl': [{ _key: 'sde', buildNumber: 42, releaseDate: '2026-10-12T11:08:38Z' }],
  'categories.jsonl': [
    { _key: 6, name: { en: 'Ship' } },
    { _key: 8, name: { en: 'Charge' } },
    { _key: 11, name: { en: 'Entity' } },
  ],
  'groups.jsonl': [
    { _key: 25, categoryID: 6, name: { en: 'Frigate' }, published: true },
    { _key: 26, categoryID: 6, name: { en: 'Cruiser' }, published: true },
    { _key: 384, categoryID: 8, name: { en: 'Light Missile' }, published: true },
    { _key: 613, categoryID: 11, name: { en: 'Deadspace Guristas Cruiser' }, published: false },
  ],
  'types.jsonl': [
    { _key: 587, groupID: 25, name: { en: 'Rifter', de: 'Rifter', zh: '裂谷级' }, published: true },
    { _key: 620, groupID: 26, name: { en: 'Osprey' }, published: true },
    { _key: 210, groupID: 384, name: { en: 'Scourge Light Missile' }, published: true },
    { _key: 1001, groupID: 613, name: { en: 'Pithum Silencer' }, published: false, factionID: 500010 },
    { _key: 1002, groupID: 613, name: { en: 'Test Scrambler' }, published: false },
    { _key: 1003, groupID: 613, name: { en: 'Test Scrambler' }, published: false },
  ],
  'dogmaAttributes.jsonl': [
    ['hp', 9],
    ['speed', 51],
    ['damageMultiplier', 64],
    ['entityWarpScrambleChance', 504],
    ['warpScrambleRange', 103],
    ['warpScrambleStrength', 105],
    ['emDamage', 114],
    ['explosiveDamage', 116],
    ['kineticDamage', 117],
    ['thermalDamage', 118],
    ['shieldCapacity', 263],
    ['armorHP', 265],
    ['shieldKineticDamageResonance', 273],
    ['entityKillBounty', 481],
    ['missileLaunchDuration', 506],
    ['entityMissileTypeID', 507],
    ['missileDamageMultiplier', 212],
  ].map(([name, id]) => ({ _key: id, name, published: false })),
  'dogmaEffects.jsonl': [
    { _key: 10, name: 'targetAttack' },
    { _key: 563, name: 'warpScrambleForEntity', rangeAttributeID: 103 },
    { _key: 569, name: 'missileLaunchingForEntity' },
    { _key: 9999, name: 'someNewNpcEffect' },
  ],
  'typeDogma.jsonl': [
    {
      _key: 210,
      dogmaAttributes: [{ attributeID: 117, value: 10 }],
      dogmaEffects: [],
    },
    {
      _key: 1001,
      dogmaAttributes: [
        { attributeID: 9, value: 700 },
        { attributeID: 263, value: 750 },
        { attributeID: 265, value: 625 },
        { attributeID: 273, value: 0.8 },
        { attributeID: 51, value: 2500 },
        { attributeID: 64, value: 3.75 },
        { attributeID: 117, value: 8 },
        { attributeID: 118, value: 6 },
        { attributeID: 481, value: 37500 },
        // Has scramble attributes but no scramble effect: must not count as a capability.
        { attributeID: 103, value: 15000 },
        { attributeID: 105, value: 1 },
        { attributeID: 504, value: 0 },
      ],
      dogmaEffects: [{ effectID: 10, isDefault: true }],
    },
    {
      _key: 1002,
      dogmaAttributes: [
        { attributeID: 103, value: 20000 },
        { attributeID: 105, value: 2 },
        { attributeID: 504, value: 0.25 },
        { attributeID: 507, value: 210 },
        { attributeID: 212, value: 2 },
        { attributeID: 506, value: 4000 },
      ],
      dogmaEffects: [
        { effectID: 563, isDefault: false },
        { effectID: 569, isDefault: false },
        { effectID: 9999, isDefault: false },
      ],
    },
  ],
  'factions.jsonl': [{ _key: 500010, name: { en: 'Guristas Pirates' } }],
  'mapRegions.jsonl': [{ _key: 10000002, name: { en: 'The Forge' } }],
  'mapSolarSystems.jsonl': [
    { _key: 30000142, name: { en: 'Jita' }, regionID: 10000002, securityStatus: 0.9459 },
    { _key: 30000144, name: { en: 'Perimeter' }, regionID: 10000002, securityStatus: 0.95 },
    { _key: 30000145, name: { en: 'New Caldari' }, regionID: 10000002, securityStatus: 1.0 },
  ],
  'mapStargates.jsonl': [
    { _key: 50000001, solarSystemID: 30000142, destination: { solarSystemID: 30000144, stargateID: 50000002 } },
    { _key: 50000002, solarSystemID: 30000144, destination: { solarSystemID: 30000142, stargateID: 50000001 } },
    { _key: 50000003, solarSystemID: 30000142, destination: { solarSystemID: 30000145, stargateID: 50000004 } },
  ],
  'missions.jsonl': [
    {
      _key: 1,
      name: { en: 'The Blockade' },
      killMission: { dungeonID: 500, objectiveQuantity: 0 },
      // U+2028 inside a string must not split the JSON line.
      messages: [{ _key: 'messages.mission.briefing', en: 'Pirates set up a blockade. Clear it.' }],
    },
    { _key: 2, name: { en: 'The Blockade' }, killMission: { dungeonID: 501 } },
    {
      _key: 3,
      name: { en: 'Smuggler Interception' },
      killMission: { dungeonID: 502, objectiveTypeID: 587, objectiveQuantity: 1, dropItemInMissionContainer: 1 },
    },
    { _key: 4, name: { en: 'Courier Job' }, courierMission: { objectiveTypeID: 587, objectiveQuantity: 5 } },
  ],
  'dungeons.jsonl': [
    {
      _key: 43,
      name: { en: 'Pith Merchant Depot' },
      factionID: 500010,
      archetypeID: 24,
      allowedShipsList: [478],
      description: { en: 'DED Threat Assessment: Minor (2 of 10)' },
    },
    { _key: 44, name: { en: 'Open Site' }, archetypeID: 24 },
    { _key: 45, name: { en: 'Rookie Site' }, archetypeID: 24, allowedShipsList: [238] },
    { _key: 46, name: { en: 'Amarr Small Outpost' }, archetypeID: 34 },
    { _key: 47, name: { en: 'Event Thing' }, archetypeID: 43 },
  ],
  'archetypes.jsonl': [
    {
      _key: 24,
      title: { en: 'Combat Sites' },
      description: { en: 'Combat Sites are locations featuring hostile forces.' },
    },
    { _key: 34, title: { en: 'Small Complex' }, description: { en: 'Factional Warfare sites that can be captured.' } },
    { _key: 43, title: { en: 'None' }, description: { en: 'These sites available during Seasonal Events.' } },
  ],
  'typeLists.jsonl': [
    { _key: 478, name: 'Dungeon Ship Restrictions [43]', includedGroupIDs: [25] },
    { _key: 238, name: 'Class 1 ships', includedTypeIDs: [587] },
  ],
};

let dir: string;
let dbPath: string;
let gd: GameDataService;

function writeZip(path: string, files: Record<string, object[]>): Promise<void> {
  const zip = new yazl.ZipFile();
  for (const [name, rows] of Object.entries(files)) {
    zip.addBuffer(Buffer.from(rows.map((r) => JSON.stringify(r)).join('\n') + '\n'), name);
  }
  zip.end();
  return new Promise((resolve, reject) => {
    zip.outputStream.pipe(createWriteStream(path)).on('close', resolve).on('error', reject);
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'eve-sde-'));
  dbPath = join(dir, 'sde.sqlite');
  await writeZip(join(dir, 'sde.zip'), SDE);
  const res = await importSdeZip(join(dir, 'sde.zip'), dbPath);
  expect(res.buildNumber).toBe(42);
  gd = new GameDataService(dbPath);
});

afterAll(() => {
  gd?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('importSdeZip', () => {
  it('stores build metadata', () => {
    expect(gd.buildNumber).toBe(42);
    expect(gd.meta('releaseDate')).toBe('2026-10-12T11:08:38Z');
  });

  it('keeps the existing index when an import fails', async () => {
    const { 'missions.jsonl': _omit, ...incomplete } = SDE;
    const bad = join(dir, 'bad.zip');
    await writeZip(bad, incomplete);
    writeFileSync(join(dir, 'keep.sqlite'), 'old');
    await expect(importSdeZip(bad, join(dir, 'keep.sqlite'))).rejects.toThrow(/missing: missions.jsonl/);
    expect(existsSync(join(dir, 'keep.sqlite'))).toBe(true);
    expect(existsSync(join(dir, 'keep.sqlite.tmp'))).toBe(false);
  });
});

describe('GameDataService', () => {
  it('reads the stargate links both ways, even from a gate listed on one side only', () => {
    const g = gd.jumpGraph();
    expect([...g.get(30000142)!].sort()).toEqual([30000144, 30000145]);
    expect(g.get(30000145)).toEqual([30000142]);
  });

  it('keeps ship names in every language and drops other types', () => {
    const names = gd.shipNames();
    expect(
      names
        .filter((n) => n.typeId === 587)
        .map((n) => n.name)
        .sort(),
    ).toEqual(['Rifter', '裂谷级']);
    expect(names.find((n) => n.name === '裂谷级')).toEqual({
      name: '裂谷级',
      typeId: 587,
      en: 'Rifter',
      group: 'Frigate',
    });
    expect(names.some((n) => n.typeId === 210)).toBe(false);
  });

  it('finds types by name, returning every type that shares the name', () => {
    expect(gd.typesByName('rifter').map((t) => t.id)).toEqual([587]);
    expect(gd.typesByName('Test Scrambler', 11).map((t) => t.id)).toEqual([1002, 1003]);
    expect(gd.typesByName('Rifter', 11)).toEqual([]);
  });

  it('builds an NPC profile: HP, resists with defaults, recommended damage, turret DPS', () => {
    const p = gd.npcProfile(1001)!;
    expect(p.factionName).toBe('Guristas Pirates');
    expect(p.hp).toEqual({ shield: 750, armor: 625, hull: 700 });
    expect(p.resonance.shield.kinetic).toBe(0.8);
    expect(p.resonance.shield.em).toBe(1); // missing attribute → no resistance
    expect(p.recommendedDamage[0]!.type).not.toBe('kinetic');
    expect(p.turret).toMatchObject({ kinetic: 12, thermal: 9, dps: 21 });
    expect(p.missile).toBeNull();
    expect(p.bounty).toBe(37500);
  });

  it('does not report a capability from attributes alone', () => {
    expect(gd.npcProfile(1001)!.capabilities).toEqual([]);
  });

  it('reports capabilities from effects, with legacy chance, range and strength', () => {
    const p = gd.npcProfile(1002)!;
    expect(p.capabilities).toEqual([
      { kind: 'warpScramble', effect: 'warpScrambleForEntity', chance: 0.25, range: 20000, strength: 2 },
    ]);
    expect(p.unmappedEffects).toEqual(['someNewNpcEffect']);
  });

  it('computes missile DPS from the missile type', () => {
    expect(gd.npcProfile(1002)!.missile).toEqual({
      typeId: 210,
      name: 'Scourge Light Missile',
      dps: 5,
      damage: { em: 0, thermal: 0, kinetic: 5, explosive: 0 },
    });
  });

  it('searches missions, sites, NPCs and ships by substring', () => {
    expect(gd.search('blockade')).toEqual([{ kind: 'mission', name: 'The Blockade', refId: 1 }]);
    expect(gd.search('merchant').map((h) => h.kind)).toEqual(['dungeon']);
    expect(gd.search('silen', { kinds: ['npc'] }).map((h) => h.name)).toEqual(['Pithum Silencer']);
    expect(gd.search('rif').map((h) => h.kind)).toEqual(['ship']);
    expect(gd.search('Os').map((h) => h.name)).toEqual(['Osprey']);
    expect(gd.search('Scourge')).toEqual([]); // charges are not searchable
  });

  it('returns all mission variants with objectives and intact briefings', () => {
    const v = gd.missionVariants('the blockade');
    expect(v.map((m) => m.id)).toEqual([1, 2]);
    expect(v[0]!.briefing).toBe('Pirates set up a blockade. Clear it.');
    expect(gd.missionVariants('Smuggler Interception')[0]).toMatchObject({
      objectiveTypeName: 'Rifter',
      objectiveQuantity: 1,
      objectiveInContainer: true,
    });
    expect(gd.missionVariants('Courier Job')[0]!.kind).toBe('courier');
  });

  it('resolves dungeon gate restrictions to ship groups', () => {
    expect(gd.dungeon(43)).toMatchObject({
      name: 'Pith Merchant Depot',
      factionName: 'Guristas Pirates',
      allowedShipGroups: [{ id: 25, name: 'Frigate' }],
    });
    expect(gd.dungeon(44)!.allowedShipGroups).toBeNull();
    expect(gd.dungeon(45)!.allowedShipGroups).toEqual([{ id: 587, name: 'Rifter' }]);
  });

  it('names the site category from its archetype', () => {
    expect(gd.dungeon(43)!.category).toBe('Combat site');
    expect(gd.dungeon(46)!.category).toBe('FW Small Complex');
    expect(gd.dungeon(47)!.category).toBeNull();
  });

  it('looks up solar systems by name', () => {
    expect(gd.systemNames().map((x) => x.name)).toEqual(['Jita', 'New Caldari', 'Perimeter']);
    expect(gd.systemByName('jita')).toEqual({ id: 30000142, name: 'Jita', regionName: 'The Forge', security: 0.9459 });
  });
});
