import { useState } from 'react';
import type { NpcCapabilityKind } from '../../core/sde/npcCapabilities';

/**
 * Module icon for an EWAR kind (CCP Image Export Collection, copied by `npm run icons`).
 * Renders nothing when the icon is missing, so the text label carries the meaning on its own.
 */
export function EwarIcon({ kind, size = 16 }: { kind: NpcCapabilityKind; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      className="ewar-icon"
      src={`../ewar/${kind}.png`}
      width={size}
      height={size}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
