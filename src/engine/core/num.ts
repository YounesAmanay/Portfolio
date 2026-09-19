/**
 * Numeric helpers, restricted to the determinism-safe subset.
 *
 * Only `+ - * /`, `Math.sqrt`, `Math.min/max`, `Math.floor/abs/round` appear here.
 * Transcendental functions (`sin`, `cos`, `pow`, `exp`, `hypot`) are *not*
 * guaranteed bit-identical across JS engines, so they are banned from any path
 * that can affect a match outcome.
 *
 * @see docs/01-rules.md §1.1 rule 4
 */

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Clamp to [0, 1]. The most common clamp in the codebase, so it gets a name. */
export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse lerp, guarded against a zero-width span. */
export function invLerp(a: number, b: number, value: number): number {
  return a === b ? 0 : (value - a) / (b - a);
}

/** Remaps a value from one range to another, clamped to the output range. */
export function remap(value: number, inA: number, inB: number, outA: number, outB: number): number {
  return lerp(outA, outB, clamp01(invLerp(inA, inB, value)));
}

/** Moves `current` toward `target` by at most `maxDelta`. Frame-rate independent movement. */
export function approach(current: number, target: number, maxDelta: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + (diff > 0 ? maxDelta : -maxDelta);
}

/** Rounds to `places` decimals. For display and for stable test assertions. */
export function roundTo(value: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/**
 * The hyperbolic diminishing-returns curve used for armour mitigation.
 * `AR / (AR + k)` — see docs/02-balance.md §3.1 for why this specific shape
 * makes marginal effective-HP exactly linear in armour points.
 */
export function diminishing(value: number, k: number): number {
  if (value <= 0) return 0;
  return value / (value + k);
}

/** Sums a numeric projection over a list. Used constantly by the stat compiler. */
export function sumBy<T>(items: readonly T[], fn: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += fn(item);
  return total;
}
