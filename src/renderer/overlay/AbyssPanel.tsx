import { Fragment, useState } from 'react';
import type { FocusGroup } from '../../core/abyss/priority';
import { WEATHER_IDS, type WeatherId } from '../../core/abyss/types';
import type { AbyssView } from '../../core/abyss/view';
import { WeatherIcon } from '../shared/WeatherIcon';

const GROUP_SEV: Record<FocusGroup, string> = {
  tackle: 'sev-danger',
  logi: 'sev-caution',
  disrupt: 'sev-caution',
  damage: 'sev-info',
  other: 'sev-info',
  tank: 'sev-info',
  swarm: 'sev-info',
  loot: 'sev-info',
};
const DANGER_CHIPS = new Set(['NEUT', 'SCRAM', 'WEB']);
const TIER_NAMES = ['Tranquil', 'Calm', 'Agitated', 'Fierce', 'Raging', 'Chaotic', 'Cataclysmic'];
const pct = (x: number) => `${Math.round(x * 100)}%`;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Weather and tier of the filament: the logs do not tell them, so the player picks (remembered in the settings). */
function AbyssPicker({ weather, tier }: { weather: WeatherId | null; tier: number | null }) {
  const set = (patch: { weather?: WeatherId | null; tier?: number | null }) =>
    void window.eve.updateSettings({ abyss: patch });
  return (
    <div className="abyss-picker">
      <div className="pick-row">
        {WEATHER_IDS.map((w) => (
          <button key={w} className={`pick${w === weather ? ' on' : ''}`} onClick={() => set({ weather: w })}>
            <WeatherIcon weather={w} size={14} /> {cap(w)}
          </button>
        ))}
      </div>
      <div className="pick-row">
        {TIER_NAMES.map((n, i) => (
          <button key={n} className={`pick${i === tier ? ' on' : ''}`} title={n} onClick={() => set({ tier: i })}>
            T{i}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The overlay body for the Abyss (EVE-75). In a run: timer and what the room can hold (with the live combat cues
 * build: who to shoot first instead).
 * Before one (preview): the picked filament, how it hits the fit, and the tier's dangerous NPCs.
 */
export function AbyssPanel({
  abyss,
  choice,
  interactive,
}: {
  abyss: AbyssView;
  choice: { weather: WeatherId | null; tier: number | null };
  interactive: boolean;
}) {
  const preview = abyss.mode === 'preview';
  const [picking, setPicking] = useState(preview && (choice.weather === null || choice.tier === null));
  const left = abyss.remainingSeconds ?? 0;
  const timerClass = left < 120 ? 'sev-text-danger' : left < 300 ? 'sev-text-caution' : '';
  const w = abyss.weather;
  const filament = `${w ? w.name : 'weather?'} · ${abyss.tier ? `T${abyss.tier.tier}` : 'T?'}`;
  const weatherIcon = w ? <WeatherIcon weather={w.id} size={14} /> : null;
  const filamentTitle = [
    abyss.tier
      ? `T${abyss.tier.tier} ${abyss.tier.name}${abyss.tier.source === 'npc' ? ' (from the Overmind on grid)' : ''}`
      : 'Tier not known',
    w ? `${w.name}: −${w.penaltyPct.join('/')}% ${w.damage ? `${w.damage} resist` : 'turret range'}, ${w.bonus}` : '',
    interactive ? 'Click to change' : '',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <div className="abyss">
      <div className="abyss-head">
        <span className="badge">ABYSS</span>
        {preview ? (
          <span className="muted small" title="The timer starts when Local switches to Unknown">
            ready
          </span>
        ) : (
          <>
            <span
              className={`abyss-timer ${timerClass}`}
              title={
                abyss.approximate
                  ? 'Estimated from the first abyssal NPC: no Local chat log'
                  : 'From the Local chat log'
              }
            >
              {abyss.approximate ? '≈' : ''}
              {clock(left)}
            </span>
            {abyss.origin && <span className="muted small">→ {abyss.origin}</span>}
          </>
        )}
        <span className="abyss-actions">
          <button
            className="chip sev-info filament"
            title={filamentTitle}
            disabled={!interactive}
            onClick={() => setPicking(!picking)}
          >
            {weatherIcon} {filament}
          </button>
          {abyss.tips.length > 0 && (
            <span className="icon-hint" title={abyss.tips.join('\n\n')}>
              💡
            </span>
          )}
          {preview && interactive && (
            <button
              className="link close"
              title="Close the Abyss panel"
              onClick={() => void window.eve.setAbyssPreview(false)}
            >
              ✕
            </button>
          )}
        </span>
      </div>
      {interactive && picking && <AbyssPicker weather={choice.weather} tier={choice.tier} />}
      {w && (
        <div className="muted small">
          −{w.penaltyPct.join('/')}% {w.damage ? `${w.damage} resist` : 'turret range'} · {w.bonus}
        </div>
      )}
      {abyss.fit && (
        <div className="small" title="Your fit's tank layer against the weather's damage type">
          {abyss.fit.shipName}: {abyss.fit.layer} {abyss.fit.damage} {pct(abyss.fit.resist)} →{' '}
          <span className="sev-text-caution">{abyss.fit.after.map(pct).join(' / ')}</span>
        </div>
      )}

      {preview ? (
        <Dangers abyss={abyss} />
      ) : abyss.live ? (
        <>
          <div className="abyss-focus">
            {abyss.focus.length ? (
              <ol>
                {abyss.focus.map((f) => (
                  <li key={f.name} className={f.ageSeconds > 10 ? 'stale' : undefined} title={f.why}>
                    <span className="focus-name">{f.name}</span>
                    {f.reasons.map((r) => (
                      <span key={r} className={`chip ${r.endsWith('on you') ? 'sev-danger' : GROUP_SEV[f.group]}`}>
                        {r}
                      </span>
                    ))}
                    <div className="muted small">{f.why}</div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="muted small">No NPC in the combat log yet. The gate opens when the room is clear.</div>
            )}
          </div>
          {abyss.rooms.map((r, i) => (
            <div key={i} className="abyss-room small" title={r.note ?? undefined}>
              {r.dpsCheck && <span className="chip sev-caution">DPS CHECK</span>}{' '}
              {r.unseen.length ? (
                <span>
                  Can still bring: <b>{r.unseen.join(', ')}</b>
                </span>
              ) : (
                <span className="muted">Nothing else known for this room.</span>
              )}
            </div>
          ))}
        </>
      ) : (
        <RoomOptions abyss={abyss} />
      )}
    </div>
  );
}

/** The tier's dangerous NPCs per faction (before a run, or while the room is not recognised). */
function Dangers({ abyss }: { abyss: AbyssView }) {
  return (
    <div className="abyss-dangers">
      {abyss.dangers.length ? (
        abyss.dangers.map((d) => (
          <div key={d.faction} className="small">
            <span className="muted">{d.factionName}:</span>{' '}
            {/* The comma stays outside the unbreakable name + chips, so lines break between NPCs. */}
            {d.npcs.map((n, i) => (
              <Fragment key={n.name}>
                {i > 0 && ', '}
                <span className="danger-npc">
                  {n.name}
                  {n.chips.map((c) => (
                    <span key={c} className={`chip ${DANGER_CHIPS.has(c) ? 'sev-danger' : 'sev-info'}`}>
                      {c}
                    </span>
                  ))}
                </span>
              </Fragment>
            ))}
          </div>
        ))
      ) : (
        <div className="muted small">Pick the tier to see its dangerous NPCs.</div>
      )}
    </div>
  );
}

/**
 * Without the live combat cues (build switch): what the recognised room can hold, all of it as the wiki lists it,
 * with what each NPC does; no order of fire. Seen ones are marked. Unrecognised yet: the tier's dangerous NPCs.
 */
function RoomOptions({ abyss }: { abyss: AbyssView }) {
  if (!abyss.rooms.length)
    return abyss.dangers.length ? (
      <>
        <div className="muted small">Room not recognised yet. This tier can bring:</div>
        <Dangers abyss={abyss} />
      </>
    ) : (
      <div className="muted small">No NPC in the combat log yet. The gate opens when the room is clear.</div>
    );
  return (
    <div className="abyss-rooms">
      {abyss.rooms.length > 1 && <div className="muted small">It can be one of {abyss.rooms.length} rooms:</div>}
      {abyss.rooms.map((r, i) => (
        <div key={i} className="abyss-room-options">
          {(r.dpsCheck || r.note) && (
            <div className="small">
              {r.dpsCheck && <span className="chip sev-caution">DPS CHECK</span>}{' '}
              {r.note && <span className="muted">{r.note}</span>}
            </div>
          )}
          <ul>
            {r.npcs.map((n, j) => (
              <li key={j} className={n.seen ? 'seen' : undefined} title={n.note ?? undefined}>
                <span className="muted">{n.count}×</span> <span className="focus-name">{n.names.join(' / ')}</span>{' '}
                <span className="muted small">{n.cls}</span>
                {n.chips.map((c) => (
                  <span key={c} className={`chip ${DANGER_CHIPS.has(c) ? 'sev-danger' : 'sev-info'}`}>
                    {c}
                  </span>
                ))}
                {n.seen && <span className="muted small"> · seen</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
