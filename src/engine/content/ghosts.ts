/**
 * Ghosts — stored opponent builds.
 *
 * A ghost is exactly what a player's own build is: a chassis, some parts, and
 * a doctrine. There is no separate "AI opponent" type and no difficulty
 * scalar, because the asynchronous design means every opponent you ever face
 * is just somebody's saved frame. These five are the house builds the Lattice
 * ships with.
 *
 * They double as the balance matrix: `tests/balance/matchups.test.ts` runs
 * every pair over many seeds and arenas and fails if any archetype exceeds a
 * 58% win rate.
 */

import { buildId } from '../domain/ids';
import type { Build } from '../domain/build';
import type { Doctrine } from '../domain/doctrine';
import { BREAKER, BULWARK, CIPHER, WARDEN, WISP } from './chassis';
import { NULLCORE, STEADY, STILL, SURGE } from './cores';
import { PHASE_DRIVE, SPIDER, STRIDER, TREADS } from './locomotion';
import {
  ABLATIVE_WEAVE,
  CERAMIC_ABLATOR,
  COMPOSITE_PLATE,
  NULLWEAVE,
  REACTIVE_LATTICE,
} from './plating';
import {
  CAPACITOR_BANK,
  COOLANT_LOOP,
  ECM_SUITE,
  GYRO_STABILISER,
  HEAT_SINK_ARRAY,
  PREDICTIVE_ARRAY,
  TARGETING_COMPUTER,
} from './modules';
import { AMMO_DISCIPLINE, KILL_PROTOCOL, OVERDRIVE, PHASE_SHIFT, TARGET_ANALYSIS } from './protocols';
import {
  AUTOCANNON,
  BEAM_LANCE,
  EMP_CHARGE,
  GAUSS_BATTERY,
  ION_LANCE,
  NOVA_LANCE,
  RAILSPIKE,
  SIEGE_MORTAR,
} from './weapons';

export type Archetype = 'LANCER' | 'BASTION' | 'SKIRMISHER' | 'DISRUPTOR' | 'ALPHA';

export interface Ghost {
  readonly build: Build;
  readonly archetype: Archetype;
  readonly architect: string;
  readonly rating: number;
  readonly blurb: string;
}

// ─────────────────────────────────────────────────────────────────────────────

const LANCER_DOCTRINE: Doctrine = {
  rules: [
    { condition: 'SELF_HEAT_ABOVE', parameter: 0.8, action: 'SEEK_COOLANT' },
    { condition: 'ENEMY_OVERLOADED', action: 'CHARGE' },
    { condition: 'ENEMY_WITHIN', parameter: 16, action: 'KITE' },
    { condition: 'ALWAYS', action: 'ENGAGE' },
  ],
};

/** CINDER. Saturates heat. Melts armour at mid range; dies to drain and kiting. */
export const VESPER: Ghost = {
  archetype: 'LANCER',
  architect: 'CINDER / Vesper Aldana',
  rating: 1320,
  blurb:
    'Twin beam lances on a Surge core. Thirty-five percent pierce on top of thermal’s native advantage means armour barely slows her down — but the Surge cools badly, so every exchange is borrowed against a vent.',
  build: {
    id: buildId('ghost.vesper'),
    name: 'VESPER',
    chassisId: WARDEN.id,
    assignments: {
      CORE: [SURGE.id],
      ARM: [BEAM_LANCE.id, BEAM_LANCE.id],
      SHOULDER: [null],
      LOCOMOTION: [SPIDER.id],
      PLATING: [REACTIVE_LATTICE.id, COMPOSITE_PLATE.id],
      MODULE: [HEAT_SINK_ARRAY.id, TARGETING_COMPUTER.id],
      PROTOCOL: [OVERDRIVE.id],
    },
    doctrine: LANCER_DOCTRINE,
  },
};

/** HAVOC. Saturates mass. Out-lasts everything; loses to ablation and the clock. */
export const ANVIL: Ghost = {
  archetype: 'BASTION',
  architect: 'HAVOC / Tomas Anvil-Reyes',
  rating: 1410,
  blurb:
    'A Bulwark on treads with three plates and a mortar. Almost impossible to stagger, almost impossible to move, and it will happily take the match to the time limit if you let it.',
  build: {
    id: buildId('ghost.anvil'),
    name: 'ANVIL',
    chassisId: BULWARK.id,
    assignments: {
      CORE: [STEADY.id],
      ARM: [RAILSPIKE.id, AUTOCANNON.id],
      SHOULDER: [SIEGE_MORTAR.id],
      LOCOMOTION: [TREADS.id],
      PLATING: [REACTIVE_LATTICE.id, CERAMIC_ABLATOR.id, null],
      MODULE: [GYRO_STABILISER.id, TARGETING_COMPUTER.id, HEAT_SINK_ARRAY.id],
      PROTOCOL: [AMMO_DISCIPLINE.id, KILL_PROTOCOL.id],
    },
    doctrine: {
      rules: [
        { condition: 'ENEMY_WITHIN', parameter: 22, action: 'BRACE' },
        { condition: 'ENEMY_STRUCTURE_BELOW', parameter: 0.3, action: 'ENGAGE' },
        { condition: 'AMMO_BELOW', parameter: 0.2, action: 'BRACE' },
        { condition: 'ALWAYS', action: 'ENGAGE' },
      ],
    },
  },
};

/** Saturates sockets. Never gets hit; folds to a single connected alpha strike. */
export const KESTREL: Ghost = {
  archetype: 'SKIRMISHER',
  architect: 'Independent / Kestrel',
  rating: 1275,
  blurb:
    'A Wisp on hover plates carrying almost nothing. Seventy-plus evasion means roughly two in five shots land on her at all — and 380 structure means she cannot afford the third.',
  build: {
    id: buildId('ghost.kestrel'),
    name: 'KESTREL',
    chassisId: WISP.id,
    assignments: {
      CORE: [STEADY.id],
      ARM: [RAILSPIKE.id, RAILSPIKE.id],
      LOCOMOTION: [PHASE_DRIVE.id],
      PLATING: [ABLATIVE_WEAVE.id, ABLATIVE_WEAVE.id],
      MODULE: [ECM_SUITE.id, TARGETING_COMPUTER.id],
      PROTOCOL: [PHASE_SHIFT.id],
    },
    doctrine: {
      rules: [
        { condition: 'SELF_STRUCTURE_BELOW', parameter: 0.4, action: 'KITE' },
        { condition: 'ENEMY_WITHIN', parameter: 18, action: 'ORBIT' },
        { condition: 'ENEMY_OVERLOADED', action: 'ENGAGE' },
        { condition: 'ALWAYS', action: 'ORBIT' },
      ],
    },
  },
};

/** NULLSET. Saturates cycles. Turns the enemy off; useless against low-heat kinetic. */
export const HOLLOW: Ghost = {
  archetype: 'DISRUPTOR',
  architect: 'NULLSET / designation HOLLOW',
  rating: 1480,
  blurb:
    'A Cipher running two ion lances and an EMP charge. It will not out-damage anything in the Lattice. It does not need to — it drains you to zero, cooks you to overload, and shoots the shutdown.',
  build: {
    id: buildId('ghost.hollow'),
    name: 'HOLLOW',
    chassisId: CIPHER.id,
    assignments: {
      CORE: [NULLCORE.id],
      ARM: [ION_LANCE.id, ION_LANCE.id],
      SHOULDER: [EMP_CHARGE.id],
      LOCOMOTION: [PHASE_DRIVE.id],
      PLATING: [NULLWEAVE.id],
      MODULE: [ECM_SUITE.id, PREDICTIVE_ARRAY.id, CAPACITOR_BANK.id, HEAT_SINK_ARRAY.id],
      PROTOCOL: [TARGET_ANALYSIS.id, PHASE_SHIFT.id],
    },
    doctrine: {
      rules: [
        { condition: 'ENEMY_OVERLOADED', action: 'CHARGE' },
        { condition: 'ENEMY_WITHIN', parameter: 20, action: 'KITE' },
        { condition: 'SELF_STRUCTURE_BELOW', parameter: 0.35, action: 'RETREAT' },
        { condition: 'SELF_ENERGY_BELOW', parameter: 0.2, action: 'ORBIT' },
        { condition: 'ALWAYS', action: 'ENGAGE' },
      ],
    },
  },
};

/** Saturates power. One enormous volley; loses to anything that survives it. */
export const SUNDER: Ghost = {
  archetype: 'ALPHA',
  architect: 'CINDER / Ilse Sunder',
  rating: 1545,
  blurb:
    'A Breaker carrying a Nova Lance and a Gauss Battery. Two hundred and sixty-seven damage in a single volley across two damage types. Forty heat a shot means a cold start buys five of them, and there is no plan for the sixth.',
  build: {
    id: buildId('ghost.sunder'),
    name: 'SUNDER',
    chassisId: BREAKER.id,
    assignments: {
      CORE: [STILL.id],
      ARM: [NOVA_LANCE.id, null],
      SHOULDER: [GAUSS_BATTERY.id, null],
      LOCOMOTION: [STRIDER.id],
      PLATING: [CERAMIC_ABLATOR.id, COMPOSITE_PLATE.id],
      MODULE: [COOLANT_LOOP.id, CAPACITOR_BANK.id],
      PROTOCOL: [KILL_PROTOCOL.id],
    },
    doctrine: {
      rules: [
        { condition: 'SELF_HEAT_ABOVE', parameter: 0.78, action: 'VENT' },
        { condition: 'ENEMY_STRUCTURE_BELOW', parameter: 0.25, action: 'ENGAGE' },
        { condition: 'ENEMY_WITHIN', parameter: 25, action: 'KITE' },
        { condition: 'ALWAYS', action: 'ENGAGE' },
      ],
    },
  },
};

export const ALL_GHOSTS: readonly Ghost[] = [KESTREL, VESPER, ANVIL, HOLLOW, SUNDER];

/** Ghosts near a given rating, for matchmaking. Always returns at least one. */
export function ghostsNearRating(rating: number, spread = 250): readonly Ghost[] {
  const near = ALL_GHOSTS.filter((ghost) => Math.abs(ghost.rating - rating) <= spread);
  return near.length > 0 ? near : ALL_GHOSTS;
}
