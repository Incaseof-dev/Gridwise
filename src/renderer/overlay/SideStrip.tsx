import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FitSiteCheck } from '../../core/fit/siteCheck';
import type { AbyssCargoView, Brief, FitPanelView } from '../../core/viewmodel';
import { render } from '../shared/images';
import { fitInStrip, fitTitle, lootCount } from './BriefView';
import { useRoomRight } from './panelSize';

/** Which of the Tips / Loot panels is open; remembered per viewer. */
export type Extra = 'tips' | 'loot' | null;
const EXTRA_KEY = 'brief.extraOpen';

/** Per-viewer UI memory; storage can be unavailable, then the default (closed) applies. */
export function readExtra(): Extra {
  try {
    const v = localStorage.getItem(EXTRA_KEY);
    return v === 'tips' || v === 'loot' ? v : null;
  } catch {
    return null;
  }
}

export function writeExtra(v: Extra): void {
  try {
    localStorage.setItem(EXTRA_KEY, v ?? '');
  } catch {
    // ignore
  }
}

/** Restrictions as hover text; the SDE gate list can name dozens of ship groups. */
function restrictionText(r: string): string {
  const gate = /^Gates allow \((SDE[^)]*)\): (.*)$/.exec(r);
  if (!gate) return r;
  const groups = gate[2]!.split(', ');
  return groups.length > 6 ? `Gates (${gate[1]}): ${groups.length} ship groups allowed:\n${groups.join(', ')}` : r;
}

/**
 * Quick ship select (EVE-81): the active hull as a chip; a click opens a menu of the fits used last and the one
 * pasted last. The menu floats over the strip and the panel, its right edge on the strip's, so it needs no room
 * beside the panel; SideStrip adds it to the window shape. Picking one makes it the active fit, as in Settings.
 */
/** A hull's render; without a type id or when the image server is out of reach, its name. */
function ShipThumb({ typeId, name }: { typeId: number | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (typeId === null || failed) return <span className="ship-thumb ship-thumb-text">{name}</span>;
  return <img className="ship-thumb" src={render(typeId)} alt={name} onError={() => setFailed(true)} />;
}

function ShipSelect({ fits, open, setOpen }: { fits: FitPanelView; open: boolean; setOpen: (v: boolean) => void }) {
  const active = fits.saved.find((f) => f.id === fits.active?.id) ?? null;
  const activeType =
    fits.saved.find((f) => f.id === active?.id)?.shipTypeId ??
    fits.quick.find((f) => f.id === active?.id)?.shipTypeId ??
    null;
  // ESI: the pilot sits in a hull without a fit (EVE-65).
  const unfitted = fits.flying && !fits.flying.hasFit ? fits.flying : null;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open, setOpen]);
  return (
    <div ref={ref} className="ship-select">
      <button
        className={`ship-button${open ? ' on' : ''}${unfitted ? ' unfitted' : ''}`}
        title={
          open
            ? undefined
            : unfitted
              ? `You fly a ${unfitted.shipName}, but there is no fit for it: the fit checks are off.\nSave its fit in game or paste it in Settings → Ship fit.`
              : active
                ? `Active fit: ${active.shipName} – ${active.name}\nClick to switch`
                : 'Pick the ship you fly'
        }
        onClick={() => setOpen(!open)}
      >
        {unfitted ? (
          <ShipThumb typeId={unfitted.shipTypeId} name={unfitted.shipName} />
        ) : active ? (
          <ShipThumb typeId={activeType} name={active.shipName} />
        ) : (
          <span className="chip sev-info">SHIP</span>
        )}
      </button>
      {open && (
        <div className="ship-menu">
          {fits.quick.map((f) => (
            <button
              key={f.id}
              className={`ship-pick${f.id === active?.id ? ' on' : ''}`}
              onClick={() => {
                setOpen(false);
                if (f.id !== active?.id) void window.eve.selectFit(f.id);
              }}
            >
              <ShipThumb typeId={f.shipTypeId} name={f.shipName} />
              <span className="ship-names">
                {f.shipName}
                <span className="ship-fit-name">{f.name}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * The cargo buttons in the Abyss (EVE-93): copy the cargo in game (Ctrl+A, Ctrl+C), then click. The first takes the
 * cargo before going in, the second the cargo after the run: the loot is what grew. Main reads the clipboard.
 */
function CargoButton({
  which,
  cargo,
  interactive,
}: {
  which: 'before' | 'after';
  cargo: AbyssCargoView;
  interactive: boolean;
}) {
  const [busy, setBusy] = useState(false);
  // The last click's answer, shown for a while.
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(t);
  }, [note]);
  const b = cargo.before;
  const a = cargo.after;
  const done = which === 'before' ? !!b : !!a?.saved;
  const disabled = !interactive || busy || (which === 'after' && !a);
  const state =
    which === 'before'
      ? b
        ? `Cargo before the run: ${b.items} item types, copied at ${hhmm(b.savedAt)}.\nClick again to take it anew.`
        : 'Before the run: in the cargo press Ctrl+A, Ctrl+C, then click here.\nThe loot is then what grew in the cargo, and what shrank was used up.'
      : !a
        ? 'After the run: copy the cargo (Ctrl+A, Ctrl+C) and click here.\nIt works once a run ended alive.'
        : a.saved
          ? `Loot saved: ${a.items} item types${a.withBefore ? ' (against the cargo before)' : ''}.\nClick again to take the cargo anew.`
          : `The run is done: copy the cargo (Ctrl+A, Ctrl+C) and click here.${a.withBefore ? '' : '\nNo cargo from before the run: the whole cargo counts as loot.'}`;
  const click = async () => {
    setBusy(true);
    const r = await window.eve.abyssCargo(which);
    setBusy(false);
    setNote(
      r.ok
        ? {
            ok: true,
            text: `${r.items} item types${r.skipped.length ? `; not known, left out: ${r.skipped.join('; ')}` : ''}`,
          }
        : { ok: false, text: r.error },
    );
  };
  return (
    <button
      className={`icon-hint cargo-button${done ? ' done' : ''}${note ? (note.ok ? ' ok' : ' bad') : ''}`}
      title={note ? `${note.ok ? '✓' : '✗'} ${note.text}` : state}
      disabled={disabled}
      onClick={() => void click()}
    >
      📋
      <span className="cargo-label">{which === 'before' ? 'before' : 'after'}</span>
    </button>
  );
}

/** Room around the strip in the window shape (shadow). */
const PAD = 4;
/** Narrower room than this on the right puts the strip over the panel's right edge. */
const MIN_ROOM = 48;

/**
 * Icons on the panel's right, outside it like the strips below: restrictions, tips and loot of the brief (details
 * on hover; tips and loot open their panel in the brief on click) and the Abyss button. Main adds the strip to the
 * window shape (setSide). Without room on the right (panel at the screen edge) it sits over the panel's edge.
 */
export function SideStrip({
  brief,
  fitCheck,
  fits,
  abyss,
  cargo,
  interactive,
  open,
  toggle,
}: {
  brief: Brief | null;
  /** The active fit against the brief; shown here as the tank layer icon when it has no resist holes. */
  fitCheck: FitSiteCheck | null;
  fits: FitPanelView;
  /** The Abyss panel is shown (run or preview): no Abyss button then. */
  abyss: boolean;
  cargo: AbyssCargoView;
  interactive: boolean;
  open: Extra;
  toggle: (v: Extra) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inside = useRoomRight() < MIN_ROOM;
  const sent = useRef('');
  const [shipOpen, setShipOpen] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    // The strip, and the ship menu floating out of it.
    const rects = [el, el?.querySelector('.ship-menu')]
      .map((x) => x?.getBoundingClientRect())
      .filter((r): r is DOMRect => !!r && r.width > 0)
      .map((r) => ({ x: r.x - PAD, y: r.y - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD }));
    const json = JSON.stringify(rects);
    if (json === sent.current) return;
    sent.current = json;
    window.eve.setOverlaySide(rects);
  });
  useEffect(() => () => window.eve.setOverlaySide([]), []);

  const loot = brief?.loot;
  const count = loot ? lootCount(loot) : 0;
  const hasLoot = !!loot && (count > 0 || loot.summary.length > 0);
  const rare = loot?.rareNpcs.map((r) => r.label).filter((v, i, a) => a.indexOf(v) === i) ?? [];
  const shown = interactive ? open : null;
  const lootTitle = loot
    ? [
        ...loot.rareNpcs.map((r) => `${r.label} ${r.name}: ${r.loot}`),
        ...loot.items.map((l) => l.item + (l.from ? ` ← ${l.from}` : '')),
        ...loot.summary,
      ].join('\n')
    : '';
  const change = fitCheck ? Math.round((fitCheck.damageFactor - 1) * 100) : 0;
  const items = [
    interactive && fits.quick.length > 0 && <ShipSelect key="s" fits={fits} open={shipOpen} setOpen={setShipOpen} />,
    fitCheck && !abyss && fitInStrip(fitCheck) && (
      <span
        key="f"
        className={`icon-hint fit-icon fit-${fitCheck.verdict}`}
        title={`${fitTitle(fitCheck)}\n\nThe number: how much more (+) or less (−) damage your ${fitCheck.layer} takes here than from even damage on all four types.`}
      >
        <img src={`../layers/${fitCheck.layer}.png`} alt={fitCheck.layer} />
        <span className="fit-value">
          {change > 0 ? '+' : change < 0 ? '−' : '±'}
          {Math.abs(change)}%
        </span>
      </span>
    ),
    brief && !abyss && brief.restrictions.length > 0 && (
      <span key="r" className="icon-hint" title={brief.restrictions.map(restrictionText).join('\n\n')}>
        ⛔
      </span>
    ),
    brief && !abyss && brief.tips.length > 0 && (
      <button
        key="t"
        className={`icon-hint${shown === 'tips' ? ' on' : ''}`}
        title={brief.tips.join('\n\n')}
        disabled={!interactive}
        onClick={() => toggle('tips')}
      >
        💡<sup>{brief.tips.length}</sup>
      </button>
    ),
    !abyss && hasLoot && (
      <button
        key="l"
        className={`icon-hint${shown === 'loot' ? ' on' : ''}`}
        title={lootTitle}
        disabled={!interactive}
        onClick={() => toggle('loot')}
      >
        💰{count > 0 && <sup>{count}</sup>}
        {rare.length > 0 && <span className="loot-badge">{rare.join(' · ')}</span>}
      </button>
    ),
    (abyss || cargo.after) && <CargoButton key="c1" which="before" cargo={cargo} interactive={interactive} />,
    (abyss || cargo.after) && <CargoButton key="c2" which="after" cargo={cargo} interactive={interactive} />,
    !abyss && interactive && (
      <button
        key="a"
        className="chip sev-info abyss-button"
        title="Going into the Abyss: pick weather and tier, the overlay shows what to expect"
        onClick={() => void window.eve.setAbyssPreview(true)}
      >
        ABYSS
      </button>
    ),
  ].filter(Boolean);

  return (
    <div ref={ref} className={`side-strip${inside ? ' inside' : ''}`}>
      {items}
    </div>
  );
}
