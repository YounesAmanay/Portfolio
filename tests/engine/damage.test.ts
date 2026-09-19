/**
 * The damage pipeline, asserted against the rulebook's worked example.
 *
 * These numbers are computed by hand in docs/01-rules.md §5.11. If this test
 * fails, either the code drifted or the documentation lied; both are bugs and
 * both need fixing together.
 */

import { describe, expect, it } from 'vitest';
import {
  ABLATION_RATE,
  ARMOR_FACTOR,
  SHIELD_MULT,
  STRUCTURE_FACTOR,
} from '@engine/domain/damage';
import { mitigationFor } from '@engine/forge/compile';
import { hitChance, rangeFactor } from '@engine/sim/combat';
import { ARMOR_K, ARMOR_MAX_MITIGATION, EVASION_POTENCY, HIT_CEIL, HIT_FLOOR } from '@engine/tuning';
import type { RangeProfile, WeaponProfile } from '@engine/domain/part';

const PRECISION = 4;

function profile(range: RangeProfile): WeaponProfile {
  return {
    damageType: 'KINETIC', damage: 48, shots: 1, cooldown: 1.45, burstDelay: 0,
    range, accuracy: 105, heatCost: 10, energyCost: 5, pierce: 0.25,
    stagger: 34, magazine: 52, arcing: false,
  };
}

describe('armour mitigation', () => {
  it('follows AR / (AR + K)', () => {
    // With ARMOR_K = 140, mitigation is 50% at exactly 140 effective armour.
    expect(mitigationFor(140 / ARMOR_FACTOR.ION, 'ION')).toBeCloseTo(0.5, PRECISION);
  });

  it('gives marginal effective HP that is exactly linear in armour', () => {
    // The property the whole plating catalogue is priced on.
    // eHP = SP x (AR + K) / K, so each +dAR is worth a constant +SP x dAR / K.
    const SP = 1000;
    const ehpAt = (ar: number): number => SP / (1 - mitigationFor(ar, 'ION'));
    const step = 40;
    const deltas = [0, 40, 80, 120, 160, 200].map((ar) => ehpAt(ar + step) - ehpAt(ar));
    for (const delta of deltas) {
      expect(delta).toBeCloseTo((SP * step) / ARMOR_K, PRECISION);
    }
  });

  it('caps mitigation', () => {
    expect(mitigationFor(100000, 'KINETIC')).toBeCloseTo(ARMOR_MAX_MITIGATION, PRECISION);
  });

  it('ranks the damage types correctly against armour', () => {
    const ar = 180;
    expect(mitigationFor(ar, 'KINETIC')).toBeGreaterThan(mitigationFor(ar, 'ION'));
    expect(mitigationFor(ar, 'ION')).toBeGreaterThan(mitigationFor(ar, 'THERMAL'));
  });

  it('honours pierce', () => {
    expect(mitigationFor(180, 'KINETIC', 0.25)).toBeLessThan(mitigationFor(180, 'KINETIC', 0));
  });
});

describe('rulebook worked example (§5.11)', () => {
  // MK-IV RAILSPIKE (48 kinetic, 25% pierce) into SH 150, AR 180, SP 900.
  const raw = 48;
  const shieldMult = SHIELD_MULT.KINETIC;

  it('step 5: the shield absorbs the first two volleys entirely', () => {
    const shieldDamage = raw * shieldMult;
    expect(shieldDamage).toBeCloseTo(62.4, PRECISION);
    let shield = 150;
    shield -= Math.min(shield, shieldDamage);
    expect(shield).toBeCloseTo(87.6, PRECISION);
    shield -= Math.min(shield, shieldDamage);
    expect(shield).toBeCloseTo(25.2, PRECISION);
  });

  it('step 5-8: the third volley breaks through', () => {
    const shieldDamage = raw * shieldMult;
    const absorbed = Math.min(25.2, shieldDamage);
    const carryOver = (shieldDamage - absorbed) / shieldMult;
    expect(carryOver).toBeCloseTo(28.6154, PRECISION);

    const effectiveAR = 180 * ARMOR_FACTOR.KINETIC * (1 - 0.25);
    expect(effectiveAR).toBeCloseTo(182.25, PRECISION);

    const mitigation = effectiveAR / (effectiveAR + ARMOR_K);
    expect(mitigation).toBeCloseTo(0.5656, PRECISION);

    const postArmour = carryOver * (1 - mitigation);
    expect(postArmour).toBeCloseTo(12.4318, PRECISION);

    const structureDamage = postArmour * STRUCTURE_FACTOR.KINETIC;
    expect(900 - structureDamage).toBeCloseTo(887.5682, PRECISION);

    const ablated = postArmour * ABLATION_RATE.KINETIC;
    expect(180 - ablated).toBeCloseTo(179.9254, PRECISION);
  });

  it('shows thermal delivering ~30% more through the same plate, and ablating 3x faster', () => {
    const carryOver = 28.6154;
    const throughKinetic =
      carryOver * (1 - mitigationFor(180, 'KINETIC', 0.25)) * STRUCTURE_FACTOR.KINETIC;
    const throughThermal =
      carryOver * (1 - mitigationFor(180, 'THERMAL', 0.25)) * STRUCTURE_FACTOR.THERMAL;

    expect(throughThermal / throughKinetic).toBeGreaterThan(1.25);
    expect(ABLATION_RATE.THERMAL / ABLATION_RATE.KINETIC).toBeCloseTo(2.3333, PRECISION);
  });

  it('shows ion barely harming the frame but gutting the shield', () => {
    expect(STRUCTURE_FACTOR.ION).toBeLessThan(0.5);
    expect(SHIELD_MULT.ION).toBeGreaterThan(SHIELD_MULT.KINETIC);
  });
});

describe('range profile', () => {
  const range: RangeProfile = { minRange: 10, optimalRange: 55, maxRange: 85, falloff: 0.55 };
  const weapon = profile(range);

  it('is full inside optimal range', () => {
    expect(rangeFactor(weapon, 30)).toBe(1);
    expect(rangeFactor(weapon, 55)).toBe(1);
  });

  it('penalises point blank', () => {
    expect(rangeFactor(weapon, 5)).toBeCloseTo(0.5, PRECISION);
  });

  it('falls off linearly to the stated floor', () => {
    expect(rangeFactor(weapon, 85)).toBeCloseTo(0.55, PRECISION);
    expect(rangeFactor(weapon, 70)).toBeCloseTo(0.775, PRECISION);
  });

  it('is zero beyond max range', () => {
    expect(rangeFactor(weapon, 86)).toBe(0);
  });
});

describe('hit chance', () => {
  it('gives evasion diminishing returns', () => {
    const acc = 100;
    const at = (ev: number): number => hitChance(acc, ev);
    const first = at(0) - at(40);
    const second = at(40) - at(80);
    expect(second).toBeLessThan(first);
  });

  it('is clamped at both ends', () => {
    expect(hitChance(10000, 1)).toBeCloseTo(HIT_CEIL, PRECISION);
    expect(hitChance(1, 100000)).toBeCloseTo(HIT_FLOOR, PRECISION);
  });

  it('weights evasion by EVASION_POTENCY', () => {
    expect(hitChance(100, 100)).toBeCloseTo(100 / (100 + 100 * EVASION_POTENCY), PRECISION);
  });

  it('never returns NaN for a zero accuracy score', () => {
    expect(hitChance(0, 50)).toBe(0);
  });
});
