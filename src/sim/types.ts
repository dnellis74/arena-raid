import encounters from '../data/encounters.json';
import statesData from '../data/states.json';

export type ActorId = string;
export type Side = 'player' | 'enemy';
export type AbilityId = string;

/** Default party standing order applied at fight start (sent to Jev). */
export const DEFAULT_PARTY_ORDER = encounters.defaultPartyOrder;

export type StateId =
  | 'close_and_attack'
  | 'hold_and_shoot'
  | 'skirmish'
  | 'retreat';

export type RangeBandId = 'contact' | 'just_clear' | 'well_clear' | 'disengaged';

export interface Vec2 {
  x: number;
  y: number;
}

export interface DecisionEntry {
  tick: number;
  actorId: ActorId;
  state: StateId;
  params: StateParams;
  probabilities: Record<string, number>;
  confidence: number;
  ability?: AbilityId;
  rangeBand?: RangeBandId;
  source: 'live' | 'offline' | 'replay' | 'trigger';
}

export interface StateParams {
  targetId?: ActorId;
  rangeBand?: RangeBandId;
  abilityPriority?: AbilityId[];
  anchor?: Vec2;
  skirmishSign?: 1 | -1;
}

export type Effect =
  | { type: 'slow_zone'; factor: number; duration: number }
  | { type: 'damage_taken_up'; factor: number; duration: number }
  | { type: 'force_retarget'; duration: number }
  | { type: 'damage_reduction'; factor: number; duration: number; radius?: number }
  | { type: 'damage_up'; factor: number; duration: number; radius?: number }
  | { type: 'multi_hit'; hits: number; perHit: number; span: number }
  | { type: 'dash'; range: number }
  | { type: 'dodge_window'; duration: number };

export interface Ability {
  id: AbilityId;
  name: string;
  kind: 'attack' | 'utility';
  delivery: 'melee' | 'ranged' | 'ground' | 'self' | 'ally';
  range: number;
  damage?: number;
  healing?: number;
  radius?: number;
  cooldown: number;
  windup: number;
  effects?: Effect[];
  blurb: string;
}

export interface StatusEffect {
  type: string;
  remaining: number;
  factor?: number;
  sourceId?: ActorId;
}

export interface GroundEffect {
  id: string;
  kind: 'slow_zone';
  pos: Vec2;
  radius: number;
  factor: number;
  remaining: number;
  ownerId: ActorId;
}

export interface FloatingText {
  id: string;
  pos: Vec2;
  text: string;
  color: string;
  age: number;
  life: number;
}

export interface Actor {
  id: ActorId;
  side: Side;
  kind: string;
  name: string;
  role: string;
  glyph: string;
  color: string;
  outline?: string;
  pos: Vec2;
  vel: Vec2;
  radius: number;
  hp: number;
  hpMax: number;
  moveSpeed: number;
  abilities: AbilityId[];
  cooldowns: Record<AbilityId, number>;
  casting: null | {
    abilityId: AbilityId;
    targetId?: ActorId;
    point?: Vec2;
    remaining: number;
    total: number;
  };
  state: StateId;
  stateParams: StateParams;
  standingOrder: string | null;
  partyOrder: string | null;
  lastDecision: DecisionEntry | null;
  decisionLog: DecisionEntry[];
  statuses: StatusEffect[];
  alive: boolean;
  deciding: boolean;
  lastDecisionTick: number;
  lastStateChangeTick: number;
  /** Previous condition band for Schmitt-trigger hysteresis. */
  lastCondition: string;
  /** Previous survivable-hit count (null = omitted / no living hostile). */
  lastSurvivableHits: number | null;
  lastHowCloseBucket: string;
  forceRetargetUntil: number;
  forceRetargetTo: ActorId | null;
  dodgeUntil: number;
  observedBehavior: StateId;
}

export interface Encounter {
  id: string;
  seed: number;
  allowedStates: StateId[];
  arenaW: number;
  arenaH: number;
  partyOrder: string | null;
}

export const ARENA_W = encounters.arena.w;
export const ARENA_H = encounters.arena.h;
export const DT = 1 / 60;
export const PUCK_RADIUS = 0.5;

type StateRow = { criteria: string; abbrev: string; label: string };
const states = statesData as Record<StateId, StateRow>;

export const BEHAVIOR_CRITERIA: Record<StateId, string> = {
  close_and_attack: states.close_and_attack.criteria,
  hold_and_shoot: states.hold_and_shoot.criteria,
  skirmish: states.skirmish.criteria,
  retreat: states.retreat.criteria,
};

/** Digest / UI label for current_behavior (inverse used by offline stub). */
export const BEHAVIOR_LABEL: Record<StateId, string> = {
  close_and_attack: states.close_and_attack.label,
  hold_and_shoot: states.hold_and_shoot.label,
  skirmish: states.skirmish.label,
  retreat: states.retreat.label,
};

export const BEHAVIOR_FROM_LABEL: Record<string, StateId> = Object.fromEntries(
  Object.entries(BEHAVIOR_LABEL).map(([id, label]) => [label, id as StateId]),
) as Record<string, StateId>;

export const STATE_ABBREV: Record<StateId, string> = {
  close_and_attack: states.close_and_attack.abbrev,
  hold_and_shoot: states.hold_and_shoot.abbrev,
  skirmish: states.skirmish.abbrev,
  retreat: states.retreat.abbrev,
};

/** Bump an ability to the front of a priority list. */
export function prependAbility(
  priority: AbilityId[] | undefined,
  ability: AbilityId | null | undefined,
): AbilityId[] | undefined {
  if (!ability) return priority;
  return [ability, ...(priority ?? []).filter((a) => a !== ability)];
}
