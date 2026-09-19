/**
 * The damage pipeline — rulebook §5, implemented step for step.
 *
 * Damage passes through three layers in a fixed order, Shield -> Armour ->
 * Structure, and each damage type interacts with each layer differently. That
 * 3x3 interaction *is* the combat triangle; everything else in the game is
 * pressure applied to it.
 *
 * The steps below are numbered to match the rulebook so the two can be diffed
 * by eye. `tests/engine/damage.test.ts` asserts the rulebook's worked example
 * against this code to four decimal places.
 */

import { clamp, lerp } from '../core/num';
import { chance, type Rng } from '../core/rng';
import { distance, type Vec2 } from '../core/vec';
import {
  ABLATION_RATE,
  ARMOR_FACTOR,
  SHIELD_MULT,
  STRUCTURE_FACTOR,
  type DamageType,
} from '../domain/damage';
import type { DamageContext, DamageModifier, HookMemory, WeaponProfile } from '../domain/part';
import { mitigationFor } from '../forge/compile';
import {
  ARMOR_K,
  ARMOR_MAX_MITIGATION,
  EVASION_POTENCY,
  BRACE_ACC_MULT,
  BRACE_ARMOR_MULT,
  BRACE_EVASION_MULT,
  HIT_CEIL,
  HIT_FLOOR,
  ION_ENERGY_DRAIN,
  ION_HEAT_TRANSFER,
  MOVING_ACC_PENALTY,
  POINT_BLANK_PENALTY,
  RUBBLE_EVASION_BONUS,
  SHIELD_HIT_DELAY,
  SHIELD_REBOOT_DELAY,
  STAGGER_DECAY,
  STAGGER_DURATION,
  STAGGER_THRESHOLD,
  THERMAL_HEAT_TRANSFER,
  TICK,
  TICK_RATE,
  VENTING_ACC_PENALTY,
} from '../tuning';
import { hasLineOfSight, inZone, type Arena } from './arena';
import type { SimEvent } from './events';
import { addHeat, penaltiesFor } from './heat';
import {
  isVenting,
  memoryFor,
  toView,
  type FrameRuntime,
  type WeaponRuntime,
} from './state';

/** Outcome of one resolved shot. Returned so the caller can log and animate it. */
export interface ShotResult {
  readonly hit: boolean;
  readonly crit: boolean;
  readonly raw: number;
  readonly shieldDamage: number;
  readonly mitigated: number;
  readonly structureDamage: number;
  readonly shieldBroke: boolean;
}

/** Placeholder for the shared context; each hook receives its own memory. */
const EMPTY_MEMORY: HookMemory = {};

const MISS: ShotResult = {
  hit: false,
  crit: false,
  raw: 0,
  shieldDamage: 0,
  mitigated: 0,
  structureDamage: 0,
  shieldBroke: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — range factor (rulebook §5.2)
// ─────────────────────────────────────────────────────────────────────────────

export function rangeFactor(profile: WeaponProfile, d: number): number {
  const { minRange, optimalRange, maxRange, falloff } = profile.range;
  if (d > maxRange) return 0;
  if (d < minRange) return POINT_BLANK_PENALTY;
  if (d <= optimalRange) return 1;
  return lerp(1, falloff, clamp((d - optimalRange) / Math.max(1e-6, maxRange - optimalRange), 0, 1));
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — hit chance (rulebook §5.3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Accuracy score before it meets evasion. Exported because the Forge shows a
 * live hit-chance preview against the reference frame, and it must use exactly
 * the same arithmetic the simulation does.
 */
export function accuracyScore(
  attacker: FrameRuntime,
  profile: WeaponProfile,
  d: number,
  tick: number,
  accuracyMult = 1,
): number {
  const stats = attacker.frame.stats;
  let score = profile.accuracy * (stats.targeting / 100) * rangeFactor(profile, d);
  score *= penaltiesFor(attacker.heatState).accuracy;
  if (attacker.moving) score *= MOVING_ACC_PENALTY;
  if (isVenting(attacker, tick)) score *= VENTING_ACC_PENALTY;
  if (attacker.action === 'BRACE') score *= BRACE_ACC_MULT;
  return score * accuracyMult;
}

/** Effective evasion, including posture, temporary bonuses and terrain. */
export function effectiveEvasion(defender: FrameRuntime, arena: Arena, tick: number): number {
  let evasion = defender.frame.stats.evasion;
  if (defender.action === 'BRACE') evasion *= BRACE_EVASION_MULT;
  evasion *= penaltiesFor(defender.heatState).evasion;
  if (tick < defender.evasionBonusUntil) evasion += defender.evasionBonus;
  if (inZone(arena, defender.position, 'RUBBLE')) evasion += RUBBLE_EVASION_BONUS;
  return Math.max(0, evasion);
}

/**
 * The ratio form `acc / (acc + ev)` gives evasion diminishing returns: you can
 * never become untouchable, and stacking evasion past a point is wasted mass.
 */
export function hitChance(accScore: number, evasion: number): number {
  if (accScore <= 0) return 0;
  return clamp(accScore / (accScore + evasion * EVASION_POTENCY), HIT_FLOOR, HIT_CEIL);
}

// ─────────────────────────────────────────────────────────────────────────────
// Firing gate (rulebook §5.1)
// ─────────────────────────────────────────────────────────────────────────────

export function canFire(
  attacker: FrameRuntime,
  weapon: WeaponRuntime,
  arena: Arena,
  target: Vec2,
  tick: number,
): boolean {
  if (tick < weapon.readyAt) return false;
  if (weapon.ammo <= 0) return false;
  if (attacker.energy < weapon.def.profile.energyCost * weapon.def.profile.shots) return false;
  const d = distance(attacker.position, target);
  if (d > weapon.def.profile.range.maxRange) return false;
  if (!weapon.def.profile.arcing && !hasLineOfSight(arena, attacker.position, target)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// The pipeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves one shot end to end and applies it. Mutates both runtimes — this is
 * one of only three functions in the engine permitted to do so, and it is the
 * reason all of the arithmetic above is exported as pure helpers: everything
 * testable is testable without side effects.
 */
export function resolveShot(
  attacker: FrameRuntime,
  defender: FrameRuntime,
  weapon: WeaponRuntime,
  arena: Arena,
  rng: Rng,
  tick: number,
  events: SimEvent[],
): ShotResult {
  const profile = weapon.def.profile;
  const type = profile.damageType;
  const d = distance(attacker.position, defender.position);
  const elapsed = tick * TICK;

  // Gather hook modifiers once, so both attacker and defender parts get a say.
  const ctx: DamageContext = {
    self: toView(attacker, elapsed),
    opponent: toView(defender, elapsed),
    damageType: type,
    raw: profile.damage,
    distance: d,
    memory: EMPTY_MEMORY,
  };
  const outgoing = collectOutgoing(attacker, ctx);
  const incoming = collectIncoming(defender, {
    ...ctx,
    self: ctx.opponent,
    opponent: ctx.self,
  });

  // ── Step 3: hit check ─────────────────────────────────────────────────────
  const accScore = accuracyScore(attacker, profile, d, tick, outgoing.accuracyMult ?? 1);
  const evasion = effectiveEvasion(defender, arena, tick);
  const chanceToHit = hitChance(accScore, evasion);

  weapon.shotsFired++;
  if (!chance(rng, chanceToHit)) return MISS;
  weapon.shotsHit++;

  // ── Step 4: raw damage ────────────────────────────────────────────────────
  const critChance = clamp(
    attacker.frame.stats.critChance + (outgoing.critChanceBonus ?? 0),
    0,
    1,
  );
  const isCrit = chance(rng, critChance);
  const critMult = isCrit ? attacker.frame.stats.critMult : 1;

  const raw =
    profile.damage *
    critMult *
    attacker.frame.stats.damageMult *
    attacker.tickDamageMult *
    (outgoing.damageMult ?? 1) *
    (incoming.damageMult ?? 1);

  // ── Step 5: shield layer ──────────────────────────────────────────────────
  const shieldMult = SHIELD_MULT[type];
  const shieldDamage = raw * shieldMult;
  const absorbed = Math.min(defender.shield, shieldDamage);
  const hadShield = defender.shield > 0;
  defender.shield -= absorbed;
  const carryOver = (shieldDamage - absorbed) / shieldMult;

  let shieldBroke = false;
  if (hadShield) {
    if (defender.shield <= 0) {
      defender.shield = 0;
      shieldBroke = true;
      defender.shieldReadyAt = tick + SHIELD_REBOOT_DELAY * TICK_RATE;
      events.push({ kind: 'SHIELD_BROKEN', tick, target: defender.index });
      defender.pendingEvents.push('SHIELD_BROKEN');
    } else {
      defender.shieldReadyAt = Math.max(
        defender.shieldReadyAt,
        tick + SHIELD_HIT_DELAY * TICK_RATE,
      );
    }
  }

  // ── Step 6: armour layer ──────────────────────────────────────────────────
  const pierce = clamp(profile.pierce + (outgoing.pierceBonus ?? 0), 0, 1);
  const braceMult = defender.action === 'BRACE' ? BRACE_ARMOR_MULT : 1;
  const armourNow = defender.armour * braceMult * (incoming.armourMult ?? 1);
  const effectiveAR = armourNow * ARMOR_FACTOR[type] * (1 - pierce);
  const mitigation = Math.min(
    effectiveAR <= 0 ? 0 : effectiveAR / (effectiveAR + ARMOR_K),
    ARMOR_MAX_MITIGATION,
  EVASION_POTENCY,
  );
  const postArmour = carryOver * (1 - mitigation);
  const mitigated = carryOver - postArmour;

  // ── Step 7: ablation ──────────────────────────────────────────────────────
  defender.armour = Math.max(0, defender.armour - postArmour * ABLATION_RATE[type]);

  // ── Step 8: structure ─────────────────────────────────────────────────────
  const structureDamage = postArmour * STRUCTURE_FACTOR[type];
  defender.structure -= structureDamage;

  // ── Step 9: on-hit side effects ───────────────────────────────────────────
  applySideEffects(defender, type, raw, profile, tick, events);

  // ── telemetry ─────────────────────────────────────────────────────────────
  attacker.pendingEvents.push('DEALT_DAMAGE');
  defender.pendingEvents.push('TOOK_DAMAGE');
  attacker.damageDealt += structureDamage;
  attacker.shieldDamageDealt += absorbed;
  defender.damageTaken += structureDamage;
  weapon.damageDealt += structureDamage;

  return {
    hit: true,
    crit: isCrit,
    raw,
    shieldDamage: absorbed,
    mitigated,
    structureDamage,
    shieldBroke,
  };
}

/**
 * Rulebook §5.9. Each type carries a payload beyond raw damage; this is where
 * ion earns its place despite dealing 55% less structural damage.
 */
function applySideEffects(
  defender: FrameRuntime,
  type: DamageType,
  raw: number,
  profile: WeaponProfile,
  tick: number,
  events: SimEvent[],
): void {
  switch (type) {
    case 'KINETIC': {
      const gain = profile.stagger * (1 - defender.frame.stats.staggerResist);
      defender.stagger += gain;
      if (defender.stagger >= STAGGER_THRESHOLD) {
        defender.stagger = 0;
        defender.staggeredUntil = tick + STAGGER_DURATION * TICK_RATE;
        events.push({ kind: 'STAGGERED', tick, target: defender.index });
        defender.pendingEvents.push('STAGGERED');
      }
      break;
    }
    case 'THERMAL':
      addHeat(defender, raw * THERMAL_HEAT_TRANSFER);
      break;
    case 'ION':
      defender.energy = Math.max(0, defender.energy - raw * ION_ENERGY_DRAIN);
      addHeat(defender, raw * ION_HEAT_TRANSFER);
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook aggregation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Folds every part's damage modifier into one. Multiplicative fields multiply,
 * additive bonuses sum. Hooks are already sorted by part id at compile time,
 * so the fold is deterministic.
 */
function collectOutgoing(runtime: FrameRuntime, ctx: DamageContext): DamageModifier {
  let damageMult = 1;
  let pierceBonus = 0;
  let critChanceBonus = 0;
  let accuracyMult = 1;
  for (const { partId, hooks } of runtime.frame.hooks) {
    const mod = hooks.modifyOutgoingDamage?.({ ...ctx, memory: memoryFor(runtime, partId) });
    if (!mod) continue;
    damageMult *= mod.damageMult ?? 1;
    pierceBonus += mod.pierceBonus ?? 0;
    critChanceBonus += mod.critChanceBonus ?? 0;
    accuracyMult *= mod.accuracyMult ?? 1;
  }
  return { damageMult, pierceBonus, critChanceBonus, accuracyMult };
}

function collectIncoming(runtime: FrameRuntime, ctx: DamageContext): DamageModifier {
  let damageMult = 1;
  let armourMult = 1;
  for (const { partId, hooks } of runtime.frame.hooks) {
    const mod = hooks.modifyIncomingDamage?.({ ...ctx, memory: memoryFor(runtime, partId) });
    if (!mod) continue;
    damageMult *= mod.damageMult ?? 1;
    armourMult *= mod.armourMult ?? 1;
  }
  return { damageMult, armourMult };
}


// ─────────────────────────────────────────────────────────────────────────────
// Per-tick regeneration
// ─────────────────────────────────────────────────────────────────────────────

/** Shield and energy regeneration, and stagger decay. Rulebook §5.5, §5.10, §7. */
export function stepRegeneration(runtime: FrameRuntime, tick: number): void {
  const stats = runtime.frame.stats;

  runtime.energy = Math.min(stats.energyCapacity, runtime.energy + stats.energyRegen * TICK);

  if (tick >= runtime.shieldReadyAt && runtime.shield < stats.shieldCapacity) {
    runtime.shield = Math.min(stats.shieldCapacity, runtime.shield + stats.shieldRegen * TICK);
  }

  if (runtime.stagger > 0) {
    runtime.stagger = Math.max(0, runtime.stagger - STAGGER_DECAY_PER_TICK);
  }

  if (stats.repairRate > 0 && runtime.structure > 0) {
    runtime.structure = Math.min(stats.structure, runtime.structure + stats.repairRate * TICK);
  }
}

const STAGGER_DECAY_PER_TICK = STAGGER_DECAY * TICK;

/**
 * Expected damage per shot against a given defender — used by the `FOCUS`
 * action to pick the weapon the enemy is currently weakest to, and by the
 * Forge to show matchup previews.
 */
export function expectedDamage(
  profile: WeaponProfile,
  defenderArmour: number,
  defenderShield: number,
): number {
  const type = profile.damageType;
  if (defenderShield > 0) {
    // While shields hold, what matters is how fast this type drains them.
    return profile.damage * SHIELD_MULT[type];
  }
  const mitigation = mitigationFor(defenderArmour, type, profile.pierce);
  return profile.damage * (1 - mitigation) * STRUCTURE_FACTOR[type];
}
