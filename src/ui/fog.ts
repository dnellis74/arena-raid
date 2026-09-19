import type { Actor } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { healthBucket } from '../sim/buckets.ts';
import { STATE_ABBREV } from '../sim/types.ts';

export function sheetVisibleFields(
  actor: Actor,
  debug: boolean,
): {
  showOrder: boolean;
  showProbabilities: boolean;
  showDecisionLog: boolean;
  showPartyOrder: boolean;
  healthLabel: string;
  behaviorLabel: string;
} {
  const isEnemy = actor.side === 'enemy';
  if (isEnemy && !debug) {
    return {
      showOrder: false,
      showProbabilities: false,
      showDecisionLog: false,
      showPartyOrder: false,
      healthLabel: healthBucket(actor.hp, actor.hpMax),
      behaviorLabel: STATE_ABBREV[actor.observedBehavior],
    };
  }
  return {
    showOrder: true,
    showProbabilities: true,
    showDecisionLog: true,
    showPartyOrder: actor.side === 'player',
    healthLabel: `${actor.hp.toFixed(0)}/${actor.hpMax}`,
    behaviorLabel: actor.state,
  };
}

export function enemyOrderLeaked(world: World, playerDigestOrders: unknown): boolean {
  const goblin = world.actors.find((a) => a.side === 'enemy');
  if (!goblin?.standingOrder) return false;
  const s = JSON.stringify(playerDigestOrders ?? {});
  return s.includes(goblin.standingOrder);
}
