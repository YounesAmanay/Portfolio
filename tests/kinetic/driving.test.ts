/**
 * Does the machine go where you point it?
 *
 * It did not, and every part of the answer was measurable. Forward and reverse
 * worked; steering did not, in three separate ways at once.
 *
 * `lateralGrip` was declared on every drive part in the library and read by
 * nothing, so every tyre had full grip sideways and a machine with no steered
 * axle physically could not scrub round. Asked to turn, all four motors stalled
 * against their own tyres at 40-55 C while the machine lurched about on
 * whatever the contact solver happened to do — the pivot direction was not even
 * consistent between runs.
 *
 * With the tyres fixed, the open differential asked both sides for full
 * opposite lock, which is kinematically correct and undrivable: a tap of
 * steering spun SCOUT at 890 deg/s, two and a half revolutions per second, and
 * every machine span at a different rate so nothing transferred between them.
 *
 * Yaw is accumulated continuously in these tests rather than read as a bearing.
 * A fast pivot passes 180 degrees inside the measurement window, and a wrapped
 * reading then looks exactly like a turn in the opposite direction — which sent
 * the first diagnosis of this chasing a sign error that was never there.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { analyse } from '@kinetic/assembly/analysis';
import type { Design } from '@kinetic/assembly/design';
import { PRESETS, SCOUT } from '@kinetic/content/presets';
import { PHYSICS_HZ } from '@kinetic/core/units';
import { driveRobot, neutralInput, spawnRobot, type ControlInput } from '@kinetic/physics/robot';
import { PhysicsWorld, initPhysics } from '@kinetic/physics/world';

beforeAll(async () => {
  await initPhysics();
});

const DEG = 180 / Math.PI;

function bearing(q: { x: number; y: number; z: number; w: number }): number {
  return Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)) * DEG;
}

function shortest(delta: number): number {
  let d = delta;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

interface Run {
  /** Ground distance covered, metres. */
  readonly distance: number;
  /** Direction of travel relative to the machine's starting heading, degrees. */
  readonly travel: number;
  /** Total rotation, accumulated rather than wrapped, degrees. */
  readonly turned: number;
}

function drive(design: Design, input: Partial<ControlInput>, seconds = 3): Run {
  const world = new PhysicsWorld();
  world.addGround(120, { friction: 1.0, restitution: 0.05 });
  const robot = spawnRobot(world.world, design, { position: { x: 0, z: 0 } });

  for (let i = 0; i < PHYSICS_HZ / 2; i += 1) {
    driveRobot(robot, neutralInput());
    world.step();
  }

  const start = robot.chassis.translation();
  const startHeading = bearing(robot.chassis.rotation());
  let previous = startHeading;
  let turned = 0;

  const command: ControlInput = { ...neutralInput(), ...input };
  for (let i = 0; i < PHYSICS_HZ * seconds; i += 1) {
    driveRobot(robot, command);
    world.step();
    const now = bearing(robot.chassis.rotation());
    turned += shortest(now - previous);
    previous = now;
  }

  const end = robot.chassis.translation();
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  return {
    distance: Math.hypot(dx, dz),
    travel: shortest(Math.atan2(dx, dz) * DEG - startHeading),
    turned,
  };
}

describe('straight line', () => {
  it.each(PRESETS.map((d) => [d.name, d] as const))('%s drives forward, not sideways', (_n, design) => {
    const run = drive(design, { drive: 1 });
    expect(run.distance).toBeGreaterThan(4);
    // Travel within 20 degrees of dead ahead, and barely any rotation.
    expect(Math.abs(run.travel)).toBeLessThan(20);
    expect(Math.abs(run.turned)).toBeLessThan(25);
  });

  it.each(PRESETS.map((d) => [d.name, d] as const))('%s reverses in a straight line', (_n, design) => {
    const run = drive(design, { drive: -1 });
    expect(run.distance).toBeGreaterThan(3);
    expect(Math.abs(Math.abs(run.travel) - 180)).toBeLessThan(20);
    expect(Math.abs(run.turned)).toBeLessThan(25);
  });

  it('does not outrun the top speed the builder promises', () => {
    // The tyre model applies traction the collider is not carrying, and an
    // earlier version of it applied the force without the matching reaction
    // torque on the wheel. That is a rocket, not a tyre: the wheels ran 32%
    // past their rated free speed and the machine beat its own spec sheet.
    const predicted = analyse(SCOUT).topSpeed;
    expect(drive(SCOUT, { drive: 1 }, 4).distance / 4).toBeLessThan(predicted);
  });
});

describe('turning', () => {
  it.each(PRESETS.map((d) => [d.name, d] as const))('%s turns right on right', (_n, design) => {
    expect(drive(design, { steer: 1 }).turned).toBeGreaterThan(60);
  });

  it.each(PRESETS.map((d) => [d.name, d] as const))('%s turns left on left', (_n, design) => {
    expect(drive(design, { steer: -1 }).turned).toBeLessThan(-60);
  });

  it('pivots on the spot rather than wandering off', () => {
    // Skid-steer, so some scrub is expected; a machine is about half a metre
    // long and this used to be four metres.
    for (const design of PRESETS) {
      expect(drive(design, { steer: 1 }).distance, design.name).toBeLessThan(1.5);
    }
  });

  it('turns at a rate a player can learn, on every machine', () => {
    // The open differential span these at 890, 790 and 491 deg/s. Closed loop
    // on yaw rate, they all sit in the same band, so what you learn driving one
    // machine is worth something on the next.
    const rates = PRESETS.map((d) => Math.abs(drive(d, { steer: 1 }).turned) / 3);
    for (const rate of rates) {
      expect(rate).toBeGreaterThan(40);
      expect(rate).toBeLessThan(200);
    }
    // Fastest to slowest within a factor of four, against a factor of 1.8 in
    // their top speeds — machines still differ, but not wildly.
    expect(Math.max(...rates) / Math.min(...rates)).toBeLessThan(4);
  });

  it('arcs when driving and steering together, instead of spinning or ploughing', () => {
    const run = drive(SCOUT, { drive: 1, steer: 1 });
    // It must cover ground — clipping the differential at full throttle left
    // the inner wheels merely coasting and the machine ploughed round an arc
    // eight metres across.
    expect(run.distance).toBeGreaterThan(2.5);
    // And it must actually turn, rather than pivoting on the spot.
    expect(Math.abs(run.turned)).toBeGreaterThan(45);
  });
});

describe('tyres', () => {
  it('grip more along the roll than across it', () => {
    // The mechanism the whole thing rests on. Without this gap a skid-steer
    // machine cannot turn at all.
    const world = new PhysicsWorld();
    world.addGround(60, { friction: 1.0, restitution: 0.05 });
    const robot = spawnRobot(world.world, SCOUT, { position: { x: 0, z: 0 } });
    for (const wheel of robot.wheels) {
      expect(wheel.spec.lateralGrip).toBeLessThan(wheel.spec.grip);
    }
  });
});
