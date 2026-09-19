/**
 * Steering, collision, and positioning.
 *
 * Frames are walkers, not vehicles: velocity is set directly with no momentum.
 * That is a deliberate simplification — momentum would add a simulation
 * parameter the player cannot see, tune, or reason about from the Forge, which
 * is where all the decisions are supposed to live.
 *
 * @see docs/01-rules.md §9
 */

import { clamp } from '../core/num';
import {
  add,
  clampToBounds,
  direction,
  distance,
  normalize,
  perp,
  scale,
  ZERO,
  type Vec2,
} from '../core/vec';
import {
  CHARGE_TARGET_RANGE,
  KITE_BUFFER,
  ORBIT_SPEED_FACTOR,
  RUBBLE_SPEED_MULT,
  TICK,
} from '../tuning';
import { hasLineOfSight, inZone, nearestZone, type Arena } from './arena';
import { thermalSpeedMult } from './heat';
import { isStaggered, type FrameRuntime } from './state';

/**
 * The range this frame wants to fight at: the optimal range of its highest-DPS
 * weapon. Using the *best* weapon rather than an average means a build with one
 * sniper and one sidearm positions for the sniper, which is what a player
 * intends when they mount one.
 */
export function preferredRange(runtime: FrameRuntime): number {
  let best = 0;
  let bestDps = -1;
  for (const weapon of runtime.weapons) {
    if (weapon.ammo <= 0) continue;
    if (weapon.def.sustainedDps > bestDps) {
      bestDps = weapon.def.sustainedDps;
      best = weapon.def.profile.range.optimalRange;
    }
  }
  return best > 0 ? best : 25;
}

/** The longest range at which anything on this frame can still fire. */
export function maxEffectiveRange(runtime: FrameRuntime): number {
  let max = 0;
  for (const weapon of runtime.weapons) {
    if (weapon.ammo <= 0) continue;
    max = Math.max(max, weapon.def.profile.range.optimalRange);
  }
  return max > 0 ? max : 25;
}

/**
 * Resolves the current action into a desired velocity, then integrates it with
 * collision. Returns nothing; mutates `runtime.position` and `runtime.facing`.
 */
export function stepMovement(
  runtime: FrameRuntime,
  opponent: FrameRuntime,
  arena: Arena,
  tick: number,
): void {
  runtime.facing = direction(runtime.position, opponent.position);

  if (isStaggered(runtime, tick) || runtime.heatState === 'OVERLOADED') {
    runtime.moving = false;
    return;
  }

  const desired = desiredDirection(runtime, opponent, arena);
  if (desired === ZERO || (desired.x === 0 && desired.y === 0)) {
    runtime.moving = false;
    return;
  }

  let speed = runtime.frame.stats.speed * thermalSpeedMult(runtime, tick);
  if (runtime.action === 'ORBIT') speed *= ORBIT_SPEED_FACTOR;
  if (inZone(arena, runtime.position, 'RUBBLE')) speed *= RUBBLE_SPEED_MULT;

  if (speed <= 0) {
    runtime.moving = false;
    return;
  }

  const step = scale(desired, speed * TICK);
  runtime.position = resolveCollisions(
    add(runtime.position, step),
    runtime,
    opponent,
    arena,
    step,
  );
  runtime.moving = true;
}

/** Unit vector the frame wants to travel along, per its current action. */
function desiredDirection(
  runtime: FrameRuntime,
  opponent: FrameRuntime,
  arena: Arena,
): Vec2 {
  const toEnemy = direction(runtime.position, opponent.position);
  const d = distance(runtime.position, opponent.position);

  // Before anything else: if we cannot see the target and nothing we carry can
  // shoot over cover, regaining line of sight outranks every other intent.
  // Holding a firing position you cannot fire from is the one behaviour that
  // makes a match end 0-0, so it is handled ahead of the action switch.
  if (needsLineOfSight(runtime) && !hasLineOfSight(arena, runtime.position, opponent.position)) {
    return flankToward(toEnemy);
  }

  switch (runtime.action) {
    case 'VENT':
    case 'BRACE':
      return ZERO;

    case 'CHARGE':
      return d > CHARGE_TARGET_RANGE ? toEnemy : ZERO;

    case 'RETREAT':
      return scale(toEnemy, -1);

    case 'ORBIT':
      // Strafe, drifting slightly inward or outward to hold the preferred band.
      return holdRange(toEnemy, d, preferredRange(runtime), true);

    case 'KITE': {
      const target = maxEffectiveRange(runtime) - KITE_BUFFER;
      return holdRange(toEnemy, d, Math.max(CHARGE_TARGET_RANGE, target), false);
    }

    case 'SEEK_COOLANT': {
      const vent = nearestZone(arena, runtime.position, 'COOLANT');
      if (!vent) return holdRange(toEnemy, d, preferredRange(runtime), false);
      if (distance(runtime.position, vent.position) < vent.radius * 0.5) return ZERO;
      return direction(runtime.position, vent.position);
    }

    case 'ENGAGE':
    case 'FOCUS':
    default:
      return holdRange(toEnemy, d, preferredRange(runtime), false);
  }
}

/** True if every usable weapon on this frame requires line of sight. */
function needsLineOfSight(runtime: FrameRuntime): boolean {
  let hasUsable = false;
  for (const weapon of runtime.weapons) {
    if (weapon.ammo <= 0) continue;
    if (weapon.def.profile.arcing) return false;
    hasUsable = true;
  }
  return hasUsable;
}

/**
 * Closes on the enemy with a sideways bias, so a frame walks *around* a pylon
 * instead of grinding straight into it. The 0.6 weighting is enough curve to
 * clear a 6 m pylon without the approach reading as evasive.
 */
function flankToward(toEnemy: Vec2): Vec2 {
  const side = perp(toEnemy);
  return normalize({ x: toEnemy.x + side.x * 0.6, y: toEnemy.y + side.y * 0.6 });
}

/**
 * Moves toward or away from the enemy to sit at `target` range, with a dead
 * band so a frame does not jitter back and forth across the threshold every
 * tick. The dead band is 8% of target range — wide enough to settle, narrow
 * enough that positioning still reads as intentional.
 */
function holdRange(toEnemy: Vec2, current: number, target: number, strafe: boolean): Vec2 {
  const deadBand = Math.max(2, target * 0.08);
  if (current > target + deadBand) return toEnemy;
  if (current < target - deadBand) return scale(toEnemy, -1);
  return strafe ? perp(toEnemy) : ZERO;
}

/**
 * Pushes a proposed position out of pylons and the opponent, then clamps to
 * the arena. Collisions *slide* rather than stop: a frame that jams on a pylon
 * and stands still looks broken, and being immobile is already the game's
 * harshest punishment (overload), so it should not happen by accident.
 */
function resolveCollisions(
  proposed: Vec2,
  runtime: FrameRuntime,
  opponent: FrameRuntime,
  arena: Arena,
  step: Vec2,
): Vec2 {
  const radius = runtime.frame.stats.radius;
  let position = proposed;

  for (const pylon of arena.pylons) {
    const gap = distance(position, pylon.position);
    const minGap = pylon.radius + radius;
    if (gap < minGap && gap > 0) {
      const out = direction(pylon.position, position);
      const along = slideAlong(step, out);
      position = add(pylon.position, scale(out, minGap));
      position = add(position, along);
    }
  }

  const enemyGap = distance(position, opponent.position);
  const minEnemyGap = radius + opponent.frame.stats.radius;
  if (enemyGap < minEnemyGap && enemyGap > 0) {
    const out = direction(opponent.position, position);
    position = add(opponent.position, scale(out, minEnemyGap));
  }

  return clampToBounds(position, arena.width, arena.height, radius);
}

/** Component of `step` tangent to the surface normal `normal`. */
function slideAlong(step: Vec2, normal: Vec2): Vec2 {
  const tangent = perp(normal);
  const amount = step.x * tangent.x + step.y * tangent.y;
  return scale(normalize(tangent), clamp(amount, -Infinity, Infinity));
}

/** Spawn positions, separated along the arena's long axis. */
export function spawnPositions(arena: Arena, separation: number): readonly [Vec2, Vec2] {
  const midY = arena.height / 2;
  const midX = arena.width / 2;
  const half = Math.min(separation, arena.width - 20) / 2;
  return [
    { x: midX - half, y: midY },
    { x: midX + half, y: midY },
  ];
}

/** Squared-distance-free helper used by the doctrine interpreter. */
export function separation(a: FrameRuntime, b: FrameRuntime): number {
  return distance(a.position, b.position);
}
