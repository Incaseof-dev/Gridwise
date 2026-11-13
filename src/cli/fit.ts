/**
 * Fit stats from an EFT file, as the overlay will compute them (EVE-62). Skills are All V.
 *
 *   npm run fit -- <file.eft>                          the fitting-window numbers
 *   npm run fit -- <file.eft> --damage 53,47,0,0       also EHP against a damage mix (EM,TH,KI,EX)
 *   wl-paste | npm run fit -- -                        read the fit from stdin
 */
import { readFileSync } from 'node:fs';
import { FitEngine, ehpAgainst, LAYERS } from '../core/fit/stats';
import { DAMAGE_TYPES, type DamageVector } from '../core/sde/damage';
import { parseArgs } from './args';

const n0 = (v: number) => Math.round(v).toLocaleString('en');
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function damageFlag(v: string | true | undefined): DamageVector | null {
  if (typeof v !== 'string') return null;
  const parts = v.split(',').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p) || p < 0)) {
    throw new Error(`--damage expects four numbers EM,TH,KI,EX, got "${v}"`);
  }
  return { em: parts[0]!, thermal: parts[1]!, kinetic: parts[2]!, explosive: parts[3]! };
}

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const file = positional[0];
  if (!file) throw new Error('usage: npm run fit -- <file.eft | -> [--damage EM,TH,KI,EX]');
  const damage = damageFlag(flags.get('damage'));
  const engine = await FitEngine.load();
  const r = engine.compute(readFileSync(file === '-' ? 0 : file, 'utf8'));
  if (!r.ok) throw new Error(r.error);
  const s = r.stats;
  const f = s.fitting;

  console.log(`${s.shipName} "${s.fitName}"  (All V skills, engine data ${engine.dataVersion})`);
  for (const line of r.unknownLines) console.log(`  ! not recognised: ${line}`);
  const slots = Object.entries(f.slots)
    .filter(([, v]) => v.max > 0 || v.used > 0)
    .map(([k, v]) => `${k} ${v.used}/${v.max}`)
    .join('  ');
  console.log(
    `fitting   CPU ${f.cpuUsed.toFixed(1)}/${f.cpuMax.toFixed(1)}  PG ${f.powerUsed.toFixed(1)}/${f.powerMax.toFixed(1)}  calibration ${f.calibrationUsed}/${f.calibrationMax}  ${slots}`,
  );
  for (const l of LAYERS) {
    const { hp, resists } = s.layers[l];
    console.log(
      `${l.padEnd(9)} ${n0(hp).padStart(7)} HP  ${DAMAGE_TYPES.map((t) => `${t} ${pct(resists[t])}`).join('  ')}`,
    );
  }
  console.log(
    `EHP       ${n0(s.ehpOmni)} omni${damage ? `, ${n0(ehpAgainst(s.layers, damage))} against ${flags.get('damage')}` : ''}`,
  );
  const t = s.tank;
  console.log(
    `tank      shield ${t.shieldBoostPerSecond.toFixed(1)}  armor ${t.armorRepairPerSecond.toFixed(1)}  hull ${t.hullRepairPerSecond.toFixed(1)} HP/s, passive shield ${t.passiveShieldRegenPeak.toFixed(1)} HP/s`,
  );
  const c = s.capacitor;
  console.log(
    `cap       ${n0(c.capacity)} GJ, ${c.rechargeSeconds.toFixed(0)} s recharge, uses ${c.usagePerSecond.toFixed(1)} of ${c.peakRechargePerSecond.toFixed(1)} GJ/s peak, ` +
      (c.stable ? `stable at ${pct(c.stableFraction)}` : `empty after ${c.secondsToEmpty?.toFixed(0) ?? '?'} s`),
  );
  const o = s.offense;
  console.log(
    `offense   ${n0(o.totalDps)} DPS (weapons ${n0(o.weaponDps)}, drones ${n0(o.droneDps)}${o.activeDrones.length ? `: ${o.activeDrones.join(', ')}` : ''}), alpha ${n0(o.alpha)}`,
  );
  const n = s.navigation;
  console.log(
    `move      ${n.maxVelocity.toFixed(1)} m/s, align ${n.alignSeconds.toFixed(2)} s, signature ${n0(n.signatureRadius)} m, lock range ${(s.lockRange / 1000).toFixed(1)} km`,
  );
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
