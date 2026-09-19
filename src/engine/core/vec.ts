/**
 * 2D vector maths for the arena.
 *
 * Vectors are immutable plain objects. Allocation is cheap at our scale
 * (2 frames, ~20 Hz) and immutability removes an entire class of aliasing bug
 * from the movement code.
 *
 * Note the absence of `angle()` / `rotate()` using `Math.atan2`/`sin`/`cos`:
 * those are not determinism-safe. Rotation is done with the algebraic form
 * (see `perp` and `rotateUnit`), which uses only multiplication and addition.
 */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const ZERO: Vec2 = Object.freeze({ x: 0, y: 0 });

export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** Squared length. Prefer this over `length` whenever you only need to compare. */
export function lengthSq(a: Vec2): number {
  return a.x * a.x + a.y * a.y;
}

export function length(a: Vec2): number {
  return Math.sqrt(lengthSq(a));
}

export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.sqrt(distanceSq(a, b));
}

/** Unit vector. Returns ZERO for a zero-length input rather than NaN. */
export function normalize(a: Vec2): Vec2 {
  const len = length(a);
  return len === 0 ? ZERO : { x: a.x / len, y: a.y / len };
}

/** Unit vector pointing from `from` to `to`. */
export function direction(from: Vec2, to: Vec2): Vec2 {
  return normalize(sub(to, from));
}

/** Perpendicular (90° counter-clockwise). The determinism-safe way to strafe. */
export function perp(a: Vec2): Vec2 {
  return { x: -a.y, y: a.x };
}

/**
 * Rotates a unit vector by a small step using a precomputed cos/sin pair.
 * Callers pass the pair from a lookup table so no transcendental runs in-sim.
 */
export function rotateUnit(a: Vec2, cosT: number, sinT: number): Vec2 {
  return { x: a.x * cosT - a.y * sinT, y: a.x * sinT + a.y * cosT };
}

/** Clamps a point into an axis-aligned rectangle anchored at the origin. */
export function clampToBounds(a: Vec2, width: number, height: number, radius = 0): Vec2 {
  const min = radius;
  return {
    x: a.x < min ? min : a.x > width - radius ? width - radius : a.x,
    y: a.y < min ? min : a.y > height - radius ? height - radius : a.y,
  };
}

/** Shortest distance from point `p` to segment `a`–`b`. Used for line-of-sight. */
export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const lenSq = lengthSq(ab);
  if (lenSq === 0) return distance(p, a);
  let t = dot(sub(p, a), ab) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return distance(p, add(a, scale(ab, t)));
}
