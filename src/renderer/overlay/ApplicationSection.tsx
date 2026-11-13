import type { AppViewModel } from '../../preload/api';

/** "Scourge Fury Light Missile" → "Fury": the strip has room for the part that tells charges apart. */
function shortCharge(name: string): string {
  return name.replace(/\b(Light|Heavy Assault|Heavy|Cruise|Torpedo|Rapid Light|Rocket|Missile|Javelin)\b/g, '').trim();
}

/**
 * Damage application hints under the DPS strip (EVE-80): how much of the ammo's damage lands on the current
 * targets, and what to try. Details and the reasoning on hover.
 */
export function ApplicationSection({ vm }: { vm: AppViewModel }) {
  if (!vm.application.length) return null;
  return (
    <div className="application">
      {vm.application.map((h) => (
        <div
          key={`${h.weapon}|${h.target}`}
          className="application-hint"
          title={[
            h.text,
            h.advice,
            h.experimental
              ? 'Experimental: the log has no ranges or speeds, so this reads only the hit quality words.'
              : "Estimate: the log does not tell the NPC's speed; this assumes it cruises (see the full speed figure).",
          ].join('\n\n')}
        >
          {h.kind === 'missile' ? (
            <>
              💥 {shortCharge(h.weapon)} → {h.target} <b>~{Math.round(h.applied! * 100)}%</b>
              {h.better ? (
                <span className="muted">
                  {' '}
                  · {shortCharge(h.better.charge)} {h.better.gain.toFixed(1)}×
                </span>
              ) : (
                <span className="muted"> · {h.limit === 'signature' ? 'painter' : 'web / painter'}</span>
              )}
            </>
          ) : (
            <>
              🎯 {h.target}: {h.poorShots!.poor}/{h.poorShots!.of} poor hits <span className="muted">· exp.</span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
