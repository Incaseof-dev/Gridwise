import { useEffect, useState } from 'react';
import type { ShipSize } from '../../core/encounter/shipSize';

/**
 * CCP's overview bracket icons, copied locally by `npm run icons` (not in the repository). Relative to the overlay
 * page, so it works from the dev server and from the built files.
 */
const bracketUrl = (size: ShipSize) => `../brackets/${size}.png`;
const available = new Map<ShipSize, Promise<boolean>>();

function probe(size: ShipSize): Promise<boolean> {
  let p = available.get(size);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = bracketUrl(size);
    });
    available.set(size, p);
  }
  return p;
}

/** Hull size icon: the real bracket tinted hostile red when available, otherwise a drawn stand-in. */
export function SizeIcon({ size, elite }: { size: ShipSize; elite: boolean }) {
  const [hasBracket, setHasBracket] = useState(false);
  useEffect(() => {
    let alive = true;
    void probe(size).then((ok) => alive && setHasBracket(ok));
    return () => {
      alive = false;
    };
  }, [size]);
  if (hasBracket) {
    return (
      <span
        className={`bracket${elite ? ' elite' : ''}`}
        style={{ maskImage: `url(${bracketUrl(size)})`, WebkitMaskImage: `url(${bracketUrl(size)})` }}
        aria-label={size}
      />
    );
  }
  return <DrawnIcon size={size} elite={elite} />;
}

/** Stand-in when the bracket icons are not installed: same idea, the triangle grows with hull size. */
function DrawnIcon({ size, elite }: { size: ShipSize; elite: boolean }) {
  const stroke = elite ? '#ffffff' : 'none';
  const tri = (w: number, top: number, bottom: number) => {
    const l = 7 - w / 2;
    const r = 7 + w / 2;
    return <polygon points={`${l},${top} ${r},${top} 7,${bottom}`} />;
  };
  const bar = <line x1="3" y1="1" x2="11" y2="1" stroke="var(--npc)" strokeWidth="1.4" />;
  let shape;
  switch (size) {
    case 'frigate':
      shape = tri(6, 4, 9);
      break;
    case 'destroyer':
      shape = (
        <>
          {bar}
          {tri(6, 4, 9)}
        </>
      );
      break;
    case 'cruiser':
      shape = tri(9, 3, 10);
      break;
    case 'battlecruiser':
      shape = (
        <>
          {bar}
          {tri(9, 3.5, 10.5)}
        </>
      );
      break;
    case 'battleship':
      shape = tri(12, 2.5, 11.5);
      break;
    case 'capital':
      shape = (
        <>
          {bar}
          {tri(12, 3, 11.8)}
        </>
      );
      break;
    case 'structure':
      shape = <rect x="3" y="2.5" width="8" height="8" />;
      break;
    case 'sentry':
      shape = <polygon points="7,1.5 12,6.5 7,11.5 2,6.5" />;
      break;
    case 'drone':
      shape = <circle cx="7" cy="6.5" r="3" />;
      break;
  }
  return (
    <svg className="size-icon" viewBox="0 0 14 13" width="17" height="16" aria-label={size}>
      <g fill="var(--npc)" stroke={stroke} strokeWidth="0.9">
        {shape}
      </g>
    </svg>
  );
}
