/**
 * Hook effect application.
 *
 * Parts describe what they want via `SimEffect`; this is the only place those
 * wishes become state changes. Centralising it means a new effect kind is a
 * single `case` here plus a union member in `domain/part.ts`, and it keeps the
 * "hooks are pure" promise honest — a hook that could mutate directly would
 * silently break determinism the first time two hooks raced.
 *
 * Effects arrive already grouped by part id (hooks are sorted at compile time)
 * and are applied in that order, so the result never depends on iteration luck.
 */

import type { SimEffect } from '../domain/part';
import { TICK_RATE } from '../tuning';
import { addHeat } from './heat';
import type { FrameRuntime as Runtime } from './state';

export function applyEffects(runtime: Runtime, effects: readonly SimEffect[], tick: number): void {
  for (const effect of effects) {
    switch (effect.kind) {
      case 'heat':
        addHeat(runtime, effect.delta);
        break;
      case 'heatGenMult':
        runtime.heatGenMult *= effect.value;
        break;
      case 'energy':
        runtime.energy = clampTo(
          runtime.energy + effect.delta,
          0,
          runtime.frame.stats.energyCapacity,
        );
        break;
      case 'structure':
        runtime.structure = Math.min(
          runtime.frame.stats.structure,
          runtime.structure + effect.delta,
        );
        break;
      case 'shield':
        runtime.shield = clampTo(
          runtime.shield + effect.delta,
          0,
          runtime.frame.stats.shieldCapacity,
        );
        break;
      case 'armour':
        runtime.armour = Math.max(0, runtime.armour + effect.delta);
        break;
      case 'evasionBonus':
        runtime.evasionBonus = effect.value;
        runtime.evasionBonusUntil = tick + effect.duration * TICK_RATE;
        break;
      case 'damageMult':
        runtime.tickDamageMult *= effect.value;
        break;
      case 'log':
        // Logging is a UI concern; the engine records nothing it cannot replay.
        break;
    }
  }
}

function clampTo(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Resets the per-tick accumulators that hooks contribute to. */
export function resetTickModifiers(runtime: Runtime): void {
  runtime.heatGenMult = 1;
  runtime.tickDamageMult = 1;
}
