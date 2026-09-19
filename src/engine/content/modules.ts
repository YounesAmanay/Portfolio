/**
 * Modules — shields, cooling, targeting, repair.
 *
 * Modules are where cycles are spent, which puts them in direct competition
 * with doctrine complexity: a seven-rule doctrine costs 14 CY, which is a
 * Predictive Array you can no longer fit. Choosing between being clever and
 * being equipped is one of the load-bearing decisions in the Forge.
 */

import { partId } from '../domain/ids';
import { cost, type Part } from '../domain/part';

export const HEAT_SINK_ARRAY: Part = {
  id: partId('mod.heat_sink'),
  name: 'HEAT SINK ARRAY',
  socket: 'MODULE',
  house: 'NEUTRAL',
  tier: 1,
  cost: cost(70, 10, 3),
  grants: { heatSink: 8 },
  description: 'Eight more heat per second. The cheapest fix for a build that overloads.',
  price: 0,
};

export const COOLANT_LOOP: Part = {
  id: partId('mod.coolant_loop'),
  name: 'COOLANT LOOP',
  socket: 'MODULE',
  house: 'CINDER',
  tier: 2,
  cost: cost(95, 14, 4),
  grants: { heatSink: 6, heatCapacity: 70 },
  description:
    'Capacity and dissipation together. The capacity matters more than it looks: it buys you the seconds a vent needs.',
  price: 650,
};

export const BARRIER_PROJECTOR: Part = {
  id: partId('mod.barrier'),
  name: 'BARRIER PROJECTOR',
  socket: 'MODULE',
  house: 'NEUTRAL',
  tier: 1,
  cost: cost(85, 18, 4),
  grants: { shieldCapacity: 120, shieldRegen: 10 },
  description: 'A regenerating first layer. Worthless against ion, excellent against thermal.',
  price: 0,
};

export const AEGIS_FIELD: Part = {
  id: partId('mod.aegis'),
  name: 'AEGIS FIELD',
  socket: 'MODULE',
  house: 'NEUTRAL',
  tier: 3,
  cost: cost(130, 28, 6),
  grants: { shieldCapacity: 220, shieldRegen: 16 },
  description: '220 points of field. Against a Cinder build that is nearly 315 effective HP; against Nullset it is 138.',
  price: 1500,
};

export const TARGETING_COMPUTER: Part = {
  id: partId('mod.targeting'),
  name: 'TARGETING COMPUTER',
  socket: 'MODULE',
  house: 'NEUTRAL',
  tier: 1,
  cost: cost(55, 12, 5),
  grants: { targeting: 25 },
  description: 'Accuracy +25%. Against 55 evasion that is a hit rate of 69% instead of 64%.',
  price: 0,
};

export const PREDICTIVE_ARRAY: Part = {
  id: partId('mod.predictive'),
  name: 'PREDICTIVE ARRAY',
  socket: 'MODULE',
  house: 'NULLSET',
  tier: 3,
  cost: cost(80, 18, 8),
  grants: { targeting: 45, critChance: 0.06 },
  description:
    'Eight cycles is most of a starter core’s budget. What you get is the highest accuracy in the game and an 11% crit rate.',
  price: 1750,
};

export const CAPACITOR_BANK: Part = {
  id: partId('mod.capacitor'),
  name: 'CAPACITOR BANK',
  socket: 'MODULE',
  house: 'CINDER',
  tier: 2,
  cost: cost(75, 6, 3),
  grants: { energyCapacity: 70, energyRegen: 8 },
  description:
    'The fix for an energy-throttled build. If the Forge is showing you an amber cycle time, this is the part it is asking for.',
  price: 600,
};

export const NANITE_REPAIR: Part = {
  id: partId('mod.nanite'),
  name: 'NANITE REPAIR',
  socket: 'MODULE',
  house: 'NEUTRAL',
  tier: 3,
  cost: cost(110, 20, 6),
  grants: { repairRate: 3.5 },
  description:
    '3.5 structure per second — 158 over a 45-second fight, and 630 if you can drag it to the time limit. The stalemate engine.',
  price: 1650,
};

export const GYRO_STABILISER: Part = {
  id: partId('mod.gyro'),
  name: 'GYRO STABILISER',
  socket: 'MODULE',
  house: 'HAVOC',
  tier: 2,
  cost: cost(85, 10, 3),
  grants: { staggerResist: 0.3, evasionFlat: 8 },
  description: 'Thirty percent less stagger accumulation. The specific answer to Autocannons and Siege Mortars.',
  price: 700,
};

export const ECM_SUITE: Part = {
  id: partId('mod.ecm'),
  name: 'ECM SUITE',
  socket: 'MODULE',
  house: 'NULLSET',
  tier: 3,
  cost: cost(70, 16, 7),
  grants: { evasionFlat: 22 },
  description:
    'Flat evasion, unscaled by agility — the only way a heavy frame gets to be hard to hit.',
  price: 1550,
};

export const ALL_MODULES: readonly Part[] = [
  HEAT_SINK_ARRAY,
  COOLANT_LOOP,
  BARRIER_PROJECTOR,
  AEGIS_FIELD,
  TARGETING_COMPUTER,
  PREDICTIVE_ARRAY,
  CAPACITOR_BANK,
  NANITE_REPAIR,
  GYRO_STABILISER,
  ECM_SUITE,
];
