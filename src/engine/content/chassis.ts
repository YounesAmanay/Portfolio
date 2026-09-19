/**
 * Chassis — the frames parts plug into.
 *
 * A chassis is the only choice that defines the *shape* of the optimisation
 * problem rather than solving part of it: it sets the socket layout, the mass
 * limit, and the base structure every other decision is made against.
 *
 * Design rule: no chassis is strictly better than another. More sockets always
 * costs mass limit per socket, and more structure always costs radius (a bigger
 * frame is easier to corner and easier to hit).
 *
 * Mass limits are derived rather than felt, so the table stays honest as parts
 * change:
 *
 *     massLimit = chassisMass x 1.2
 *               + 0.87 x SUM(socketCount x typicalPartMass[socket])
 *
 * with typical masses CORE 175, ARM 160, SHOULDER 250, LOCOMOTION 190,
 * PLATING 175, MODULE 90, PROTOCOL 0. The 0.87 is what makes a chassis unable
 * to fill every socket with a mid-weight part — the shortfall *is* the game.
 * A frame that can afford everything has no decisions left in it.
 */

import { partId } from '../domain/ids';
import type { Chassis } from '../domain/part';

export const WISP: Chassis = {
  id: partId('chassis.wisp'),
  name: 'WISP',
  house: 'NEUTRAL',
  tier: 1,
  mass: 180,
  massLimit: 1200,
  structure: 760,
  radius: 1.6,
  sockets: { CORE: 1, ARM: 2, LOCOMOTION: 1, PLATING: 2, MODULE: 2, PROTOCOL: 1 },
  grants: { damageMult: 1.65, targeting: 10 },
  description:
    'Reconnaissance frame. Only two weapon mounts, but a precision spine that drives every one of them 45% harder — and the lowest mass floor in the Lattice.',
  price: 0,
};

export const WARDEN: Chassis = {
  id: partId('chassis.warden'),
  name: 'WARDEN',
  house: 'NEUTRAL',
  tier: 1,
  mass: 260,
  massLimit: 1560,
  structure: 900,
  radius: 2.0,
  sockets: { CORE: 1, ARM: 2, SHOULDER: 1, LOCOMOTION: 1, PLATING: 2, MODULE: 2, PROTOCOL: 1 },
  description:
    'The line frame every Architect learns on. No weakness, no speciality. The reference build in every balance table is a Warden.',
  price: 0,
};

export const BREAKER: Chassis = {
  id: partId('chassis.breaker'),
  name: 'BREAKER',
  house: 'HAVOC',
  tier: 2,
  mass: 340,
  massLimit: 1870,
  structure: 1000,
  radius: 2.3,
  sockets: { CORE: 1, ARM: 2, SHOULDER: 2, LOCOMOTION: 1, PLATING: 2, MODULE: 2, PROTOCOL: 1 },
  grants: { damageMult: 1.0 },
  description:
    'Assault frame. Two shoulder hardpoints make it the alpha-strike chassis — if you can find the power and the mass to feed them both.',
  price: 700,
};

export const BULWARK: Chassis = {
  id: partId('chassis.bulwark'),
  name: 'BULWARK',
  house: 'HAVOC',
  tier: 3,
  mass: 460,
  massLimit: 2100,
  structure: 1000,
  radius: 2.7,
  sockets: { CORE: 1, ARM: 2, SHOULDER: 1, LOCOMOTION: 1, PLATING: 3, MODULE: 3, PROTOCOL: 2 },
  grants: { staggerResist: 0.1, armour: 60 },
  description:
    'Siege frame. Three plating sockets and the deepest structure in the Lattice, 60 points of integral armour before you bolt a single plate to it. It out-lasts everything and out-damages nothing. Fortresses draw; they rarely win on time.',
  price: 1800,
};

export const CIPHER: Chassis = {
  id: partId('chassis.cipher'),
  name: 'CIPHER',
  house: 'NULLSET',
  tier: 4,
  mass: 210,
  massLimit: 1500,
  structure: 780,
  radius: 1.7,
  sockets: { CORE: 1, ARM: 2, SHOULDER: 1, LOCOMOTION: 1, PLATING: 1, MODULE: 4, PROTOCOL: 2 },
  grants: { damageMult: 0.86, coolingMult: 1.15 },
  description:
    'Void frame. Four module sockets and two protocol slots, and a 14% damage penalty on everything it mounts. It cannot out-trade anything; it makes the other frame stop working.',
  price: 3200,
};

export const ALL_CHASSIS: readonly Chassis[] = [WISP, WARDEN, BREAKER, BULWARK, CIPHER];
