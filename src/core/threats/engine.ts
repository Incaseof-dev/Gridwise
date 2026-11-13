/**
 * Rule-based threat assessment (task 015). Deterministic: the same engagement and time give the same list.
 *
 * Principles (brief §4.2, docs/architecture.md §5):
 * - Observed (log evidence) and known (SDE/KB capability) are kept apart; a known capability is never
 *   presented as being used.
 * - Warp prevention ranks above everything else: if the ship can warp, almost any situation is recoverable.
 * - No result never means "safe"; the UI says "no threats observed".
 */
import { neutOutlook, type CapacitorFacts, type NeutOutlook } from '../fit/capacitor';
import { CAP_DRY_MS, type Engagement, type NpcObservation } from '../session/combat';
import type { NpcCapabilityKind } from '../sde/npcCapabilities';
import type { Severity, ThreatView } from '../viewmodel';

/** Observed EWAR counts as active this long after the last attempt in the log. */
export const OBSERVED_ACTIVE_MS = 20_000;
/** NPCs that interacted with us this recently are "on grid" for known-capability warnings. */
export const ACTIVE_NPC_MS = 60_000;
/** An NPC that pointed us and was seen this recently is assumed to still hold the point. */
export const STILL_ATTACKING_MS = 10_000;
/** A point/scram that is no longer active is still mentioned for this long. */
export const STALE_WARP_MS = 60_000;
/** Window of the current neut rate, compared with the learned heavy rate (Engagement.heavyNeutGJs). */
export const NEUT_RATE_MS = 20_000;
/** With a known fit, neut pressure is heavy when the capacitor runs dry within this long with every module on. */
export const HEAVY_NEUT_CAP_S = 300;
/** A hit on a trigger NPC is reported for this long. */
export const TRIGGER_HIT_MS = 15_000;

export interface KnownCapability {
  kind: NpcCapabilityKind;
  basis: 'kb' | 'sde' | 'observed';
}

export interface ThreatContext {
  /** Known capabilities of an NPC name as it appears in the log (SDE type, KB display name). */
  capabilitiesOf: (npcName: string) => KnownCapability[];
  /** Trigger NPC names of the selected encounter → what they trigger. */
  triggers: Map<string, string>;
  /** Capacitor of the player's active fit (EVE-64); without it the heavy neut rate is learned from the log. */
  capacitor?: CapacitorFacts | null;
}

const SEVERITY_ORDER: Record<Severity, number> = { danger: 0, caution: 1, info: 2 };
const ORDER = [
  'observed-warpScramble',
  'observed-warpDisruption',
  'known-warpScramble',
  'known-warpDisruption',
  'incoming-spike',
  'trigger-',
  'observed-neut',
  'observed-ecm',
  'known-',
];
const KNOWN_LABEL: Partial<Record<NpcCapabilityKind, string>> = {
  warpScramble: 'can SCRAM',
  warpDisruption: 'can POINT',
  web: 'can WEB',
  neut: 'can NEUT',
  ecm: 'can JAM',
  sensorDamp: 'can DAMP',
  trackingDisruption: 'can TD',
  guidanceDisruption: 'can GD',
  targetPaint: 'can PAINT',
  remoteRepair: 'LOGI',
  rampingDamage: 'ramping damage',
  smartbomb: 'smartbomb',
  superWeapon: 'super weapon',
};
const KNOWN_SEVERITY: Partial<Record<NpcCapabilityKind, Severity>> = {
  warpScramble: 'caution',
  warpDisruption: 'caution',
  superWeapon: 'caution',
};

const secondsAgo = (now: number, t: number) => Math.max(0, Math.round((now - t) / 1000));

function names(list: NpcObservation[]): string[] {
  return [...new Set(list.map((n) => n.name))];
}

interface NeutPressure {
  gjs: number;
  /** The fit's capacitor runs dry within HEAVY_NEUT_CAP_S with the modules on, or the learned heavy rate is reached. */
  heavy: boolean;
  dry: boolean;
  /** From the active fit's capacitor; null without a fit. */
  outlook: NeutOutlook | null;
}

/** Neut pressure from the current rate, the fit's capacitor (or the learned heavy rate) and empty-cap neuts. */
function neutPressure(g: Engagement, nowMs: number, cap: CapacitorFacts | null | undefined): NeutPressure {
  const gj = g.recentNeut.filter((x) => x.t > nowMs - NEUT_RATE_MS && x.t <= nowMs).reduce((a, x) => a + x.amount, 0);
  const gjs = Math.round(gj / (NEUT_RATE_MS / 1000));
  const outlook = cap && gjs > 0 ? neutOutlook(cap, gjs) : null;
  // A known fit says directly whether the rate is too much; the learned rate is the fallback without one.
  const heavy = outlook
    ? outlook.neutOnlySeconds !== null ||
      (outlook.withModulesSeconds !== null && outlook.withModulesSeconds <= HEAVY_NEUT_CAP_S)
    : g.heavyNeutGJs !== null && gjs >= g.heavyNeutGJs;
  const dry = g.capDryNeuts.filter((t) => t > nowMs - CAP_DRY_MS && t <= nowMs).length >= 2;
  return { gjs, heavy, dry, outlook };
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** What the neut does to the fit's capacitor, e.g. " · Praxis cap empties in ~2:10 with modules on". */
function outlookText(o: NeutOutlook): string {
  if (o.neutOnlySeconds !== null)
    return ` · ${o.shipName} cap empties in ~${mmss(o.neutOnlySeconds)} even with modules off`;
  if (o.withModulesSeconds !== null)
    return ` · ${o.shipName} cap empties in ~${mmss(o.withModulesSeconds)} with all modules on, holds with them off`;
  return ` · ${o.shipName} cap holds`;
}

export function assessThreats(g: Engagement | null, nowMs: number, ctx: ThreatContext): ThreatView[] {
  if (!g) return [];
  const out: ThreatView[] = [];
  const npcs = [...g.npcs.values()];

  // 1. Observed EWAR on us.
  const observed: { kind: 'warpScramble' | 'warpDisruption' | 'ecm' | 'neut'; label: string }[] = [
    { kind: 'warpScramble', label: 'SCRAMMED' },
    { kind: 'warpDisruption', label: 'POINTED' },
    { kind: 'ecm', label: 'JAMMED' },
    { kind: 'neut', label: 'NEUTED' },
  ];
  for (const { kind, label } of observed) {
    const by = npcs.filter((n) => n.ewarOnUs[kind] !== undefined);
    if (!by.length) continue;
    const last = Math.max(...by.map((n) => n.ewarOnUs[kind]!));
    const fresh = nowMs - last <= OBSERVED_ACTIVE_MS;
    const warp = kind === 'warpScramble' || kind === 'warpDisruption';
    if (!warp) {
      if (!fresh) continue; // stale neut/jam is covered by the known-capability line
      const p = kind === 'neut' ? neutPressure(g, nowMs, ctx.capacitor) : null;
      const heavy = p !== null && (p.heavy || p.dry);
      // With an empty capacitor the rate drops (nothing left to take), so the learned rate is shown only while high.
      const extra =
        p === null
          ? ''
          : [
              p.outlook
                ? ` · ${p.gjs} GJ/s${outlookText(p.outlook)}`
                : p.heavy
                  ? ` · ${p.gjs} GJ/s, heavy for this ship (from ${g.heavyNeutGJs})`
                  : '',
              p.dry ? ' · capacitor empty (neuts land for almost nothing)' : '',
              !p.outlook && !heavy ? ` · ${Math.round(by.reduce((a, n) => a + n.neutGJ, 0))} GJ this fight` : '',
            ].join('');
      out.push({
        id: `observed-${kind}`,
        severity: 'caution',
        label: heavy ? 'HEAVY NEUT' : label,
        text: `by ${names(by).join(', ')}${extra}`,
        npcs: names(by),
        basis: 'observed',
        ageSeconds: secondsAgo(nowMs, last),
      });
      continue;
    }
    // Attempts are not logged every cycle. While an NPC that pointed us keeps attacking, assume it still holds.
    const stillAttacking = by.filter((n) => nowMs - n.lastSeenMs <= STILL_ATTACKING_MS);
    const danger = fresh || stillAttacking.length > 0;
    // An old point from NPCs that stopped attacking is history, not something to act on.
    if (!danger && nowMs - last > STALE_WARP_MS) continue;
    // Name only the NPCs that matter now: fresh attempts or still attacking.
    const relevant = danger
      ? by.filter((n) => nowMs - n.ewarOnUs[kind]! <= OBSERVED_ACTIVE_MS || stillAttacking.includes(n))
      : by;
    out.push({
      id: `observed-${kind}`,
      severity: danger ? 'danger' : 'caution',
      label,
      text: fresh
        ? `by ${names(relevant).join(', ')}`
        : danger
          ? `by ${names(relevant).join(', ')} (last attempt ${secondsAgo(nowMs, last)} s ago; still attacking)`
          : `${secondsAgo(nowMs, last)} s ago by ${names(by).join(', ')} (no longer attacking)`,
      npcs: names(relevant),
      basis: 'observed',
      ageSeconds: secondsAgo(nowMs, last),
    });
  }

  // 2. Known capabilities of NPCs we are fighting (not proof that they use them).
  const onGrid = npcs.filter(
    (n) =>
      nowMs - n.lastSeenMs <= ACTIVE_NPC_MS &&
      (n.damageToUs > 0 || n.missesOnUs > 0 || n.damageByUs > 0 || Object.keys(n.ewarOnUs).length > 0),
  );
  const known = new Map<NpcCapabilityKind, { npcs: Set<string>; basis: Set<string> }>();
  for (const n of onGrid) {
    for (const c of ctx.capabilitiesOf(n.name)) {
      // Already reported as observed for this NPC.
      if (c.kind === 'warpScramble' && n.ewarOnUs.warpScramble !== undefined) continue;
      if (c.kind === 'warpDisruption' && n.ewarOnUs.warpDisruption !== undefined) continue;
      if (c.kind === 'ecm' && n.ewarOnUs.ecm !== undefined && nowMs - n.ewarOnUs.ecm <= OBSERVED_ACTIVE_MS) continue;
      if (c.kind === 'neut' && n.ewarOnUs.neut !== undefined && nowMs - n.ewarOnUs.neut <= OBSERVED_ACTIVE_MS) continue;
      const k = known.get(c.kind) ?? { npcs: new Set(), basis: new Set() };
      k.npcs.add(n.name);
      k.basis.add(c.basis === 'sde' ? 'SDE' : c.basis === 'kb' ? 'KB' : 'observed before');
      known.set(c.kind, k);
    }
  }
  for (const [kind, k] of known) {
    const label = KNOWN_LABEL[kind] ?? kind;
    out.push({
      id: `known-${kind}`,
      severity: KNOWN_SEVERITY[kind] ?? 'info',
      label: label.toUpperCase().replace(/^CAN /, ''),
      text: `${[...k.npcs].join(', ')} ${label} (${[...k.basis].join(' + ')}; not seen in log yet)`,
      npcs: [...k.npcs],
      basis: 'known',
      ageSeconds: null,
    });
  }

  // 3. Shooting a trigger of the selected encounter.
  for (const [target, t] of g.ourTargets) {
    const what = ctx.triggers.get(target);
    if (what && nowMs - t <= TRIGGER_HIT_MS) {
      out.push({
        id: `trigger-${target}`,
        severity: 'caution',
        label: 'TRIGGER',
        text: `You are shooting ${target}: ${what}`,
        npcs: [target],
        basis: 'observed',
        ageSeconds: secondsAgo(nowMs, t),
      });
    }
  }

  // 4. Incoming damage spike: last 10 s against the 60 s before (no ship data, so no absolute limit).
  const sumIn = (from: number, to: number) =>
    g.recentTaken.filter((x) => x.t >= from && x.t < to).reduce((a, x) => a + x.amount, 0);
  const recentIn = sumIn(nowMs - 10_000, nowMs + 1) / 10;
  const baselineFrom = Math.max(g.startMs, nowMs - 70_000);
  const baselineSeconds = (nowMs - 10_000 - baselineFrom) / 1000;
  if (baselineSeconds >= 20) {
    const baseline = sumIn(baselineFrom, nowMs - 10_000) / baselineSeconds;
    if (recentIn >= 50 && recentIn >= 2 * baseline) {
      out.push({
        id: 'incoming-spike',
        severity: 'caution',
        label: 'DPS SPIKE',
        text: `Incoming ${Math.round(recentIn)} dps (before: ${Math.round(baseline)})`,
        npcs: [],
        basis: 'observed',
        ageSeconds: 0,
      });
    }
  }

  // Stable order (no reshuffling every second): severity, then a fixed rule order.
  const rank = (t: ThreatView) => {
    const i = ORDER.findIndex((prefix) => t.id.startsWith(prefix));
    return i < 0 ? ORDER.length : i;
  };
  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || rank(a) - rank(b));
}
