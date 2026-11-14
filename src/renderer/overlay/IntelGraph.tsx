import { useEffect, useState } from 'react';
import type { AppViewModel } from '../../preload/api';
import type { IntelKillView, IntelRowView } from '../../core/intel/view';
import { onClearClick } from './IntelStrip';
import { HullIcons, ICON_TAGS, ReportMarks } from './IntelIcons';
import { ESS_TIMER_MS } from '../../core/intel/board';
import { useNow } from '../shared/useNow';

/** The in-game security colours, 1.0 down to 0.0 and below. */
const SEC_COLORS = [
  '#f00000',
  '#d73000',
  '#f04800',
  '#f06000',
  '#d77700',
  '#efef00',
  '#8fef2f',
  '#00f000',
  '#00ef47',
  '#48f0c0',
  '#2fefef',
];
export function secColor(sec: number | null): string {
  if (sec === null) return '#888';
  // The game rounds to one decimal, and anything above 0.0 but below 0.05 shows as 0.1.
  const r = sec > 0 && sec < 0.05 ? 0.1 : Math.round(sec * 10) / 10;
  return SEC_COLORS[Math.max(0, Math.min(10, Math.round(r * 10)))]!;
}

const W = 480;
const PAD_X = 22;
const PAD_Y = 14;

const who = (r: IntelRowView) => (r.count !== null ? r.count : r.pilots.length || null);

/**
 * The systems around the pilot (EVE-102): the pilot's system on top, one row per jump, gates as lines. No
 * background, only contrasting lines and nodes. A system with a report gets a halo tinted by distance and the
 * count; hovering it shows the report.
 */
export function IntelGraph({ vm, interactive, now }: { vm: AppViewModel; interactive: boolean; now: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), note.error ? 8000 : 4000);
    return () => clearTimeout(t);
  }, [note]);
  const g = vm.intel.graph;
  if (!g) return null;
  const canRoute = interactive && vm.settings.intel.destination;
  const setDestination = async (id: number, name: string) => {
    const r = await window.eve.intelSetDestination(id);
    setNote(r.ok ? { text: `Destination set: ${name}`, error: false } : { text: r.error, error: true });
  };
  const rowH = Math.max(26, Math.min(40, 220 / Math.max(1, g.range)));
  // Below the last row: room for the names (and an ESS ring) under its systems.
  const H = PAD_Y * 2 + g.range * rowH + 16;
  const pos = new Map(g.nodes.map((n) => [n.id, { x: PAD_X + n.x * (W - 2 * PAD_X), y: PAD_Y + n.jumps * rowH }]));
  const reports = new Map(vm.intel.rows.map((r) => [r.systemId, r]));
  const kills = new Map<number, IntelKillView[]>();
  for (const k of vm.intel.kills) kills.set(k.systemId, [...(kills.get(k.systemId) ?? []), k]);
  const hovered = hover !== null ? g.nodes.find((n) => n.id === hover) : undefined;
  const hoveredReport = hover !== null ? reports.get(hover) : undefined;
  const hoveredKills = hover !== null ? (kills.get(hover) ?? []) : [];
  // EVE-103: the route to the destination, the part inside the graph; where it leaves, the name and distance.
  const dest = vm.intel.destination;
  const route = dest ? dest.route.filter((id) => pos.has(id)) : [];
  const routeLegs: [number, number][] = [];
  if (dest)
    for (let i = 1; i < dest.route.length; i++) {
      const a = dest.route[i - 1]!;
      const b = dest.route[i]!;
      if (pos.has(a) && pos.has(b)) routeLegs.push([a, b]);
    }
  const exit = dest && !pos.has(dest.systemId) ? route.at(-1) : undefined;
  const allNames = vm.settings.intel.graphNames === 'all';

  return (
    <div className="intel-graph">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Systems within ${g.range} jumps`}>
        {Array.from({ length: g.range + 1 }, (_, d) => (
          <text key={d} className="graph-row" x={4} y={PAD_Y + d * rowH + 3}>
            {d}
          </text>
        ))}
        {g.edges.map(([a, b]) => {
          const p = pos.get(a)!;
          const q = pos.get(b)!;
          const hot = reports.has(a) || reports.has(b) || kills.has(a) || kills.has(b);
          return (
            <line key={`${a}-${b}`} className={`graph-edge${hot ? ' hot' : ''}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />
          );
        })}
        {routeLegs.map(([a, b]) => {
          const p = pos.get(a)!;
          const q = pos.get(b)!;
          return <line key={`r${a}-${b}`} className="graph-route" x1={p.x} y1={p.y} x2={q.x} y2={q.y} />;
        })}
        {g.nodes.map((n) => {
          const p = pos.get(n.id)!;
          const r = reports.get(n.id);
          const here = n.id === g.origin;
          const hue = r ? Math.round(55 * (1 - r.weight)) : 0;
          const count = r ? who(r) : null;
          const k = kills.get(n.id);
          const khue = k ? Math.round(55 * (1 - k[0]!.weight)) : 0;
          const ess = r?.tags.includes('ess') ?? false;
          const side = ess ? 15 : 9;
          return (
            <g
              key={n.id}
              className={`graph-node${r ? ' reported' : ''}${here ? ' here' : ''}`}
              onMouseEnter={interactive ? () => setHover(n.id) : undefined}
              onMouseLeave={interactive ? () => setHover(null) : undefined}
              onClick={
                canRoute
                  ? (e) => {
                      if (e.ctrlKey && !here) void setDestination(n.id, n.name);
                    }
                  : undefined
              }
              onContextMenu={
                r || k
                  ? (e) => {
                      onClearClick(n.id, interactive)?.(e);
                      setHover(null);
                    }
                  : undefined
              }
            >
              {r && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={11}
                  className="graph-halo"
                  style={{ fill: `hsla(${hue}, 95%, 55%, 0.45)`, stroke: `hsl(${hue}, 95%, 60%)` }}
                />
              )}
              {k && !r && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={10}
                  className="graph-halo kill"
                  style={{ fill: `hsla(${khue}, 95%, 55%, 0.25)`, stroke: `hsl(${khue}, 95%, 60%)` }}
                />
              )}
              {here && <circle cx={p.x} cy={p.y} r={9} className="graph-here" />}
              {dest?.systemId === n.id && <circle cx={p.x} cy={p.y} r={9} className="graph-dest" />}
              {ess ? (
                <>
                  <EssRing x={p.x} y={p.y} endMs={r!.essEndMs} />
                  <EssVault x={p.x} y={p.y} />
                </>
              ) : (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={here ? 6 : 4.5}
                  style={{ fill: secColor(n.security) }}
                  className="graph-dot"
                />
              )}
              {/* A bigger invisible target for the pointer. */}
              <circle cx={p.x} cy={p.y} r={10} className="graph-hit" />
              {count !== null && (
                <text x={p.x + side} y={p.y - 7} className="graph-count">
                  {count}
                </text>
              )}
              {k && (
                <text x={p.x - side} y={p.y - 7} className="graph-kills">
                  ✕{k.length}
                </text>
              )}
              {(allNames || here || r || k || dest?.systemId === n.id) && (
                <text x={p.x} y={p.y + (ess ? 25 : 17)} className={`graph-label${r || k || here ? '' : ' quiet'}`}>
                  {n.name}
                </text>
              )}
              {exit === n.id && dest && (
                <text
                  x={p.x}
                  y={p.y + (ess ? 36 : r || k || allNames ? 28 : 17)}
                  className="graph-label graph-dest-label"
                >
                  → {dest.name} · {dest.jumps} j
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div className={`graph-tip${tipSide(pos.get(hovered.id)!)}`} style={tipStyle(pos.get(hovered.id)!, H)}>
          <div>
            <b>{hovered.name}</b>{' '}
            <span style={{ color: secColor(hovered.security) }}>{hovered.security?.toFixed(1) ?? '?'}</span>{' '}
            <span className="muted">· {hovered.jumps === 0 ? 'you are here' : `${hovered.jumps} j`}</span>
          </div>
          {hoveredReport && <ReportDetails r={hoveredReport} now={now} />}
          {hoveredKills.map((x) => (
            <div key={x.killmailId}>
              <span className="intel-kill-mark">kill</span>{' '}
              {x.victim ? `${x.victim.name}${x.victim.cls ? ` · ${x.victim.cls}` : ''}` : '?'}
              <span className="muted">
                {' '}
                by {x.attackers}
                {x.attackerShips.length > 0 &&
                  `: ${x.attackerShips
                    .slice(0, 4)
                    .map((a) => a.name)
                    .join(', ')}`}{' '}
                · {Math.max(0, Math.floor((now - x.timeMs) / 60_000))} min ago
              </span>
            </div>
          ))}
          {!hoveredReport && !hoveredKills.length && <div className="muted">No report</div>}
          {dest?.systemId === hovered.id && (
            <div className="graph-dest-text">Destination · {dest.jumps} j by the shortest path</div>
          )}
          {(hoveredReport || hoveredKills.length > 0) && <div className="muted small">Ctrl + right-click: clear</div>}
          {canRoute && hovered.id !== g.origin && <div className="muted small">Ctrl + click: set destination</div>}
        </div>
      )}
      {note && <div className={`graph-note${note.error ? ' error' : ''}`}>{note.text}</div>}
    </div>
  );
}

/** The ESS on the graph: a vault in place of the dot. */
function EssVault({ x, y }: { x: number; y: number }) {
  return (
    <g className="graph-ess" transform={`translate(${x - 6} ${y - 5})`}>
      <rect x={0} y={0} width={12} height={10} rx={1.8} />
      <circle cx={6} cy={5} r={2.3} />
      <path d="M6 1.6 V2.7 M6 7.3 V8.4 M2.6 5 H3.7 M8.3 5 H9.4" />
    </g>
  );
}

/** Outside the report's halo (r 11), so the two do not cover each other. */
const RING_R = 14;
const RING_C = 2 * Math.PI * RING_R;

/**
 * The time left on the ESS timer as a ring around the vault, emptying clockwise from the top over the 6 minutes;
 * faint and dashed once it is over. With no timer known, only the faint track.
 */
function EssRing({ x, y, endMs }: { x: number; y: number; endMs: number | null }) {
  const now = useNow(1000);
  const left = endMs === null ? 0 : Math.min(1, Math.max(0, (endMs - now) / ESS_TIMER_MS));
  return (
    <>
      <circle cx={x} cy={y} r={RING_R} className={`graph-ess-track${endMs !== null && left === 0 ? ' over' : ''}`} />
      {left > 0 && (
        <circle
          cx={x}
          cy={y}
          r={RING_R}
          strokeDasharray={`${left * RING_C} ${RING_C}`}
          transform={`rotate(-90 ${x} ${y})`}
          className={`graph-ess-ring${left < 1 / 6 ? ' low' : ''}`}
        />
      )}
    </>
  );
}

/**
 * The tooltip stays inside the graph's box, which is all the window shape shows: below a node in the upper half,
 * above it in the lower half; anchored left or right near the edges.
 */
const tipStyle = (p: { x: number; y: number }, h: number): React.CSSProperties => {
  const x = p.x / W;
  const horiz = x < 0.3 ? { left: `${x * 100}%` } : x > 0.7 ? { right: `${(1 - x) * 100}%` } : { left: `${x * 100}%` };
  return p.y < h / 2
    ? { ...horiz, top: `${((p.y + 14) / h) * 100}%` }
    : { ...horiz, bottom: `${((h - p.y + 14) / h) * 100}%` };
};
const tipSide = (p: { x: number }) => {
  const x = p.x / W;
  return x < 0.3 ? ' from-left' : x > 0.7 ? ' from-right' : '';
};

export function ReportDetails({ r, now }: { r: IntelRowView; now: number }) {
  const mins = Math.max(0, Math.floor((now - r.lastMs) / 60_000));
  const loose = r.ships.filter((s) => !r.pilots.some((p) => p.ship?.name === s.name));
  return (
    <>
      {(r.ships.length > 0 || r.tags.some((t) => ICON_TAGS.has(t)) || r.count !== null) && (
        <div className="graph-tip-icons">
          <HullIcons ships={r.ships} />
          <ReportMarks r={r} />
        </div>
      )}
      <div className="muted">
        {r.count !== null ? `${r.count} reported` : `${r.pilots.length} named`} · {mins < 1 ? 'now' : `${mins} min ago`}
        {r.noVisual && ' · no visual'}
        {r.gate && ` · on the ${r.gate} gate`}
        {r.tags.some((t) => !ICON_TAGS.has(t)) && ` · ${r.tags.filter((t) => !ICON_TAGS.has(t)).join(', ')}`}
      </div>
      {r.pilots.map((p) => (
        <div key={p.name}>
          {p.name}
          {p.ship && (
            <span className="muted">
              {' '}
              {p.ship.name}
              {p.ship.cls && ` · ${p.ship.cls}`}
            </span>
          )}
        </div>
      ))}
      {loose.length > 0 && (
        <div className="muted">{loose.map((s) => (s.cls ? `${s.name} (${s.cls})` : s.name)).join(', ')}</div>
      )}
    </>
  );
}
