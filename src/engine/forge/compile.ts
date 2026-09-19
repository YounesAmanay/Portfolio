/**
 * The stat compiler — the single place where parts become numbers.
 *
 * Compilation order is fixed and matters (rulebook §4):
 *   1. seed from chassis base stats
 *   2. sum every part's flat contribution        (order-independent)
 *   3. apply multiplicative modifiers            (sorted by part id)
 *   4. apply load/agility scaling                (needs final mass)
 *   5. clamp to legal ranges
 *
 * Step 4 must come last because agility depends on total mass, which is only
 * known after every part has been counted. Getting this order wrong was the
 * first bug this module ever had, hence the explicit comment.
 */

import { clamp, diminishing } from '../core/num';
import type { Build } from '../domain/build';
import { installedPartIds } from '../domain/build';
import { ARMOR_FACTOR, SHIELD_MULT, STRUCTURE_FACTOR, type DamageType } from '../domain/damage';
import { compileDoctrine, doctrineCost, type Doctrine } from '../domain/doctrine';
import type { PartId } from '../domain/ids';
import { isWeapon, type Chassis, type Part, type PartHooks, type WeaponProfile } from '../domain/part';
import { applyGrant, createAccumulator, type FrameStats } from '../domain/stats';
import {
  AGILITY_BASE,
  AGILITY_SLOPE,
  ARMOR_K,
  ARMOR_MAX_MITIGATION,
  CRIT_BASE,
  CRIT_MULT_BASE,
  TARGETING_BASE,
} from '../tuning';
import type { PartRegistry } from './registry';

/** A weapon resolved against its owning frame, ready for the simulation. */
export interface CompiledWeapon {
  readonly partId: PartId;
  readonly name: string;
  readonly profile: WeaponProfile;
  /** Seconds for one full volley cycle, including burst spacing. */
  readonly cycleTime: number;
  /**
   * The *real* cycle time once energy regeneration is accounted for. When this
   * exceeds `cycleTime` the weapon is energy-throttled — a hidden damage loss
   * the Forge surfaces in amber rather than letting the player discover it
   * mid-match. @see docs/02-balance.md §4.1
   */
  readonly effectiveCycle: number;
  readonly sustainedDps: number;
  readonly heatPressure: number;
  readonly energyPressure: number;
}

/** Hooks paired with their owning part id, so effects can be sorted stably. */
export interface CompiledHook {
  readonly partId: PartId;
  readonly hooks: PartHooks;
}

/** An immutable, deployable frame. Never mutated during a match. */
export interface CompiledFrame {
  readonly build: Build;
  readonly chassis: Chassis;
  readonly parts: readonly Part[];
  readonly stats: FrameStats;
  readonly weapons: readonly CompiledWeapon[];
  readonly hooks: readonly CompiledHook[];
  readonly doctrine: Doctrine;
  readonly powerDraw: number;
  readonly cycleDraw: number;
  readonly powerSupply: number;
  readonly cycleSupply: number;
}

export function compileFrame(build: Build, registry: PartRegistry): CompiledFrame {
  const chassis = registry.requireChassis(build.chassisId);
  const parts = installedPartIds(build).map((id) => registry.requirePart(id));

  // Step 1 + 2 + 3 — accumulate grants. Sorting by id makes multiplicative
  // folding order-independent, which matters for floating-point determinism.
  const acc = createAccumulator();
  if (chassis.grants) applyGrant(acc, chassis.grants);
  const sorted = [...parts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const part of sorted) applyGrant(acc, part.grants);

  const mass = chassis.mass + parts.reduce((sum, part) => sum + part.cost.mass, 0);
  const powerDraw = parts.reduce((sum, part) => sum + part.cost.powerDraw, 0);
  const cycleDraw =
    parts.reduce((sum, part) => sum + part.cost.cycleDraw, 0) + doctrineCost(build.doctrine);
  const powerSupply = parts.reduce((sum, part) => sum + (part.supply?.power ?? 0), 0);
  const cycleSupply = parts.reduce((sum, part) => sum + (part.supply?.cycles ?? 0), 0);

  // Step 4 — load and agility. Must follow the mass sum.
  const load = chassis.massLimit > 0 ? mass / chassis.massLimit : 1;
  const agility = AGILITY_BASE - AGILITY_SLOPE * clamp(load, 0, 1);

  // Step 5 — assemble and clamp.
  const stats: FrameStats = {
    structure: Math.max(1, chassis.structure + acc.structure),
    armour: Math.max(0, acc.armour * acc.armourMult),
    mass,
    massLimit: chassis.massLimit,
    load,
    agility,

    heatCapacity: Math.max(1, acc.heatCapacity),
    heatSink: Math.max(0, acc.heatSink * acc.coolingMult),
    energyCapacity: Math.max(1, acc.energyCapacity),
    energyRegen: Math.max(0, acc.energyRegen),
    shieldCapacity: Math.max(0, acc.shieldCapacity),
    shieldRegen: Math.max(0, acc.shieldRegen),

    speed: Math.max(0, acc.speed * agility * acc.speedMult),
    evasion: Math.max(0, acc.evasion * agility + acc.evasionFlat),
    targeting: Math.max(1, TARGETING_BASE + acc.targeting),
    critChance: clamp(CRIT_BASE + acc.critChance, 0, 1),
    critMult: Math.max(1, CRIT_MULT_BASE + acc.critMult),
    staggerResist: clamp(acc.staggerResist, 0, 0.9),
    repairRate: Math.max(0, acc.repairRate),

    damageMult: acc.damageMult,
    cooldownMult: Math.max(0.1, acc.cooldownMult),
    radius: chassis.radius,
  };

  const weapons = parts
    .filter(isWeapon)
    .map((part) => compileWeapon(part.id, part.name, part.weapon, stats));

  const hooks = sorted
    .filter((part): part is Part & { hooks: PartHooks } => part.hooks !== undefined)
    .map((part) => ({ partId: part.id, hooks: part.hooks }));

  return {
    build,
    chassis,
    parts,
    stats,
    weapons,
    hooks,
    doctrine: compileDoctrine(build.doctrine),
    powerDraw,
    cycleDraw,
    powerSupply,
    cycleSupply,
  };
}

function compileWeapon(
  partId: PartId,
  name: string,
  profile: WeaponProfile,
  stats: FrameStats,
): CompiledWeapon {
  const cycleTime = weaponCycleTime(profile) * stats.cooldownMult;
  const energyPerVolley = profile.energyCost * profile.shots;
  // Energy-limited cycle: you cannot fire faster than regen refills the cost.
  const energyLimited = stats.energyRegen > 0 ? energyPerVolley / stats.energyRegen : Infinity;
  const effectiveCycle = Math.max(cycleTime, energyLimited);

  return {
    partId,
    name,
    profile,
    cycleTime,
    effectiveCycle,
    sustainedDps: (profile.damage * profile.shots * stats.damageMult) / effectiveCycle,
    heatPressure: (profile.heatCost * profile.shots) / effectiveCycle,
    energyPressure: energyPerVolley / effectiveCycle,
  };
}

/** Full volley duration: the cooldown plus the intra-burst spacing. */
export function weaponCycleTime(profile: WeaponProfile): number {
  return profile.cooldown + Math.max(0, profile.shots - 1) * profile.burstDelay;
}

/** Armour mitigation against one damage type. @see docs/01-rules.md §5.6 */
export function mitigationFor(armour: number, type: DamageType, pierce = 0): number {
  const effective = armour * ARMOR_FACTOR[type] * (1 - clamp(pierce, 0, 1));
  return Math.min(diminishing(effective, ARMOR_K), ARMOR_MAX_MITIGATION);
}

/**
 * Effective HP against one damage type — the honest durability number, since
 * raw structure badly understates a well-armoured frame.
 * @see docs/02-balance.md §1.1
 */
export function effectiveHp(stats: FrameStats, type: DamageType): number {
  const mitigation = mitigationFor(stats.armour, type);
  const shieldPart = stats.shieldCapacity / SHIELD_MULT[type];
  const structurePart = stats.structure / ((1 - mitigation) * STRUCTURE_FACTOR[type]);
  return shieldPart + structurePart;
}

/** Total heat balance: positive means the build cooks itself. @see docs/02-balance.md §4 */
export function heatBalance(frame: CompiledFrame): number {
  return frame.weapons.reduce((sum, w) => sum + w.heatPressure, 0) - frame.stats.heatSink;
}

/** Seconds of unrestricted fire before overload, or Infinity if sustainable. */
export function timeToOverload(frame: CompiledFrame): number {
  const balance = heatBalance(frame);
  return balance <= 0 ? Infinity : frame.stats.heatCapacity / balance;
}
