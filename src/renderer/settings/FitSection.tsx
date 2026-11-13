import { useEffect, useState } from 'react';
import { buildShipTree } from '@core/fit/shipTree';
import type { FitStats } from '@core/fit/types';
import { FitParts } from './FitParts';
import { GameStats } from './GameStats';
import type { AppViewModel } from '../../preload/api';
import { skillsNote } from '../shared/format';
import { render } from '../shared/images';

const RACKS = ['high', 'mid', 'low', 'rig'] as const;
const FIT_ENGINE_URL = 'https://github.com/WilliamFalci/capsuleers.fitting-engine';
const PYFA_URL = 'https://github.com/pyfa-org/Pyfa';
const when = (iso: string) => new Date(iso).toLocaleString();

/** Things in the paste that make the numbers wrong or the fit impossible. */
function fitProblems(s: FitStats, unknownLines: string[]): string[] {
  const out = unknownLines.map((l) => `Not recognised, so missing from the numbers: ${l}`);
  for (const r of RACKS) {
    const { used, max } = s.fitting.slots[r];
    if (used > max) out.push(`${used} ${r} modules but only ${max} ${r} slots. Is this the right ship?`);
  }
  const with_ = s.skills === 'all-v' ? 'even with all skills at V' : `with ${skillsNote(s.skills)}`;
  if (s.fitting.cpuUsed > s.fitting.cpuMax) out.push(`Needs more CPU than the ship has, ${with_}.`);
  if (s.fitting.powerUsed > s.fitting.powerMax) out.push(`Needs more powergrid than the ship has, ${with_}.`);
  return out;
}

/** A hull's render, or nothing when the SDE does not know it (the name is next to it anyway). */
function Hull({ typeId }: { typeId: number | null }) {
  const [failed, setFailed] = useState(false);
  if (typeId === null || failed) return <span className="hull-img" />;
  return <img className="hull-img" src={render(typeId)} alt="" onError={() => setFailed(true)} />;
}

/**
 * The player's fits as in EVE's fitting browser (EVE-82): ship class → faction → ship → fits. A click makes a fit
 * active; × removes it.
 */
function FitTree({ vm }: { vm: AppViewModel }) {
  const activeId = vm.fit.active?.id ?? null;
  const flying = vm.fit.flying?.shipName ?? null;
  const tree = buildShipTree(vm.fit.saved);
  // Like the game: branches start closed, except the ones holding the active fit or the ship you sit in.
  const holds = (fits: { id: string; shipName: string }[]) =>
    fits.some((f) => f.id === activeId || f.shipName === flying);
  const all = (c: (typeof tree)[number]) => c.factions.flatMap((fa) => fa.ships.flatMap((sh) => sh.fits));
  // What the player opened or closed by hand wins over the automatic state, also across state pushes.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const branch = (key: string, auto: boolean) => ({
    open: toggled[key] ?? auto,
    onToggle: (e: React.SyntheticEvent<HTMLDetailsElement>) => {
      const open = e.currentTarget.open;
      if (open !== (toggled[key] ?? auto)) setToggled((t) => ({ ...t, [key]: open }));
    },
  });
  return (
    <nav className="fit-tree">
      <button
        className={`fit-row none${activeId === null ? ' on' : ''}`}
        onClick={() => void window.eve.selectFit(null)}
      >
        No fit (skip fit checks)
      </button>
      {tree.map((c) => (
        <details key={c.name} {...branch(c.name, holds(all(c)) || tree.length === 1)}>
          <summary>{c.name}</summary>
          {c.factions.map((fa) => (
            <details
              key={fa.faction}
              {...branch(
                `${c.name}|${fa.faction}`,
                holds(fa.ships.flatMap((sh) => sh.fits)) || c.factions.length === 1,
              )}
              className="tree-faction"
            >
              <summary>{fa.faction}</summary>
              {fa.ships.map((sh) => (
                <details
                  key={sh.shipName}
                  {...branch(`ship|${sh.shipName}`, holds(sh.fits) || sh.fits.length === 1)}
                  className="tree-ship"
                >
                  <summary title={sh.shipGroup ?? undefined}>
                    <Hull typeId={sh.shipTypeId} />
                    <span>
                      {sh.shipName}
                      {sh.shipGroup && <span className="muted small"> {sh.shipGroup}</span>}
                    </span>
                    {sh.shipName === flying && (
                      <span className="chip-flying" title="ESI: you sit in this ship now">
                        flying
                      </span>
                    )}
                    <span className="muted small tree-count">{sh.fits.length}</span>
                  </summary>
                  {sh.fits.map((f) => (
                    <div key={f.id} className={`fit-row${f.id === activeId ? ' on' : ''}`}>
                      <button
                        className="fit-pick"
                        title={
                          f.source === 'esi'
                            ? `Saved in game by ${f.owner ?? 'a logged-in character'}`
                            : f.source === 'ewb'
                              ? 'On your EVE Workbench account'
                              : `Pasted ${when(f.savedAt)}`
                        }
                        onClick={() => void window.eve.selectFit(f.id)}
                      >
                        {f.name}
                      </button>
                      {f.source === 'esi' ? (
                        <span className="muted small" title="Saved in game; change or delete it there">
                          in game
                        </span>
                      ) : f.source === 'ewb' ? (
                        <span className="muted small" title="On EVE Workbench; change or delete it there">
                          EWB
                        </span>
                      ) : (
                        <button
                          className="link small"
                          title="Remove this fit"
                          onClick={() => void window.eve.removeFit(f.id)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </details>
              ))}
            </details>
          ))}
        </details>
      ))}
    </nav>
  );
}

/** The EFT paste in a dialog (EVE-83): Esc or a click outside closes it. */
function AddFitDialog({ vm, close }: { vm: AppViewModel; close: () => void }) {
  const [eft, setEft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const engine = vm.fit.engine;
  const save = async () => {
    setBusy(true);
    const r = await window.eve.saveFit(eft);
    setBusy(false);
    if (r.ok) close();
    else setError(r.error);
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Add a fit" onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h3>Add a fit</h3>
        <p className="muted">
          In EVE open the Fitting window, click Copy to clipboard (or right-click a saved fit, Copy to clipboard) and
          paste it here. Pasting the same ship and fit name again replaces the old one.
        </p>
        <textarea
          className="eft"
          rows={12}
          spellCheck={false}
          autoFocus
          placeholder={'[Praxis, My PvE fit]\nDamage Control II\n…'}
          value={eft}
          onChange={(e) => setEft(e.target.value)}
        />
        <div className="path">
          <button className="primary" disabled={busy || !eft.trim() || engine !== 'ready'} onClick={() => void save()}>
            {engine === 'loading' ? 'Loading fit data…' : 'Save and use this fit'}
          </button>
          <button onClick={close}>Cancel</button>
          {error && <span className="error">{error}</span>}
        </div>
      </div>
    </div>
  );
}

/** Seconds until an ISO time, ticking once a second while there is one. */
function useCountdown(iso: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [iso]);
  return iso ? Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000)) : 0;
}

/** Under the tree: add a fit (dialog) on the left, sync with ESI on the right, not more often than ESI refreshes. */
function TreeActions({ vm, add }: { vm: AppViewModel; add: () => void }) {
  const e = vm.esi;
  const wait = useCountdown(e.nextSyncAt);
  const loggedIn = e.characters.length > 0;
  return (
    <div className="tree-actions">
      <button onClick={add}>Add a fit…</button>
      {loggedIn && (
        <button
          disabled={e.syncing || wait > 0}
          title={
            wait > 0
              ? 'ESI keeps its answer for a few minutes; asking again before then returns the same'
              : 'Read skills, implants, fittings and the current ship now'
          }
          onClick={() => void window.eve.esiSync()}
        >
          {e.syncing
            ? 'Syncing…'
            : wait > 0
              ? `ESI sync in ${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, '0')}`
              : 'ESI sync'}
        </button>
      )}
    </div>
  );
}

export function FitSection({ vm }: { vm: AppViewModel }) {
  const [adding, setAdding] = useState(false);
  const fit = vm.fit;
  const active = fit.active;

  return (
    <section>
      <h2>Ship fit</h2>
      <p className="muted">
        The fit you fly, for checking it against the site: resists against the NPCs&apos; damage, capacitor against
        neuts. Without an EVE login the numbers assume all skills at V; logged in, they use your skills and implants.
      </p>
      <p className="muted small fit-disclaimer">
        Not a fitting tool: fits are not built or edited here. The app works only from the fits you bring (saved in game
        and read through the EVE login, on EVE Workbench, or pasted), and only ammo, drones and the T3D mode can be
        switched. The numbers come from{' '}
        <button className="link" onClick={() => window.eve.openExternal(FIT_ENGINE_URL)}>
          eve-fit-engine
        </button>{' '}
        by Capsuleers.app (GPL-3.0), a port of{' '}
        <button className="link" onClick={() => window.eve.openExternal(PYFA_URL)}>
          Pyfa
        </button>
        . To build a fit, use Pyfa or the game&apos;s fitting window.
      </p>
      {fit.engine === 'error' && <p className="error">The fit engine could not load its data: {fit.engineError}</p>}

      {fit.flying && !fit.flying.hasFit && (
        <p className="error">
          You sit in a {fit.flying.shipName}, but there is no fit for it, so the fit checks are off. Save its fit in
          game (with the EVE login it shows up here) or add it with the button under the list.
        </p>
      )}
      <div className="fit-layout">
        <div className="fit-side">
          {fit.saved.length > 0 ? (
            <FitTree vm={vm} />
          ) : (
            <p className="muted">
              No fits yet. Add one, log in with EVE to bring the fittings saved in game, or add your EVE Workbench key
              (EVE login tab).
            </p>
          )}
          <TreeActions vm={vm} add={() => setAdding(true)} />
        </div>
        <div className="fit-detail">
          {active && (
            <div className="field">
              <label>Active fit</label>
              {active.error && <p className="error">This fit no longer reads: {active.error}</p>}
              {!active.stats && !active.error && <p className="muted">Computing…</p>}
              {active.stats && (
                <>
                  <p>
                    {active.stats.shipName} · {active.stats.fitName}{' '}
                    <span className="muted">
                      (
                      {active.source === 'esi'
                        ? 'saved in game'
                        : active.source === 'ewb'
                          ? 'EVE Workbench'
                          : `pasted ${when(active.savedAt)}`}{' '}
                      · {skillsNote(active.stats.skills)}
                      {active.stats.mode && ` · ${active.stats.mode} mode`})
                    </span>
                  </p>
                  {fitProblems(active.stats, active.unknownLines).map((p) => (
                    <p key={p} className="error">
                      {p}
                    </p>
                  ))}
                  <div className="fit-columns">
                    {active.parts ? (
                      <FitParts fitId={active.id} parts={active.parts} changed={active.loadoutChanged} />
                    ) : (
                      <div />
                    )}
                    <GameStats s={active.stats} />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {adding && <AddFitDialog vm={vm} close={() => setAdding(false)} />}
    </section>
  );
}
