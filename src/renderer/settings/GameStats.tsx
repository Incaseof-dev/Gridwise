import { DAMAGE_TYPES } from '@core/sde/damage';
import { LAYERS, type FitStats } from '@core/fit/types';
import { DAMAGE_LABEL } from '../shared/labels';

const n0 = (v: number) => Math.round(v).toLocaleString('en');
const n1 = (v: number) => v.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const n2 = (v: number) => v.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const clock = (s: number) => {
  const t = Math.max(0, Math.round(s));
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60].map((x) => String(x).padStart(2, '0')).join(':');
};
const minSec = (s: number) => {
  const t = Math.round(s);
  return t >= 60 ? `${Math.floor(t / 60)}m ${t % 60}s` : `${t}s`;
};

function Section({ title, value, children }: { title: string; value?: React.ReactNode; children: React.ReactNode }) {
  return (
    <details className="gs-section" open>
      <summary>
        <span>{title}</span>
        {value !== undefined && <span className="gs-head-value">{value}</span>}
      </summary>
      <div className="gs-body">{children}</div>
    </details>
  );
}

const Cell = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="gs-cell" title={label}>
    <span className="gs-label">{label}</span>
    <span>{children}</span>
  </div>
);

/** A resist as in the game: a coloured bar filled to the resist, the number on it. */
const Resist = ({ type, value }: { type: (typeof DAMAGE_TYPES)[number]; value: number }) => (
  <span className={`gs-resist dmg-bg-${type}`} title={`${DAMAGE_LABEL[type]} resist ${Math.round(value * 100)}%`}>
    <span className="gs-fill" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    <span className="gs-pct">{Math.round(value * 100)} %</span>
  </span>
);

/**
 * The fit's numbers laid out like the in-game fitting window (EVE-82): capacitor, offense, defense with resist
 * bars, targeting, navigation, drones, then CPU and powergrid.
 */
export function GameStats({ s }: { s: FitStats }) {
  const c = s.capacitor;
  const o = s.offense;
  const t = s.tank;
  const net = c.peakRechargePerSecond - c.usagePerSecond;
  const repair = t.shieldBoostPerSecond + t.armorRepairPerSecond + t.hullRepairPerSecond;
  const layerHp = { shield: s.layers.shield.hp, armor: s.layers.armor.hp, hull: s.layers.hull.hp };
  const f = s.fitting;
  return (
    <div className="game-stats">
      <Section
        title="Capacitor"
        value={
          c.stable ? (
            <span className="gs-good">Stable at {Math.round(c.stableFraction * 100)}%</span>
          ) : (
            <span className="gs-bad">Depletes in {clock(c.secondsToEmpty ?? 0)}</span>
          )
        }
      >
        <div className="gs-row">
          <span>
            {n1(c.capacity)} GJ / {minSec(c.rechargeSeconds)}
          </span>
        </div>
        <div className="gs-row" title="Peak recharge minus what the modules use, all running">
          <span>
            Δ {net >= 0 ? '+' : ''}
            {n1(net)} GJ/s ({net >= 0 ? '+' : ''}
            {n1(c.peakRechargePerSecond > 0 ? (net / c.peakRechargePerSecond) * 100 : 0)}%)
          </span>
        </div>
      </Section>

      <Section title="Offense" value={`${n1(o.totalDps)} dps`}>
        <div className="gs-row gs-two">
          <Cell label="DPS (with reloads)">
            {n1(o.weaponDps)} dps ({n1(o.sustainedDps - o.droneDps)} dps)
          </Cell>
          <Cell label="Volley">{n0(o.alpha)} HP</Cell>
        </div>
      </Section>

      <Section title="Defense" value={`${n0(s.ehpOmni)} ehp`}>
        <div className="gs-resists">
          <span className="gs-label" title="Active repair">
            {n1(repair)} hp/s
          </span>
          {DAMAGE_TYPES.map((d) => (
            <span key={d} className={`gs-dmg dmg-${d}`}>
              {DAMAGE_LABEL[d]}
            </span>
          ))}
          {LAYERS.map((l) => (
            <div key={l} className="gs-layer">
              <span className="gs-layer-hp">
                <img src={`../layers/${l}.png`} alt={l} />
                <span>
                  {n0(layerHp[l])} hp
                  {l === 'shield' && s.shieldRechargeSeconds !== null && (
                    <span className="gs-sub"> {n0(s.shieldRechargeSeconds)} s</span>
                  )}
                </span>
              </span>
              {DAMAGE_TYPES.map((d) => (
                <Resist key={d} type={d} value={s.layers[l].resists[d]} />
              ))}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Targeting" value={`${n2(s.lockRange / 1000)} km`}>
        <div className="gs-row gs-two">
          <Cell label={`Sensor strength (${s.targeting.sensorType})`}>{n2(s.targeting.sensorStrength)} points</Cell>
          <Cell label="Scan resolution">{n0(s.targeting.scanResolution)} mm</Cell>
          <Cell label="Signature radius">{n0(s.navigation.signatureRadius)} m</Cell>
          <Cell label="Max locked targets">{s.targeting.maxLockedTargets}x</Cell>
        </div>
      </Section>

      <Section title="Navigation" value={`${n1(s.navigation.maxVelocity)} m/s`}>
        <div className="gs-row gs-two">
          <Cell label="Mass">{n0(s.navigation.mass / 1000)} t</Cell>
          <Cell label="Inertia modifier">{s.navigation.agility.toFixed(4)}x</Cell>
          <Cell label="Warp speed">{n2(s.navigation.warpSpeed)} AU/s</Cell>
          <Cell label="Align time">{n2(s.navigation.alignSeconds)}s</Cell>
        </div>
      </Section>

      {(s.drones.bandwidthMax > 0 || o.droneDps > 0) && (
        <Section title="Drones" value={`${n1(o.droneDps)} dps`}>
          <div className="gs-row gs-two">
            <Cell label="Bandwidth">
              {n0(s.drones.bandwidthUsed)}/{n0(s.drones.bandwidthMax)} Mbit/sec
            </Cell>
            <Cell label="Control range">{n2(s.drones.controlRange / 1000)} km</Cell>
            <Cell label="Drones in space">{s.drones.active} Active</Cell>
          </div>
        </Section>
      )}

      <div className="gs-fitting">
        <div className={f.cpuUsed > f.cpuMax ? 'gs-bad' : ''}>
          <b>CPU</b>
          <div>
            {n1(f.cpuUsed)}/{n1(f.cpuMax)}
          </div>
        </div>
        <div className={f.powerUsed > f.powerMax ? 'gs-bad' : ''}>
          <b>Power Grid</b>
          <div>
            {n1(f.powerUsed)}/{n1(f.powerMax)}
          </div>
        </div>
        <div className={f.calibrationUsed > f.calibrationMax ? 'gs-bad' : ''}>
          <b>Calibration</b>
          <div>
            {n0(f.calibrationUsed)}/{n0(f.calibrationMax)}
          </div>
        </div>
      </div>
    </div>
  );
}
