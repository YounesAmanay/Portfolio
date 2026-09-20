/**
 * A simple opponent.
 *
 * Deliberately not clever. It closes, it turns toward you, it swings whatever
 * it is carrying, and it backs off when it is stuck. A better opponent would
 * make the physics harder to read, and reading the physics is the point.
 *
 * It uses the same `ControlInput` a human produces, so nothing about the
 * machine changes when a person takes over.
 */

import { clamp } from '../kinetic/core/units';
import {
  isInverted,
  neutralInput,
  robotForward,
  robotSpeed,
  type ControlInput,
  type RobotHandle,
} from '../kinetic/physics/robot';

const stuckTimers = new WeakMap<RobotHandle, number>();

export function simpleAutopilot(self: RobotHandle, target: RobotHandle): ControlInput {
  const input = neutralInput();
  if (!self.alive) return input;

  const a = self.chassis.translation();
  const b = target.chassis.translation();
  const toTarget = { x: b.x - a.x, z: b.z - a.z };
  const distance = Math.hypot(toTarget.x, toTarget.z);
  if (distance < 0.001) return input;

  const forward = robotForward(self);
  // Signed angle between facing and the direction to the target, via the cross
  // product's vertical component — no trig needed inside the loop.
  const cross = forward.x * toTarget.z - forward.z * toTarget.x;
  const dot = (forward.x * toTarget.x + forward.z * toTarget.z) / distance;

  input.steer = clamp((cross / distance) * 1.8, -1, 1);
  // Only drive forward once roughly pointed the right way, so it does not
  // circle its target forever.
  input.drive = dot > 0.2 ? clamp(0.55 + dot * 0.45, 0, 1) : 0.15;
  input.weapon = distance < 4 ? 1 : 0.35;   // keep a spinner wound up

  // Inverted or wedged: reverse out and turn hard.
  const stuck = (stuckTimers.get(self) ?? 0) + (robotSpeed(self) < 0.35 ? 1 : -2);
  stuckTimers.set(self, Math.max(0, Math.min(180, stuck)));
  if (stuck > 90 || isInverted(self)) {
    input.drive = -0.8;
    input.steer = 1;
  }

  return input;
}
