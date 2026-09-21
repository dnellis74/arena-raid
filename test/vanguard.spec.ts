import { describe, expect, it } from 'vitest';
import classes from '../src/data/classes.json' with { type: 'json' };
import { applyDamage, tryBeginCast } from '../src/sim/abilities.ts';
import { getAbility } from '../src/sim/actor.ts';
import { DT } from '../src/sim/types.ts';
import { stepWorld, runTicks } from '../src/sim/step.ts';
import { createReferenceFight } from '../src/sim/world.ts';
import { applySyntheticAnswers } from '../src/net/decide.ts';
import { offlineDecide } from '../src/net/offlinePolicy.ts';
import { buildDigest } from '../src/net/digest.ts';

function settleCast(world: ReturnType<typeof createReferenceFight>, ticks = 25): void {
  for (let i = 0; i < ticks; i++) stepWorld(world, DT);
}

function vanguardFight(seed = 1) {
  const w = createReferenceFight(seed, { players: ['vanguard'], enemies: 1 });
  const p = w.actors.find((a) => a.kind === 'vanguard')!;
  const g = w.actors.find((a) => a.kind === 'goblin')!;
  return { w, p, g };
}

describe('Vanguard spawn', () => {
  it('spawns as the front-line defender with its own standing order', () => {
    const { w, p, g } = vanguardFight();
    expect(p.hp).toBe(40);
    expect(p.moveSpeed).toBe(4.2);
    expect(p.color).toBe('#3B82F6');
    expect(p.state).toBe('close_and_attack');
    expect(p.abilities).toEqual([
      'shield_bash',
      'thrown_cleaver',
      'bulwark',
      'battle_shout',
    ]);
    expect(g.kind).toBe('goblin');
    expect(p.standingOrder).toBe(classes.vanguard.standingOrder);
    expect(w.partyOrder).toBeNull();
    expect(p.partyOrder).toBeNull();
  });

  it('joins the arcanist and warden against two goblins in the default fight', () => {
    const w = createReferenceFight(1);
    expect(w.actors.map((a) => a.kind).sort()).toEqual([
      'arcanist',
      'goblin',
      'goblin',
      'vanguard',
      'warden',
    ]);
    const a = w.actors.find((x) => x.kind === 'arcanist')!;
    const v = w.actors.find((x) => x.kind === 'vanguard')!;
    expect(a.standingOrder).toBe(classes.arcanist.standingOrder);
    expect(v.standingOrder).toBe(classes.vanguard.standingOrder);
    expect(w.partyOrder).toBeNull();
  });
});

describe('Shield Bash', () => {
  it('matches spec: melee 1.4, 5 dmg, taunt 3s, cd 1.4, windup 0.3', () => {
    const ab = getAbility('shield_bash');
    expect(ab.kind).toBe('attack');
    expect(ab.delivery).toBe('melee');
    expect(ab.range).toBe(1.4);
    expect(ab.damage).toBe(5);
    expect(ab.cooldown).toBe(1.4);
    expect(ab.windup).toBe(0.3);
    expect(ab.effects).toEqual([{ type: 'force_retarget', duration: 3 }]);
  });

  it('deals 5 and forces the target to retarget the vanguard', () => {
    const { w, p, g } = vanguardFight();
    p.pos = { x: 8, y: 14 };
    g.pos = { x: 8, y: 15.2 };
    p.vel = { x: 0, y: 0 };
    g.vel = { x: 0, y: 0 };
    g.state = 'hold_and_shoot';
    const hp = g.hp;
    expect(tryBeginCast(w, p, 'shield_bash', g)).toBe(true);
    settleCast(w);
    expect(hp - g.hp).toBe(5);
    expect(g.forceRetargetTo).toBe(p.id);
    expect(g.forceRetargetUntil).toBeGreaterThan(w.time);
    expect(g.forceRetargetUntil).toBeLessThanOrEqual(w.time + 3);
  });
});

describe('Thrown Cleaver', () => {
  it('matches spec: ranged 7, 2 dmg, cd 2, windup 0.3', () => {
    const ab = getAbility('thrown_cleaver');
    expect(ab.delivery).toBe('ranged');
    expect(ab.range).toBe(7);
    expect(ab.damage).toBe(2);
    expect(ab.cooldown).toBe(2);
    expect(ab.windup).toBe(0.3);
  });

  it('fires during hold_and_shoot when prioritized', () => {
    const { w, p, g } = vanguardFight(42);
    p.pos = { x: 8, y: 10 };
    g.pos = { x: 8, y: 15 };
    g.vel = { x: 0, y: 0 };
    g.state = 'hold_and_shoot';
    applySyntheticAnswers(w, p, {
      behavior: 'hold_and_shoot',
      ability: 'thrown_cleaver',
      confidence: 0.95,
    });
    const hp = g.hp;
    runTicks(w, 45);
    expect(g.hp).toBeLessThan(hp);
    expect(p.cooldowns.thrown_cleaver).toBeGreaterThan(0);
  });
});

describe('Bulwark', () => {
  it('matches spec: self, 50% damage taken for 4s, cd 12, windup 0', () => {
    const ab = getAbility('bulwark');
    expect(ab.kind).toBe('utility');
    expect(ab.delivery).toBe('self');
    expect(ab.range).toBe(0);
    expect(ab.cooldown).toBe(12);
    expect(ab.windup).toBe(0);
    expect(ab.effects).toEqual([
      { type: 'damage_reduction', factor: 0.5, duration: 4, radius: 2 },
    ]);
  });

  it('halves incoming damage on the caster', () => {
    const { w, p, g } = vanguardFight();
    expect(tryBeginCast(w, p, 'bulwark', g)).toBe(true);
    const ward = p.statuses.find((s) => s.type === 'damage_reduction');
    expect(ward?.factor).toBe(0.5);
    expect(ward!.remaining).toBe(4);
    const hp = p.hp;
    applyDamage(w, g, p, 6);
    expect(hp - p.hp).toBeCloseTo(3, 5);
  });

  it('fires from hold_and_shoot despite range 0', () => {
    const { w, p, g } = vanguardFight(42);
    p.pos = { x: 8, y: 10 };
    g.pos = { x: 8, y: 16 };
    g.vel = { x: 0, y: 0 };
    g.state = 'hold_and_shoot';
    applySyntheticAnswers(w, p, {
      behavior: 'hold_and_shoot',
      ability: 'bulwark',
      confidence: 0.95,
    });
    runTicks(w, 10);
    expect(p.statuses.some((s) => s.type === 'damage_reduction')).toBe(true);
  });

  it('fires while closing when prioritized', () => {
    const { w, p, g } = vanguardFight(42);
    p.pos = { x: 8, y: 10 };
    g.pos = { x: 8, y: 16 };
    g.vel = { x: 0, y: 0 };
    g.state = 'hold_and_shoot';
    applySyntheticAnswers(w, p, {
      behavior: 'close_and_attack',
      ability: 'bulwark',
      confidence: 0.95,
    });
    runTicks(w, 12);
    expect(p.statuses.some((s) => s.type === 'damage_reduction')).toBe(true);
  });
});

describe('Battle Shout', () => {
  it('matches spec: self, +5% damage for 4s, cd 10, windup 0, radius 6', () => {
    const ab = getAbility('battle_shout');
    expect(ab.delivery).toBe('self');
    expect(ab.cooldown).toBe(10);
    expect(ab.windup).toBe(0);
    expect(ab.effects).toEqual([
      { type: 'damage_up', factor: 0.05, duration: 4, radius: 6 },
    ]);
  });

  it('boosts the vanguard own damage by 5%', () => {
    const { w, p, g } = vanguardFight();
    expect(tryBeginCast(w, p, 'battle_shout', g)).toBe(true);
    const hp = g.hp;
    applyDamage(w, p, g, 5);
    expect(hp - g.hp).toBeCloseTo(5.25, 5);
  });
});

describe('offline ability preference for Vanguard', () => {
  it('prioritizes bash when the order asks to taunt', () => {
    const { p, w } = vanguardFight();
    p.standingOrder = 'taunt the goblin and keep it on you';
    expect(offlineDecide(p, buildDigest(w, p)).ability).toBe('shield_bash');
  });

  it('prioritizes bulwark when the order asks to defend', () => {
    const { p, w } = vanguardFight();
    p.standingOrder = 'put up a bulwark then charge';
    expect(offlineDecide(p, buildDigest(w, p)).ability).toBe('bulwark');
  });

  it('prioritizes shout when the order asks to rally', () => {
    const { p, w } = vanguardFight();
    p.standingOrder = 'shout and then bash';
    expect(offlineDecide(p, buildDigest(w, p)).ability).toBe('battle_shout');
  });
});

describe('Vanguard vs Goblin', () => {
  it('can finish a 1v1', () => {
    const { w, p, g } = vanguardFight(7);
    p.state = 'close_and_attack';
    g.state = 'close_and_attack';
    runTicks(w, 60 * 20);
    expect(w.matchOver).toBe(true);
    expect(p.alive || g.alive).toBe(true);
  });
});
