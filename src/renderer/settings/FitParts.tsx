import { useState } from 'react';
import type { FitLoadoutView } from '@core/fit/types';
import { icon } from '../shared/images';

const RACK_LABEL = { high: 'High slots', mid: 'Medium slots', low: 'Low slots', rig: 'Rigs', subsystem: 'Subsystems' };
/** Drones in space at once (Drones V). */
const MAX_DRONES = 5;

function Icon({ typeId }: { typeId: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="part-icon" />;
  return <img className="part-icon" src={icon(typeId)} alt="" onError={() => setFailed(true)} />;
}

type Module = FitLoadoutView['racks'][number]['modules'][number];

/** Same module with the same charge side by side: one row with a count, as weapons are grouped in game. */
function grouped(modules: Module[]): { m: Module; count: number }[] {
  const out: { m: Module; count: number }[] = [];
  for (const m of modules) {
    const last = out.at(-1);
    if (last && last.m.name === m.name && last.m.charge === m.charge) last.count++;
    else out.push({ m, count: 1 });
  }
  return out;
}

/**
 * The fit's parts as in the fitting window (EVE-83). Nothing can be fitted or removed; only the charge of each
 * weapon type and the drones in space change, and the numbers above follow.
 */
export function FitParts({ fitId, parts, changed }: { fitId: string; parts: FitLoadoutView; changed: boolean }) {
  const used = parts.drones.reduce((a, d) => a + d.active * d.bandwidth, 0);
  const inSpace = parts.drones.reduce((a, d) => a + d.active, 0);
  const tooMany = used > parts.droneBandwidth || inSpace > MAX_DRONES;
  return (
    <div className="fit-parts">
      {parts.modes && (
        <div className="parts-rack">
          <div className="parts-head">Mode</div>
          <div className="t3d-modes" title="Tactical destroyer mode: the bonuses the numbers use">
            {parts.modes.map((m) => (
              <button
                key={m.name}
                className={m.active ? 'on' : ''}
                onClick={() => !m.active && void window.eve.changeLoadout(fitId, { mode: m.name })}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {parts.racks.map((r) => (
        <div key={r.rack} className="parts-rack">
          <div className="parts-head">{RACK_LABEL[r.rack]}</div>
          {grouped(r.modules).map(({ m, count }, i) => (
            <div key={`${m.name}-${i}`} className="part">
              <Icon typeId={m.typeId} />
              <span className="part-name">
                {count > 1 && <span className="muted">{count}× </span>}
                {m.name}
              </span>
              {m.chargeOptions && (
                <select
                  value={m.charge ?? ''}
                  title="Ammo: every module of this type loads it"
                  onChange={(e) => void window.eve.changeLoadout(fitId, { module: m.name, charge: e.target.value })}
                >
                  {!m.charge && <option value="">(empty)</option>}
                  <optgroup label="In the cargo">
                    {m.chargeOptions
                      .filter((c) => c.inCargo)
                      .map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Other ammo">
                    {m.chargeOptions
                      .filter((c) => !c.inCargo)
                      .map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                  </optgroup>
                </select>
              )}
            </div>
          ))}
        </div>
      ))}

      {parts.drones.length > 0 && (
        <div className="parts-rack">
          <div className="parts-head">
            Drones{' '}
            <span className={tooMany ? 'error' : 'muted'}>
              {inSpace}/{MAX_DRONES} in space · {Math.round(used)}/{Math.round(parts.droneBandwidth)} Mbit/s
            </span>
          </div>
          {parts.drones.map((d) => (
            <div key={d.name} className="part">
              <Icon typeId={d.typeId} />
              <span className="part-name">{d.name}</span>
              <span className="drone-count">
                <button
                  disabled={d.active <= 0}
                  onClick={() => void window.eve.changeLoadout(fitId, { drone: d.name, count: d.active - 1 })}
                >
                  −
                </button>
                <span title="In space / in the bay">
                  {d.active} / {d.total}
                </span>
                <button
                  disabled={d.active >= d.total}
                  onClick={() => void window.eve.changeLoadout(fitId, { drone: d.name, count: d.active + 1 })}
                >
                  +
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {parts.cargo.length > 0 && (
        <div className="parts-rack">
          <div className="parts-head">Cargo</div>
          {parts.cargo.map((c) => (
            <div key={c.name} className="part muted">
              <Icon typeId={c.typeId} />
              <span className="part-name">
                {c.name} <span>×{c.count.toLocaleString('en')}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {changed && (
        <button className="link small" onClick={() => void window.eve.changeLoadout(fitId, { reset: true })}>
          Back to the ammo, drones and mode of the saved fit
        </button>
      )}
    </div>
  );
}
