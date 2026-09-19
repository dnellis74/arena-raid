export type ActorId = string;
export type Side = 'player' | 'enemy';
export type AbilityId = string;
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

export const ARENA_W = 16;
export const ARENA_H = 25;
export const DT = 1 / 60;
export const PUCK_RADIUS = 0.5;

export const BEHAVIOR_CRITERIA: Record<StateId, string> = {
  skirmish: 'Back away from the enemy while attacking it, staying out of its reach',
  close_and_attack: 'Walk straight at the enemy and fight it up close',
  hold_and_shoot: 'Stand still and attack anything within range',
  retreat: 'Run away from the enemy and do not attack',
};

export const STATE_ABBREV: Record<StateId, string> = {
  close_and_attack: 'CAA',
  hold_and_shoot: 'HAS',
  skirmish: 'SKR',
  retreat: 'RET',
};
