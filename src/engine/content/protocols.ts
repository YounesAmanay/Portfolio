/**
 * Protocols — software.
 *
 * Zero mass, cycles only, and they change the *rules* rather than the numbers.
 * This file is the proof that the plugin architecture earns its keep: every
 * protocol below is data plus a small pure function, and not one of them
 * required a line of engine code.
 *
 * @see docs/01-rules.md §11
 * @see docs/03-architecture.md §3
 */

import { partId } from '../domain/ids';
import { cost, type Part } from '../domain/part';
import { HEAT_STRAIN_THRESHOLD } from '../tuning';

export const OVERDRIVE: Part = {
  id: partId('proto.overdrive'),
  name: 'OVERDRIVE',
  socket: 'PROTOCOL',
  house: 'CINDER',
  tier: 3,
  cost: cost(0, 0, 6),
  grants: {},
  hooks: {
    modifyOutgoingDamage: ({ self }) =>
      self.heatRatio > HEAT_STRAIN_THRESHOLD ? { damageMult: 1.2 } : {},
    onTick: ({ self }) =>
      self.heatRatio > HEAT_STRAIN_THRESHOLD ? [{ kind: 'heatGenMult', value: 1.15 }] : [],
  },
  description:
    'Above 70% heat: +20% damage, +15% heat generation. Rewards running hot and punishes misjudging how hot.',
  price: 1400,
};

export const LAST_STAND: Part = {
  id: partId('proto.last_stand'),
  name: 'LAST STAND',
  socket: 'PROTOCOL',
  house: 'HAVOC',
  tier: 2,
  cost: cost(0, 0, 5),
  grants: {},
  hooks: {
    modifyOutgoingDamage: ({ self }) => (self.structureRatio < 0.25 ? { damageMult: 1.35 } : {}),
    modifyIncomingDamage: ({ self }) => (self.structureRatio < 0.25 ? { armourMult: 0.7 } : {}),
  },
  description:
    'Below 25% structure: +35% damage, -30% armour. A losing position converted into a race you might win.',
  price: 900,
};

export const PHASE_SHIFT: Part = {
  id: partId('proto.phase_shift'),
  name: 'PHASE SHIFT',
  socket: 'PROTOCOL',
  house: 'NULLSET',
  tier: 3,
  cost: cost(0, 0, 8),
  grants: {},
  hooks: {
    onEvent: ({ event }) =>
      event === 'SHIELD_BROKEN' ? [{ kind: 'evasionBonus', value: 40, duration: 3 }] : [],
  },
  description:
    'On shield break: +40 evasion for three seconds. Turns the moment you become vulnerable into the moment you are hardest to hit.',
  price: 1700,
};

export const HEAT_SINK_PURGE: Part = {
  id: partId('proto.purge'),
  name: 'HEAT SINK PURGE',
  socket: 'PROTOCOL',
  house: 'CINDER',
  tier: 2,
  cost: cost(0, 0, 4),
  grants: {},
  hooks: {
    onEvent: ({ event, self, memory }) => {
      if (event !== 'ENTERED_CRITICAL' || memory.used === 1) return [];
      memory.used = 1;
      return [{ kind: 'heat', delta: -self.heat * 0.35 }];
    },
  },
  description:
    'The first time you reach critical heat, dump 35% of it instantly. Once per match. The difference between a near miss and a shutdown.',
  price: 750,
};

export const AMMO_DISCIPLINE: Part = {
  id: partId('proto.ammo_discipline'),
  name: 'AMMO DISCIPLINE',
  socket: 'PROTOCOL',
  house: 'HAVOC',
  tier: 2,
  cost: cost(0, 0, 4),
  grants: {},
  hooks: {
    // Long-range kinetic shots are the ones that miss; refusing them is
    // functionally a magazine extension.
    modifyOutgoingDamage: ({ damageType, distance }) =>
      damageType === 'KINETIC' && distance > 70 ? { accuracyMult: 0.55 } : { damageMult: 1.08 },
  },
  description:
    'Kinetic weapons hold fire at long range and hit 8% harder inside it. Effectively a larger magazine for a Havoc build.',
  price: 800,
};

export const ADAPTIVE_PLATING: Part = {
  id: partId('proto.adaptive'),
  name: 'ADAPTIVE PLATING',
  socket: 'PROTOCOL',
  house: 'NEUTRAL',
  tier: 3,
  cost: cost(0, 0, 7),
  grants: {},
  hooks: {
    modifyIncomingDamage: ({ damageType, raw, memory }) => {
      const key = `absorbed_${damageType}`;
      const total = (memory[key] ?? 0) + raw;
      memory[key] = total;
      return total >= 400 ? { armourMult: 1.25 } : {};
    },
  },
  description:
    'Learns. After absorbing 400 damage of one type, armour becomes 25% more effective against it. Rewards surviving the opening exchange.',
  price: 1900,
};

export const TARGET_ANALYSIS: Part = {
  id: partId('proto.target_analysis'),
  name: 'TARGET ANALYSIS',
  socket: 'PROTOCOL',
  house: 'NULLSET',
  tier: 3,
  cost: cost(0, 0, 6),
  grants: {},
  hooks: {
    modifyOutgoingDamage: ({ self }) => {
      // +4% per 5 seconds elapsed, capped at +20%. Sustained pressure pays.
      const stacks = Math.min(5, Math.floor(self.elapsed / 5));
      return { damageMult: 1 + stacks * 0.04 };
    },
  },
  description:
    'Ramps to +20% damage over the first 25 seconds. The long-game protocol: bad in a brawl, decisive at the time limit.',
  price: 1600,
};

export const KILL_PROTOCOL: Part = {
  id: partId('proto.kill'),
  name: 'KILL PROTOCOL',
  socket: 'PROTOCOL',
  house: 'HAVOC',
  tier: 2,
  cost: cost(0, 0, 5),
  grants: {},
  hooks: {
    modifyOutgoingDamage: ({ opponent }) =>
      opponent.structureRatio < 0.2 ? { accuracyMult: 1.25, critChanceBonus: 0.1 } : {},
  },
  description: 'Against a frame below 20% structure: +25% accuracy, +10% crit. Closes matches that would otherwise drift to time.',
  price: 950,
};

// ─────────────────────────────────────────────────────────────────────────────
// A note on stateful protocols
//
// HEAT SINK PURGE and ADAPTIVE PLATING both need memory. They keep it in the
// `memory` object the simulation hands them — one per part, per frame, per
// match. Closing over module-level state instead would share a counter between
// every frame using the part and across every match in a balance run, which
// would quietly destroy determinism. The scratch space exists so a content
// author never has to reach for a closure to get memory.
// ─────────────────────────────────────────────────────────────────────────────

export const ALL_PROTOCOLS: readonly Part[] = [
  OVERDRIVE,
  LAST_STAND,
  PHASE_SHIFT,
  HEAT_SINK_PURGE,
  AMMO_DISCIPLINE,
  ADAPTIVE_PLATING,
  TARGET_ANALYSIS,
  KILL_PROTOCOL,
];
