import { useState } from 'react';
import type { AppViewModel } from '../../preload/api';

/**
 * Timed messages as chat bubbles below the panel (Below.tsx), so they cover nothing in it.
 * While the overlay is interactive a bubble can be closed before its time is up.
 */
export function Messages({ vm, interactive }: { vm: AppViewModel; interactive: boolean }) {
  const [closed, setClosed] = useState<string[]>([]);
  const shown = vm.messages.filter((m) => !closed.includes(m.id));
  if (!shown.length) return null;
  return (
    <div className="messages">
      {shown.map((m) => (
        <div
          key={m.id}
          className={`message ${m.basis}${m.remainingSeconds <= 3 ? ' fading' : ''}`}
          title={
            m.basis === 'known'
              ? 'Based on what these NPCs can do (SDE/KB); the game log does not show it'
              : 'Based on the game log'
          }
        >
          {interactive && (
            <button
              className="message-close"
              title="Close"
              // Ids of expired messages are never shown again, so keep only the recent ones.
              onClick={() => setClosed((c) => [...c.slice(-20), m.id])}
            >
              ×
            </button>
          )}
          {m.text}
        </div>
      ))}
    </div>
  );
}
