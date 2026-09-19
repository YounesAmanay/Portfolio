/**
 * The match loop.
 *
 * `simulate()` is the entire game reduced to one pure function:
 *
 *     simulate(frameA, frameB, arena, seed) -> MatchResult
 *
 * No I/O, no clock, no shared mutable state that survives the call. Run it
 * twice with the same arguments and you get byte-identical event logs — which
 * is what makes replays 1 KB, balance testable in CI, and results verifiable.
 *
 * @see docs/01-rules.md §1.1, §12
 */

import { createRng, type Rng } from '../core/rng';
import type { SimEffect } from '../domain/part';
import type { CompiledFrame } from '../forge/compile';
import {
  DECISION_INTERVAL_TICKS,
  ION_STORM_DRAIN,
  MATCH_LIMIT_TICKS,
  STALEMATE_EPSILON,
  TICK,
  TICK_RATE,
  VENT_COOLDOWN,
  VENT_MAX_DURATION,
} from '../tuning';
import { applyEffects, resetTickModifiers } from './apply';
import { inZone, type Arena } from './arena';
import { canFire, resolveShot, stepRegeneration } from './combat';
import { applyDecision, decide } from './cortex';
import type { FrameIndex, SimEvent } from './events';
import { penaltiesFor, stepHeat, addHeat } from './heat';
import { spawnPositions, stepMovement } from './movement';
import {
  canAct,
  createRuntime,
  isAlive,
  memoryFor,
  structureRatio,
  toView,
  type FrameRuntime,
  type MatchOutcome,
  type MatchState,
} from './state';
import { ARENA_SPAWN_SEPARATION } from '../tuning';

/** Per-frame statistics for the after-action report. */
export interface FrameTelemetry {
  readonly name: string;
  readonly structureRemaining: number;
  readonly structureRatio: number;
  readonly damageDealt: number;
  readonly damageTaken: number;
  readonly shieldDamageDealt: number;
  readonly armourRemaining: number;
  readonly overloadCount: number;
  readonly secondsOverloaded: number;
  readonly secondsVenting: number;
  readonly peakHeatRatio: number;
  readonly accuracy: number;
  readonly shotsFired: number;
  readonly weapons: readonly {
    readonly name: string;
    readonly shotsFired: number;
    readonly shotsHit: number;
    readonly damageDealt: number;
    readonly ammoRemaining: number;
  }[];
}

export interface MatchResult {
  readonly winner: FrameIndex | null;
  readonly outcome: MatchOutcome;
  readonly ticks: number;
  readonly duration: number;
  readonly events: readonly SimEvent[];
  readonly telemetry: readonly [FrameTelemetry, FrameTelemetry];
  readonly seed: number;
  readonly arenaId: string;
}

const VENT_DURATION_TICKS = Math.round(VENT_MAX_DURATION * TICK_RATE);
const VENT_COOLDOWN_TICKS = Math.round(VENT_COOLDOWN * TICK_RATE);
const ION_STORM_PER_TICK = ION_STORM_DRAIN * TICK;

export function simulate(
  frameA: CompiledFrame,
  frameB: CompiledFrame,
  arena: Arena,
  seed: number,
): MatchResult {
  const state = createMatch(frameA, frameB, arena, seed);

  while (!state.finished && state.tick < MATCH_LIMIT_TICKS) {
    stepMatch(state);
  }

  if (!state.finished) finishByTimeout(state);

  return buildResult(state);
}

/** Exposed so the UI can step a match frame-by-frame for live playback. */
export function createMatch(
  frameA: CompiledFrame,
  frameB: CompiledFrame,
  arena: Arena,
  seed: number,
): MatchState {
  const [spawnA, spawnB] = spawnPositions(arena, ARENA_SPAWN_SEPARATION);
  const state: MatchState = {
    tick: 0,
    arena,
    frames: [createRuntime(frameA, 0, spawnA), createRuntime(frameB, 1, spawnB)],
    rng: createRng(seed),
    seed,
    events: [],
    finished: false,
    winner: null,
    outcome: 'ONGOING',
  };
  state.events.push({ kind: 'MATCH_START', tick: 0, arena: arena.name });
  return state;
}

/**
 * Advances the match exactly one tick.
 *
 * Phase order is load-bearing and deliberately explicit:
 *   1. reset per-tick hook accumulators
 *   2. hooks (may change heat generation, damage, evasion for this tick)
 *   3. decisions  — every 5th tick only
 *   4. movement   — acts on this tick's decision
 *   5. firing     — acts on this tick's positions
 *   6. heat       — after firing, so this tick's heat counts
 *   7. regen and zones
 *   8. victory check
 *
 * Firing must follow movement so a frame that closed into range this tick can
 * shoot; heat must follow firing so a volley that tips you over overloads you
 * now rather than a tick later.
 */
export function stepMatch(state: MatchState): void {
  if (state.finished) return;
  state.tick++;
  const tick = state.tick;
  const elapsed = tick * TICK;
  const [a, b] = state.frames;

  for (const runtime of state.frames) resetTickModifiers(runtime);

  runHooks(state, a, b, elapsed);
  runHooks(state, b, a, elapsed);

  if (tick % DECISION_INTERVAL_TICKS === 0) {
    for (const runtime of state.frames) {
      const enemy = runtime.index === 0 ? b : a;
      if (!canAct(runtime, tick)) continue;
      applyDecision(
        runtime,
        decide(runtime, enemy, tick),
        tick,
        state.events,
        VENT_DURATION_TICKS,
        VENT_COOLDOWN_TICKS,
      );
    }
  }

  stepMovement(a, b, state.arena, tick);
  stepMovement(b, a, state.arena, tick);

  fireWeapons(state, a, b);
  fireWeapons(state, b, a);

  for (const runtime of state.frames) {
    if (runtime.ventingUntil > tick) runtime.ticksVenting++;
    stepHeat(runtime, state.arena, tick, state.events);
    stepRegeneration(runtime, tick);
    if (inZone(state.arena, runtime.position, 'ION_STORM')) {
      runtime.energy = Math.max(0, runtime.energy - ION_STORM_PER_TICK);
    }
  }

  dispatchPartEvents(state, a, b, elapsed);
  dispatchPartEvents(state, b, a, elapsed);

  checkVictory(state);
}

function runHooks(
  state: MatchState,
  runtime: FrameRuntime,
  opponent: FrameRuntime,
  elapsed: number,
): void {
  if (runtime.frame.hooks.length === 0) return;
  const base = {
    self: toView(runtime, elapsed),
    opponent: toView(opponent, elapsed),
    tick: state.tick,
    distance: distanceBetween(runtime, opponent),
  };
  const effects: SimEffect[] = [];
  for (const { partId, hooks } of runtime.frame.hooks) {
    const produced = hooks.onTick?.({ ...base, memory: memoryFor(runtime, partId) });
    if (produced) effects.push(...produced);
  }
  if (effects.length > 0) applyEffects(runtime, effects, state.tick);
}

/**
 * Dispatches the part-facing events raised during this tick, then clears them.
 *
 * Run after the tick's mechanics so a hook sees the state its trigger produced
 * — a PHASE SHIFT reacting to SHIELD_BROKEN should see a shield of zero, not
 * the value it had a microsecond before the hit landed.
 */
function dispatchPartEvents(
  state: MatchState,
  runtime: FrameRuntime,
  opponent: FrameRuntime,
  elapsed: number,
): void {
  if (runtime.pendingEvents.length === 0) return;
  if (runtime.frame.hooks.length === 0) {
    runtime.pendingEvents.length = 0;
    return;
  }

  const base = {
    self: toView(runtime, elapsed),
    opponent: toView(opponent, elapsed),
    tick: state.tick,
    distance: distanceBetween(runtime, opponent),
  };
  const effects: SimEffect[] = [];
  // Deduplicate: a frame hit four times in one tick raises TOOK_DAMAGE four
  // times, but a hook that reacts to being hit should fire once per tick.
  const seen = new Set(runtime.pendingEvents);
  for (const event of seen) {
    for (const { partId, hooks } of runtime.frame.hooks) {
      const produced = hooks.onEvent?.({
        ...base,
        memory: memoryFor(runtime, partId),
        event,
      });
      if (produced) effects.push(...produced);
    }
  }
  runtime.pendingEvents.length = 0;
  if (effects.length > 0) applyEffects(runtime, effects, state.tick);
}


function distanceBetween(a: FrameRuntime, b: FrameRuntime): number {
  const dx = a.position.x - b.position.x;
  const dy = a.position.y - b.position.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Fires every weapon that is ready, in range, and affordable. A volley resolves
 * all of its shots on the same tick — the intra-burst spacing is already priced
 * into `cycleTime`, so simulating each pellet on its own tick would double-count
 * it and make shotguns silently worse than their datasheet.
 */
function fireWeapons(state: MatchState, attacker: FrameRuntime, defender: FrameRuntime): void {
  const tick = state.tick;
  if (!canAct(attacker, tick) || !isAlive(defender)) return;
  if (attacker.action === 'VENT' && attacker.ventingUntil > tick) return;

  const focusType = attacker.action === 'FOCUS' ? weakestTypeAgainst(defender) : null;
  const cooldownMult = penaltiesFor(attacker.heatState).cooldown;

  for (const weapon of attacker.weapons) {
    const profile = weapon.def.profile;
    if (focusType !== null && profile.damageType !== focusType) continue;
    if (!canFire(attacker, weapon, state.arena, defender.position, tick)) continue;

    // Pay the costs once for the whole volley.
    attacker.energy -= profile.energyCost * profile.shots;
    addHeat(attacker, profile.heatCost * profile.shots);
    if (Number.isFinite(profile.magazine)) {
      weapon.ammo -= profile.shots;
      if (weapon.ammo <= 0) {
        weapon.ammo = 0;
        state.events.push({
          kind: 'AMMO_OUT',
          tick,
          frame: attacker.index,
          weapon: weapon.def.name,
        });
      }
    }
    weapon.readyAt = tick + Math.max(1, Math.round(weapon.def.cycleTime * cooldownMult * TICK_RATE));

    for (let shot = 0; shot < profile.shots; shot++) {
      const result = resolveShot(
        attacker,
        defender,
        weapon,
        state.arena,
        state.rng,
        tick,
        state.events,
      );
      state.events.push({
        kind: 'SHOT',
        tick,
        source: attacker.index,
        weapon: weapon.def.name,
        damageType: profile.damageType,
        from: attacker.position,
        to: defender.position,
        hit: result.hit,
        crit: result.crit,
        damage: result.structureDamage,
        shieldDamage: result.shieldDamage,
        mitigated: result.mitigated,
      });
      if (!isAlive(defender)) break;
    }
  }
}

/**
 * Which damage type this defender is currently least protected against.
 * Drives the `FOCUS` action: while their shield holds, ion and kinetic strip
 * it fastest; once it is down, the armour matrices decide.
 */
function weakestTypeAgainst(defender: FrameRuntime): 'KINETIC' | 'THERMAL' | 'ION' {
  if (defender.shield > 0) return 'ION';
  return defender.armour > 80 ? 'THERMAL' : 'KINETIC';
}

// ─────────────────────────────────────────────────────────────────────────────
// Victory — rulebook §12
// ─────────────────────────────────────────────────────────────────────────────

function checkVictory(state: MatchState): void {
  const [a, b] = state.frames;
  const aDead = !isAlive(a);
  const bDead = !isAlive(b);
  if (!aDead && !bDead) return;

  if (aDead) state.events.push({ kind: 'DESTROYED', tick: state.tick, frame: 0 });
  if (bDead) state.events.push({ kind: 'DESTROYED', tick: state.tick, frame: 1 });

  if (aDead && bDead) {
    finish(state, null, 'DOUBLE_KO', 'mutual destruction');
  } else {
    finish(state, aDead ? 1 : 0, 'DESTRUCTION', 'frame destroyed');
  }
}

/** Timeout is decided on damage ratio, so turtling can draw but never win. */
function finishByTimeout(state: MatchState): void {
  const [a, b] = state.frames;
  const scoreA = 1 - structureRatio(a);
  const scoreB = 1 - structureRatio(b);

  if (Math.abs(scoreA - scoreB) < STALEMATE_EPSILON) {
    finish(state, null, 'STALEMATE', 'time expired, damage even');
    return;
  }
  // The frame that *took* less damage wins: scoreB is damage dealt to B.
  finish(state, scoreB > scoreA ? 0 : 1, 'TIMEOUT', 'time expired, decided on damage');
}

function finish(
  state: MatchState,
  winner: FrameIndex | null,
  outcome: MatchOutcome,
  description: string,
): void {
  state.finished = true;
  state.winner = winner;
  state.outcome = outcome;
  state.events.push({ kind: 'MATCH_END', tick: state.tick, outcome: description, winner });
}

// ─────────────────────────────────────────────────────────────────────────────
// Reporting
// ─────────────────────────────────────────────────────────────────────────────

function buildResult(state: MatchState): MatchResult {
  return {
    winner: state.winner,
    outcome: state.outcome,
    ticks: state.tick,
    duration: state.tick * TICK,
    events: state.events,
    telemetry: [telemetryFor(state.frames[0]), telemetryFor(state.frames[1])],
    seed: state.seed,
    arenaId: state.arena.id,
  };
}

function telemetryFor(runtime: FrameRuntime): FrameTelemetry {
  const shotsFired = runtime.weapons.reduce((sum, w) => sum + w.shotsFired, 0);
  const shotsHit = runtime.weapons.reduce((sum, w) => sum + w.shotsHit, 0);
  return {
    name: runtime.frame.build.name,
    structureRemaining: Math.max(0, runtime.structure),
    structureRatio: Math.max(0, structureRatio(runtime)),
    damageDealt: runtime.damageDealt,
    damageTaken: runtime.damageTaken,
    shieldDamageDealt: runtime.shieldDamageDealt,
    armourRemaining: runtime.armour,
    overloadCount: runtime.overloadCount,
    secondsOverloaded: runtime.ticksOverloaded * TICK,
    secondsVenting: runtime.ticksVenting * TICK,
    peakHeatRatio: runtime.peakHeatRatio,
    accuracy: shotsFired > 0 ? shotsHit / shotsFired : 0,
    shotsFired,
    weapons: runtime.weapons.map((w) => ({
      name: w.def.name,
      shotsFired: w.shotsFired,
      shotsHit: w.shotsHit,
      damageDealt: w.damageDealt,
      ammoRemaining: w.ammo,
    })),
  };
}

/** Re-exported so callers can seed a match without importing core/rng. */
export type { Rng };
