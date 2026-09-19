/**
 * Damage types and the three interaction matrices that form the combat triangle.
 *
 * These twelve numbers are the most load-bearing constants in the game. Each
 * damage type is strong against one defensive layer and weak against another,
 * so no single type is correct against every build.
 *
 * @see docs/01-rules.md §5.5–§5.8
 * @see docs/02-balance.md §1.1 for the effective-HP consequences
 */

export const DAMAGE_TYPES = ['KINETIC', 'THERMAL', 'ION'] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

/**
 * Damage dealt to a shield pool, as a multiple of raw damage.
 * Kinetic overwhelms field geometry; thermal is diffused; ion unmakes the field.
 */
export const SHIELD_MULT: Readonly<Record<DamageType, number>> = {
  KINETIC: 1.3,
  THERMAL: 0.7,
  ION: 1.6,
};

/**
 * Multiplier on armour points when computing mitigation against this type.
 * Plating is built to stop slugs (1.35) and melts under beams (0.80). Thermal
 * sat at 0.70 until the matchup matrix showed it stacking with weapon pierce
 * to make armour nearly irrelevant against a lance build.
 */
export const ARMOR_FACTOR: Readonly<Record<DamageType, number>> = {
  KINETIC: 1.35,
  THERMAL: 0.8,
  ION: 1.0,
};

/**
 * Multiplier on damage that finally reaches structure.
 * Ion barely harms the frame — its payload is system disruption instead.
 */
export const STRUCTURE_FACTOR: Readonly<Record<DamageType, number>> = {
  KINETIC: 1.0,
  THERMAL: 1.0,
  ION: 0.45,
};

/**
 * Armour points stripped per point of post-mitigation damage.
 * Thermal ablates 2.3x faster than kinetic — it is the anti-armour type twice
 * over, which is what stops fortress builds from being unconditionally correct.
 */
export const ABLATION_RATE: Readonly<Record<DamageType, number>> = {
  KINETIC: 0.006,
  THERMAL: 0.014,
  ION: 0.002,
};

/** Presentation metadata. Colour is the UI's single source of truth per type. */
export const DAMAGE_INFO: Readonly<
  Record<DamageType, { label: string; colour: string; house: string; blurb: string }>
> = {
  KINETIC: {
    label: 'Kinetic',
    colour: '#7fd4ff',
    house: 'HAVOC',
    blurb: 'Shreds shields and staggers frames. Blunted by armour. Finite ammunition.',
  },
  THERMAL: {
    label: 'Thermal',
    colour: '#ffab4d',
    house: 'CINDER',
    blurb: 'Melts armour and strips it fast. Diffused by shields. Runs hot.',
  },
  ION: {
    label: 'Ion',
    colour: '#d98bff',
    house: 'NULLSET',
    blurb: 'Erases shields, drains energy, forces overload. Cannot kill a frame quickly.',
  },
};

export const HOUSES = ['HAVOC', 'CINDER', 'NULLSET', 'NEUTRAL'] as const;
export type House = (typeof HOUSES)[number];
