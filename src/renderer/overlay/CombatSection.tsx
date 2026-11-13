import type { AppViewModel } from '../../preload/api';
import { compact, duration } from '../shared/format';

export function CombatSection({ vm }: { vm: AppViewModel }) {
  const c = vm.combat;
  if (!c) return null;
  const title = [
    `Observed from the game log${c.engaged ? '' : ' (last fight)'}.`,
    `Dealt ${compact(c.dealt)}, taken ${compact(c.taken)}`,
    c.hitRate !== null ? `Hit rate ${Math.round(c.hitRate * 100)}%` : null,
    ...c.topWeapons.map((w) => `  ${w.name}: ${compact(w.damage)}`),
    c.topAttackers.length ? 'Hardest hitters:' : null,
    ...c.topAttackers.map((a) => `  ${a.name}: ${compact(a.damage)}`),
    c.secondsPerKillEstimate !== null
      ? `~${Math.round(c.secondsPerKillEstimate)} s per kill is an estimate (fight time / bounty lines).`
      : null,
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <div className={`combat${c.engaged ? '' : ' idle'}`} title={title}>
      <span>
        {c.engaged ? '⚔' : 'last'} {duration(c.durationMs)}
      </span>
      <span>
        out <b>{Math.round(c.engaged ? c.dpsOut : c.avgDpsOut)}</b>
        {c.engaged && <span className="muted"> ({Math.round(c.avgDpsOut)})</span>}
      </span>
      <span>
        in <b>{Math.round(c.engaged ? c.dpsIn : c.avgDpsIn)}</b>
        {c.engaged && <span className="muted"> ({Math.round(c.avgDpsIn)})</span>}
      </span>
      {c.bounty > 0 && <span>{compact(c.bounty)} ISK</span>}
      {c.secondsPerKillEstimate !== null && (
        <span className="muted">~{Math.round(c.secondsPerKillEstimate)}s/kill</span>
      )}
    </div>
  );
}
