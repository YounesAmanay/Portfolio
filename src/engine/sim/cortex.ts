/**
 * The cortex — the doctrine interpreter.
 *
 * Named for the fiction (doctrine is compiled *into* a cortex) and to avoid
 * colliding with `domain/doctrine.ts`, which owns the vocabulary while this
 * file owns the execution.
 *
 * Rules are evaluated top-down and **the first match wins**. That single rule
 * is what turns doctrine authoring into a priority-ordering problem: easy to
 * teach, hard to master, and trivially debuggable because the reason a frame
 * did something is always "rule N fired".
 *
 * @see docs/01-rules.md §10
 */

import { CONDITION_INFO, type ActionKind, type DoctrineRule } from '../domain/doctrine';
import { TICK } from '../tuning';
import type { SimEvent } from './events';
import {
  energyRatio,
  heatRatio,
  isOverloaded,
  isVenting,
  structureRatio,
  type FrameRuntime,
} from './state';
import { separation } from './movement';

export interface Decision {
  readonly action: ActionKind;
  /** Human-readable justification, e.g. "rule 2: enemy overloaded". */
  readonly reason: string;
}

/** Fallback when a doctrine somehow has no terminal rule. Should be unreachable. */
const DEFAULT_DECISION: Decision = { action: 'ENGAGE', reason: 'default' };

/**
 * Picks this frame's action. Pure with respect to match state — it reads, it
 * never writes — so it can be unit-tested against synthetic states and reused
 * by the Doctrine editor to preview which rule would fire.
 */
export function decide(runtime: FrameRuntime, opponent: FrameRuntime, tick: number): Decision {
  const rules = runtime.frame.doctrine.rules;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (!rule) continue;
    if (matches(rule, runtime, opponent, tick)) {
      const action = legalise(rule.action, runtime, tick);
      return { action, reason: `rule ${i + 1}: ${describe(rule)}` };
    }
  }
  return DEFAULT_DECISION;
}

/**
 * Some actions are situationally impossible. Rather than letting a frame stand
 * there doing nothing — which would look like a bug and feel like one — an
 * illegal action degrades to the nearest sensible alternative.
 */
function legalise(action: ActionKind, runtime: FrameRuntime, tick: number): ActionKind {
  if (action === 'VENT') {
    const cannotVent = isOverloaded(runtime) || tick < runtime.ventReadyAt;
    if (cannotVent) return 'KITE';
  }
  return action;
}

function matches(
  rule: DoctrineRule,
  self: FrameRuntime,
  enemy: FrameRuntime,
  tick: number,
): boolean {
  const p = rule.parameter ?? 0;

  switch (rule.condition) {
    case 'ALWAYS':
      return true;
    case 'SELF_HEAT_ABOVE':
      return heatRatio(self) > p;
    case 'SELF_HEAT_BELOW':
      return heatRatio(self) < p;
    case 'SELF_STRUCTURE_BELOW':
      return structureRatio(self) < p;
    case 'SELF_SHIELD_DOWN':
      return self.shield <= 0;
    case 'SELF_ENERGY_BELOW':
      return energyRatio(self) < p;
    case 'ENEMY_WITHIN':
      return separation(self, enemy) < p;
    case 'ENEMY_BEYOND':
      return separation(self, enemy) > p;
    case 'ENEMY_STRUCTURE_BELOW':
      return structureRatio(enemy) < p;
    case 'ENEMY_OVERLOADED':
      return isOverloaded(enemy);
    case 'ENEMY_SHIELD_UP':
      return enemy.shield > 0;
    case 'TIME_AFTER':
      return tick * TICK > p;
    case 'AMMO_BELOW':
      return hasLowAmmo(self, p);
  }
}

/** True if any finite-magazine weapon has dropped below the given fraction. */
function hasLowAmmo(runtime: FrameRuntime, fraction: number): boolean {
  for (const weapon of runtime.weapons) {
    const magazine = weapon.def.profile.magazine;
    if (!Number.isFinite(magazine) || magazine <= 0) continue;
    if (weapon.ammo / magazine < fraction) return true;
  }
  return false;
}

function describe(rule: DoctrineRule): string {
  const info = CONDITION_INFO[rule.condition];
  return info.parameter === 'none'
    ? info.label.toLowerCase()
    : `${info.label.toLowerCase()} ${rule.parameter ?? 0}`;
}

/**
 * Applies a decision to the runtime, starting a vent if that is what the
 * doctrine asked for. Separated from `decide` so the decision itself stays
 * pure and testable.
 */
export function applyDecision(
  runtime: FrameRuntime,
  decision: Decision,
  tick: number,
  events: SimEvent[],
  ventDurationTicks: number,
  ventCooldownTicks: number,
): void {
  const changed = runtime.action !== decision.action;
  runtime.action = decision.action;
  runtime.actionReason = decision.reason;

  if (decision.action === 'VENT' && !isVenting(runtime, tick) && tick >= runtime.ventReadyAt) {
    runtime.ventingUntil = tick + ventDurationTicks;
    runtime.ventReadyAt = tick + ventDurationTicks + ventCooldownTicks;
    events.push({ kind: 'VENT_START', tick, frame: runtime.index });
  }

  if (changed) {
    events.push({
      kind: 'ACTION',
      tick,
      frame: runtime.index,
      action: decision.action,
      reason: decision.reason,
    });
  }
}
