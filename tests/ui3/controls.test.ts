/**
 * Control feel.
 *
 * The complaint that prompted these was simply "the controls are very bad",
 * and the largest cause was not in this file — it was that the camera followed
 * the machine's position but never its heading, so forward on the stick meant
 * a different direction on screen every second. What is covered here is the
 * rest of it: a resting thumb must not steer, leaving centre must not jump,
 * and steering must be quicker than the throttle.
 */

import { describe, expect, it } from 'vitest';
import { approach, shapeStick } from '../../src/ui3/controls';

describe('stick shaping', () => {
  it('treats small drift as centre', () => {
    // A thumb resting on a capacitive pad reports a few percent of movement.
    expect(shapeStick(0.05, 0.05)).toEqual({ x: 0, y: 0 });
    expect(shapeStick(0, 0.12)).toEqual({ x: 0, y: 0 });
  });

  it('starts from zero just past the dead zone rather than jumping', () => {
    const just = shapeStick(0, 0.17);
    expect(just.y).toBeGreaterThan(0);
    expect(just.y).toBeLessThan(0.06);
  });

  it('still reaches full travel at the edge', () => {
    expect(shapeStick(0, 1).y).toBeCloseTo(1, 5);
    expect(shapeStick(-1, 0).x).toBeCloseTo(-1, 5);
  });

  it('applies the dead zone radially, so diagonals are not favoured', () => {
    // Same distance from centre, different directions: same magnitude out.
    const d = Math.SQRT1_2;
    const diagonal = shapeStick(d * 0.6, d * 0.6);
    const straight = shapeStick(0, 0.6);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(Math.abs(straight.y), 5);
  });

  it('keeps the direction the thumb is pointing', () => {
    const shaped = shapeStick(0.6, 0.8);
    expect(shaped.x / shaped.y).toBeCloseTo(0.6 / 0.8, 5);
  });

  it('spends more travel on the slow half than a linear stick would', () => {
    // Half deflection should command less than half throttle.
    expect(shapeStick(0, 0.5).y).toBeLessThan(0.5);
  });
});

describe('ramping', () => {
  it('moves toward the target at the given rate', () => {
    expect(approach(0, 1, 0.1, 5, 5)).toBeCloseTo(0.5, 5);
  });

  it('snaps when the remaining distance is under one step', () => {
    expect(approach(0.98, 1, 0.1, 5, 5)).toBe(1);
  });

  it('returns to centre faster than it leaves it', () => {
    const out = approach(0, 1, 1 / 60, 7, 10);
    const back = 1 - approach(1, 0, 1 / 60, 7, 10);
    expect(back).toBeGreaterThan(out);
  });

  it('is symmetric about zero', () => {
    expect(approach(0, -1, 0.1, 5, 5)).toBeCloseTo(-approach(0, 1, 0.1, 5, 5), 5);
  });
});
