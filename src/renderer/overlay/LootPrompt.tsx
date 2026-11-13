import { useState } from 'react';
import type { AppViewModel } from '../../preload/api';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * After a run that ended alive (EVE-86): a strip below the panel asking for the loot. The paste itself happens in
 * the settings window (the overlay takes no keyboard focus while you play).
 */
export function LootPrompt({ vm, interactive }: { vm: AppViewModel; interactive: boolean }) {
  const p = vm.lootPrompt;
  const [error, setError] = useState<string | null>(null);
  if (!p) return null;
  // EVE-93: the cargo copied in game, straight from the clipboard; the prompt goes away once it is saved.
  const fromClipboard = async () => {
    const r = await window.eve.abyssCargo('after');
    setError(r.ok ? null : r.error);
  };
  const what = [p.weather && p.weather.charAt(0).toUpperCase() + p.weather.slice(1), p.tier !== null && `T${p.tier}`]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="loot-alerts loot-prompt">
      <div className="loot-alert">
        <span className="chip loot">💰 Run done</span>
        <span>
          {what || 'Abyss run'}
          {p.clearSeconds !== null && <span className="muted"> in {clock(p.clearSeconds)}</span>}
          <span className="muted">
            {' '}
            · copy the cargo (Ctrl+A, Ctrl+C) and add it to the run
            {vm.abyssCargo.after?.withBefore ? ' (against the cargo before it)' : ''}
          </span>
        </span>
      </div>
      {interactive ? (
        <div className="path">
          <button onClick={() => void fromClipboard()}>From the clipboard</button>
          <button onClick={() => window.eve.openAbyssLoot(p.entryId)}>Paste it…</button>
          <button onClick={() => void window.eve.dismissAbyssLoot(p.entryId)}>Not now</button>
        </div>
      ) : (
        <div className="muted small">Turn click-through off to add it, or later in Settings → Abyss.</div>
      )}
      {error && <div className="small sev-text-danger">{error}</div>}
    </div>
  );
}
