import abilitiesData from '../data/abilities.json';
import classesData from '../data/classes.json';
import monstersData from '../data/monsters.json';
import type {
  Ability,
  AbilityId,
  Actor,
  ActorId,
  Side,
  StateId,
  StateParams,
  Vec2,
} from './types.ts';
import { healthBucket, howCloseBucket } from './buckets.ts';
import { zero } from './vec.ts';

export const abilities = abilitiesData as Record<AbilityId, Ability>;
export const classes = classesData as Record<string, ClassDef>;
export const monsters = monstersData as Record<string, MonsterDef>;

export interface ClassDef {
  id: string;
  name: string;
  role: string;
  color: string;
  glyph: string;
  hp: number;
  moveSpeed: number;
  radius: number;
  abilities: AbilityId[];
  defaultState: StateId;
  defaultBand: string;
  defaultAbilityOrder: AbilityId[];
  retreatHpFraction: number;
}

export interface MonsterDef {
  id: string;
  name: string;
  role: string;
  glyph: string;
  outline: string;
  hp: number;
  moveSpeed: number;
  radius: number;
  abilities: AbilityId[];
  defaultState: StateId;
  defaultBand: string;
  defaultAbilityOrder: AbilityId[];
  standingOrder: string;
  retreatHpFraction: number;
  /**
   * When true, schedules Jev / offline decide calls.
   * Omit or false = fixed role-default AI (e.g. goblin always charges).
   */
  usesDecide?: boolean;
}

export function getAbility(id: AbilityId): Ability {
  const a = abilities[id];
  if (!a) throw new Error(`Unknown ability ${id}`);
  return a;
}

export function createActor(opts: {
  id: ActorId;
  side: Side;
  kind: string;
  pos: Vec2;
  partyOrder?: string | null;
  standingOrder?: string | null;
  state?: StateId;
  stateParams?: StateParams;
}): Actor {
  const isPlayerClass = opts.kind in classes;
  const def = isPlayerClass ? classes[opts.kind]! : monsters[opts.kind]!;
  if (!def) throw new Error(`Unknown kind ${opts.kind}`);

  const cooldowns: Record<AbilityId, number> = {};
  for (const id of def.abilities) cooldowns[id] = 0;

  const standingOrder =
    opts.standingOrder !== undefined
      ? opts.standingOrder
      : 'standingOrder' in def
        ? (def as MonsterDef).standingOrder
        : null;

  const color = isPlayerClass ? (def as ClassDef).color : '#111111';
  const outline = isPlayerClass ? undefined : (def as MonsterDef).outline;

  const actor: Actor = {
    id: opts.id,
    side: opts.side,
    kind: opts.kind,
    name: def.name,
    role: def.role,
    glyph: def.glyph,
    color,
    outline,
    pos: { ...opts.pos },
    vel: zero(),
    radius: def.radius,
    hp: def.hp,
    hpMax: def.hp,
    moveSpeed: def.moveSpeed,
    abilities: [...def.abilities],
    cooldowns,
    casting: null,
    state: opts.state ?? def.defaultState,
    stateParams: {
      rangeBand: (opts.stateParams?.rangeBand ?? def.defaultBand) as StateParams['rangeBand'],
      abilityPriority: opts.stateParams?.abilityPriority ?? [...def.defaultAbilityOrder],
      ...opts.stateParams,
    },
    standingOrder,
    partyOrder: opts.partyOrder ?? null,
    lastDecision: null,
    decisionLog: [],
    statuses: [],
    alive: true,
    deciding: false,
    lastDecisionTick: -9999,
    lastStateChangeTick: -9999,
    lastHealthBucket: healthBucket(def.hp, def.hp),
    lastHowCloseBucket: 'across the arena',
    forceRetargetUntil: 0,
    forceRetargetTo: null,
    dodgeUntil: 0,
    observedBehavior: opts.state ?? def.defaultState,
  };
  return actor;
}

export function roleDefaults(kind: string): {
  state: StateId;
  band: StateParams['rangeBand'];
  abilityPriority: AbilityId[];
} {
  const def = kind in classes ? classes[kind]! : monsters[kind]!;
  return {
    state: def.defaultState,
    band: def.defaultBand as StateParams['rangeBand'],
    abilityPriority: [...def.defaultAbilityOrder],
  };
}

/**
 * Player classes ask Jev (or offline policy). Fixed-role monsters stay on
 * spawn defaults — goblin charges via `close_and_attack` with no network.
 */
export function actorUsesDecide(actor: Actor): boolean {
  if (actor.kind in classes) return true;
  return monsters[actor.kind]?.usesDecide === true;
}

export function syncBuckets(actor: Actor, gap: number | null): void {
  actor.lastHealthBucket = healthBucket(actor.hp, actor.hpMax);
  if (gap !== null) actor.lastHowCloseBucket = howCloseBucket(gap);
}
