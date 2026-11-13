import { useEffect, useState } from 'react';
import { identifyNpc } from '@core/abyss/priority';
import { WEATHER_IDS, type AbyssData, type AbyssDataView, type AbyssRoomNpc, type WeatherId } from '@core/abyss/types';
import { tankLayer } from '@core/fit/siteCheck';
import type { AppViewModel } from '../../preload/api';
import { WeatherIcon } from '../shared/WeatherIcon';

const EWAR_LABEL: Record<string, string> = {
  neut: 'NEUT',
  warpScramble: 'SCRAM',
  warpDisruption: 'POINT',
  web: 'WEB',
  trackingDisruption: 'TD',
  guidanceDisruption: 'GD',
  sensorDamp: 'DAMP',
  targetPaint: 'PAINT',
  ecm: 'JAM',
};
const DANGER = new Set(['neut', 'warpScramble', 'web']);
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** EWAR and role chips of a room NPC: what the room table says plus what the name parts mean. */
function chips(npc: AbyssRoomNpc, data: AbyssData): { label: string; danger: boolean }[] {
  const kinds = new Set(npc.ewar);
  let logi = false;
  let big = false;
  for (const n of npc.names) {
    const a = identifyNpc(n.replace(/\[Name\]\s*/i, ''), data);
    // A name list ("Lucid Escort/Aegis/Warden") only says what the room can roll: chips for the whole list.
    for (const k of a.ewar) kinds.add(k);
    logi ||= a.tags.includes('logi');
    big ||= a.tags.includes('highDamage');
  }
  return [
    ...[...kinds].filter((k) => EWAR_LABEL[k]).map((k) => ({ label: EWAR_LABEL[k]!, danger: DANGER.has(k) })),
    ...(logi ? [{ label: 'LOGI', danger: false }] : []),
    ...(big ? [{ label: 'HIGH DPS', danger: false }] : []),
  ];
}

export function AbyssTab({ vm }: { vm: AppViewModel }) {
  const [view, setView] = useState<AbyssDataView | null>(null);
  useEffect(() => {
    void window.eve.getAbyss().then(setView);
  }, []);
  if (!view) return <section>Loading…</section>;
  const data = view.data;
  if (!data) return <section className="error">The Abyss data could not be read: {view.error}</section>;

  const choice = vm.settings.abyss;
  const weather = data.weathers.find((w) => w.id === choice.weather) ?? null;
  const tier = data.tiers.find((t) => t.tier === (choice.tier ?? 1))!;
  const set = (patch: { weather?: WeatherId | null; tier?: number | null }) =>
    void window.eve.updateSettings({ abyss: patch });
  const fit = vm.fit.active?.stats ?? null;
  const layer = fit ? tankLayer(fit) : null;
  const rooms = data.rooms.filter((r) => r.tier === tier.tier);
  const overmind = data.overminds.find((o) => o.tier === tier.tier);
  const factionName = (id: string) => data.factions.find((f) => f.id === id)?.name ?? id;

  return (
    <section className="abyss-tab">
      <h2>Abyss</h2>
      <p className="muted">
        Abyssal Deadspace by weather and tier. Pick the filament you run: the logs do not tell weather or tier, so the
        overlay uses this choice (the tier also shows from the Overmind, when one is on grid). Entering the Abyss is
        read from the Local chat log, and the overlay then shows the 20-minute timer and who to shoot first. Your runs
        are in the Abyss log tab.
      </p>

      <h3>Weather</h3>
      <div className="factions" role="tablist">
        {WEATHER_IDS.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={id === choice.weather}
            className={id === choice.weather ? 'active' : undefined}
            onClick={() => set({ weather: id === choice.weather ? null : id })}
          >
            <WeatherIcon weather={id} size={16} /> {data.weathers.find((w) => w.id === id)?.name ?? id}
          </button>
        ))}
      </div>
      <h3>Tier</h3>
      <div className="factions" role="tablist">
        {data.tiers.map((t) => (
          <button
            key={t.tier}
            role="tab"
            aria-selected={t.tier === tier.tier}
            className={t.tier === tier.tier ? 'active' : undefined}
            onClick={() => set({ tier: t.tier })}
          >
            T{t.tier} {t.name}
          </button>
        ))}
      </div>

      <div className="abyss-weather">
        {weather ? (
          <>
            <p>
              <b>{weather.name}</b>, T{tier.tier} {tier.name}: −{tier.penalty.join('% or −')}% (rolled per site){' '}
              {weather.penalty.kind === 'resist' ? `${weather.penalty.damage} resist` : 'turret optimal and falloff'};{' '}
              {weather.bonus}. Both apply to you and to the NPCs.
            </p>
            {weather.advice.map((a) => (
              <p key={a} className="muted small">
                {a}
              </p>
            ))}
          </>
        ) : (
          <p className="muted">Pick a weather to see its penalty and bonus at this tier.</p>
        )}
      </div>

      {fit && layer && (
        <>
          <h3>
            {fit.shipName} ({fit.fitName}) in each weather, T{tier.tier}
          </h3>
          <table className="sitemap abyss-fit">
            <thead>
              <tr>
                <th>Weather</th>
                <th>Lowered resist ({layer})</th>
                <th>Now</th>
                <th>In the Abyss</th>
              </tr>
            </thead>
            <tbody>
              {data.weathers.map((w) => {
                const d = w.penalty.kind === 'resist' ? w.penalty.damage : null;
                const r = d ? fit.layers[layer].resists[d] : null;
                return (
                  <tr key={w.id} className={w.id === choice.weather ? 'root' : undefined}>
                    <td>{w.name}</td>
                    <td className={d ? `dmg-${d}` : 'muted'}>{d ?? 'none (turret range)'}</td>
                    <td>{r === null ? '–' : pct(r)}</td>
                    <td className={r !== null && r * (1 - tier.penalty.at(-1)! / 100) < 0.3 ? 'bad' : undefined}>
                      {r === null ? '–' : tier.penalty.map((p) => pct(r * (1 - p / 100))).join(' / ')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <h3>
        Rooms in T{tier.tier} {tier.name}
      </h3>
      {overmind && (
        <p className="small">
          Rogue drone battleship of this tier: <b>{overmind.name}</b>
          {overmind.damage.length ? `, armor weak to ${overmind.damage.join('/')}` : ''}
          {overmind.note ? `. ${overmind.note}` : ''}
        </p>
      )}
      {rooms.length === 0 && <p className="muted">The wiki lists no rooms for this tier yet.</p>}
      <table className="sitemap abyss-rooms">
        <tbody>
          {[...new Set(rooms.map((r) => r.faction))].map((f) => (
            <FactionRooms key={f} name={factionName(f)} rooms={rooms.filter((r) => r.faction === f)} data={data} />
          ))}
        </tbody>
      </table>

      <h3>What the names mean</h3>
      <p className="muted small">
        Abyssal NPC names tell their role. The overlay's focus order uses these, together with the EWAR the SDE gives
        each type.
      </p>
      {data.factions.map((f) => (
        <details key={f.id} className="abyss-faction">
          <summary>
            <b>{f.name}</b> <span className="muted small">({f.markers.join(', ')})</span>
          </summary>
          <table className="sitemap">
            <tbody>
              {f.roles.map((r) => (
                <tr key={r.token}>
                  <td>
                    <b>{r.token}</b>
                  </td>
                  <td className="muted small">{r.hull ?? ''}</td>
                  <td>
                    {r.ewar.map((k) => (
                      <span key={k} className={`chip${DANGER.has(k) ? ' danger' : ''}`}>
                        {EWAR_LABEL[k] ?? k}
                      </span>
                    ))}
                    {r.tags.includes('logi') && <span className="chip">LOGI</span>}
                  </td>
                  <td className="small">{r.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {f.damageToDeal && <p className="small">{f.damageToDeal}</p>}
          {f.notes.map((n) => (
            <p key={n} className="muted small">
              {n}
            </p>
          ))}
        </details>
      ))}

      <h3>General</h3>
      {data.general.map((g) => (
        <p key={g} className="muted small">
          {g}
        </p>
      ))}
      <p className="muted small">
        Source: EVE University wiki,{' '}
        {data.sources.map((s, i) => (
          <span key={s.title}>
            {i > 0 && ', '}
            <button className="link" onClick={() => window.eve.openExternal(s.url)}>
              {s.title}
            </button>{' '}
            (revision {s.revision})
          </span>
        ))}{' '}
        ({data.sources[0]?.license}, retrieved {data.sources[0]?.retrieved}).
      </p>
    </section>
  );
}

function FactionRooms({ name, rooms, data }: { name: string; rooms: AbyssData['rooms']; data: AbyssData }) {
  return (
    <>
      <tr className="kind">
        <td colSpan={3}>{name}</td>
      </tr>
      {rooms.map((r, i) => (
        <tr key={i}>
          <td className="room-npcs">
            {r.npcs.map((n, j) => (
              <div key={j}>
                <span className="muted">{n.count}×</span> {n.names.join(' / ')}{' '}
                <span className="muted small">{n.class}</span>{' '}
                {chips(n, data).map((c) => (
                  <span key={c.label} className={`chip${c.danger ? ' danger' : ''}`}>
                    {c.label}
                  </span>
                ))}
                {n.note && <div className="muted small">{n.note}</div>}
              </div>
            ))}
          </td>
          <td className="small">
            {r.dpsCheck && <span className="chip">DPS CHECK</span>} {r.note}
          </td>
        </tr>
      ))}
    </>
  );
}
