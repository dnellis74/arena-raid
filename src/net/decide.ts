import triggers from '../data/triggers.json';
import { actorUsesDecide } from '../sim/actor.ts';
import { healthBucket, howCloseBucket } from '../sim/buckets.ts';
import type {
  AbilityId,
  Actor,
  DecisionEntry,
  RangeBandId,
  StateId,
} from '../sim/types.ts';
import { DT } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { gapTo, nearestHostile, recordDecision } from '../sim/world.ts';
import { buildDigest } from './digest.ts';
import { callDecide, DecideError } from './jev.ts';
import { offlineDecide } from './offlinePolicy.ts';
import { buildQuestions } from './questions.ts';
import { setTelemetryMode } from './telemetry.ts';

/** Nominal decide cadence per actor (sim time). */
export const BASE_INTERVAL_S = 1.0;
/** Absolute min gap between decides for the same actor (sim time). */
export const HARD_FLOOR_S = 1.0;
export const SWITCH_FLOOR_S = 0.6;
const TIMEOUT_MS = 1200;
const STALE_INTERVALS = 1;

interface InFlight {
  actorId: string;
  startedAt: number;
  controller: AbortController;
  issuedTick: number;
}

const inFlight = new Map<string, InFlight>();
let forceOffline = false;
let replayMode = false;
let replayCursor = 0;
let replayLog: DecisionEntry[] = [];

export function setForceOffline(v: boolean): void {
  forceOffline = v;
  if (v) setTelemetryMode('degraded');
}

export function setReplayLog(log: DecisionEntry[]): void {
  replayMode = true;
  replayLog = log;
  replayCursor = 0;
}

export function clearReplay(): void {
  replayMode = false;
  replayLog = [];
  replayCursor = 0;
}

/**
 * Request an early decide. By default respects HARD_FLOOR_S and skips if a call
 * is already in flight. Pass `{ bypassFloor: true }` for player order changes so
 * the new standing order is acted on immediately.
 */
export function requestImmediateDecision(
  world: World,
  actor: Actor,
  opts: { bypassFloor?: boolean } = {},
): void {
  if (!actorUsesDecide(actor)) return;
  if (!opts.bypassFloor) {
    if (inFlight.has(actor.id)) return;
    if ((world.tick - actor.lastDecisionTick) * DT < HARD_FLOOR_S) return;
  }
  void issueDecide(world, actor, 'trigger');
}

export function tickDecisions(world: World): void {
  if (world.matchOver) return;

  // Replay: apply logged decisions at their ticks
  if (replayMode) {
    while (
      replayCursor < replayLog.length &&
      replayLog[replayCursor]!.tick <= world.tick
    ) {
      const entry = replayLog[replayCursor++]!;
      applyEntry(world, entry);
    }
    return;
  }

  const deciding = world.actors.filter((a) => a.alive && actorUsesDecide(a));
  const stagger = BASE_INTERVAL_S / Math.max(1, deciding.length);
  const intervalTicks = Math.round(BASE_INTERVAL_S / DT);

  for (let i = 0; i < deciding.length; i++) {
    const actor = deciding[i]!;
    evaluateTriggers(world, actor);

    const offset = Math.round((i * stagger) / DT);
    const onCadence =
      world.tick >= offset && (world.tick - offset) % intervalTicks === 0;
    const floorOk = (world.tick - actor.lastDecisionTick) * DT >= HARD_FLOOR_S;

    if (onCadence && floorOk && !inFlight.has(actor.id)) {
      void issueDecide(world, actor, 'live');
    }
  }
}

function evaluateTriggers(world: World, actor: Actor): void {
  if (!actorUsesDecide(actor)) return;
  const trig = (triggers as Record<string, { retreatOnHealthFraction: number; requestOnContactWhileHolding: boolean }>)[
    actor.kind
  ];
  if (!trig) return;

  const enemy = nearestHostile(world, actor);
  const hpFrac = actor.hp / actor.hpMax;

  if (
    trig.retreatOnHealthFraction > 0 &&
    hpFrac <= trig.retreatOnHealthFraction &&
    world.encounter.allowedStates.includes('retreat') &&
    actor.state !== 'retreat'
  ) {
    // Prefer early call over forced state (still rate-limited)
    requestImmediateDecision(world, actor);
  }

  if (enemy) {
    const gap = gapTo(actor, enemy);
    const close = howCloseBucket(gap);
    const health = healthBucket(actor.hp, actor.hpMax);
    if (close !== actor.lastHowCloseBucket || health !== actor.lastHealthBucket) {
      actor.lastHowCloseBucket = close;
      actor.lastHealthBucket = health;
      requestImmediateDecision(world, actor);
    }
    if (
      trig.requestOnContactWhileHolding &&
      actor.state === 'hold_and_shoot' &&
      gap <= 1.4
    ) {
      requestImmediateDecision(world, actor);
    }
    if (!enemy.alive) {
      actor.stateParams.targetId = undefined;
      requestImmediateDecision(world, actor);
    }
  }
}

/** Exact `{ state, questions }` body shape posted to `/api/decide` (minus model). */
export function buildDecidePayload(
  world: World,
  actor: Actor,
): { state: ReturnType<typeof buildDigest>; questions: ReturnType<typeof buildQuestions> } {
  const state = buildDigest(world, actor);
  const questions = buildQuestions(actor, world.encounter.allowedStates, state);
  return { state, questions };
}

async function issueDecide(
  world: World,
  actor: Actor,
  source: DecisionEntry['source'],
): Promise<void> {
  if (!actorUsesDecide(actor)) return;

  // Cancel in-flight
  const existing = inFlight.get(actor.id);
  if (existing) {
    existing.controller.abort();
    inFlight.delete(actor.id);
  }

  if (forceOffline) {
    actor.lastDecisionTick = world.tick;
    applyOffline(world, actor);
    return;
  }

  const controller = new AbortController();
  const issuedTick = world.tick;
  const startedAt = performance.now();
  inFlight.set(actor.id, { actorId: actor.id, startedAt, controller, issuedTick });
  actor.deciding = true;
  actor.lastDecisionTick = world.tick;

  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const { state: digest, questions } = buildDecidePayload(world, actor);
    const response = await callDecide(digest, questions, actor.id, controller.signal);

    // Stale?
    if (world.tick - issuedTick > (BASE_INTERVAL_S / DT) * STALE_INTERVALS) {
      return;
    }

    // Degraded proxy answers must not replace the role-default offline policy.
    // The no-key stub used to always pick hold_and_shoot, freezing melee enemies.
    if (response.degraded) {
      applyOffline(world, actor);
      world.degraded = true;
      setTelemetryMode('degraded');
    } else {
      applyJevResponse(world, actor, response, source === 'trigger' ? 'live' : source);
      world.degraded = false;
    }
  } catch {
    applyOffline(world, actor);
    world.degraded = true;
    setTelemetryMode('degraded');
  } finally {
    clearTimeout(timeout);
    inFlight.delete(actor.id);
    actor.deciding = false;
  }
}

function applyOffline(world: World, actor: Actor): void {
  const digest = buildDigest(world, actor);
  const d = offlineDecide(actor, digest);
  const entry: DecisionEntry = {
    tick: world.tick,
    actorId: actor.id,
    state: d.state,
    params: {
      rangeBand: d.rangeBand,
      abilityPriority: d.ability
        ? [d.ability, ...(actor.stateParams.abilityPriority ?? []).filter((a) => a !== d.ability)]
        : actor.stateParams.abilityPriority,
      targetId: nearestHostile(world, actor)?.id,
    },
    probabilities: d.probabilities,
    confidence: d.confidence,
    ability: d.ability ?? undefined,
    rangeBand: d.rangeBand,
    source: 'offline',
  };
  applyEntry(world, entry);
  world.degraded = true;
}

export function applyJevResponse(
  world: World,
  actor: Actor,
  response: {
    answers: Record<
      string,
      | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
      | { type: 'noul'; noul: number }
    >;
  },
  source: DecisionEntry['source'] = 'live',
): void {
  const behavior = response.answers.behavior;
  if (!behavior || behavior.type !== 'choice') return;

  let nextState = hysteresisPick(actor, world, behavior);
  if (!world.encounter.allowedStates.includes(nextState)) {
    nextState = actor.state;
  }

  let rangeBand = actor.stateParams.rangeBand ?? 'well_clear';
  const bandAns = response.answers.range_band;
  if (bandAns && bandAns.type === 'choice') {
    rangeBand = bandAns.choice as RangeBandId;
  }

  let ability: AbilityId | undefined;
  const abAns = response.answers.ability;
  if (abAns && abAns.type === 'choice') {
    if (actor.abilities.includes(abAns.choice) && (actor.cooldowns[abAns.choice] ?? 0) <= 0) {
      ability = abAns.choice;
    }
  }

  const entry: DecisionEntry = {
    tick: world.tick,
    actorId: actor.id,
    state: nextState,
    params: {
      rangeBand,
      abilityPriority: ability
        ? [ability, ...(actor.stateParams.abilityPriority ?? []).filter((a) => a !== ability)]
        : actor.stateParams.abilityPriority,
      targetId: nearestHostile(world, actor)?.id,
      skirmishSign: actor.stateParams.skirmishSign,
    },
    probabilities: behavior.probabilities,
    confidence: behavior.confidence,
    ability,
    rangeBand,
    source,
  };
  applyEntry(world, entry);
}

export interface BehaviorDecisionInput {
  current: StateId;
  answers: {
    behavior?:
      | {
          type: 'choice';
          choice: string;
          probabilities: Record<string, number>;
          confidence: number;
        }
      | { type: 'noul'; noul: number };
  };
  allowedStates: StateId[];
  /**
   * Seconds since last state change. Defaults to Infinity so the switch floor
   * is treated as satisfied (calibration / synthetic callers).
   */
  sinceSwitchS?: number;
}

/**
 * Resolve the behavior the game would adopt from a Choice answer + hysteresis.
 * Assert calibration through this — not raw `choice` — so low-confidence
 * skirmish labels that leave the actor in hold_and_shoot do not count as passes.
 */
export function applyBehaviorDecision(input: BehaviorDecisionInput): { state: StateId } {
  const behavior = input.answers.behavior;
  if (!behavior || behavior.type !== 'choice') {
    return { state: input.current };
  }

  const choice = behavior.choice as StateId;
  const sinceSwitch = input.sinceSwitchS ?? Infinity;
  if (sinceSwitch < SWITCH_FLOOR_S && choice !== input.current) {
    return { state: input.current };
  }
  if (!input.allowedStates.includes(choice)) {
    return { state: input.current };
  }

  const currentP = behavior.probabilities[input.current] ?? 0;
  if (behavior.confidence >= 0.7) return { state: choice };
  if (
    behavior.confidence >= 0.45 &&
    (behavior.probabilities[choice] ?? 0) - currentP > 0.15
  ) {
    return { state: choice };
  }
  return { state: input.current };
}

function hysteresisPick(
  actor: Actor,
  world: World,
  next: { choice: string; probabilities: Record<string, number>; confidence: number },
): StateId {
  return applyBehaviorDecision({
    current: actor.state,
    answers: {
      behavior: {
        type: 'choice',
        choice: next.choice,
        probabilities: next.probabilities,
        confidence: next.confidence,
      },
    },
    allowedStates: world.encounter.allowedStates,
    sinceSwitchS: (world.tick - actor.lastStateChangeTick) * DT,
  }).state;
}

function applyEntry(world: World, entry: DecisionEntry): void {
  const actor = world.actors.find((a) => a.id === entry.actorId);
  if (!actor) return;
  if (actor.state !== entry.state) {
    actor.stateParams.skirmishSign = undefined; // re-roll on skirmish entry
  }
  recordDecision(world, entry);
}

/** Apply a synthetic answer set (for tests). */
export function applySyntheticAnswers(
  world: World,
  actor: Actor,
  answers: {
    behavior: StateId;
    rangeBand?: RangeBandId;
    ability?: AbilityId;
    confidence?: number;
    probabilities?: Record<string, number>;
  },
): void {
  const probabilities =
    answers.probabilities ??
    Object.fromEntries(
      world.encounter.allowedStates.map((s) => [s, s === answers.behavior ? 0.8 : 0.066]),
    );
  applyJevResponse(
    world,
    actor,
    {
      answers: {
        behavior: {
          type: 'choice',
          choice: answers.behavior,
          probabilities,
          confidence: answers.confidence ?? 0.9,
        },
        range_band: {
          type: 'choice',
          choice: answers.rangeBand ?? 'well_clear',
          probabilities: { well_clear: 1 },
          confidence: 0.9,
        },
        ...(answers.ability
          ? {
              ability: {
                type: 'choice' as const,
                choice: answers.ability,
                probabilities: { [answers.ability]: 1 },
                confidence: 0.9,
              },
            }
          : {}),
      },
    },
    'live',
  );
}

export { DecideError };
