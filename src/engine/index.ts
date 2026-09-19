/**
 * ARCFORGE engine — public API.
 *
 * The UI imports from here and nowhere else. Everything below this barrel is
 * free to be reorganised without touching a line of interface code.
 *
 * The engine is pure: no DOM, no clock, no randomness that is not seeded, no
 * I/O. @see docs/03-architecture.md §1
 */

// ── core ─────────────────────────────────────────────────────────────────────
export * from './core/num';
export * from './core/rng';
export * from './core/vec';

// ── domain ───────────────────────────────────────────────────────────────────
export * from './domain/build';
export * from './domain/damage';
export * from './domain/doctrine';
export * from './domain/ids';
export * from './domain/part';
export * from './domain/sockets';
export * from './domain/stats';

// ── forge ────────────────────────────────────────────────────────────────────
export * from './forge/compile';
export * from './forge/registry';
export * from './forge/validate';

// ── simulation ───────────────────────────────────────────────────────────────
export * from './sim/arena';
export * from './sim/combat';
export * from './sim/cortex';
export * from './sim/events';
export * from './sim/heat';
export * from './sim/movement';
export * from './sim/simulate';
export * from './sim/state';

// ── meta ─────────────────────────────────────────────────────────────────────
export * from './meta/economy';
export * from './meta/rating';

// ── content ──────────────────────────────────────────────────────────────────
export * from './content/index';

// ── tuning ───────────────────────────────────────────────────────────────────
export * as TUNING from './tuning';
