import type { StateId } from '../sim/types.ts';
import type { World } from '../sim/world.ts';

export type CombatLogKind = 'decide' | 'ability';

export interface CombatLogEntry {
  time: number;
  text: string;
  kind: CombatLogKind;
}

const MAX_ENTRIES = 80;

/** Humanize a state id for combat log lines ("skirmish", "close and attack"). */
export function formatStateName(state: StateId): string {
  return state.replaceAll('_', ' ');
}

export function formatDecideLine(actorName: string, state: StateId): string {
  return `${actorName} decides to ${formatStateName(state)}`;
}

export function pushCombatLog(
  world: World,
  text: string,
  kind: CombatLogKind = 'ability',
): void {
  world.combatLog.push({ time: world.time, text, kind });
  if (world.combatLog.length > MAX_ENTRIES) {
    world.combatLog.splice(0, world.combatLog.length - MAX_ENTRIES);
  }
}

export function pushDecideLog(world: World, actorName: string, state: StateId): void {
  pushCombatLog(world, formatDecideLine(actorName, state), 'decide');
}
