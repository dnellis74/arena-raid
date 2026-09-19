import type { DecisionEntry } from './sim/types.ts';
import type { World } from './sim/world.ts';
import { createReferenceFight } from './sim/world.ts';
import { stepWorld } from './sim/step.ts';
import { setReplayLog, clearReplay, tickDecisions } from './net/decide.ts';
import { DT } from './sim/types.ts';

export function exportDecisionLog(world: World): DecisionEntry[] {
  return world.decisionLog.map((e) => ({ ...e, params: { ...e.params } }));
}

export function replayFight(
  seed: number,
  log: DecisionEntry[],
  maxSeconds = 60,
): World {
  const world = createReferenceFight(seed);
  setReplayLog(log);
  const maxTicks = Math.ceil(maxSeconds / DT);
  for (let i = 0; i < maxTicks && !world.matchOver; i++) {
    tickDecisions(world);
    stepWorld(world);
  }
  clearReplay();
  return world;
}
