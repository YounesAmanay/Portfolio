/**
 * Frame statistics and the algebra that combines them.
 *
 * `StatGrant` is what a part *contributes*. `FrameStats` is what a build *has*.
 * The only code permitted to turn the former into the latter is
 * `forge/compile.ts`, so the UI and the simulation can never disagree about
 * what a part does.
 *
 * @see docs/01-rules.md §4
 */

/**
 * A part's contribution. Every field optional; absent means "contributes nothing".
 *
 * Flat fields are summed; `*Mult` fields are multiplied together. Keeping the
 * two kinds in one shape (rather than two objects) is what lets a part be
 * written as a single readable literal in the content files.
 */
export interface StatGrant {
  // ── flat, additive ────────────────────────────────────────────────────────
  readonly structure?: number;
  readonly armour?: number;
  readonly heatCapacity?: number;
  readonly heatSink?: number;
  readonly energyCapacity?: number;
  readonly energyRegen?: number;
  readonly shieldCapacity?: number;
  readonly shieldRegen?: number;
  readonly speed?: number;
  /** Scaled by the frame's agility multiplier. Locomotion uses this. */
  readonly evasion?: number;
  /** NOT scaled by agility — a flat bonus, e.g. from a module. */
  readonly evasionFlat?: number;
  readonly targeting?: number;
  readonly critChance?: number;
  readonly critMult?: number;
  readonly staggerResist?: number;
  readonly repairRate?: number;

  // ── multiplicative ────────────────────────────────────────────────────────
  readonly speedMult?: number;
  readonly coolingMult?: number;
  readonly damageMult?: number;
  readonly armourMult?: number;
  readonly cooldownMult?: number;
}

/** Fully compiled, immutable statistics for a deployable frame. */
export interface FrameStats {
  readonly structure: number;
  readonly armour: number;
  readonly mass: number;
  readonly massLimit: number;
  readonly load: number;
  readonly agility: number;

  readonly heatCapacity: number;
  readonly heatSink: number;
  readonly energyCapacity: number;
  readonly energyRegen: number;
  readonly shieldCapacity: number;
  readonly shieldRegen: number;

  readonly speed: number;
  readonly evasion: number;
  readonly targeting: number;
  readonly critChance: number;
  readonly critMult: number;
  readonly staggerResist: number;
  readonly repairRate: number;

  readonly damageMult: number;
  readonly cooldownMult: number;
  readonly radius: number;
}

/** Keys that accumulate by addition. */
export const FLAT_STAT_KEYS = [
  'structure',
  'armour',
  'heatCapacity',
  'heatSink',
  'energyCapacity',
  'energyRegen',
  'shieldCapacity',
  'shieldRegen',
  'speed',
  'evasion',
  'evasionFlat',
  'targeting',
  'critChance',
  'critMult',
  'staggerResist',
  'repairRate',
] as const satisfies readonly (keyof StatGrant)[];

/** Keys that accumulate by multiplication. Default 1.0. */
export const MULT_STAT_KEYS = [
  'speedMult',
  'coolingMult',
  'damageMult',
  'armourMult',
  'cooldownMult',
] as const satisfies readonly (keyof StatGrant)[];

export type FlatStatKey = (typeof FLAT_STAT_KEYS)[number];
export type MultStatKey = (typeof MULT_STAT_KEYS)[number];

/** A mutable accumulator used only inside the compiler. */
export type StatAccumulator = Record<FlatStatKey, number> & Record<MultStatKey, number>;

export function createAccumulator(): StatAccumulator {
  const acc = {} as StatAccumulator;
  for (const key of FLAT_STAT_KEYS) acc[key] = 0;
  for (const key of MULT_STAT_KEYS) acc[key] = 1;
  return acc;
}

/** Folds one grant into the accumulator. Additive first, then multiplicative. */
export function applyGrant(acc: StatAccumulator, grant: StatGrant): void {
  for (const key of FLAT_STAT_KEYS) {
    const value = grant[key];
    if (value !== undefined) acc[key] += value;
  }
  for (const key of MULT_STAT_KEYS) {
    const value = grant[key];
    if (value !== undefined) acc[key] *= value;
  }
}

/**
 * Human-facing metadata for every stat: label, unit, and whether higher is
 * better. The Forge uses this to render comparison arrows without a per-stat
 * `switch`, which is how a new stat becomes a one-line change.
 */
export interface StatDescriptor {
  readonly label: string;
  readonly unit: string;
  readonly higherIsBetter: boolean;
  readonly precision: number;
  readonly blurb: string;
}

export const STAT_INFO = {
  structure: { label: 'Structure', unit: 'sp', higherIsBetter: true, precision: 0, blurb: 'Raw hit points. Reaching zero ends the match.' },
  armour: { label: 'Armour', unit: 'AR', higherIsBetter: true, precision: 0, blurb: 'Mitigation AR/(AR+120). Every +120 halves incoming damage again.' },
  mass: { label: 'Mass', unit: 'kg', higherIsBetter: false, precision: 0, blurb: 'Total weight. Costs mobility linearly, long before it costs legality.' },
  load: { label: 'Load', unit: '%', higherIsBetter: false, precision: 0, blurb: 'Mass as a fraction of the chassis limit. Drives agility.' },
  agility: { label: 'Agility', unit: 'x', higherIsBetter: true, precision: 2, blurb: '1.25 - 0.50 x load. Scales both speed and evasion.' },
  heatCapacity: { label: 'Heat cap', unit: 'hu', higherIsBetter: true, precision: 0, blurb: 'Heat you can hold before overloading.' },
  heatSink: { label: 'Cooling', unit: 'hu/s', higherIsBetter: true, precision: 1, blurb: 'Passive heat dissipation per second.' },
  energyCapacity: { label: 'Energy', unit: 'EN', higherIsBetter: true, precision: 0, blurb: 'Burst pool for weapons and modules.' },
  energyRegen: { label: 'Regen', unit: 'EN/s', higherIsBetter: true, precision: 1, blurb: 'Energy per second. Throttles sustained rate of fire.' },
  shieldCapacity: { label: 'Shield', unit: 'SH', higherIsBetter: true, precision: 0, blurb: 'Regenerating first layer. Absorbs before armour.' },
  shieldRegen: { label: 'SH regen', unit: '/s', higherIsBetter: true, precision: 1, blurb: 'Shield recovery. Halts 4s after a full break.' },
  speed: { label: 'Speed', unit: 'm/s', higherIsBetter: true, precision: 1, blurb: 'Movement rate. The arena is 120m across.' },
  evasion: { label: 'Evasion', unit: 'EV', higherIsBetter: true, precision: 0, blurb: 'Reduces hit chance by ratio, with diminishing returns.' },
  targeting: { label: 'Targeting', unit: '', higherIsBetter: true, precision: 0, blurb: 'Accuracy scalar. Base 100.' },
  critChance: { label: 'Crit', unit: '%', higherIsBetter: true, precision: 1, blurb: 'Chance of a critical hit.' },
  critMult: { label: 'Crit mult', unit: 'x', higherIsBetter: true, precision: 2, blurb: 'Damage multiplier on a critical hit.' },
  staggerResist: { label: 'Stagger res', unit: '%', higherIsBetter: true, precision: 0, blurb: 'Reduces incoming stagger accumulation.' },
  repairRate: { label: 'Repair', unit: 'sp/s', higherIsBetter: true, precision: 1, blurb: 'Structure restored per second.' },
} as const satisfies Record<string, StatDescriptor>;

export type DisplayStatKey = keyof typeof STAT_INFO;
