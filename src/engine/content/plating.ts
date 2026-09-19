/**
 * Plating — armour and structure.
 *
 * Priced at a flat rate per armour point, which is only correct because the
 * `AR/(AR+120)` curve makes marginal effective-HP exactly linear in armour.
 * @see docs/02-balance.md §3.1 for the proof.
 *
 * Two plates carry hooks rather than raw numbers — they are the demonstration
 * that a defensive part can change the *rules* of mitigation, not just its
 * magnitude.
 */

import { partId } from '../domain/ids';
import { cost, type Part } from '../domain/part';

export const ABLATIVE_WEAVE: Part = {
  id: partId('plate.ablative_weave'),
  name: 'ABLATIVE WEAVE',
  socket: 'PLATING',
  house: 'NEUTRAL',
  tier: 1,
  cost: cost(90),
  grants: { armour: 45, structure: 85 },
  description: 'The cheap plate. Ninety kilograms for 45 AR — about a 27% cut to incoming kinetic.',
  price: 0,
};

export const COMPOSITE_PLATE: Part = {
  id: partId('plate.composite'),
  name: 'COMPOSITE PLATE',
  socket: 'PLATING',
  house: 'NEUTRAL',
  tier: 1,
  cost: cost(140),
  grants: { armour: 70, structure: 155 },
  description: 'Standard issue. The plate the reference frame is built with.',
  price: 0,
};

export const REACTIVE_LATTICE: Part = {
  id: partId('plate.reactive'),
  name: 'REACTIVE LATTICE',
  socket: 'PLATING',
  house: 'HAVOC',
  tier: 2,
  cost: cost(175, 8),
  grants: { armour: 80, structure: 170 },
  description: 'Powered plate. Draws 8 PU to hold its charge, and stops a great deal more than it weighs.',
  price: 700,
};

export const CERAMIC_ABLATOR: Part = {
  id: partId('plate.ceramic'),
  name: 'CERAMIC ABLATOR',
  socket: 'PLATING',
  house: 'CINDER',
  tier: 2,
  cost: cost(150),
  grants: { armour: 60, structure: 125 },
  hooks: {
    // Thermal is the type that both bypasses armour and strips it fastest.
    // This plate does not add more armour; it changes how thermal interacts
    // with the armour you already have.
    modifyIncomingDamage: ({ damageType }) =>
      damageType === 'THERMAL' ? { armourMult: 1.45 } : {},
  },
  description:
    'Sacrificial ceramic. Only 60 AR, but it makes every point of your armour 45% more effective against thermal. The direct answer to a Cinder lance build.',
  price: 800,
};

export const MONOBLOCK: Part = {
  id: partId('plate.monoblock'),
  name: 'MONOBLOCK ARMOUR',
  socket: 'PLATING',
  house: 'HAVOC',
  tier: 3,
  cost: cost(290),
  grants: { armour: 115, structure: 210, speedMult: 0.94 },
  description:
    'A single forged slab. 115 AR and 210 structure for 290 kg and 6% of your speed. The fortress plate.',
  price: 1600,
};

export const NULLWEAVE: Part = {
  id: partId('plate.nullweave'),
  name: 'NULLWEAVE',
  socket: 'PLATING',
  house: 'NULLSET',
  tier: 4,
  cost: cost(165, 10),
  grants: { armour: 85, structure: 170 },
  hooks: {
    modifyIncomingDamage: ({ damageType }) => (damageType === 'ION' ? { damageMult: 0.6 } : {}),
  },
  description:
    'Grounded mesh. Cuts incoming ion damage by 40% — which also cuts the energy drain and heat transfer that scale off it. The Nullset counter to Nullset.',
  price: 2800,
};

export const ALL_PLATING: readonly Part[] = [
  ABLATIVE_WEAVE,
  COMPOSITE_PLATE,
  REACTIVE_LATTICE,
  CERAMIC_ABLATOR,
  MONOBLOCK,
  NULLWEAVE,
];
