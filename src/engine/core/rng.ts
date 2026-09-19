/**
 * Deterministic pseudo-random number generation.
 *
 * The engine contains exactly one source of randomness and it is this one.
 * `Math.random()` does not appear anywhere under `src/engine` — enforced by
 * `tests/engine/purity.test.ts` — because a single unseeded call would make
 * matches unreproducible and silently break replays, balance tests, and any
 * future server-side verification.
 *
 * @see docs/01-rules.md §1.1 (determinism contract)
 */

/** An explicit, threaded random handle. Mutable by design: advancing is the point. */
export interface Rng {
  /** Current internal state. Exposed so a match can be forked or resumed. */
  state: number;
}

/** Creates a generator from a 32-bit seed. */
export function createRng(seed: number): Rng {
  // Normalise into uint32 so negative or fractional seeds behave predictably.
  return { state: (Math.floor(seed) >>> 0) || 0x9e3779b9 };
}

/**
 * mulberry32 — small, fast, and statistically sound for game purposes.
 * Chosen over xorshift for its better low-bit distribution, which matters
 * because we take many small probability rolls per tick.
 */
export function next(rng: Rng): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = rng.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Uniform float in [min, max). */
export function nextRange(rng: Rng, min: number, max: number): number {
  return min + next(rng) * (max - min);
}

/** Uniform integer in [min, max] inclusive. */
export function nextInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(next(rng) * (max - min + 1));
}

/** True with probability `p`. `p <= 0` is never, `p >= 1` is always. */
export function chance(rng: Rng, p: number): boolean {
  if (p <= 0) return false;
  if (p >= 1) return true;
  return next(rng) < p;
}

/** Picks one element. Returns undefined only for an empty list. */
export function pick<T>(rng: Rng, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[nextInt(rng, 0, items.length - 1)];
}

/**
 * Derives an independent child seed. Used to give each match component its own
 * stream so that adding a roll in one system does not shift every other
 * system's sequence — which would make balance diffs unreadable.
 */
export function deriveSeed(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
