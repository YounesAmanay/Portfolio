/**
 * Cores — the reactors.
 *
 * The core is the only part that *supplies* budget rather than consuming it,
 * so it is the first decision in any build: it sets the ceiling on everything
 * else. Each core trades along a different axis — raw power, cycles for
 * modules and doctrine, energy for burst, or heat capacity for sustain.
 */

import { partId } from '../domain/ids';
import { cost, supply, type Part } from '../domain/part';

export const EMBER: Part = {
  id: partId('core.ember'),
  name: 'CELL-7 EMBER',
  socket: 'CORE',
  house: 'NEUTRAL',
  tier: 1,
  cost: cost(120),
  supply: supply(130, 26),
  grants: { energyCapacity: 110, energyRegen: 18, heatCapacity: 180, heatSink: 12 },
  description: 'Starter reactor. Unremarkable in every direction, which makes it a fair baseline and a poor endgame.',
  price: 0,
};

export const STEADY: Part = {
  id: partId('core.steady'),
  name: 'FUSION-K STEADY',
  socket: 'CORE',
  house: 'NEUTRAL',
  tier: 2,
  cost: cost(165),
  supply: supply(165, 30),
  grants: { energyCapacity: 140, energyRegen: 22, heatCapacity: 220, heatSink: 15 },
  description: 'The reference core. Every ratio in the balance model is computed against this reactor.',
  price: 600,
};

export const SURGE: Part = {
  id: partId('core.surge'),
  name: 'PLASMA-9 SURGE',
  socket: 'CORE',
  house: 'CINDER',
  tier: 3,
  cost: cost(190),
  supply: supply(200, 32),
  grants: { energyCapacity: 190, energyRegen: 30, heatCapacity: 210, heatSink: 14 },
  description:
    'Enormous power and energy throughput, deliberately weak cooling. Feeds energy weapons that will then cook you alive unless you solve heat elsewhere.',
  price: 1500,
};

export const STILL: Part = {
  id: partId('core.still'),
  name: 'CRYO-CORE STILL',
  socket: 'CORE',
  house: 'CINDER',
  tier: 3,
  cost: cost(210),
  supply: supply(160, 34),
  grants: { energyCapacity: 120, energyRegen: 19, heatCapacity: 300, heatSink: 24 },
  description:
    'The thermal answer. Doubles your heat headroom at the cost of power and burst. The only core that lets a plasma build fire continuously.',
  price: 1650,
};

export const NULLCORE: Part = {
  id: partId('core.null'),
  name: 'SINGULARITY NULL',
  socket: 'CORE',
  house: 'NULLSET',
  tier: 4,
  cost: cost(175),
  supply: supply(185, 48),
  grants: { energyCapacity: 165, energyRegen: 26, heatCapacity: 230, heatSink: 17 },
  description:
    'Forty-eight cycles. Enough to run a full eight-rule doctrine and still fit three modules — the reactor that makes the Cipher worth its price.',
  price: 3400,
};

export const ALL_CORES: readonly Part[] = [EMBER, STEADY, SURGE, STILL, NULLCORE];
