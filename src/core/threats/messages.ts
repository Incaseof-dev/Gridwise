/**
 * Timed, explanatory messages (task EVE-55): instead of alarming on every line, say something once a situation has
 * lasted a while (sustained), once it is over (ended), or when something notable happens (event).
 *
 * Pure function of the engagement and the time, like the threat engine: the same log gives the same messages, and
 * each message is visible for SHOW_MS from the moment its condition is first met. Silence is the default.
 *
 * Warp prevention is not handled here: scram/point stay instant alerts in the threat list.
 * The wording (and sarcasm level) comes from `render`, see texts.ts.
 */
import type { Engagement, NpcObservation, Streak } from '../session/combat';
import { STREAK_GAP_MS } from '../session/combat';
import type { NpcCapabilityKind } from '../sde/npcCapabilities';
import type { MessageView } from '../viewmodel';
import type { ThreatContext } from './engine';
import type { MessageVars } from './texts';

/** How long a message stays on the overlay (it can also be closed while the overlay is interactive). */
export const SHOW_MS = 60_000;
/** A situation counts as over after this much silence. */
export const QUIET_MS = 30_000;
/** An NPC with a known capability counts as "on us" while it attacked us this recently. */
export const KNOWN_ACTIVE_MS = 20_000;
/** Fight length (with several kinds of threat) for the long-fight message. */
export const LONG_FIGHT_MS = 5 * 60_000;
/** Two different triggers shot within this window: "everyone at once". */
export const MULTI_TRIGGER_MS = 60_000;

type Observed = 'neut' | 'ecm';
type Known = Extract<
  NpcCapabilityKind,
  'web' | 'sensorDamp' | 'trackingDisruption' | 'guidanceDisruption' | 'targetPaint'
>;

/** How long a situation has to last before it is worth a word. */
export const SUSTAINED_MS: Record<Observed | Known, number> = {
  neut: 3 * 60_000,
  ecm: 60_000,
  web: 2 * 60_000,
  sensorDamp: 2 * 60_000,
  trackingDisruption: 2 * 60_000,
  guidanceDisruption: 2 * 60_000,
  targetPaint: 2 * 60_000,
};

const OBSERVED: Observed[] = ['neut', 'ecm'];
const KNOWN: Known[] = ['web', 'sensorDamp', 'trackingDisruption', 'guidanceDisruption', 'targetPaint'];

/** Renders the text of a message: `key` is "trigger/phase", `id` identifies the message while it is shown. */
export type RenderText = (key: string, id: string, vars: MessageVars) => string;

const attackedUs = (n: NpcObservation) => n.damageToUs > 0 || n.missesOnUs > 0 || Object.keys(n.ewarOnUs).length > 0;

type Draft = Omit<MessageView, 'id' | 'remainingSeconds' | 'text'> & { vars: MessageVars };

/** Pushes a message if `nowMs` falls into the SHOW_MS window that starts at `fromMs`. */
function show(out: MessageView[], render: RenderText, nowMs: number, fromMs: number, d: Draft): void {
  if (nowMs < fromMs || nowMs >= fromMs + SHOW_MS) return;
  const { vars, ...m } = d;
  const id = `${m.trigger}/${m.phase}@${fromMs}`;
  out.push({
    ...m,
    id,
    text: render(`${m.trigger}/${m.phase}`, id, vars),
    remainingSeconds: Math.ceil((fromMs + SHOW_MS - nowMs) / 1000),
  });
}

/** Sustained / ended messages of one streak. */
function streakMessages(
  out: MessageView[],
  render: RenderText,
  nowMs: number,
  trigger: Observed | Known,
  s: Streak,
  active: boolean,
  npcs: string[],
  basis: MessageView['basis'],
): void {
  const need = SUSTAINED_MS[trigger];
  const gj = trigger === 'neut' ? s.amount : null;
  if (active) {
    if (nowMs - s.startMs >= need)
      show(out, render, nowMs, s.startMs + need, {
        trigger,
        phase: 'sustained',
        basis,
        vars: { npcs, durationMs: nowMs - s.startMs, gj },
      });
  } else if (s.lastMs - s.startMs >= need) {
    show(out, render, nowMs, s.lastMs + QUIET_MS, {
      trigger,
      phase: 'ended',
      basis,
      vars: { npcs, durationMs: s.lastMs - s.startMs, gj },
    });
  }
}

export function timedMessages(
  g: Engagement | null,
  nowMs: number,
  ctx: ThreatContext,
  render: RenderText,
): MessageView[] {
  if (!g) return [];
  const out: MessageView[] = [];
  const npcs = [...g.npcs.values()];
  const kinds = new Set<string>();

  // 1. Observed EWAR (in the log): neut, jam.
  for (const kind of OBSERVED) {
    const s = g.ewarStreaks[kind];
    if (!s) continue;
    kinds.add(kind);
    const by = npcs.filter((n) => n.ewarOnUs[kind] !== undefined && n.ewarOnUs[kind]! >= s.startMs).map((n) => n.name);
    streakMessages(out, render, nowMs, kind, s, nowMs - s.lastMs <= STREAK_GAP_MS, by, 'observed');
  }
  if (g.ewarStreaks.warpScramble || g.ewarStreaks.warpDisruption) kinds.add('warp');

  // 2. Known capabilities (not logged): NPCs that can do it and keep attacking us.
  const attackers = npcs.filter(attackedUs);
  for (const kind of KNOWN) {
    const capable = attackers.filter((n) => ctx.capabilitiesOf(n.name).some((c) => c.kind === kind));
    if (!capable.length) continue;
    kinds.add(kind);
    const active = capable.filter((n) => nowMs - n.lastSeenMs <= KNOWN_ACTIVE_MS);
    const group = active.length ? active : capable;
    const s: Streak = {
      startMs: Math.min(...group.map((n) => n.firstSeenMs)),
      lastMs: Math.max(...group.map((n) => n.lastSeenMs)),
      amount: group.length,
    };
    const names = [...new Set(group.map((n) => n.name))];
    streakMessages(out, render, nowMs, kind, s, active.length > 0, names, 'known');
  }

  // 3. A long fight with several kinds of threat.
  if (kinds.size >= 2)
    show(out, render, nowMs, g.startMs + LONG_FIGHT_MS, {
      trigger: 'longFight',
      phase: 'event',
      basis: 'observed',
      vars: { npcs: [], durationMs: nowMs - g.startMs, gj: null },
    });

  // 4. Two different triggers of the selected encounter shot within a minute.
  const triggerHits = [...g.ourFirstHits].filter(([target]) => ctx.triggers.has(target)).sort((a, b) => a[1] - b[1]);
  for (let i = 1; i < triggerHits.length; i++) {
    const [[first, t0], [second, t1]] = [triggerHits[i - 1]!, triggerHits[i]!];
    if (t1 - t0 > MULTI_TRIGGER_MS) continue;
    show(out, render, nowMs, t1, {
      trigger: 'multiTrigger',
      phase: 'event',
      basis: 'observed',
      vars: { npcs: [first, second], durationMs: t1 - t0, gj: null },
    });
    break;
  }

  return out;
}
