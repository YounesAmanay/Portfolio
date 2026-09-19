/**
 * Weapons.
 *
 * Every damage value in this file was solved, not guessed: the balance model in
 * docs/02-balance.md §2 prices each weapon's character (range, heat, energy,
 * ammunition, mass, power) and the damage is whatever makes the efficiency
 * ratio land on 1.00. `tests/balance/weapons.test.ts` re-derives every one of
 * them and fails the build if any drifts outside [0.88, 1.12].
 *
 * That means this file is safe to edit: change a cooldown and the suite tells
 * you immediately what the damage must become.
 */

import { partId } from '../domain/ids';
import { cost, type Part, type RangeProfile, type WeaponProfile } from '../domain/part';

/** Keeps range profiles readable at the call site. */
function range(minRange: number, optimalRange: number, maxRange: number, falloff: number): RangeProfile {
  return { minRange, optimalRange, maxRange, falloff };
}

/** Defaults for the fields most weapons do not care about. */
function weapon(profile: Omit<WeaponProfile, 'burstDelay' | 'pierce' | 'stagger' | 'arcing'> &
  Partial<Pick<WeaponProfile, 'burstDelay' | 'pierce' | 'stagger' | 'arcing'>>): WeaponProfile {
  return { burstDelay: 0, pierce: 0, stagger: 0, arcing: false, ...profile };
}

// ─────────────────────────────────────────────────────────────────────────────
// HAVOC — kinetic. Shreds shields, staggers frames, blunted by armour, finite.
// ─────────────────────────────────────────────────────────────────────────────

export const SLUG_THROWER: Part = {
  id: partId('arm.slug_thrower'),
  name: 'SLUG THROWER',
  socket: 'ARM',
  house: 'HAVOC',
  tier: 1,
  cost: cost(110, 12),
  grants: {},
  weapon: weapon({
    damageType: 'KINETIC',
    damage: 23,
    shots: 1,
    cooldown: 0.7,
    range: range(0, 30, 55, 0.55),
    accuracy: 95,
    heatCost: 4,
    energyCost: 2,
    magazine: 180,
    pierce: 0.1,
    stagger: 12,
  }),
  description:
    'A rifle. 180 rounds, negligible heat, and it never surprises you. Competitive at every rating, which is the point of a Tier I part.',
  price: 0,
};

export const RAILSPIKE: Part = {
  id: partId('arm.railspike'),
  name: 'MK-IV RAILSPIKE',
  socket: 'ARM',
  house: 'HAVOC',
  tier: 2,
  cost: cost(165, 22),
  grants: {},
  weapon: weapon({
    damageType: 'KINETIC',
    damage: 48,
    shots: 1,
    cooldown: 1.45,
    range: range(0, 55, 85, 0.55),
    accuracy: 105,
    heatCost: 10,
    energyCost: 5,
    magazine: 52,
    pierce: 0.25,
    stagger: 34,
  }),
  description:
    'The reference kinetic rifle. Enough pierce to matter against plate and enough stagger that three hits deny a full second of action.',
  price: 650,
};

export const SCATTERGUN: Part = {
  id: partId('arm.scattergun'),
  name: 'SCATTERGUN',
  socket: 'ARM',
  house: 'HAVOC',
  tier: 2,
  cost: cost(140, 16),
  grants: {},
  weapon: weapon({
    damageType: 'KINETIC',
    damage: 23,
    shots: 5,
    cooldown: 1.6,
    burstDelay: 0.04,
    range: range(0, 12, 28, 0.35),
    accuracy: 80,
    heatCost: 3,
    energyCost: 1.5,
    magazine: 150,
    pierce: 0.05,
    stagger: 9,
  }),
  description:
    'Five pellets, twelve metres, 45 stagger per volley. Devastating inside knife range and completely inert past 28 m. Bring legs.',
  price: 550,
};

export const AUTOCANNON: Part = {
  id: partId('arm.autocannon'),
  name: 'AUTOCANNON',
  socket: 'ARM',
  house: 'HAVOC',
  tier: 3,
  cost: cost(180, 20),
  grants: {},
  weapon: weapon({
    damageType: 'KINETIC',
    damage: 26,
    shots: 3,
    cooldown: 1.3,
    burstDelay: 0.12,
    range: range(0, 38, 62, 0.55),
    accuracy: 92,
    heatCost: 6,
    energyCost: 2.5,
    magazine: 150,
    pierce: 0.15,
    stagger: 14,
  }),
  description: 'Three-round bursts at mid range. The most reliable stagger engine in the game.',
  price: 1300,
};

export const MISSILE_POD: Part = {
  id: partId('shoulder.missile_pod'),
  name: 'MISSILE POD',
  socket: 'SHOULDER',
  house: 'HAVOC',
  tier: 2,
  cost: cost(210, 18),
  grants: {},
  weapon: weapon({
    damageType: 'KINETIC',
    damage: 35,
    shots: 4,
    cooldown: 2.6,
    burstDelay: 0.15,
    range: range(10, 60, 95, 0.7),
    accuracy: 88,
    heatCost: 7,
    energyCost: 3.5,
    magazine: 72,
    pierce: 0.1,
    stagger: 10,
    arcing: true,
  }),
  description: 'Arcing salvo — ignores line of sight entirely. The answer to an opponent hiding behind pylons.',
  price: 900,
};

export const SIEGE_MORTAR: Part = {
  id: partId('shoulder.siege_mortar'),
  name: 'SIEGE MORTAR',
  socket: 'SHOULDER',
  house: 'HAVOC',
  tier: 3,
  cost: cost(290, 22),
  grants: {},
  weapon: weapon({
    damageType: 'KINETIC',
    damage: 114,
    shots: 1,
    cooldown: 3.2,
    range: range(20, 75, 110, 0.6),
    accuracy: 82,
    heatCost: 14,
    energyCost: 6,
    magazine: 30,
    pierce: 0.2,
    stagger: 55,
    arcing: true,
  }),
  description:
    'Arcing shell, 55 stagger, useless inside 20 m. Two hits interrupt almost anything. Thirty shells is your whole match.',
  price: 1700,
};

export const GAUSS_BATTERY: Part = {
  id: partId('shoulder.gauss_battery'),
  name: 'GAUSS BATTERY',
  socket: 'SHOULDER',
  house: 'HAVOC',
  tier: 4,
  cost: cost(300, 30),
  grants: {},
  weapon: weapon({
    damageType: 'KINETIC',
    damage: 97,
    shots: 1,
    cooldown: 2.8,
    range: range(15, 80, 115, 0.6),
    accuracy: 100,
    heatCost: 16,
    energyCost: 9,
    magazine: 26,
    pierce: 0.4,
    stagger: 60,
    arcing: false,
  }),
  description:
    'Forty percent pierce at eighty metres — the only kinetic weapon that does not fall apart against heavy plate. Twenty-six rounds.',
  price: 3600,
};

// ─────────────────────────────────────────────────────────────────────────────
// CINDER — thermal. Melts armour and strips it, diffused by shields, runs hot.
// ─────────────────────────────────────────────────────────────────────────────

export const PULSE_LASER: Part = {
  id: partId('arm.pulse_laser'),
  name: 'PULSE LASER',
  socket: 'ARM',
  house: 'CINDER',
  tier: 1,
  cost: cost(120, 20),
  grants: {},
  weapon: weapon({
    damageType: 'THERMAL',
    damage: 25,
    shots: 2,
    cooldown: 0.85,
    burstDelay: 0.08,
    range: range(0, 40, 70, 0.75),
    accuracy: 108,
    heatCost: 8,
    energyCost: 6,
    magazine: Infinity,
    pierce: 0.2,
  }),
  description: 'Infinite ammunition, high accuracy, 17 hu/s. The starter laser teaches the thermal lesson early.',
  price: 0,
};

export const BEAM_LANCE: Part = {
  id: partId('arm.beam_lance'),
  name: 'BEAM LANCE',
  socket: 'ARM',
  house: 'CINDER',
  tier: 2,
  cost: cost(160, 28),
  grants: {},
  weapon: weapon({
    damageType: 'THERMAL',
    damage: 60,
    shots: 1,
    cooldown: 1.35,
    range: range(0, 50, 80, 0.75),
    accuracy: 112,
    heatCost: 18,
    energyCost: 13,
    magazine: Infinity,
    pierce: 0.35,
  }),
  description: 'The anti-armour standard. 35% pierce on top of thermal’s native advantage against plate.',
  price: 800,
};

export const PLASMA_THROWER: Part = {
  id: partId('arm.plasma_thrower'),
  name: 'PLASMA THROWER',
  socket: 'ARM',
  house: 'CINDER',
  tier: 3,
  cost: cost(150, 24),
  grants: {},
  weapon: weapon({
    damageType: 'THERMAL',
    damage: 47,
    shots: 2,
    cooldown: 1.1,
    burstDelay: 0.1,
    range: range(0, 22, 40, 0.5),
    accuracy: 96,
    heatCost: 14,
    energyCost: 8,
    magazine: Infinity,
    pierce: 0.3,
  }),
  description:
    'The highest sustained damage in the catalogue at 48.7 sp/s, and 23.3 hu/s of heat to pay for it. Nothing cools this. Fire in bursts or die to your own reactor.',
  price: 1550,
};

export const THERMAL_ARRAY: Part = {
  id: partId('shoulder.thermal_array'),
  name: 'THERMAL LANCE ARRAY',
  socket: 'SHOULDER',
  house: 'CINDER',
  tier: 3,
  cost: cost(245, 34),
  grants: {},
  weapon: weapon({
    damageType: 'THERMAL',
    damage: 63,
    shots: 2,
    cooldown: 2.0,
    burstDelay: 0.12,
    range: range(0, 55, 85, 0.75),
    accuracy: 104,
    heatCost: 20,
    energyCost: 13,
    magazine: Infinity,
    pierce: 0.35,
  }),
  description: 'Paired lances on a shoulder mount. 146 damage per volley at 55 m, and it strips armour as it goes.',
  price: 1900,
};

export const NOVA_LANCE: Part = {
  id: partId('arm.nova_lance'),
  name: 'NOVA LANCE',
  socket: 'ARM',
  house: 'CINDER',
  tier: 4,
  cost: cost(215, 40),
  grants: {},
  weapon: weapon({
    damageType: 'THERMAL',
    damage: 111,
    shots: 1,
    cooldown: 2.4,
    range: range(8, 70, 105, 0.75),
    accuracy: 118,
    heatCost: 40,
    energyCost: 28,
    magazine: Infinity,
    pierce: 0.45,
  }),
  description:
    'One hundred and forty-three thermal at seventy metres with 45% pierce. Forty heat per shot means a cold start buys you five shots. Solve that and you own the match.',
  price: 3800,
};

// ─────────────────────────────────────────────────────────────────────────────
// NULLSET — ion. Erases shields, drains energy, forces overload. Cannot rush.
// ─────────────────────────────────────────────────────────────────────────────

export const DISRUPTOR: Part = {
  id: partId('arm.disruptor'),
  name: 'DISRUPTOR',
  socket: 'ARM',
  house: 'NULLSET',
  tier: 1,
  cost: cost(105, 18),
  grants: {},
  weapon: weapon({
    damageType: 'ION',
    damage: 24,
    shots: 2,
    cooldown: 0.95,
    burstDelay: 0.08,
    range: range(0, 32, 55, 0.7),
    accuracy: 100,
    heatCost: 4,
    energyCost: 7,
    magazine: Infinity,
    pierce: 0.1,
  }),
  description: 'Paired ion bolts. Barely scratches a frame; drains roughly 15 EN/s and cooks them 6 hu/s while it does.',
  price: 0,
};

export const STATIC_WEB: Part = {
  id: partId('arm.static_web'),
  name: 'STATIC WEB',
  socket: 'ARM',
  house: 'NULLSET',
  tier: 2,
  cost: cost(125, 22),
  grants: {},
  weapon: weapon({
    damageType: 'ION',
    damage: 29,
    shots: 3,
    cooldown: 1.2,
    burstDelay: 0.07,
    range: range(0, 24, 45, 0.6),
    accuracy: 92,
    heatCost: 4,
    energyCost: 7,
    magazine: Infinity,
  }),
  description: 'Three-bolt spread at close range. The fastest shield-stripper in the catalogue at 1.60x against fields.',
  price: 600,
};

export const ION_LANCE: Part = {
  id: partId('arm.ion_lance'),
  name: 'ION LANCE',
  socket: 'ARM',
  house: 'NULLSET',
  tier: 3,
  cost: cost(150, 30),
  grants: {},
  weapon: weapon({
    damageType: 'ION',
    damage: 61,
    shots: 1,
    cooldown: 1.5,
    range: range(0, 48, 75, 0.7),
    accuracy: 106,
    heatCost: 7,
    energyCost: 17,
    magazine: Infinity,
    pierce: 0.2,
  }),
  description: 'Thirty-four energy stripped per hit at forty-eight metres. Two of these lock a frame out of its own weapons.',
  price: 1600,
};

export const EMP_CHARGE: Part = {
  id: partId('shoulder.emp_charge'),
  name: 'EMP CHARGE',
  socket: 'SHOULDER',
  house: 'NULLSET',
  tier: 3,
  cost: cost(200, 30),
  grants: {},
  weapon: weapon({
    damageType: 'ION',
    damage: 130,
    shots: 1,
    cooldown: 2.8,
    range: range(0, 40, 70, 0.65),
    accuracy: 94,
    heatCost: 6,
    energyCost: 20,
    magazine: Infinity,
    pierce: 0.1,
    arcing: true,
  }),
  description:
    'Arcing burst: 65 energy drained and 26 heat added per detonation. It will not kill anything. It will stop them working.',
  price: 1800,
};

export const ALL_WEAPONS: readonly Part[] = [
  SLUG_THROWER,
  RAILSPIKE,
  SCATTERGUN,
  AUTOCANNON,
  MISSILE_POD,
  SIEGE_MORTAR,
  GAUSS_BATTERY,
  PULSE_LASER,
  BEAM_LANCE,
  PLASMA_THROWER,
  THERMAL_ARRAY,
  NOVA_LANCE,
  DISRUPTOR,
  STATIC_WEB,
  ION_LANCE,
  EMP_CHARGE,
];
