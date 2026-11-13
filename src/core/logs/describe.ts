/** One-line human-readable description of a GameEvent (diagnostics, CLI). */
import type { GameEvent } from './events';

export function describeEvent(e: GameEvent): string {
  switch (e.kind) {
    case 'damageDealt':
      return `→ ${e.amount} to ${e.target} [${e.weapon ?? '?'}] ${e.quality ?? ''}`;
    case 'damageTaken':
      return `← ${e.amount} from ${e.attacker}${e.weapon ? ` [${e.weapon}]` : ''} ${e.quality ?? ''}`;
    case 'missTaken':
      return `← miss by ${e.attacker}`;
    case 'missDealt':
      return `→ miss on ${e.target} [${e.weapon ?? '?'}]`;
    case 'ewar':
      return `!! ${e.ewar} by ${e.attacker} on ${e.victim ? `${e.victim} (${e.victimShip ?? '?'})` : 'you'}`;
    case 'energyNeutralized':
      return `!! neut ${e.amountGJ} GJ by ${e.attacker}`;
    case 'energyDrained':
      return `nos +${e.amountGJ} GJ from ${e.target}`;
    case 'remoteRepair':
      return `remote ${e.layer} ${e.amount} ${e.direction} ${e.other}${e.ship ? ` (${e.ship})` : ''}`;
    case 'ewarBetween':
      return `${e.ewar} ${e.attacker} → ${e.victim}`;
    case 'energyLeeched':
      return `nosed −${e.amountGJ} GJ by ${e.by}`;
    case 'bounty':
      return `bounty ${e.isk.toLocaleString('en')} ISK`;
    case 'reload':
      return `reload ${e.module} with ${e.charge} (${e.seconds ?? '?'}s)`;
    case 'outOfCharges':
      return `out of charges: ${e.module}`;
    case 'noTargetInRange':
      return `no target in range: ${e.module}`;
    case 'targetGone':
      return `target gone (${e.item ?? 'targeting'})`;
    case 'systemJump':
      return `jump ${e.from} → ${e.to}`;
    case 'undock':
      return `undock ${e.station} (${e.system})`;
    case 'gateLocked':
      return `gate locked: ${e.message.slice(0, 80)}`;
    case 'mining':
      return `mined ${e.units} ${e.ore ?? '(residue)'} ${e.variant}`;
    case 'unknown':
      return `? (${e.category}) ${e.text.replace(/\n/g, ' ⏎ ').slice(0, 120)}`;
  }
}
