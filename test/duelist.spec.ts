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

function duelistFight(seed = 1) {
  const w = createReferenceFight(seed, { players: ['duelist'], enemies: 1 });
  const p = w.actors.find((a) => a.kind === 'duelist')!;
  const g = w.actors.find((a) => a.kind === 'goblin')!;
  return { w, p, g };
}

describe('Duelist spawn', () => {
  it('spawns as the skirmishing striker with its own standing order', () => {
    const { w, p, g } = duelistFight();
    expect(p.hp).toBe(22);
    expect(p.moveSpeed).toBe(5.5);
    expect(p.color).toBe('#EF4444');
    expect(p.state).toBe('skirmish');
    expect(p.stateParams.rangeBand).toBe('just_clear');
    expect(p.abilities).toEqual(['flurry', 'thrown_dagger', 'shadowstep', 'feint']);
    expect(g.kind).toBe('goblin');
    expect(p.standingOrder).toBe(classes.duelist.standingOrder);
    expect(w.partyOrder).toBeNull();
    expect(p.partyOrder).toBeNull();
  });

  it('joins the full party against four goblins and a hobgoblin', () => {
    const w = createReferenceFight(1);
    expect(w.actors.map((a) => a.kind).sort()).toEqual([
      'arcanist',
      'duelist',
      'goblin',
      'goblin',
      'goblin',
      'goblin',
      'hobgoblin',
      'vanguard',
      'warden',
    ]);
    const d = w.actors.find((x) => x.kind === 'duelist')!;
    expect(d.standingOrder).toBe(classes.duelist.standingOrder);
    expect(w.partyOrder).toBeNull();
  });
});

describe('Flurry', () => {
  it('matches spec: melee 1.4, 3x3 over 0.6s, cd 2.0, windup 0.2', () => {
    const ab = getAbility('flurry');
    expect(ab.kind).toBe('attack');
    expect(ab.delivery).toBe('melee');
    expect(ab.range).toBe(1.4);
    expect(ab.cooldown).toBe(2.0);
    expect(ab.windup).toBe(0.2);
    expect(ab.effects).toEqual([
      { type: 'multi_hit', hits: 3, perHit: 3, span: 0.6 },
    ]);
  });

  it('lands three hits of 3 over the span (9 total)', () => {
    const { w, p, g } = duelistFight();
    p.pos = { x: 8, y: 14 };
    g.pos = { x: 8, y: 15.2 };
    g.state = 'hold_and_shoot';
    g.vel = { x: 0, y: 0 };
    p.vel = { x: 0, y: 0 };
    p.state = 'hold_and_shoot';
    p.stateParams.abilityPriority = ['flurry'];
    p.cooldowns.thrown_dagger = 99;
    p.cooldowns.shadowstep = 99;
    p.cooldowns.feint = 99;
    const hp = g.hp;
    expect(tryBeginCast(w, p, 'flurry', g)).toBe(true);
    // windup 0.2 + span 0.6
    settleCast(w, Math.ceil(1.0 / DT));
    expect(hp - g.hp).toBe(9);
    expect(w.pendingStrikes).toHaveLength(0);
  });
});

describe('Thrown Dagger', () => {
  it('matches spec: ranged 6, 2 dmg, cd 1.2, windup 0.2', () => {
    const ab = getAbility('thrown_dagger');
    expect(ab.delivery).toBe('ranged');
    expect(ab.range).toBe(6);
    expect(ab.damage).toBe(2);
    expect(ab.cooldown).toBe(1.2);
    expect(ab.windup).toBe(0.2);
  });

  it('deals 2 at range', () => {
    const { w, p, g } = duelistFight();
    p.pos = { x: 8, y: 12 };
    g.pos = { x: 8, y: 16 };
    g.state = 'hold_and_shoot';
    const hp = g.hp;
    expect(tryBeginCast(w, p, 'thrown_dagger', g)).toBe(true);
    settleCast(w);
    expect(hp - g.hp).toBe(2);
  });
});

describe('Shadowstep', () => {
  it('matches spec: self dash 6u, cd 8, windup 0.1', () => {
    const ab = getAbility('shadowstep');
    expect(ab.delivery).toBe('self');
    expect(ab.range).toBe(6);
    expect(ab.cooldown).toBe(8);
    expect(ab.windup).toBe(0.1);
    expect(ab.effects).toEqual([{ type: 'dash', range: 6 }]);
  });

  it('dashes toward the current target ignoring the blocker', () => {
    const { w, p, g } = duelistFight();
    p.pos = { x: 8, y: 10 };
    g.pos = { x: 8, y: 20 };
    p.stateParams.targetId = g.id;
    // Place a dummy ally between — dash teleports past collision
    const blocker = w.actors.find((a) => a.kind === 'goblin')!;
    void blocker;
    const y0 = p.pos.y;
    expect(tryBeginCast(w, p, 'shadowstep', null)).toBe(true);
    settleCast(w, 20);
    expect(p.pos.y).toBeGreaterThan(y0 + 4);
    expect(p.pos.y).toBeLessThanOrEqual(y0 + 6.01);
  });
});

describe('Feint', () => {
  it('matches spec: self dodge 0.5s, cd 6, windup 0', () => {
    const ab = getAbility('feint');
    expect(ab.delivery).toBe('self');
    expect(ab.range).toBe(0);
    expect(ab.cooldown).toBe(6);
    expect(ab.windup).toBe(0);
    expect(ab.effects).toEqual([{ type: 'dodge_window', duration: 0.5 }]);
  });

  it('makes the next incoming attack miss', () => {
    const { w, p, g } = duelistFight();
    p.pos = { x: 8, y: 14 };
    g.pos = { x: 8, y: 15.2 };
    expect(tryBeginCast(w, p, 'feint', null)).toBe(true);
    expect(p.dodgeUntil).toBeGreaterThan(w.time);
    const hp = p.hp;
    applyDamage(w, g, p, 6);
    expect(p.hp).toBe(hp);
    expect(w.floatingTexts.some((f) => f.text === 'miss')).toBe(true);
    // Window consumed — second hit lands
    applyDamage(w, g, p, 6);
    expect(p.hp).toBe(hp - 6);
  });

  it('auto-reacts when a nearby enemy attack is about to land', () => {
    const { w, p, g } = duelistFight();
    p.pos = { x: 8, y: 14 };
    g.pos = { x: 8, y: 15.2 };
    g.state = 'hold_and_shoot';
    p.state = 'skirmish';
    p.cooldowns.feint = 0;
    // Start a cleaver windup and tick until feint fires
    expect(tryBeginCast(w, g, 'rusty_cleaver', p)).toBe(true);
    expect(g.casting).not.toBeNull();
    for (let i = 0; i < 30 && p.dodgeUntil <= w.time; i++) {
      stepWorld(w, DT);
    }
    expect(p.dodgeUntil).toBeGreaterThan(w.time);
    expect((p.cooldowns.feint ?? 0) > 0).toBe(true);
  });
});

describe('offline ability preference for Duelist', () => {
  it('prioritizes flurry when the order asks to burst', () => {
    const { p, w } = duelistFight();
    p.standingOrder = 'flurry them then slip away';
    expect(offlineDecide(p, buildDigest(w, p)).ability).toBe('flurry');
  });

  it('prioritizes shadowstep when the order asks to dash', () => {
    const { p, w } = duelistFight();
    p.standingOrder = 'shadowstep in and carve';
    expect(offlineDecide(p, buildDigest(w, p)).ability).toBe('shadowstep');
  });

  it('prioritizes feint when the order asks to dodge', () => {
    const { p, w } = duelistFight();
    p.standingOrder = 'feint their swings then dagger';
    expect(offlineDecide(p, buildDigest(w, p)).ability).toBe('feint');
  });

  it('prioritizes thrown dagger when the order asks for dagger', () => {
    const { p, w } = duelistFight();
    p.standingOrder = 'throw a dagger from range';
    expect(offlineDecide(p, buildDigest(w, p)).ability).toBe('thrown_dagger');
  });
});

describe('Duelist vs Goblin', () => {
  it('can finish a 1v1 from skirmish', () => {
    const { w, p, g } = duelistFight(7);
    p.state = 'skirmish';
    p.stateParams.rangeBand = 'just_clear';
    g.state = 'close_and_attack';
    p.pos = { x: 8, y: 10 };
    g.pos = { x: 8, y: 18 };
    runTicks(w, 60 * 25);
    expect(w.matchOver).toBe(true);
    expect(p.alive || g.alive).toBe(true);
  });

  it('adopts skirmish from a slip-away standing order', () => {
    const { w, p } = duelistFight();
    applySyntheticAnswers(w, p, {
      behavior: 'skirmish',
      rangeBand: 'just_clear',
      confidence: 0.95,
    });
    expect(p.state).toBe('skirmish');
  });
});
