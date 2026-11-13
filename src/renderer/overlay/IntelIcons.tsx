import type { IntelRowView, IntelShipView } from '../../core/intel/view';
import { hullSize, HULL_ORDER, type HullSize } from '../../core/intel/hull';
import { useNow } from '../shared/useNow';
import { SizeIcon } from './SizeIcon';

/**
 * Small icons on an intel row: the hull sizes reported (the overview brackets, as on the encounter brief; drawn
 * stand-ins for industrials and shuttles, which have none), the ESS (with the time left on its timer, faint) and a
 * fleet.
 */

const HULL_LABEL: Record<HullSize, string> = {
  shuttle: 'Shuttle / corvette',
  frigate: 'Frigate',
  destroyer: 'Destroyer',
  cruiser: 'Cruiser',
  battlecruiser: 'Battlecruiser',
  battleship: 'Battleship',
  capital: 'Capital',
  industrial: 'Industrial',
};

function HullGlyph({ size }: { size: 'industrial' | 'shuttle' }) {
  return (
    <svg className="intel-glyph" viewBox="0 0 16 12" aria-hidden>
      {size === 'industrial' ? <rect x={3} y={3} width={10} height={6} rx={1.5} /> : <circle cx={8} cy={6} r={2} />}
    </svg>
  );
}

/** The sizes among the reported ships, biggest first, with the ships of each in the tooltip. */
export function HullIcons({ ships, max = 4 }: { ships: readonly IntelShipView[]; max?: number }) {
  const by = new Map<HullSize, string[]>();
  for (const s of ships) {
    const size = hullSize(s.cls);
    if (size) by.set(size, [...(by.get(size) ?? []), s.name]);
  }
  const sizes = HULL_ORDER.filter((s) => by.has(s)).slice(0, max);
  if (!sizes.length) return null;
  return (
    <span className="intel-hulls">
      {sizes.map((s) => (
        <span key={s} className={`intel-hull hull-${s}`} title={`${HULL_LABEL[s]}: ${by.get(s)!.join(', ')}`}>
          {s === 'industrial' || s === 'shuttle' ? <HullGlyph size={s} /> : <SizeIcon size={s} elite={false} />}
          {by.get(s)!.length > 1 && <span className="intel-hull-n">{by.get(s)!.length}</span>}
        </span>
      ))}
    </span>
  );
}

/** 0:42, 4:05, then 12m, 1h. */
export function shortTimer(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

/**
 * What is left of the ESS timer: exact when a report said it ("5m"), else counted from the first mention with the
 * full 6 minutes, so at most that ("≤").
 */
function EssTimer({ endMs, exact }: { endMs: number; exact: boolean }) {
  const now = useNow(1000);
  const left = endMs - now;
  if (left <= 0) return <span className="intel-timer over">over</span>;
  return (
    <span className="intel-timer">
      {exact ? '' : '≤'}
      {shortTimer(left)}
    </span>
  );
}

function EssGlyph() {
  // A vault: the box, its dial and the handle.
  return (
    <svg className="intel-glyph" viewBox="0 0 16 12" aria-hidden>
      <rect x={2.5} y={1.5} width={11} height={9} rx={1.5} />
      <circle cx={8} cy={6} r={2.4} />
      <path d="M8 3.6 V2.6 M8 8.4 V9.4 M5.6 6 H4.6 M10.4 6 H11.4" />
    </svg>
  );
}

function FleetGlyph() {
  // Three hulls in formation.
  return (
    <svg className="intel-glyph" viewBox="0 0 16 12" aria-hidden>
      <path d="M5.5 5 L8 1 L10.5 5" />
      <path d="M1 10.5 L3.5 6.5 L6 10.5" />
      <path d="M10 10.5 L12.5 6.5 L15 10.5" />
    </svg>
  );
}

/** A report counted this big is a fleet, said or not. */
export const FLEET_COUNT = 10;

export const isFleet = (r: IntelRowView) => r.tags.includes('fleet') || (r.count ?? 0) >= FLEET_COUNT;

/** The ESS and fleet marks of a report. */
export function ReportMarks({ r }: { r: IntelRowView }) {
  const ess = r.tags.includes('ess');
  const fleet = isFleet(r);
  if (!ess && !fleet) return null;
  return (
    <>
      {ess && (
        <span
          className="intel-mark mark-ess"
          title={
            r.essExact
              ? 'ESS: the time left on the timer, from the time reported'
              : 'ESS: no time reported, so at most this is left (6 minutes from the first mention)'
          }
        >
          <EssGlyph />
          {r.essEndMs !== null && <EssTimer endMs={r.essEndMs} exact={r.essExact} />}
        </span>
      )}
      {fleet && (
        <span
          className="intel-mark mark-fleet"
          title={r.tags.includes('fleet') ? 'A fleet is reported' : `${r.count} reported: a fleet`}
        >
          <FleetGlyph />
        </span>
      )}
    </>
  );
}

/** Tags shown as an icon instead of a word. */
export const ICON_TAGS: ReadonlySet<string> = new Set(['ess', 'fleet']);
