/** Builds the threat engine's lookups from the selected encounter (KB) and the SDE. */
import type { Encounter } from '../kb/types';
import type { GameDataService } from '../sde/gameData';
import type { KnownCapability, ThreatContext } from './engine';

export function buildThreatContext(encounter: Encounter | null, gd: GameDataService | null): ThreatContext {
  const kb = new Map<string, KnownCapability[]>();
  const triggers = new Map<string, string>();
  const add = (name: string, cap: KnownCapability) => {
    const list = kb.get(name) ?? [];
    if (!list.some((c) => c.kind === cap.kind)) list.push(cap);
    kb.set(name, list);
  };
  /** A display name and the SDE types behind it can both appear in the log. */
  const aliases = (name: string) => [name, ...(encounter?.npcs[name]?.sdeTypes ?? [])];

  if (encounter) {
    for (const [name, k] of Object.entries(encounter.npcs))
      for (const f of k.ewar)
        for (const n of aliases(name)) add(n, { kind: f.kind, basis: f.confidence === 'observed' ? 'observed' : 'kb' });
    for (const p of encounter.pockets)
      for (const w of p.waves)
        for (const s of w.spawns)
          for (const display of s.names)
            for (const n of aliases(display)) {
              for (const f of s.ewar) add(n, { kind: f.kind, basis: f.confidence === 'observed' ? 'observed' : 'kb' });
              if (s.triggers) triggers.set(n, s.triggers);
            }
  }

  const cache = new Map<string, KnownCapability[]>();
  return {
    triggers,
    capabilitiesOf: (name) => {
      const hit = cache.get(name);
      if (hit) return hit;
      const caps = [...(kb.get(name) ?? [])];
      for (const t of gd?.typesByName(name, 11) ?? []) {
        for (const c of gd!.npcProfile(t.id)?.capabilities ?? []) {
          if (c.chance === 0 || caps.some((x) => x.kind === c.kind)) continue;
          caps.push({ kind: c.kind, basis: 'sde' });
        }
      }
      cache.set(name, caps);
      return caps;
    },
  };
}
