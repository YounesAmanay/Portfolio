/**
 * Heat — the strategic resource.
 *
 * Heat accumulates across the whole match and never fully resets. It is the
 * reason a build cannot simply mount maximum firepower, and the reason cooling
 * is a real budget line rather than an afterthought.
 *
 * @see docs/01-rules.md §6
 */

import { clamp } from '../core/num';
import {
  CRITICAL_ACC_MULT,
  CRITICAL_COOLDOWN_MULT,
  CRITICAL_SPEED_MULT,
  HEAT_CRITICAL_THRESHOLD,
  HEAT_HARD_CAP_MULT,
  HEAT_OVERLOAD_THRESHOLD,
  HEAT_STRAIN_THRESHOLD,
  OVERLOAD_BURN,
  OVERLOAD_COOLING_MULT,
  OVERLOAD_EVASION_MULT,
  OVERLOAD_MIN_TICKS,
  OVERLOAD_RECOVERY_RATIO,
  STRAIN_ACC_MULT,
  STRAIN_COOLING_MULT,
  STRAIN_SPEED_MULT,
  TICK,
  VENT_MULTIPLIER,
  VENT_SPEED_MULT,
  VENT_ZONE_MULT,
} from '../tuning';
import { inZone, type Arena } from './arena';
import type { SimEvent } from './events';
import { heatRatio, isVenting, type FrameRuntime, type HeatState } from './state';

/** The multiplicative penalties a heat band imposes. One table, no scattered ifs. */
export interface HeatPenalties {
  readonly accuracy: number;
  readonly speed: number;
  readonly cooling: number;
  readonly cooldown: number;
  readonly evasion: number;
}

const PENALTIES: Readonly<Record<HeatState, HeatPenalties>> = {
  NOMINAL: { accuracy: 1, speed: 1, cooling: 1, cooldown: 1, evasion: 1 },
  STRAIN: {
    accuracy: STRAIN_ACC_MULT,
    speed: STRAIN_SPEED_MULT,
    cooling: STRAIN_COOLING_MULT,
    cooldown: 1,
    evasion: 1,
  },
  CRITICAL: {
    accuracy: CRITICAL_ACC_MULT,
    speed: CRITICAL_SPEED_MULT,
    cooling: 1,
    cooldown: CRITICAL_COOLDOWN_MULT,
    evasion: 1,
  },
  OVERLOADED: {
    accuracy: 0,
    speed: 0,
    cooling: OVERLOAD_COOLING_MULT,
    cooldown: 1,
    evasion: OVERLOAD_EVASION_MULT,
  },
};

export function penaltiesFor(state: HeatState): HeatPenalties {
  return PENALTIES[state];
}

/** Classifies a heat ratio into a band. Pure — used by the UI for previews too. */
export function classifyHeat(ratio: number): HeatState {
  if (ratio >= HEAT_OVERLOAD_THRESHOLD) return 'OVERLOADED';
  if (ratio >= HEAT_CRITICAL_THRESHOLD) return 'CRITICAL';
  if (ratio >= HEAT_STRAIN_THRESHOLD) return 'STRAIN';
  return 'NOMINAL';
}

/**
 * Advances heat for one tick: dissipation, band transitions, overload entry
 * and recovery, and the structural burn of a shutdown.
 */
export function stepHeat(runtime: FrameRuntime, arena: Arena, tick: number, events: SimEvent[]): void {
  const stats = runtime.frame.stats;
  const previous = runtime.heatState;

  // ── dissipation ───────────────────────────────────────────────────────────
  let coolingMult = penaltiesFor(previous).cooling;
  if (isVenting(runtime, tick)) coolingMult *= VENT_MULTIPLIER;
  if (inZone(arena, runtime.position, 'COOLANT')) coolingMult *= VENT_ZONE_MULT;

  runtime.heat = Math.max(0, runtime.heat - stats.heatSink * coolingMult * TICK);
  runtime.heat = clamp(runtime.heat, 0, stats.heatCapacity * HEAT_HARD_CAP_MULT);

  const ratio = heatRatio(runtime);
  runtime.peakHeatRatio = Math.max(runtime.peakHeatRatio, ratio);

  // ── overload: entry, burn, and exit ───────────────────────────────────────
  if (previous === 'OVERLOADED') {
    runtime.ticksOverloaded++;
    runtime.structure -= stats.structure * OVERLOAD_BURN * TICK;

    const minimumServed = tick >= runtime.overloadUntil;
    if (minimumServed && ratio <= OVERLOAD_RECOVERY_RATIO) {
      runtime.heatState = classifyHeat(ratio);
      events.push({ kind: 'RECOVERED', tick, frame: runtime.index });
    }
    return;
  }

  const next = classifyHeat(ratio);
  if (next === previous) return;

  runtime.heatState = next;
  if (next === 'OVERLOADED') {
    runtime.overloadCount++;
    runtime.overloadUntil = tick + OVERLOAD_MIN_TICKS;
    runtime.ventingUntil = 0; // venting cannot save you once you are over
    events.push({ kind: 'OVERLOAD', tick, frame: runtime.index });
    runtime.pendingEvents.push('ENTERED_OVERLOAD');
  } else {
    events.push({ kind: 'HEAT_STATE', tick, frame: runtime.index, state: next });
    if (next === 'CRITICAL') runtime.pendingEvents.push('ENTERED_CRITICAL');
  }
}

/** Adds heat, honouring any hook-supplied generation multiplier for this tick. */
export function addHeat(runtime: FrameRuntime, amount: number): void {
  runtime.heat = Math.max(0, runtime.heat + amount * runtime.heatGenMult);
}

/** Speed multiplier from thermal state and venting combined. */
export function thermalSpeedMult(runtime: FrameRuntime, tick: number): number {
  const base = penaltiesFor(runtime.heatState).speed;
  return isVenting(runtime, tick) ? base * VENT_SPEED_MULT : base;
}
