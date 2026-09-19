/**
 * Mutable match state.
 *
 * `CompiledFrame` is immutable and shared; everything that changes during a
 * match lives here. The split is what lets a balance test run one compiled
 * frame through a thousand matches without ever resetting it.
 *
 * Mutation is confined to `sim/`. Nothing outside this directory writes to a
 * `FrameRuntime`.
 */

import type { Rng } from '../core/rng';
import { ZERO, type Vec2 } from '../core/vec';
import type { ActionKind } from '../domain/doctrine';
import type { CompiledFrame, CompiledWeapon } from '../forge/compile';
import type { PartId } from '../domain/ids';
import type { HookMemory, PartEventKind } from '../domain/part';
import type { Arena } from './arena';
import type { FrameIndex, SimEvent } from './events';

export type HeatState = 'NOMINAL' | 'STRAIN' | 'CRITICAL' | 'OVERLOADED';

export interface WeaponRuntime {
  readonly def: CompiledWeapon;
  /** Tick at which this weapon may next fire. */
  readyAt: number;
  /** Remaining rounds. `Infinity` for energy weapons. */
  ammo: number;
  shotsFired: number;
  shotsHit: number;
  damageDealt: number;
}

export interface FrameRuntime {
  readonly frame: CompiledFrame;
  readonly index: FrameIndex;

  position: Vec2;
  /** Unit vector the frame is facing. Cosmetic, but the renderer needs it. */
  facing: Vec2;

  structure: number;
  shield: number;
  /** Current armour. Ablates under fire and does not regenerate. */
  armour: number;
  heat: number;
  energy: number;

  heatState: HeatState;
  /** Tick at which overload ends. 0 when not overloaded. */
  overloadUntil: number;
  ventingUntil: number;
  ventReadyAt: number;
  /** Tick at which shield regeneration may resume. */
  shieldReadyAt: number;

  stagger: number;
  staggeredUntil: number;

  action: ActionKind;
  actionReason: string;
  moving: boolean;

  /** Temporary evasion granted by hooks (e.g. PHASE_SHIFT). */
  evasionBonus: number;
  evasionBonusUntil: number;
  /** Heat generation multiplier contributed by hooks this tick. Reset each tick. */
  heatGenMult: number;
  /** Damage multiplier contributed by hooks this tick. Reset each tick. */
  tickDamageMult: number;

  readonly weapons: WeaponRuntime[];

  /** Per-part scratch space, created once per match. @see domain/part.ts */
  readonly hookMemory: Map<PartId, HookMemory>;
  /** Part-facing events raised this tick, drained at the end of it. */
  readonly pendingEvents: PartEventKind[];

  // ── telemetry, for the after-action report ────────────────────────────────
  damageDealt: number;
  damageTaken: number;
  shieldDamageDealt: number;
  overloadCount: number;
  ticksOverloaded: number;
  ticksVenting: number;
  peakHeatRatio: number;
}

export interface MatchState {
  tick: number;
  readonly arena: Arena;
  readonly frames: readonly [FrameRuntime, FrameRuntime];
  readonly rng: Rng;
  /** The seed this match was created from. Part of the replay identity. */
  readonly seed: number;
  readonly events: SimEvent[];
  finished: boolean;
  winner: FrameIndex | null;
  outcome: MatchOutcome;
}

export type MatchOutcome = 'ONGOING' | 'DESTRUCTION' | 'TIMEOUT' | 'DOUBLE_KO' | 'STALEMATE';

export function createRuntime(frame: CompiledFrame, index: FrameIndex, position: Vec2): FrameRuntime {
  return {
    frame,
    index,
    position,
    facing: ZERO,

    structure: frame.stats.structure,
    shield: frame.stats.shieldCapacity,
    armour: frame.stats.armour,
    heat: 0,
    energy: frame.stats.energyCapacity,

    heatState: 'NOMINAL',
    overloadUntil: 0,
    ventingUntil: 0,
    ventReadyAt: 0,
    shieldReadyAt: 0,

    stagger: 0,
    staggeredUntil: 0,

    action: 'ENGAGE',
    actionReason: 'initial',
    moving: false,

    evasionBonus: 0,
    evasionBonusUntil: 0,
    heatGenMult: 1,
    tickDamageMult: 1,

    hookMemory: new Map(frame.hooks.map(({ partId }) => [partId, {} as HookMemory])),
    pendingEvents: [],

    weapons: frame.weapons.map((def) => ({
      def,
      readyAt: 0,
      ammo: def.profile.magazine,
      shotsFired: 0,
      shotsHit: 0,
      damageDealt: 0,
    })),

    damageDealt: 0,
    damageTaken: 0,
    shieldDamageDealt: 0,
    overloadCount: 0,
    ticksOverloaded: 0,
    ticksVenting: 0,
    peakHeatRatio: 0,
  };
}

// ── derived reads ────────────────────────────────────────────────────────────

export function heatRatio(runtime: FrameRuntime): number {
  return runtime.heat / runtime.frame.stats.heatCapacity;
}

export function structureRatio(runtime: FrameRuntime): number {
  return runtime.structure / runtime.frame.stats.structure;
}

export function energyRatio(runtime: FrameRuntime): number {
  return runtime.energy / runtime.frame.stats.energyCapacity;
}

export function isOverloaded(runtime: FrameRuntime): boolean {
  return runtime.heatState === 'OVERLOADED';
}

export function isVenting(runtime: FrameRuntime, tick: number): boolean {
  return tick < runtime.ventingUntil;
}

export function isStaggered(runtime: FrameRuntime, tick: number): boolean {
  return tick < runtime.staggeredUntil;
}

/** Can this frame act at all this tick? */
export function canAct(runtime: FrameRuntime, tick: number): boolean {
  return !isOverloaded(runtime) && !isStaggered(runtime, tick);
}

export function isAlive(runtime: FrameRuntime): boolean {
  return runtime.structure > 0;
}

/** The read-only projection hooks receive. Never exposes mutable state. */
export function toView(runtime: FrameRuntime, elapsed: number): import('../domain/part').FrameView {
  return {
    structure: runtime.structure,
    maxStructure: runtime.frame.stats.structure,
    structureRatio: structureRatio(runtime),
    shield: runtime.shield,
    maxShield: runtime.frame.stats.shieldCapacity,
    heat: runtime.heat,
    heatRatio: heatRatio(runtime),
    energy: runtime.energy,
    energyRatio: energyRatio(runtime),
    armour: runtime.armour,
    overloaded: isOverloaded(runtime),
    elapsed,
  };
}

/**
 * Scratch space for one part on one frame, created lazily and living exactly
 * one match. This is what lets a stateful protocol keep a counter without
 * leaking it into the next match and breaking determinism.
 */
export function memoryFor(runtime: FrameRuntime, partId: PartId): HookMemory {
  let memory = runtime.hookMemory.get(partId);
  if (!memory) {
    memory = {};
    runtime.hookMemory.set(partId, memory);
  }
  return memory;
}

export function opponentOf(state: MatchState, index: FrameIndex): FrameRuntime {
  return state.frames[index === 0 ? 1 : 0];
}
