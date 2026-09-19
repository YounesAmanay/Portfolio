/**
 * Locomotion — speed, evasion, and the ability to stay standing.
 *
 * Note that `speed` and `evasion` here are *base* values: the compiler scales
 * both by the frame's agility multiplier, so the same legs are meaningfully
 * worse on an overloaded chassis. @see docs/01-rules.md §3.1
 */

import { partId } from '../domain/ids';
import { cost, type Part } from '../domain/part';

export const STRIDER: Part = {
  id: partId('loco.strider'),
  name: 'STRIDER LEGS',
  socket: 'LOCOMOTION',
  house: 'NEUTRAL',
  tier: 1,
  cost: cost(140, 14),
  grants: { speed: 8.0, evasion: 58, staggerResist: 0.15 },
  description: 'Bipedal walkers. The baseline: 8 m/s crosses the arena in fifteen seconds.',
  price: 0,
};

export const TREADS: Part = {
  id: partId('loco.treads'),
  name: 'TREAD ASSEMBLY',
  socket: 'LOCOMOTION',
  house: 'HAVOC',
  tier: 1,
  cost: cost(290, 12),
  grants: { speed: 5.6, evasion: 30, staggerResist: 0.55 },
  description:
    'Slow, heavy, and almost impossible to stagger. If you intend to stand in one place and win the damage race, stand on these.',
  price: 0,
};

export const HOVER: Part = {
  id: partId('loco.hover'),
  name: 'HOVER PLATE',
  socket: 'LOCOMOTION',
  house: 'NEUTRAL',
  tier: 2,
  cost: cost(170, 26),
  grants: { speed: 10.2, evasion: 88, staggerResist: 0.05 },
  description:
    'Fast and slippery, with no ground contact to resist a kinetic hit. One Siege Mortar shell interrupts you for the better part of a second.',
  price: 850,
};

export const SPIDER: Part = {
  id: partId('loco.spider'),
  name: 'SPIDER RIG',
  socket: 'LOCOMOTION',
  house: 'NEUTRAL',
  tier: 3,
  cost: cost(200, 18),
  grants: { speed: 7.2, evasion: 66, staggerResist: 0.4 },
  description: 'Eight points of contact. The compromise leg: nothing exceptional, nothing exploitable.',
  price: 1400,
};

export const PHASE_DRIVE: Part = {
  id: partId('loco.phase'),
  name: 'PHASE DRIVE',
  socket: 'LOCOMOTION',
  house: 'NULLSET',
  tier: 4,
  cost: cost(155, 34),
  grants: { speed: 11.5, evasion: 105, staggerResist: 0.0 },
  description:
    'The fastest frame in the Lattice, and the only one with no stagger resistance whatsoever. Never let a kinetic build close.',
  price: 3000,
};

export const ALL_LOCOMOTION: readonly Part[] = [STRIDER, TREADS, HOVER, SPIDER, PHASE_DRIVE];
