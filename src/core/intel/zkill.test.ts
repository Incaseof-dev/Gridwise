import { describe, expect, it } from 'vitest';
import { migrateSettings } from '../settings';
import { IntelAlerts, killSide } from './view';
import { KillBoard, parseR2z2, R2Z2_BASE, ZKILL_USER_AGENT, ZkillFeed, type ZkillKill } from './zkill';

/** The shape of a real R2Z2 package (2026-11-12), ids made up. */
const pkg = (over: { npc?: boolean; id?: number; system?: number; time?: string } = {}) => ({
  killmail_id: over.id ?? 1001,
  hash: 'abc',
  esi: {
    attackers: [
      { character_id: 1, ship_type_id: 22456, final_blow: true, corporation_id: 98000001, alliance_id: 99000001 },
      { character_id: 2, ship_type_id: 22456, corporation_id: 98000001, alliance_id: 99000001 },
      { character_id: 3, ship_type_id: 11198, corporation_id: 98000002 },
      { character_id: 4, corporation_id: 98000002 },
      { faction_id: 500003, ship_type_id: 3001, corporation_id: 1000125 },
    ],
    killmail_id: over.id ?? 1001,
    killmail_time: over.time ?? '2026-11-12T12:51:12Z',
    solar_system_id: over.system ?? 30000142,
    victim: { character_id: 9, ship_type_id: 17478, corporation_id: 98000009, alliance_id: 99000009, items: [] },
  },
  zkb: { npc: over.npc ?? false, attackerCount: 5, totalValue: 123_000_000, labels: [] },
  uploaded_at: 1,
  sequence_id: 5,
});

describe('parseR2z2', () => {
  it('reads system, time, victim and the attacking pilots’ ships, without the NPCs', () => {
    expect(parseR2z2(pkg())).toEqual({
      killmailId: 1001,
      timeMs: Date.UTC(2026, 10, 12, 12, 51, 12),
      systemId: 30000142,
      victimShipTypeId: 17478,
      attackerShipTypeIds: [22456, 22456, 11198],
      attackers: 4,
      value: 123_000_000,
      victimCorp: 98000009,
      victimAlliance: 99000009,
      attackerCorps: [98000001, 98000002],
      attackerAlliances: [99000001],
    });
  });

  it('drops NPC kills and malformed packages', () => {
    expect(parseR2z2(pkg({ npc: true }))).toBeNull();
    expect(parseR2z2({ killmail_id: 1 })).toBeNull();
    expect(parseR2z2(null)).toBeNull();
  });
});

describe('ZkillFeed', () => {
  it('starts at the pointer, walks the numbers, waits on 404 and sends the User-Agent', async () => {
    const seen: { url: string; ua: string | null }[] = [];
    const answers: Record<string, () => Response> = {
      [`${R2Z2_BASE}/sequence.json`]: () => Response.json({ sequence: 50 }),
      [`${R2Z2_BASE}/50.json`]: () => Response.json(pkg({ id: 1 })),
      [`${R2Z2_BASE}/51.json`]: () => Response.json(pkg({ id: 2, npc: true })),
      [`${R2Z2_BASE}/52.json`]: () => Response.json(pkg({ id: 3 })),
    };
    const sleeps: number[] = [];
    let feed: ZkillFeed | null = null;
    const done = new Promise<void>((resolve) => {
      feed = new ZkillFeed({
        fetch: (async (url: string, init?: RequestInit) => {
          seen.push({ url, ua: new Headers(init?.headers).get('User-Agent') });
          return answers[url]?.() ?? new Response(null, { status: 404 });
        }) as typeof fetch,
        sleep: async (ms) => {
          sleeps.push(ms);
          if (ms === 6000) {
            feed!.stop();
            resolve();
          }
        },
      });
    });
    const kills: ZkillKill[] = [];
    feed!.on('kill', (k) => kills.push(k));
    feed!.start();
    await done;
    expect(kills.map((k) => k.killmailId)).toEqual([1, 3]);
    expect(seen.map((s) => s.url.replace(`${R2Z2_BASE}/`, ''))).toEqual([
      'sequence.json',
      '50.json',
      '51.json',
      '52.json',
      '53.json',
    ]);
    expect(seen.every((s) => s.ua === ZKILL_USER_AGENT)).toBe(true);
    expect(sleeps).toEqual([100, 100, 100, 6000]);
    expect(feed!.status).toMatchObject({ state: 'stopped', kills: 2 });
  });

  it('backs off for an hour when blocked', async () => {
    let feed: ZkillFeed | null = null;
    const slept = await new Promise<number>((resolve) => {
      feed = new ZkillFeed({
        fetch: (async (url: string) =>
          url.endsWith('sequence.json')
            ? Response.json({ sequence: 1 })
            : new Response(null, { status: 403 })) as typeof fetch,
        sleep: async (ms) => {
          feed!.stop();
          resolve(ms);
        },
      });
      feed.start();
    });
    expect(slept).toBe(3600_000);
    expect(feed!.status.lastError).toMatch(/403/);
  });
});

describe('KillBoard', () => {
  const k = (id: number, timeMs: number): ZkillKill => ({
    killmailId: id,
    timeMs,
    systemId: 1,
    victimShipTypeId: null,
    victimCorp: null,
    victimAlliance: null,
    attackerCorps: [],
    attackerAlliances: [],
    attackerShipTypeIds: [],
    attackers: 1,
    value: 0,
  });

  it('keeps each kill once, newest first, and forgets old ones', () => {
    const b = new KillBoard(10 * 60_000);
    expect(b.add(k(1, 0), 60_000)).toBe(true);
    expect(b.add(k(1, 0), 60_000)).toBe(false);
    expect(b.add(k(2, 120_000), 130_000)).toBe(true);
    expect(b.add(k(3, 0), 11 * 60_000)).toBe(false);
    expect(b.active(130_000).map((x) => x.killmailId)).toEqual([2, 1]);
    expect(b.active(10 * 60_000 + 1).map((x) => x.killmailId)).toEqual([2]);
  });

  it('clears a system by hand, and its kills do not come back', () => {
    const b = new KillBoard(10 * 60_000);
    b.add(k(1, 0), 0);
    b.add({ ...k(2, 0), systemId: 7 }, 0);
    expect(b.removeSystem(1)).toBe(true);
    expect(b.add(k(1, 0), 0)).toBe(false);
    expect(b.active(0).map((x) => x.killmailId)).toEqual([2]);
  });
});

describe('IntelAlerts.kills', () => {
  const s = migrateSettings({}, '/h').intel;
  const ships: Record<number, { name: string; cls: string }> = {
    22456: { name: 'Sabre', cls: 'Interdictor' },
    11198: { name: 'Stiletto', cls: 'Interceptor' },
    17478: { name: 'Retriever', cls: 'Mining Barge' },
  };
  const kill = parseR2z2(pkg())!;

  it('lists kills within range with victim and attacker ships, most flown first, and sounds once', () => {
    const a = new IntelAlerts();
    const args = [
      (id: number) => (id === 30000142 ? 1 : null),
      () => ({ name: 'Jita', security: 0.9 }),
      (t: number) => ships[t] ?? null,
      s,
    ] as const;
    const r = a.kills([kill], ...args);
    expect(r.kills[0]).toMatchObject({
      system: 'Jita',
      jumps: 1,
      victim: { name: 'Retriever', cls: 'Mining Barge' },
      attackers: 4,
      attackerShips: [ships[22456], ships[11198]],
      level: 'warning',
    });
    expect(r.kills[0]!.weight).toBeLessThan(1);
    expect(r.alert).toEqual({ seq: 1, level: 'warning' });
    expect(a.kills([kill], ...args).alert?.seq).toBe(1);
    expect(
      a.kills([kill], () => 7, ...(args.slice(1) as [(typeof args)[1], (typeof args)[2], (typeof args)[3]])).kills,
    ).toEqual([]);
  });

  it('shows a kill without a sound when the kill sound is off, and does not replay it when turned back on', () => {
    const a = new IntelAlerts();
    const quiet = { ...s, zkill: { ...s.zkill, sound: false } };
    const look = [
      (id: number) => (id === 30000142 ? 1 : null),
      () => ({ name: 'Jita', security: 0.9 }),
      () => null,
    ] as const;
    const r = a.kills([kill], ...look, quiet);
    expect(r.kills).toHaveLength(1);
    expect(r.alert).toBeNull();
    expect(a.kills([kill], ...look, s).alert).toBeNull();
  });

  it('tells our side from the pilot’s corporation and alliance: a loss first, then a kill', () => {
    expect(killSide(kill, null)).toBeNull();
    expect(killSide(kill, { corporationId: 1, allianceId: null })).toBeNull();
    expect(killSide(kill, { corporationId: 98000009, allianceId: null })).toBe('loss');
    expect(killSide(kill, { corporationId: 5, allianceId: 99000009 })).toBe('loss');
    expect(killSide(kill, { corporationId: 98000002, allianceId: null })).toBe('kill');
    expect(killSide(kill, { corporationId: 5, allianceId: 99000001 })).toBe('kill');
    expect(killSide({ ...kill, attackerCorps: [98000009] }, { corporationId: 98000009, allianceId: null })).toBe(
      'loss',
    );
    const a = new IntelAlerts();
    const r = a.kills(
      [kill],
      (id) => (id === 30000142 ? 1 : null),
      () => ({ name: 'Jita', security: 0.9 }),
      () => null,
      s,
      {
        corporationId: 98000002,
        allianceId: null,
      },
    );
    expect(r.kills[0]!.side).toBe('kill');
    // Blues: a friendly alliance's loss is ours, a blue corporation among the attackers is our kill.
    const us = { corporationId: 1, allianceId: 2 };
    expect(killSide(kill, { ...us, blueAlliances: new Set([99000009]) })).toBe('loss');
    expect(killSide(kill, { ...us, blueCorps: new Set([98000002]) })).toBe('kill');
    expect(killSide(kill, { ...us, blueCorps: new Set(), blueAlliances: new Set() })).toBeNull();
  });

  it('normalises the zKillboard settings', () => {
    expect(s.zkill).toEqual({ mode: 'quiet', quietMin: 5, keepMin: 15, sound: true, blues: false });
    expect(
      migrateSettings({ intel: { zkill: { mode: 'loud', quietMin: 0, keepMin: 999 } } }, '/h').intel.zkill,
    ).toEqual({
      mode: 'quiet',
      quietMin: 1,
      keepMin: 120,
      sound: true,
      blues: false,
    });
    expect(migrateSettings({ intel: { zkill: { sound: false } } }, '/h').intel.zkill.sound).toBe(false);
  });

  it('keeps the graph names setting, the names only where something is by default', () => {
    expect(s.graphNames).toBe('marked');
    expect(migrateSettings({ intel: { graphNames: 'all' } }, '/h').intel.graphNames).toBe('all');
    expect(migrateSettings({ intel: { graphNames: 'some' } } as never, '/h').intel.graphNames).toBe('marked');
  });
});
