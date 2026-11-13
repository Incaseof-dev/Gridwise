import { useState } from 'react';
import type { WeatherId } from '../../core/abyss/types';

/**
 * The game's status effect icon of an Abyss weather (CCP Image Export Collection, copied by `npm run icons`).
 * Renders nothing when the icon is missing, so the name carries the meaning on its own.
 */
export function WeatherIcon({ weather, size = 16 }: { weather: WeatherId; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      className="weather-icon"
      src={`../weather/${weather}.png`}
      width={size}
      height={size}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
