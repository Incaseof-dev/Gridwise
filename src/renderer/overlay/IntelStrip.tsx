import { useEffect, useRef, useState } from 'react';
import type { AppViewModel } from '../../preload/api';
import type { IntelKillView, IntelRowView, IntelShipView } from '../../core/intel/view';
import { IntelGraph } from './IntelGraph';
import { useNow } from '../shared/useNow';
import { playIntelSound } from '../shared/intelSound';
import { HullIcons, ICON_TAGS, ReportMarks } from './IntelIcons';

/** Rows shown at most; the rest are counted. */
const MAX_ROWS = 5;
/** Names shown per row; the rest are counted. */
const MAX_PILOTS = 8;

/** Pale yellow at the edge of the range, red at one jump (EVE-98). */
export function intelTint(weight: number): React.CSSProperties {
  const hue = Math.round(55 * (1 - weight));
  return {
    background: `hsla(${hue}, 90%, 50%, ${(0.1 + 0.32 * weight).toFixed(2)})`,
    borderLeftColor: `hsl(${hue}, 90%, 58%)`,
  };
}

const age = (lastMs: number, now: number) => {
  const m = Math.max(0, Math.floor((now - lastMs) / 60_000));
  return m < 1 ? 'now' : `${m}m`;
};

const who = (r: IntelRowView) => (r.count !== null ? `${r.count}` : r.pilots.length ? `${r.pilots.length}` : '?');

const TAG_LABEL: Record<IntelRowView['tags'][number], string> = {
  camp: 'camp',
  bubble: 'bubble',
  cyno: 'cyno',
  cloaky: 'cloaky',
  docked: 'docked',
  moving: 'moving',
  spike: 'spike',
  blops: 'blops',
  kill: 'kill',
  ess: 'ESS',
  fleet: 'fleet',
};

const shipText = (s: IntelShipView) => (s.cls && s.cls !== s.name ? `${s.name} (${s.cls})` : s.name);

const clear = (systemId: number) => void window.eve.intelClear(systemId);

/**
 * Ctrl + right-click on a row or a graph node clears that system (only while the overlay takes the mouse). A plain
 * right-click does nothing: a warning should not go away by a slip of the hand.
 */
export const onClearClick = (systemId: number, interactive: boolean) =>
  interactive
    ? (e: React.MouseEvent) => {
        e.preventDefault();
        if (e.ctrlKey) clear(systemId);
      }
    : undefined;

/** Two clicks: the first one asks ("clear?"), the second within 3 s clears. */
function ClearButton({ systemId }: { systemId: number }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={`intel-clear${armed ? ' armed' : ''}`}
      title="Clear this system: click twice (or Ctrl + right-click it)"
      onClick={() => (armed ? clear(systemId) : setArmed(true))}
    >
      {armed ? 'clear?' : '✕'}
    </button>
  );
}

function Row({
  r,
  now,
  compact,
  interactive = false,
}: {
  r: IntelRowView;
  now: number;
  compact?: boolean;
  interactive?: boolean;
}) {
  // Ships of named pilots go with the name on the second line; the rest stay on the first.
  const loose = r.ships.filter((s) => !r.pilots.some((p) => p.ship?.name === s.name));
  const firstLine = compact
    ? r.pilots.length
      ? r.pilots.slice(0, 2).map((p) => p.name)
      : r.ships.slice(0, 2).map((x) => x.name)
    : loose.slice(0, 3).map(shipText);
  const more = (compact ? r.pilots.length || r.ships.length : loose.length) - firstLine.length;
  return (
    <div
      className={`intel-row${r.jumps === 0 ? ' here' : ''}`}
      style={intelTint(r.weight)}
      onContextMenu={onClearClick(r.systemId, interactive)}
      title={`${r.system}${r.security !== null ? ` (${r.security.toFixed(1)})` : ''}: ${r.messages} report(s) since ${new Date(r.firstMs).toISOString().slice(11, 16)} EVE`}
    >
      <div className="intel-main">
        <span className="intel-jumps">{r.jumps === 0 ? 'HERE' : `${r.jumps}j`}</span>
        <span className="intel-system">{r.system}</span>
        <HullIcons ships={r.ships} max={compact ? 2 : 4} />
        <ReportMarks r={r} />
        <span className="intel-who" title={r.count !== null ? 'Reported count' : 'Pilots named'}>
          {who(r)}
        </span>
        <span className="intel-ships">
          {firstLine.join(', ')}
          {more > 0 && ` +${more}`}
          {r.noVisual && <span className="muted"> nv</span>}
        </span>
        {!compact && r.gate && <span className="intel-tag">{r.gate} gate</span>}
        {!compact &&
          r.tags
            .filter((t) => !ICON_TAGS.has(t))
            .map((t) => (
              <span key={t} className={`intel-tag tag-${t}`}>
                {TAG_LABEL[t]}
              </span>
            ))}
        <span className="intel-age">{age(r.lastMs, now)}</span>
        {interactive && <ClearButton systemId={r.systemId} />}
      </div>
      {!compact && r.pilots.length > 0 && (
        <div className="intel-pilots">
          {r.pilots.slice(0, MAX_PILOTS).map((p, i) => (
            <span key={p.name}>
              {i > 0 && ', '}
              <span className="intel-pilot">{p.name}</span>
              {p.ship && <span className="intel-pilot-ship"> {shipText(p.ship)}</span>}
            </span>
          ))}
          {r.pilots.length > MAX_PILOTS && ` +${r.pilots.length - MAX_PILOTS}`}
        </div>
      )}
    </div>
  );
}

/** Kills shown at most; zKillboard is the second level, the reports come first. */
const MAX_KILLS = 3;

const isk = (v: number) =>
  v >= 1e9 ? `${(v / 1e9).toFixed(1)}b` : v >= 1e6 ? `${Math.round(v / 1e6)}m` : `${Math.round(v / 1e3)}k`;

/** The kill's word, by the pilot's side: one of ours lost, one ours killed, or someone else's. */
export function KillMark({ side }: { side: IntelKillView['side'] }) {
  return side === 'loss' ? (
    <span className="intel-kill-mark side-loss" title="One of yours (corporation or alliance) died">
      loss
    </span>
  ) : side === 'kill' ? (
    <span className="intel-kill-mark side-kill" title="Yours (corporation or alliance) were among the attackers">
      our kill
    </span>
  ) : (
    <span className="intel-kill-mark">kill</span>
  );
}

/** A zKillboard kill nearby (EVE-100): what died, to how many, in what. */
export function KillRow({
  k,
  now,
  compact,
  interactive = false,
}: {
  k: IntelKillView;
  now: number;
  compact?: boolean;
  interactive?: boolean;
}) {
  const ships = k.attackerShips.slice(0, compact ? 2 : 4);
  return (
    <div
      className="intel-row kill"
      style={intelTint(k.weight)}
      onContextMenu={onClearClick(k.systemId, interactive)}
      title={`zKillboard: ${k.system}${k.security !== null ? ` (${k.security.toFixed(1)})` : ''}, ${isk(k.value)} ISK, ${new Date(k.timeMs).toISOString().slice(11, 16)} EVE`}
    >
      <div className="intel-main">
        <span className="intel-jumps">{k.jumps === 0 ? 'HERE' : `${k.jumps}j`}</span>
        <span className="intel-system">{k.system}</span>
        <KillMark side={k.side} />
        <span className="intel-ships">
          {k.victim ? shipText(k.victim) : '?'}
          <span className="muted"> by {k.attackers}</span>
          {ships.length > 0 && `: ${ships.map((x) => (compact ? x.name : shipText(x))).join(', ')}`}
          {k.attackerShips.length > ships.length && ` +${k.attackerShips.length - ships.length}`}
        </span>
        <span className="intel-age">{age(k.timeMs, now)}</span>
        {interactive && <ClearButton systemId={k.systemId} />}
      </div>
    </div>
  );
}

function ViewToggle({ view }: { view: 'list' | 'graph' }) {
  const next = view === 'list' ? 'graph' : 'list';
  return (
    <button
      className="intel-toggle"
      title={view === 'list' ? 'Show the jump graph' : 'Show the report list'}
      onClick={() => void window.eve.updateSettings({ intel: { view: next } })}
    >
      {view === 'list' ? '◇' : '≡'}
    </button>
  );
}

/**
 * Hostiles reported on the intel channels within range (EVE-98), closest first, tinted by distance, with the names
 * and ships reported (EVE-D9); or the jump graph around the pilot (EVE-102). The list hides with nothing to
 * report, the graph stays (minimized too). `quick` is the minimized one-liner of the list: the closest report and
 * how many more there are. Ctrl + right-click or ✕ twice clears a system.
 */
export function IntelStrip({ vm, quick, interactive }: { vm: AppViewModel; quick?: boolean; interactive: boolean }) {
  const now = useNow(15_000);
  const { rows, approaching, view, kills } = vm.intel;
  if (vm.intel.state !== 'watching') return null;
  // The graph has no background, so it shows minimized too.
  if (view === 'graph' && vm.intel.graph)
    return (
      <div className={`intel graph${interactive ? ' with-toggle' : ''}`}>
        <IntelGraph vm={vm} interactive={interactive} now={now} />
        {approaching && <span className="intel-closing graph-closing">closing in</span>}
        {interactive && <ViewToggle view={view} />}
      </div>
    );
  // Nothing to report: only while the overlay takes the mouse, a quiet line with the switch to the graph.
  const idle = interactive ? (
    <div className="intel idle with-toggle">
      <span className="muted small">Intel: nothing within {vm.intel.range} jumps</span>
      <ViewToggle view={view} />
    </div>
  ) : null;
  if (quick) {
    if (!rows.length && !kills.length) return idle;
    // A quiet channel: the closest kill instead.
    if (!rows.length) {
      const k = [...kills].sort((a, b) => a.jumps - b.jumps)[0]!;
      return (
        <div className={`intel quick${interactive ? ' with-toggle' : ''}`}>
          <KillRow k={k} now={now} compact interactive={interactive} />
          {kills.length > 1 && <span className="intel-more"> +{kills.length - 1}</span>}
          {interactive && <ViewToggle view={view} />}
        </div>
      );
    }
    return (
      <div className={`intel quick${interactive ? ' with-toggle' : ''}`}>
        <Row r={rows[0]!} now={now} compact interactive={interactive} />
        {(rows.length > 1 || approaching) && (
          <span className="intel-more">
            {approaching && <span className="intel-closing">closing in</span>}
            {rows.length > 1 && ` +${rows.length - 1}`}
          </span>
        )}
        {interactive && <ViewToggle view={view} />}
      </div>
    );
  }
  if (!rows.length && !kills.length) return idle;
  const shown = rows.slice(0, MAX_ROWS);
  const shownKills = kills.slice(0, MAX_KILLS);
  return (
    <div className={`intel${interactive ? ' with-toggle' : ''}`}>
      {shown.map((r, i) => (
        <div key={r.systemId} className="intel-line">
          <Row r={r} now={now} interactive={interactive} />
          {i === 0 && approaching && <span className="intel-closing">closing in</span>}
        </div>
      ))}
      {rows.length > shown.length && (
        <div className="muted small">
          +{rows.length - shown.length} more within {vm.intel.range} jumps
        </div>
      )}
      {shownKills.length > 0 && (
        <div className="intel-source muted small">
          zKillboard{vm.intel.zkill.mode === 'quiet' ? ', the intel channels are quiet' : ''}
        </div>
      )}
      {shownKills.map((k) => (
        <KillRow key={k.killmailId} k={k} now={now} interactive={interactive} />
      ))}
      {kills.length > shownKills.length && (
        <div className="muted small">+{kills.length - shownKills.length} more kills</div>
      )}
      {interactive && <ViewToggle view={view} />}
    </div>
  );
}

/** Plays the alert sound when main says so (a new seq); the first one seen at start is old news. */
export function useIntelSound(vm: AppViewModel | null): void {
  // undefined until the first view model: whatever alert it carries happened before the overlay was there.
  const seen = useRef<number | null | undefined>(undefined);
  const seq = vm?.intel.alert?.seq ?? null;
  useEffect(() => {
    if (!vm) return;
    if (seen.current === undefined) {
      seen.current = seq;
      return;
    }
    if (seq === null || seq === seen.current) return;
    seen.current = seq;
    const s = vm.settings.intel;
    const level = vm.intel.alert!.level;
    playIntelSound(level === 'warning' ? s.warning.sound : s.notice.sound, s.volume);
  }, [seq, vm]);
}
