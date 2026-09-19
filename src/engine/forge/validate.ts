/**
 * Build validation — the four budgets.
 *
 * Returns a *report*, never throws and never returns a bare boolean. The Forge
 * shows every violation at once with the exact overage, because "invalid build"
 * with no number attached is the most frustrating message a builder tool can
 * give you.
 *
 * @see docs/01-rules.md §3
 */

import type { Build } from '../domain/build';
import { validateDoctrine } from '../domain/doctrine';
import { REQUIRED_SOCKETS, SOCKET_INFO, SOCKET_KINDS, type SocketKind } from '../domain/sockets';
import { EXPECTED_HIT_RATE } from '../tuning';
import type { CompiledFrame } from './compile';

/** Raw-output floor below which a build cannot realistically close a match. */
const RAW_DPS_FLOOR = 54 / EXPECTED_HIT_RATE;
import type { PartRegistry } from './registry';

export type BudgetKind = 'MASS' | 'POWER' | 'CYCLES' | 'SOCKETS' | 'DOCTRINE';

export interface BudgetReading {
  readonly kind: BudgetKind;
  readonly label: string;
  readonly used: number;
  readonly limit: number;
  readonly unit: string;
  readonly ok: boolean;
  /** Fraction of the limit consumed. May exceed 1 when over budget. */
  readonly ratio: number;
}

export interface Violation {
  readonly budget: BudgetKind;
  readonly message: string;
}

export interface ValidationReport {
  readonly valid: boolean;
  readonly budgets: readonly BudgetReading[];
  readonly violations: readonly Violation[];
  /** Non-blocking advice: legal builds that are probably mistakes. */
  readonly warnings: readonly string[];
}

export function validateBuild(frame: CompiledFrame, registry: PartRegistry): ValidationReport {
  const violations: Violation[] = [];
  const { stats, chassis, build } = frame;

  // ── B1 MASS ────────────────────────────────────────────────────────────────
  const massOk = stats.mass <= chassis.massLimit;
  if (!massOk) {
    violations.push({
      budget: 'MASS',
      message: `Over mass by ${round(stats.mass - chassis.massLimit)} kg. Chassis limit is ${chassis.massLimit} kg.`,
    });
  }

  // ── B2 POWER ───────────────────────────────────────────────────────────────
  const powerOutput = frame.powerSupply;
  const powerOk = frame.powerDraw <= powerOutput;
  if (!powerOk) {
    violations.push({
      budget: 'POWER',
      message: `Power draw ${round(frame.powerDraw)} PU exceeds core output ${round(powerOutput)} PU.`,
    });
  }

  // ── B3 CYCLES ──────────────────────────────────────────────────────────────
  const cycleOutput = frame.cycleSupply;
  const cyclesOk = frame.cycleDraw <= cycleOutput;
  if (!cyclesOk) {
    violations.push({
      budget: 'CYCLES',
      message:
        `Cycle draw ${round(frame.cycleDraw)} CY exceeds core output ${round(cycleOutput)} CY. ` +
        `Doctrine accounts for ${build.doctrine.rules.length * 2} CY of that.`,
    });
  }

  // ── B4 SOCKETS ─────────────────────────────────────────────────────────────
  const socketViolations = checkSockets(build, frame, registry);
  violations.push(...socketViolations);

  // ── Doctrine structure ─────────────────────────────────────────────────────
  for (const problem of validateDoctrine(build.doctrine)) {
    violations.push({ budget: 'DOCTRINE', message: problem });
  }

  const budgets: BudgetReading[] = [
    reading('MASS', 'Mass', stats.mass, chassis.massLimit, 'kg'),
    reading('POWER', 'Power', frame.powerDraw, powerOutput, 'PU'),
    reading('CYCLES', 'Cycles', frame.cycleDraw, cycleOutput, 'CY'),
  ];

  return {
    valid: violations.length === 0,
    budgets,
    violations,
    warnings: collectWarnings(frame),
  };
}

/**
 * Legal builds that are probably mistakes. These are the difference between a
 * validator and a *mentor* — every one of them encodes a lesson from the
 * balance model that a new Architect would otherwise learn by losing.
 */
function collectWarnings(frame: CompiledFrame): readonly string[] {
  const warnings: string[] = [];
  const { stats } = frame;

  if (frame.weapons.length === 0) {
    warnings.push('No weapons installed. This frame cannot win, only survive.');
  }

  const heatPressure = frame.weapons.reduce((sum, w) => sum + w.heatPressure, 0);
  const balance = heatPressure - stats.heatSink;
  if (balance > 10) {
    warnings.push(
      `Heat balance +${round(balance, 1)} hu/s — you overload in ${round(stats.heatCapacity / balance, 1)}s of sustained fire. Add cooling or a VENT rule.`,
    );
  } else if (balance > 4) {
    warnings.push(
      `Heat balance +${round(balance, 1)} hu/s. Sustainable only in bursts; doctrine must manage heat.`,
    );
  }

  for (const weapon of frame.weapons) {
    const throttle = weapon.effectiveCycle / weapon.cycleTime;
    if (throttle > 1.08) {
      warnings.push(
        `${weapon.name} is energy-throttled: firing every ${round(weapon.effectiveCycle, 2)}s instead of ${round(weapon.cycleTime, 2)}s (-${round((1 - 1 / throttle) * 100)}% damage). Raise energy regen.`,
      );
    }
  }

  if (stats.load > 0.95) {
    warnings.push(
      `Load ${round(stats.load * 100)}% — agility ${round(stats.agility, 2)}x. You are legal but slow and easy to hit.`,
    );
  }

  if (stats.armour < 40 && stats.shieldCapacity < 60) {
    warnings.push('Almost no mitigation. Every hit lands near full damage.');
  }

  // `sustainedDps` is raw output before hit chance. The balance model's 54 sp/s
  // target is post-hit-rate, so the comparable raw floor is 54 / 0.65 ~= 83.
  const dps = frame.weapons.reduce((sum, w) => sum + w.sustainedDps, 0);
  if (frame.weapons.length > 0 && dps < RAW_DPS_FLOOR) {
    warnings.push(
      `Sustained output ${round(dps, 1)} sp/s raw (~${round(dps * EXPECTED_HIT_RATE, 1)} after hit chance) is below the ~54 sp/s needed to win inside the time limit.`,
    );
  }

  return warnings;
}

function checkSockets(
  build: Build,
  frame: CompiledFrame,
  registry: PartRegistry,
): readonly Violation[] {
  const violations: Violation[] = [];

  for (const kind of SOCKET_KINDS) {
    const available = frame.chassis.sockets[kind] ?? 0;
    const slots = build.assignments[kind] ?? [];

    if (slots.length > available) {
      violations.push({
        budget: 'SOCKETS',
        message: `${SOCKET_INFO[kind].label}: ${slots.length} parts assigned but the chassis has ${available} socket(s).`,
      });
    }

    for (const id of slots) {
      if (id === null) continue;
      const part = registry.part(id);
      if (!part) {
        violations.push({ budget: 'SOCKETS', message: `Unknown part "${id}".` });
      } else if (part.socket !== kind) {
        violations.push({
          budget: 'SOCKETS',
          message: `${part.name} is a ${SOCKET_INFO[part.socket].label} part; it cannot go in a ${SOCKET_INFO[kind].label} socket.`,
        });
      }
    }
  }

  for (const kind of REQUIRED_SOCKETS) {
    const filled = (build.assignments[kind] ?? []).some((id) => id !== null);
    if (!filled) {
      violations.push({
        budget: 'SOCKETS',
        message: `${SOCKET_INFO[kind].label} socket is empty. A frame cannot deploy without one.`,
      });
    }
  }

  return violations;
}

function reading(
  kind: BudgetKind,
  label: string,
  used: number,
  limit: number,
  unit: string,
): BudgetReading {
  return {
    kind,
    label,
    used: round(used, 1),
    limit: round(limit, 1),
    unit,
    ok: used <= limit,
    ratio: limit > 0 ? used / limit : used > 0 ? Infinity : 0,
  };
}

function round(value: number, places = 0): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/** Socket kinds a chassis actually exposes, in display order. */
export function activeSockets(frame: CompiledFrame): readonly SocketKind[] {
  return SOCKET_KINDS.filter((kind) => (frame.chassis.sockets[kind] ?? 0) > 0);
}
