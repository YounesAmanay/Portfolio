/**
 * Control feel.
 *
 * Touch input is now discrete held buttons — steering under the left thumb,
 * throttle under the right, the way every driving game on a phone lays it out.
 * The two-axis stick that used to live here made one thumb responsible for
 * both at once, so holding a throttle and correcting a line were the same
 * gesture and every turn came out as a swerve.
 *
 * What is left to test is the ramp, which is what turns a button that is
 * either down or up into a throttle with some weight to it.
 */

import { describe, expect, it } from 'vitest';
import { approach } from '../../src/ui3/controls';

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
