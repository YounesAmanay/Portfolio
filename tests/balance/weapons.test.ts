/**
 * Weapon pricing regression.
 *
 * Re-derives every weapon's efficiency from the balance model and fails if any
 * drifts out of band. This is the test that makes the catalogue safe to edit:
 * change a cooldown and it tells you immediately what the damage must become.
 *
 * @see docs/02-balance.md §2
 */

import { describe, expect, it } from 'vitest';
import { REGISTRY } from '@engine/content/index';
import { isWeapon, type WeaponPart, type WeaponProfile } from '@engine/domain/part';
import { weaponCycleTime } from '@engine/forge/compile';
import {
  EFFICIENCY_MAX,
  EFFICIENCY_MIN,
  EFFICIENCY_NORM,
  EN_WEIGHT,
  EXPECTED_HIT_RATE,
  HEAT_WEIGHT,
  MASS_WEIGHT,
  PIERCE_WEIGHT,
  POWER_WEIGHT,
  RANGE_BASE,
  RANGE_REF,
  RANGE_SLOPE,
  REFERENCE_FIGHT,
} from '@engine/tuning';

/** Threat: what the weapon gives you. @see docs/02-balance.md §2.1 */
function wpr(profile: WeaponProfile): number {
  const cycle = weaponCycleTime(profile);
  const dps = (profile.damage * profile.shots * EXPECTED_HIT_RATE) / cycle;
  const rangeScore = RANGE_BASE + RANGE_SLOPE * (profile.range.optimalRange / RANGE_REF);
  const magazineDuration = Number.isFinite(profile.magazine)
    ? (profile.magazine / profile.shots) * cycle
    : Infinity;
  const uptime = Math.min(1, magazineDuration / REFERENCE_FIGHT);
  const pierceValue = 1 + profile.pierce * PIERCE_WEIGHT;
  return dps * rangeScore * uptime * pierceValue;
}

/** Cost: what it takes from your budgets. @see docs/02-balance.md §2.2 */
function wcr(part: WeaponPart): number {
  const profile = part.weapon;
  const cycle = weaponCycleTime(profile);
  const heatPressure = (profile.heatCost * profile.shots) / cycle;
  const energyPressure = (profile.energyCost * profile.shots) / cycle;
  return (
    part.cost.mass * MASS_WEIGHT +
    part.cost.powerDraw * POWER_WEIGHT +
    heatPressure * HEAT_WEIGHT +
    energyPressure * EN_WEIGHT
  );
}

const weapons = REGISTRY.allParts().filter(isWeapon);

describe('weapon pricing', () => {
  it('the catalogue has weapons to price', () => {
    expect(weapons.length).toBeGreaterThanOrEqual(16);
  });

  it.each(weapons.map((w) => [w.name, w] as const))(
    '%s sits inside the efficiency band',
    (name, part) => {
      const efficiency = wpr(part.weapon) / wcr(part) / EFFICIENCY_NORM;
      expect(
        efficiency,
        `${name} efficiency ${efficiency.toFixed(3)} is outside [${EFFICIENCY_MIN}, ${EFFICIENCY_MAX}]. ` +
          `Adjust its damage to ${(part.weapon.damage / efficiency).toFixed(0)} to re-centre it.`,
      ).toBeGreaterThanOrEqual(EFFICIENCY_MIN);
      expect(efficiency).toBeLessThanOrEqual(EFFICIENCY_MAX);
    },
  );

  it('EFFICIENCY_NORM is still the catalogue geometric mean', () => {
    const logSum = weapons.reduce((sum, w) => sum + Math.log(wpr(w.weapon) / wcr(w)), 0);
    const geometricMean = Math.exp(logSum / weapons.length);
    // If this drifts far, the constant needs re-deriving — otherwise the band
    // silently recentres around whatever was added last.
    expect(geometricMean / EFFICIENCY_NORM).toBeGreaterThan(0.95);
    expect(geometricMean / EFFICIENCY_NORM).toBeLessThan(1.05);
  });

  it('every damage type is represented across the range bands', () => {
    for (const type of ['KINETIC', 'THERMAL', 'ION'] as const) {
      const ofType = weapons.filter((w) => w.weapon.damageType === type);
      expect(ofType.length, type).toBeGreaterThanOrEqual(4);
      expect(Math.min(...ofType.map((w) => w.weapon.range.optimalRange)), type).toBeLessThan(40);
      expect(Math.max(...ofType.map((w) => w.weapon.range.optimalRange)), type).toBeGreaterThan(39);
    }
  });

  it('every weapon has sane, finite numbers', () => {
    for (const w of weapons) {
      const p = w.weapon;
      expect(p.damage, w.name).toBeGreaterThan(0);
      expect(p.shots, w.name).toBeGreaterThanOrEqual(1);
      expect(p.cooldown, w.name).toBeGreaterThan(0);
      expect(p.range.optimalRange, w.name).toBeLessThanOrEqual(p.range.maxRange);
      expect(p.range.minRange, w.name).toBeLessThanOrEqual(p.range.optimalRange);
      expect(p.pierce, w.name).toBeGreaterThanOrEqual(0);
      expect(p.pierce, w.name).toBeLessThan(1);
      expect(p.range.falloff, w.name).toBeGreaterThan(0);
    }
  });

  it('ammunition-limited weapons trade uptime for punch', () => {
    const limited = weapons.filter((w) => Number.isFinite(w.weapon.magazine));
    const unlimited = weapons.filter((w) => !Number.isFinite(w.weapon.magazine));
    expect(limited.length).toBeGreaterThan(0);
    expect(unlimited.length).toBeGreaterThan(0);
    // Kinetic is the ammo house; it should also be the low-heat house.
    const avgHeat = (list: typeof weapons): number =>
      list.reduce((s, w) => s + (w.weapon.heatCost * w.weapon.shots) / weaponCycleTime(w.weapon), 0) / list.length;
    expect(avgHeat(limited)).toBeLessThan(avgHeat(unlimited));
  });
});
