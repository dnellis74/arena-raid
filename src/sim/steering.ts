import type { Actor, Vec2 } from './types.ts';
import { ARENA_H, ARENA_W } from './types.ts';
import { add, len, norm, scale, sub, zero } from './vec.ts';

const W_INTENT = 1.0;
const W_SEP = 0.6;
const W_WALL = 0.8;
const SEP_RADIUS = 1.5;
const WALL_RADIUS = 2.5;

export function steer(
  actor: Actor,
  intentDir: Vec2,
  others: Actor[],
  moveScale = 1,
  arenaW = ARENA_W,
  arenaH = ARENA_H,
): Vec2 {
  const intent = norm(intentDir);
  const sep = separation(actor, others);
  let wall = wallRepulsion(actor.pos, arenaW, arenaH);
  // Don't let wall repulsion cancel the flee intent (pushes you into the enemy)
  if (len(intent) > 1e-6 && len(wall) > 1e-6) {
    const dot = intent.x * wall.x + intent.y * wall.y;
    if (dot < 0) {
      // Keep only the wall component perpendicular to intent
      const parallel = scale(intent, dot);
      wall = sub(wall, parallel);
      wall = norm(wall);
    }
  }
  const desired = add(
    add(scale(intent, W_INTENT), scale(sep, W_SEP)),
    scale(wall, W_WALL),
  );
  const n = norm(desired);
  const speed = actor.moveSpeed * moveScale;
  if (len(n) < 1e-6) return zero();
  return scale(n, speed);
}

function separation(self: Actor, others: Actor[]): Vec2 {
  let acc = zero();
  let count = 0;
  for (const o of others) {
    if (o.id === self.id || !o.alive) continue;
    const d = sub(self.pos, o.pos);
    const dist = len(d);
    if (dist > 0 && dist < SEP_RADIUS) {
      acc = add(acc, scale(norm(d), (SEP_RADIUS - dist) / SEP_RADIUS));
      count++;
    }
  }
  if (count === 0) return zero();
  return norm(acc);
}

function wallRepulsion(pos: Vec2, w: number, h: number): Vec2 {
  let acc = zero();
  if (pos.x < WALL_RADIUS) acc = add(acc, { x: (WALL_RADIUS - pos.x) / WALL_RADIUS, y: 0 });
  if (w - pos.x < WALL_RADIUS)
    acc = add(acc, { x: -(WALL_RADIUS - (w - pos.x)) / WALL_RADIUS, y: 0 });
  if (pos.y < WALL_RADIUS) acc = add(acc, { x: 0, y: (WALL_RADIUS - pos.y) / WALL_RADIUS });
  if (h - pos.y < WALL_RADIUS)
    acc = add(acc, { x: 0, y: -(WALL_RADIUS - (h - pos.y)) / WALL_RADIUS });
  return norm(acc);
}

/** True if heading from pos points into a wall within `within` units. */
export function headingHitsWall(
  pos: Vec2,
  dir: Vec2,
  within = 3,
  arenaW = ARENA_W,
  arenaH = ARENA_H,
): boolean {
  const n = norm(dir);
  if (len(n) < 1e-6) return false;
  const probe = add(pos, scale(n, within));
  return probe.x < 0 || probe.x > arenaW || probe.y < 0 || probe.y > arenaH;
}
