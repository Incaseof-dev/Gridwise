import { describe, expect, it, vi } from 'vitest';
import { cargoDiff, lootValue, parseLootPaste } from '../abyss/loot';
import { buildRunTree } from '../abyss/logTree';
import type { AbyssLogEntry, EwbAbyssRun } from '../abyss/types';
import { DEFAULT_EWB_API, migrateSettings, normalizeApiBase, syncEwbFits, type SavedFit } from '../settings';
import { EwbClient, field, type EwbFetch } from './client';
import { entryCharacterId, telemetryFor, uploadBlocker, uuidFrom } from './telemetry';

const IDS: Record<string, number> = {
  'Triglavian Survey Database': 48121,
  'Calm Dark Filament': 47762,
  'Mutated Large Shield Extender': 47820,
};
const typeId = (n: string) => IDS[n] ?? null;

describe('loot paste', () => {
  it('reads the cargo list columns, any thousands separator, and adds up the same item', () => {
    const p = parseLootPaste(
      [
        'Triglavian Survey Database\t1 234\tAbyssal Materials\tMaterial\t\t\t12,34 m3\t123 400 ISK',
        'Triglavian Survey Database\t6\tAbyssal Materials',
        'Calm Dark Filament\t\tAbyssal Filaments',
        'Mutated Large Shield Extender*\t1',
        '',
      ].join('\r\n'),
      typeId,
    );
    expect(p.items).toEqual([
      { name: 'Triglavian Survey Database', typeId: 48121, count: 1240 },
      { name: 'Calm Dark Filament', typeId: 47762, count: 1 },
      { name: 'Mutated Large Shield Extender', typeId: 47820, count: 1 },
    ]);
    expect(p.skipped).toEqual([]);
  });

  it('reads "Name x 3" and "3 x Name", keeps unknown lines aside', () => {
    const p = parseLootPaste('Triglavian Survey Database x 3\n2 x Calm Dark Filament\nSomething Else', typeId);
    expect(p.items.map((i) => [i.name, i.count])).toEqual([
      ['Triglavian Survey Database', 3],
      ['Calm Dark Filament', 2],
    ]);
    expect(p.skipped).toEqual(['Something Else']);
  });

  it('values the loot where there are prices', () => {
    const items = parseLootPaste('Triglavian Survey Database\t10\nCalm Dark Filament\t1', typeId).items;
    expect(lootValue(items, (id) => (id === 48121 ? 100_000 : null))).toBe(1_000_000);
    expect(lootValue(items, () => null)).toBeNull();
  });

  it('takes the loot as what grew in the cargo, and what shrank as used up (EVE-93)', () => {
    const before = parseLootPaste('Calm Dark Filament\t3\nTriglavian Survey Database\t2', typeId).items;
    const after = parseLootPaste('Calm Dark Filament\t2\nTriglavian Survey Database\t12', typeId).items;
    const { gained, lost } = cargoDiff(before, after);
    expect(gained).toMatchObject([{ name: 'Triglavian Survey Database', count: 10 }]);
    expect(lost).toMatchObject([{ name: 'Calm Dark Filament', count: 1 }]);
    expect(cargoDiff([], after).gained).toEqual(after);
  });
});

function entry(over: Partial<AbyssLogEntry> = {}): AbyssLogEntry {
  return {
    id: '1000001-1792964779000',
    character: 'Test Pilot',
    enteredAt: '2026-10-25T21:46:19.000Z',
    exitedAt: '2026-10-25T21:58:19.000Z',
    clearSeconds: 720,
    outcome: 'completed',
    approximate: false,
    origin: 'Somewhere',
    weather: 'dark',
    tier: 3,
    tierSource: 'npc',
    ship: 'Jackdaw',
    rooms: [
      {
        startS: 20,
        endS: 200,
        npcs: [
          { name: 'Striking Damavik', firstS: 20, lastS: 150, damageToUs: 100, damageByUs: 5000, ewar: [] },
          { name: 'Triglavian Biocombinative Cache', firstS: 40, lastS: 60, damageToUs: 0, damageByUs: 600, ewar: [] },
        ],
      },
      { startS: 230, endS: 400, npcs: [] },
      { startS: 430, endS: 700, npcs: [] },
    ],
    dealt: 5600,
    taken: 100,
    loot: {
      items: [{ name: 'Triglavian Survey Database', typeId: 48121, count: 10 }],
      skipped: [],
      savedAt: '2026-10-25T22:00:00.000Z',
      value: 1_000_000,
    },
    ...over,
  };
}

describe('Abyss Tracker telemetry', () => {
  const ship = {
    name: 'Jackdaw',
    typeId: 34828,
    hullType: 'Destroyer',
    eft: '[Jackdaw, Test]',
    fitName: 'Test',
    ewbFitId: null,
  };

  it('maps a log entry to the tracker fields', () => {
    const t = telemetryFor({
      entry: entry(),
      characterId: 1000001,
      privacy: 'private',
      ship,
      price: (id) => (id === 48121 ? 100_000 : null),
    });
    expect(t).toMatchObject({
      privacy: 'PRIVATE',
      shipType: 'Destroyer',
      runStartTime: 1792964779,
      runDurationSeconds: 720,
      weather: 'Dark',
      tier: 3,
      characterId: 1000001,
      success: true,
      lootGainedPrice: 1_000_000,
      lootGained: [{ name: 'Triglavian Survey Database', count: 10, typeId: 48121 }],
      lootLost: [],
      cansSpawned: 3,
      cansLooted: 1,
    });
    expect(t.rooms[0]!.spawn).toEqual([
      { name: 'Striking Damavik', count: 1, npc: true },
      { name: 'Triglavian Biocombinative Cache', count: 1, npc: false },
    ]);
    expect(t.ships[0]).toMatchObject({ shipName: 'Jackdaw', shipTypeId: 34828, eft: '[Jackdaw, Test]' });
  });

  it('keeps the record id of an entry, so a second upload replaces the run', () => {
    const a = telemetryFor({ entry: entry(), characterId: 1, privacy: 'public', ship, price: () => null });
    const b = telemetryFor({ entry: entry({ tier: 4 }), characterId: 1, privacy: 'public', ship, price: () => null });
    expect(a.recordUuid).toBe(b.recordUuid);
    expect(a.recordUuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidFrom('x')).not.toBe(uuidFrom('y'));
    expect(a.privacy).toBe('PUBLIC');
  });

  it('sends what the run used up as lost loot (EVE-93)', () => {
    const e = entry();
    const t = telemetryFor({
      entry: { ...e, loot: { ...e.loot!, lost: [{ name: 'Calm Dark Filament', typeId: 47762, count: 1 }] } },
      characterId: 1,
      privacy: 'private',
      ship,
      price: (id) => (id === 47762 ? 500_000 : id === 48121 ? 100_000 : null),
    });
    expect(t.lootLost).toEqual([{ name: 'Calm Dark Filament', count: 1, typeId: 47762 }]);
    expect(t.lootLostPrice).toBe(500_000);
    expect(t.lootGainedPrice).toBe(1_000_000);
  });

  it('sends a lost run without loot, and says why an entry cannot go up', () => {
    const lost = entry({ outcome: 'lost', clearSeconds: null, loot: null });
    expect(uploadBlocker(lost)).toBeNull();
    const t = telemetryFor({ entry: lost, characterId: 1, privacy: 'private', ship, price: () => 1 });
    expect(t.success).toBe(false);
    expect(t.lootGained).toEqual([]);
    expect(t.runDurationSeconds).toBe(720);
    expect(uploadBlocker(entry({ loot: null }))).toMatch(/loot/);
    expect(uploadBlocker(entry({ weather: null }))).toMatch(/weather/);
    expect(entryCharacterId(entry({ characterId: undefined }))).toBe(1000001);
  });
});

const ewbRun = (over: Partial<EwbAbyssRun>): EwbAbyssRun => ({
  id: 'r1',
  dateAdded: '2026-10-20T10:00:00',
  weather: 'dark',
  tier: 3,
  hullType: 'Destroyer',
  survived: true,
  seconds: 800,
  lootValue: 5_000_000,
  loot: [],
  ...over,
});

describe('Abyss log tree', () => {
  it('groups tier → weather → runs, higher tiers first, and shows an uploaded run once', () => {
    const tree = buildRunTree(
      [
        entry({ id: 'a', upload: { runId: 'r1', at: '2026-10-25T22:01:00Z', privacy: 'private' } }),
        entry({ id: 'b', tier: 1, weather: 'gamma', enteredAt: '2026-10-24T10:00:00Z' }),
        entry({ id: 'c', tier: null, weather: null }),
      ],
      [ewbRun({}), ewbRun({ id: 'r2', weather: 'exotic' })],
    );
    expect(tree.map((t) => t.name)).toEqual(['T3 Fierce', 'T1 Calm', 'Unknown tier']);
    expect(tree[0]!.weathers.map((w) => [w.weather, w.runs.map((r) => r.key)])).toEqual([
      ['dark', ['a']],
      ['exotic', ['ewb:r2']],
    ]);
    expect(tree[0]!.weathers[0]!.runs[0]!.ewb?.id).toBe('r1');
  });
});

describe('EVE Workbench fits', () => {
  it('replace their earlier copies and keep their first-seen time', () => {
    const paste: SavedFit = { id: 'p', eft: 'x', shipName: 'Hawk', name: 'p', source: 'paste', savedAt: 't0' };
    const first = syncEwbFits([paste], [{ fitId: 'f1', hash: 'h1', name: 'A', shipName: 'Jackdaw', eft: 'e1' }], 't1');
    const second = syncEwbFits(first, [{ fitId: 'f1', hash: 'h2', name: 'A2', shipName: 'Jackdaw', eft: 'e2' }], 't2');
    expect(second).toEqual([
      paste,
      {
        id: 'ewb-f1',
        eft: 'e2',
        shipName: 'Jackdaw',
        name: 'A2',
        source: 'ewb',
        savedAt: 't1',
        ewb: { fitId: 'f1', hash: 'h2' },
      },
    ]);
    expect(syncEwbFits(second, [], 't3')).toEqual([paste]);
  });
});

describe('EVE Workbench client', () => {
  function setup(answer: (url: string, init: Parameters<EwbFetch>[1]) => { status: number; body?: unknown }) {
    const calls: { url: string; init: Parameters<EwbFetch>[1] }[] = [];
    const fetch: EwbFetch = async (url, init) => {
      calls.push({ url, init });
      const a = answer(url, init);
      return { status: a.status, json: async () => a.body ?? null };
    };
    return { client: new EwbClient(() => 'KEY', fetch), calls };
  }

  it('reads fields in any letter case', () => {
    expect(field({ NumberOfPages: 3 }, 'numberOfPages')).toBe(3);
    expect(field({ runId: 'x' }, 'runId')).toBe('x');
  });

  it('sends the key and reads runs in PascalCase', async () => {
    const { client, calls } = setup(() => ({
      status: 200,
      body: {
        NumberOfPages: 2,
        Runs: [
          {
            Id: 'r1',
            AbyssWeather: 'Firestorm',
            AbyssTier: 'Raging',
            Survived: true,
            TimeSpend: 900,
            LootValue: 12.5e6,
            HullType: 'Cruiser',
            DateAdded: '2026-10-21T12:33:29',
            Loot: [{ Type: 'Triglavian Survey Database', TypeId: 48121, Amount: 50, TotalSellPrice: 5e6 }],
          },
        ],
      },
    }));
    const r = await client.runs();
    expect(calls[0]!.url).toBe('https://api.eveworkbench.com/v1/abyss-tracker/get-runs?page=1');
    expect(calls[0]!.init.headers['X-API-KEY']).toBe('KEY');
    expect(r.pages).toBe(2);
    expect(r.runs[0]).toMatchObject({ id: 'r1', weather: 'firestorm', tier: 4, seconds: 900, lootValue: 12.5e6 });
    expect(r.runs[0]!.loot[0]).toEqual({ name: 'Triglavian Survey Database', typeId: 48121, count: 50, value: 5e6 });
  });

  it('turns a refused key, an error answer and a rate limit into messages', async () => {
    await expect(setup(() => ({ status: 401 })).client.characters()).rejects.toThrow(/refused the key/);
    await expect(
      setup(() => ({ status: 200, body: { error: true, message: 'Bad tier' } })).client.upload(
        {} as Parameters<EwbClient['upload']>[0],
      ),
    ).rejects.toThrow('Bad tier');
    await expect(setup(() => ({ status: 429 })).client.fits()).rejects.toThrow(/wait/);
  });

  it('prefers sell prices', async () => {
    const { client } = setup(() => ({
      status: 200,
      body: {
        prices: [
          { typeId: 1, price: 10, orderType: 'Buy' },
          { typeId: 1, price: 12, orderType: 'Sell' },
          { typeId: 2, price: 5, orderType: 'Sell' },
          { typeId: 2, price: 4, orderType: 'Buy' },
        ],
      },
    }));
    const price = await client.price();
    expect([price(1), price(2), price(3)]).toEqual([12, 5, null]);
  });
});

describe('EVE Workbench API server', () => {
  it('takes https servers only, without a trailing slash', () => {
    expect(normalizeApiBase(' https://api.staging.eveworkbench.com/ ')).toBe('https://api.staging.eveworkbench.com');
    expect(normalizeApiBase('http://api.staging.eveworkbench.com')).toBeNull();
    expect(normalizeApiBase('https://x.example/api?x=1')).toBeNull();
    expect(normalizeApiBase('nonsense')).toBeNull();
  });

  it('defaults to the live server, and keeps a valid other one', () => {
    expect(migrateSettings({}, '/h').ewb).toEqual({ privacy: 'private', apiBase: DEFAULT_EWB_API });
    expect(migrateSettings({ ewb: { apiBase: 'ftp://x' } }, '/h').ewb.apiBase).toBe(DEFAULT_EWB_API);
    expect(migrateSettings({ ewb: { apiBase: 'https://api.staging.eveworkbench.com' } }, '/h').ewb.apiBase).toBe(
      'https://api.staging.eveworkbench.com',
    );
  });

  it('sends the calls to the server it is given', async () => {
    const urls: string[] = [];
    const client = new EwbClient(
      () => 'KEY',
      async (url) => {
        urls.push(url);
        return { status: 200, json: async () => [] };
      },
      () => 'https://api.staging.eveworkbench.com',
    );
    await client.characters();
    expect(urls).toEqual(['https://api.staging.eveworkbench.com/v1/characters']);
  });
});

describe('EVE Workbench call times', () => {
  it('reports each call, and gives up on a server that does not answer', async () => {
    const calls: unknown[] = [];
    const hang: EwbFetch = (_url, init) =>
      new Promise((_ok, fail) => init.signal?.addEventListener('abort', () => fail(new Error('aborted'))));
    const client = new EwbClient(() => 'KEY', hang);
    client.onCall = (c) => calls.push(c);
    vi.useFakeTimers();
    try {
      const p = client.characters();
      const caught = p.catch((e: Error) => e.message);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await caught).toMatch(/did not answer in 30 s/);
    } finally {
      vi.useRealTimers();
    }
    expect(calls).toMatchObject([{ method: 'GET', path: '/v1/characters', status: null }]);
  });
});
