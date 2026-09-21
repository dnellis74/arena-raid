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

function settleCast(world: ReturnType<typeof createReferenceFight>, ticks = 30): void {
  for (let i = 0; i < ticks; i++) stepWorld(world, DT);
}

function wardenFight(seed = 1) {
  const w = createReferenceFight(seed, { players: ['warden'], enemies: 1 });
  const p = w.actors.find((a) => a.kind === 'warden')!;
  const g = w.actors.find((a) => a.kind === 'goblin')!;
  return { w, p, g };
}

describe('Warden spawn', () => {
  it('spawns as the mid-range healer with its own standing order', () => {
    const { w, p, g } = wardenFight();
    expect(p.hp).toBe(28);
    expect(p.moveSpeed).toBe(4.5);
    expect(p.color).toBe('#22C55E');
    expect(p.state).toBe('hold_and_shoot');
    expect(p.stateParams.rangeBand).toBe('just_clear');
    expect(p.abilities).toEqual(['mending_lash', 'staff_swing', 'suture', 'cleanse']);
    expect(g.kind).toBe('goblin');
    expect(p.standingOrder).toBe(classes.warden.standingOrder);
    expect(w.partyOrder).toBeNull();
    expect(p.partyOrder).toBeNull();
  });

  it('joins the full party against three goblins and a hobgoblin', () => {
    const w = createReferenceFight(1);
    expect(w.actors.map((a) => a.kind).sort()).toEqual([
      'arcanist',
      'duelist',
      'goblin',
      'goblin',
      'goblin',
      'hobgoblin',
      'vanguard',
      'warden',
    ]);
    const ward = w.actors.find((x) => x.kind === 'warden')!;
    expect(ward.standingOrder).toBe(classes.warden.standingOrder);
    expect(w.partyOrder).toBeNull();
  });
});

describe('Mending Lash', () => {
  it('matches spec: ranged 6, 2 dmg + heal 3 lowest ally, cd 1.6, windup 0.25', () => {
    const ab = getAbility('mending_lash');
    expect(ab.kind).toBe('attack');
    expect(ab.delivery).toBe('ranged');
    expect(ab.range).toBe(6);
    expect(ab.damage).toBe(2);
    expect(ab.healing).toBe(3);
    expect(ab.cooldown).toBe(1.6);
    expect(ab.windup).toBe(0.25);
  });

  it('damages the goblin and self-heals when solo', () => {
    const { w, p, g } = wardenFight();
    p.pos = { x: 8, y: 12 };
    g.pos = { x: 8, y: 16 };
    p.hp = 20;
    const gHp = g.hp;
    expect(tryBeginCast(w, p, 'mending_lash', g)).toBe(true);
    settleCast(w);
    expect(gHp - g.hp).toBe(2);
    expect(p.hp).toBe(23);
  });
});

describe('Staff Swing', () => {
  it('matches spec: melee 1.4, 3 dmg, cd 1.0, windup 0.25', () => {
    const ab = getAbility('staff_swing');
    expect(ab.delivery).toBe('melee');
    expect(ab.range).toBe(1.4);
    expect(ab.damage).toBe(3);
    expect(ab.cooldown).toBe(1.0);
    expect(ab.windup).toBe(0.25);
  });

  it('deals 3 in melee', () => {
    const { w, p, g } = wardenFight();
    p.pos = { x: 8, y: 14 };
    g.pos = { x: 8, y: 15.2 };
    const hp = g.hp;
    expect(tryBeginCast(w, p, 'staff_swing', g)).toBe(true);
    settleCast(w);
    expect(hp - g.hp).toBe(3);
  });
});

describe('Suture', () => {
  it('matches spec: ally 8, heal 8, cd 6, windup 0.4', () => {
    const ab = getAbility('suture');
    expect(ab.kind).toBe('utility');
    expect(ab.delivery).toBe('ally');
    expect(ab.range).toBe(8);
    expect(ab.healing).toBe(8);
    expect(ab.cooldown).toBe(6);
    expect(ab.windup).toBe(0.4);
  });

  it('heals self and refuses a hostile target', () => {
    const { w, p, g } = wardenFight();
    p.pos = { x: 8, y: 12 };
    g.pos = { x: 8, y: 20 };
    g.state = 'hold_and_shoot';
    g.vel = { x: 0, y: 0 };
    p.hp = 10;
    p.vel = { x: 0, y: 0 };
    expect(tryBeginCast(w, p, 'suture', g)).toBe(false);
    expect(tryBeginCast(w, p, 'suture', p)).toBe(true);
    settleCast(w);
    expect(p.hp).toBe(18);
  });

  it('fires on self from hold_and_shoot without healing the goblin', () => {
    const { w, p, g } = wardenFight();
    p.pos = { x: 8, y: 10 };
    g.pos = { x: 8, y: 15 };
    p.hp = 12;
    p.state = 'hold_and_shoot';
    p.stateParams.abilityPriority = ['suture', 'mending_lash', 'cleanse', 'staff_swing'];
    g.state = 'hold_and_shoot';
    const gHp = g.hp;
    runTicks(w, 40);
    expect(p.hp).toBeGreaterThan(12);
    expect(g.hp).toBe(gHp);
  });
});

describe('Cleanse', () => {
  it('matches spec: ally 8, heal 1, cd 5, windup 0.3', () => {
    const ab = getAbility('cleanse');
    expect(ab.delivery).toBe('ally');
    expect(ab.range).toBe(8);
    expect(ab.healing).toBe(1);
    expect(ab.cooldown).toBe(5);
    expect(ab.windup).toBe(0.3);
  });

  it('removes one debuff and heals 1', () => {
    const { w, p } = wardenFight();
    p.pos = { x: 8, y: 12 };
    p.hp = 20;
    p.statuses.push({ type: 'debuff', remaining: 5, sourceId: 'e1' });
    p.statuses.push({ type: 'debuff', remaining: 5, sourceId: 'e1' });
    expect(tryBeginCast(w, p, 'cleanse', p)).toBe(true);
    settleCast(w);
    expect(p.statuses.filter((s) => s.type === 'debuff')).toHaveLength(1);
    expect(p.hp).toBe(21);
  });
});

describe('offline ability preference for Warden', () => {
  it('prioritizes suture when the order asks to heal', () => {
    const { p, w } = wardenFight();
    p.standingOrder = 'suture the wounded and keep lashing';
    expect(offlineDecide(p, buildDigest(w, p)).ability).toBe('suture');
  });

  it('prioritizes cleanse when the order asks to dispel', () => {
    const { p, w } = wardenFight();
    p.standingOrder = 'cleanse the debuff then lash';
    expect(offlineDecide(p, buildDigest(w, p)).ability).toBe('cleanse');
  });

  it('prioritizes mending lash when the order asks to lash', () => {
    const { p, w } = wardenFight();
    p.standingOrder = 'lash them and stay mid range';
    expect(offlineDecide(p, buildDigest(w, p)).ability).toBe('mending_lash');
  });
});

describe('Warden vs Goblin', () => {
  it('can finish a 1v1 from hold_and_shoot', () => {
    const { w, p, g } = wardenFight(7);
    p.state = 'hold_and_shoot';
    g.state = 'close_and_attack';
    // Close enough for lash range once goblin walks in
    p.pos = { x: 8, y: 10 };
    g.pos = { x: 8, y: 18 };
    runTicks(w, 60 * 25);
    expect(w.matchOver).toBe(true);
    expect(p.alive || g.alive).toBe(true);
  });

  it('adopts hold_and_shoot from a mid-range standing order', () => {
    const { w, p } = wardenFight();
    applySyntheticAnswers(w, p, {
      behavior: 'hold_and_shoot',
      rangeBand: 'just_clear',
      confidence: 0.95,
    });
    expect(p.state).toBe('hold_and_shoot');
  });
});
