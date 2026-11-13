import type { AppViewModel } from '../../preload/api';

/**
 * Rare-loot NPCs of the current or just-finished fight, a strip below the panel (Below.tsx). The log never shows
 * drops, so this is a reminder.
 */
export function LootSection({ vm }: { vm: AppViewModel }) {
  if (!vm.loot.length) return null;
  const engaged = vm.combat?.engaged ?? false;
  return (
    <div className="loot-alerts">
      {vm.loot.map((l) => (
        <div
          key={l.id}
          className="loot-alert"
          title={`${l.basis === 'sde' ? 'From the SDE NPC group' : 'From the encounter notes (wiki)'}. The game log does not show what dropped.`}
        >
          <span className="chip loot">💰 {l.label}</span>
          <span>
            <b>{l.npc}</b> <span className="muted">· {l.text}</span>
          </span>
        </div>
      ))}
      {!engaged && <div className="muted small">Fight over: check the wrecks.</div>}
    </div>
  );
}
