import { describe, expect, it } from 'vitest';
import { applyDamage, tryBeginCast } from '../src/sim/abilities.ts';
import { getAbility } from '../src/sim/actor.ts';
import { DT } from '../src/sim/types.ts';
import { stepWorld, runTicks } from '../src/sim/step.ts';
import { createReferenceFight } from '../src/sim/world.ts';
import { applySyntheticAnswers } from '../src/net/decide.ts';
import { offlineDecide } from '../src/net/offlinePolicy.ts';
import { buildDigest } from '../src/net/digest.ts';

function settleCast(world: ReturnType<typeof createReferenceFight>, ticks = 20): void {
  for (let i = 0; i < ticks; i++) stepWorld(world, DT);
}

describe('Arcane Mark', () => {
  it('matches spec: ranged utility, range 9, +10% damage taken 5s, cd 4, windup 0.2', () => {
    const ab = getAbility('arcane_mark');
    expect(ab.kind).toBe('utility');
    expect(ab.delivery).toBe('ranged');
    expect(ab.range).toBe(9);
    expect(ab.cooldown).toBe(4);
    expect(ab.windup).toBe(0.2);
    expect(ab.effects).toEqual([{ type: 'damage_taken_up', factor: 0.1, duration: 5 }]);
  });

  it('applies +10% damage taken for 5s', () => {
    const w = createReferenceFight(1);
    const p = w.actors.find((a) => a.kind === 'arcanist')!;
    const g = w.actors.find((a) => a.kind === 'goblin')!;
    p.pos = { x: 8, y: 10 };
    g.pos = { x: 8, y: 15 };
    p.vel = { x: 0, y: 0 };
    expect(tryBeginCast(w, p, 'arcane_mark', g)).toBe(true);
    settleCast(w);
    const mark = g.statuses.find((s) => s.type === 'damage_taken_up');
    expect(mark?.factor).toBe(0.1);
    expect(mark!.remaining).toBeGreaterThan(4.5);

    const before = g.hp;
    applyDamage(w, p, g, 2);
    expect(before - g.hp).toBeCloseTo(2.2, 5);
  });

  it('refreshes duration instead of stacking', () => {
    const w = createReferenceFight(1);
    const p = w.actors.find((a) => a.kind === 'arcanist')!;
    const g = w.actors.find((a) => a.kind === 'goblin')!;
    p.pos = { x: 8, y: 10 };
    g.pos = { x: 8, y: 15 };
    p.vel = { x: 0, y: 0 };
    g.vel = { x: 0, y: 0 };
    g.state = 'hold_and_shoot';
    expect(tryBeginCast(w, p, 'arcane_mark', g)).toBe(true);
    settleCast(w);
    runTicks(w, 120);
    const leftover = g.statuses.find((s) => s.type === 'damage_taken_up')!.remaining;
    expect(leftover).toBeLessThan(4);

    p.cooldowns.arcane_mark = 0;
    p.casting = null;
    p.vel = { x: 0, y: 0 };
    g.vel = { x: 0, y: 0 };
    g.state = 'hold_and_shoot';
    expect(tryBeginCast(w, p, 'arcane_mark', g)).toBe(true);
    settleCast(w);
    const marks = g.statuses.filter((s) => s.type === 'damage_taken_up');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.remaining).toBeGreaterThan(leftover + 1);
    expect(marks[0]!.remaining).toBeGreaterThan(4.5);
  });

  it('fires during hold_and_shoot when prioritized', () => {
    const w = createReferenceFight(42);
    const p = w.actors.find((a) => a.side === 'player')!;
    const g = w.actors.find((a) => a.side === 'enemy')!;
    p.pos = { x: 8, y: 10 };
    g.pos = { x: 8, y: 15 };
    g.vel = { x: 0, y: 0 };
    g.state = 'hold_and_shoot';

    applySyntheticAnswers(w, p, {
      behavior: 'hold_and_shoot',
      ability: 'arcane_mark',
      confidence: 0.95,
    });
    runTicks(w, 45);
    expect(g.statuses.some((s) => s.type === 'damage_taken_up')).toBe(true);
    expect(p.cooldowns.arcane_mark).toBeGreaterThan(0);
  });

  it('fires during skirmish when ability Choice puts it first', () => {
    const w = createReferenceFight(42);
    const p = w.actors.find((a) => a.side === 'player')!;
    const g = w.actors.find((a) => a.side === 'enemy')!;
    p.pos = { x: 8, y: 10 };
    g.pos = { x: 8, y: 16 };
    g.vel = { x: 0, y: 0 };
    g.state = 'hold_and_shoot';

    applySyntheticAnswers(w, p, {
      behavior: 'skirmish',
      rangeBand: 'well_clear',
      ability: 'arcane_mark',
      confidence: 0.95,
    });
    expect(p.stateParams.abilityPriority![0]).toBe('arcane_mark');
    runTicks(w, 60);
    expect(g.statuses.some((s) => s.type === 'damage_taken_up')).toBe(true);
    expect(p.cooldowns.arcane_mark).toBeGreaterThan(0);
  });
});

describe('offline ability preference for Arcane Mark', () => {
  it('prioritizes mark when the standing order asks to mark', () => {
    const w = createReferenceFight(1);
    const p = w.actors.find((a) => a.kind === 'arcanist')!;
    p.standingOrder = 'mark the goblin and keep shooting';
    const d = offlineDecide(p, buildDigest(w, p));
    expect(d.ability).toBe('arcane_mark');
  });
});
