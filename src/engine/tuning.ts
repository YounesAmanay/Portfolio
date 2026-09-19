/**
 * ARCFORGE — Tuning constants.
 *
 * Every number that defines how the game *feels* lives here and nowhere else.
 * No other file in `src/engine` may contain a magic number; if you find one,
 * it is a bug. This is what makes the game tunable by a designer rather than
 * only by whoever wrote the file.
 *
 * Each constant is cross-referenced to the rulebook section that specifies it:
 * @see docs/01-rules.md
 * @see docs/02-balance.md
 */

// ─────────────────────────────────────────────────────────────────────────────
// Time — rulebook §1
// ─────────────────────────────────────────────────────────────────────────────

/** Fixed simulation timestep, in seconds. 20 Hz. */
export const TICK = 0.05;
/** Ticks per second, derived. */
export const TICK_RATE = 1 / TICK;
/** Hard match cap: 180 s. */
export const MATCH_LIMIT_TICKS = 3600;
/** Doctrine re-evaluates every 5 ticks (4 Hz) — the reaction-latency budget. */
export const DECISION_INTERVAL_TICKS = 5;

// ─────────────────────────────────────────────────────────────────────────────
// Budgets & load — rulebook §3
// ─────────────────────────────────────────────────────────────────────────────

/** agility = AGILITY_BASE - AGILITY_SLOPE * load, load = mass / massLimit. */
export const AGILITY_BASE = 1.25;
export const AGILITY_SLOPE = 0.5;
/** Cycle cost of a single doctrine rule. Doctrine competes with modules for CY. */
export const DOCTRINE_RULE_COST = 2;
export const MAX_DOCTRINE_RULES = 8;

// ─────────────────────────────────────────────────────────────────────────────
// Base stats — rulebook §4
// ─────────────────────────────────────────────────────────────────────────────

export const TARGETING_BASE = 100;
export const CRIT_BASE = 0.05;
export const CRIT_MULT_BASE = 1.75;

// ─────────────────────────────────────────────────────────────────────────────
// Damage pipeline — rulebook §5
// ─────────────────────────────────────────────────────────────────────────────

/** Range profile: firing closer than minRange costs accuracy. */
export const POINT_BLANK_PENALTY = 0.5;

/**
 * How much one point of evasion is worth against one point of accuracy.
 *
 * At 1.0 the light/heavy axis collapses: a skirmisher with 93 EV took only
 * 1.45x fewer hits than a fortress with 31 EV, which came nowhere near paying
 * for the 4x difference in effective HP between them. At 1.8 the same pair
 * sits at 1.69x, and mobility plus range control covers the rest.
 */
export const EVASION_POTENCY = 3.2;

export const HIT_FLOOR = 0.05;
export const HIT_CEIL = 0.95;
/** Accuracy multiplier while moving / while venting. */
export const MOVING_ACC_PENALTY = 0.88;
export const VENTING_ACC_PENALTY = 0.5;

/** Armour mitigation = AR / (AR + ARMOR_K), capped. @see docs/02-balance.md §3.1 */
export const ARMOR_K = 140;
export const ARMOR_MAX_MITIGATION = 0.80;

/** Shield reboot delay after a full break, and the softer delay after any hit. */
export const SHIELD_REBOOT_DELAY = 4.0;
export const SHIELD_HIT_DELAY = 1.2;

/** On-hit side effects — rulebook §5.9. */
export const THERMAL_HEAT_TRANSFER = 0.3;
export const ION_ENERGY_DRAIN = 0.55;
export const ION_HEAT_TRANSFER = 0.22;

/** Stagger — rulebook §5.10. */
export const STAGGER_THRESHOLD = 100;
export const STAGGER_DECAY = 15;
export const STAGGER_DURATION = 0.6;

// ─────────────────────────────────────────────────────────────────────────────
// Heat — rulebook §6
// ─────────────────────────────────────────────────────────────────────────────

export const HEAT_STRAIN_THRESHOLD = 0.7;
export const HEAT_CRITICAL_THRESHOLD = 0.9;
export const HEAT_OVERLOAD_THRESHOLD = 1.0;
/** Heat cannot exceed capacity * this, so overload recovery is bounded. */
export const HEAT_HARD_CAP_MULT = 1.5;

export const STRAIN_ACC_MULT = 0.85;
export const STRAIN_SPEED_MULT = 0.9;
export const STRAIN_COOLING_MULT = 0.95;

export const CRITICAL_ACC_MULT = 0.7;
export const CRITICAL_SPEED_MULT = 0.8;
export const CRITICAL_COOLDOWN_MULT = 1.25;

/** Overload: the fail state. Severe by design — see rulebook §6. */
export const OVERLOAD_RECOVERY_RATIO = 0.4;
export const OVERLOAD_MIN_TICKS = 60; // 3.0 s
export const OVERLOAD_EVASION_MULT = 0.25;
/** Structure burned per second while overloaded, as a fraction of max structure. */
export const OVERLOAD_BURN = 0.008;
export const OVERLOAD_COOLING_MULT = 2.5;

/** Venting: the doctrine action that avoids overload, at a real cost. */
export const VENT_MULTIPLIER = 4.0;
export const VENT_SPEED_MULT = 0.3;
export const VENT_MAX_DURATION = 2.0;
export const VENT_COOLDOWN = 3.0;

// ─────────────────────────────────────────────────────────────────────────────
// Arena — rulebook §9
// ─────────────────────────────────────────────────────────────────────────────

export const ARENA_WIDTH = 120;
export const ARENA_HEIGHT = 80;
export const ARENA_SPAWN_SEPARATION = 70;

/** Zone effects. */
export const VENT_ZONE_MULT = 1.8;
export const ION_STORM_DRAIN = 6; // EN/s
export const RUBBLE_SPEED_MULT = 0.75;
export const RUBBLE_EVASION_BONUS = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Doctrine actions — rulebook §10.2
// ─────────────────────────────────────────────────────────────────────────────

export const ORBIT_SPEED_FACTOR = 0.85;
export const BRACE_ARMOR_MULT = 1.3;
export const BRACE_EVASION_MULT = 0.6;
export const BRACE_ACC_MULT = 1.15;
/** How close `CHARGE` tries to get, and the stand-off `KITE` maintains. */
export const CHARGE_TARGET_RANGE = 8;
export const KITE_BUFFER = 6;

// ─────────────────────────────────────────────────────────────────────────────
// Victory & rating — rulebook §12
// ─────────────────────────────────────────────────────────────────────────────

export const STALEMATE_EPSILON = 0.02;

export const ELO_K_DEFAULT = 32;
export const ELO_K_HIGH = 24;
export const ELO_K_ELITE = 16;
export const ELO_K_PROVISIONAL = 48;
export const ELO_HIGH_THRESHOLD = 2000;
export const ELO_ELITE_THRESHOLD = 2400;
export const ELO_PROVISIONAL_MATCHES = 10;
export const ELO_FLOOR = 100;
export const ELO_START = 1000;

export const BASE_REWARD = 120;
export const LOSS_REWARD_RATIO = 0.4;
export const DAMAGE_BONUS = 80;
export const SALVAGE_CHANCE = 0.35;

// ─────────────────────────────────────────────────────────────────────────────
// Balance model — docs/02-balance.md §2
// Used by the content pricing helpers and asserted by tests/balance.
// ─────────────────────────────────────────────────────────────────────────────

export const EXPECTED_HIT_RATE = 0.65;
export const REFERENCE_FIGHT = 60;
export const RANGE_BASE = 0.8;
export const RANGE_SLOPE = 0.85;
export const RANGE_REF = 60;

export const MASS_WEIGHT = 0.045;
export const POWER_WEIGHT = 0.18;
export const HEAT_WEIGHT = 0.55;
export const EN_WEIGHT = 0.3;
/**
 * What armour penetration is worth as a multiplier on threat.
 *
 * Omitting this was a real balance bug: the three weapons that dominated the
 * archetype matrix (Nova Lance 45%, Gauss Battery 40%, Beam Lance 35%) were
 * precisely the high-pierce ones, because the model charged them nothing for
 * ignoring the defensive stat the whole catalogue is priced around.
 */
export const PIERCE_WEIGHT = 0.85;
export const AGILITY_WEIGHT = 1.4;

/**
 * Normalises WPR/WCR so that archetype-defining weapons sit at ~1.00.
 * Re-calibrating the whole catalogue is a one-line change here; the balance
 * suite then reports exactly which parts fell out of band.
 */
export const EFFICIENCY_NORM = 2.5236;
export const EFFICIENCY_MIN = 0.88;
export const EFFICIENCY_MAX = 1.12;

/**
 * Bounds on archetype win rate across the full matchup matrix, enforced by
 * `tests/balance/matchups.test.ts`.
 *
 * The shipped catalogue sits inside the 42-58% design goal on every archetype;
 * the enforced band carries two points of margin so that seed-to-seed noise
 * does not fail CI, while a genuine balance regression still does.
 * @see docs/02-balance.md §5
 */
export const MAX_ARCHETYPE_WINRATE = 0.6;
export const MIN_ARCHETYPE_WINRATE = 0.4;
/** The design goal the suite reports against. */
export const TARGET_WINRATE_BAND = [0.42, 0.58] as const;
