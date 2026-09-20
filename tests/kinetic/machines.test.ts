/**
 * The presets, as machines rather than as shapes.
 *
 * Each has to be something a person could actually have built: one connected
 * assembly, inside its weight class, with both chains complete and nothing the
 * builder would refuse. They are the first thing a new player opens, so a
 * preset carrying an error teaches the wrong lesson on contact.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { analyseBuild } from '@kinetic/machine/analysis';
import { assemblies } from '@kinetic/machine/build';
import { MACHINES } from '@kinetic/content/machines';
import { PHYSICS_HZ } from '@kinetic/core/units';
import { driveRobot, isInverted, neutralInput, spawnMachine } from '@kinetic/physics/robot';
import { PhysicsWorld, initPhysics } from '@kinetic/physics/world';

describe.each(MACHINES.map((m) => [m.name, m] as const))('%s', (_name, build) => {
  const report = analyseBuild(build);

  it('is one machine, not several sharing a save file', () => {
    expect(assemblies(build)).toHaveLength(1);
  });

  it('has nothing wrong with it', () => {
    expect(report.problems.filter((p) => p.severity === 'error').map((p) => p.message)).toEqual([]);
  });

  it('fits its weight class with room to spare', () => {
    expect(report.massMargin).toBeGreaterThan(0);
    expect(report.mass).toBeLessThanOrEqual(report.weightClass.limit);
  });

  it('drives', () => {
    expect(report.drivenWheels).toBeGreaterThanOrEqual(2);
    expect(report.topSpeed).toBeGreaterThan(0.5);
    expect(report.totalTorque).toBeGreaterThan(0);
  });

  it('stands on its own wheels', () => {
    expect(report.contacts.length).toBeGreaterThanOrEqual(3);
    expect(report.groundClearance).toBeGreaterThan(0);
    expect(report.tipG).toBeGreaterThan(0.35);
  });

  it('can supply what it can pull', () => {
    expect(report.solution.sag).toBe(1);
  });

  it('has a receiver channel for everything wired to it', () => {
    expect(report.channelsUsed).toBeLessThanOrEqual(report.channelsAvailable);
  });
});

describe('every preset is deployable', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it.each(MACHINES.map((m) => [m.name, m] as const))('%s drives and stays upright', (_name, build) => {
    const world = new PhysicsWorld();
    world.addGround(60, { friction: 1.0, restitution: 0.04 });
    const robot = spawnMachine(world.world, build, { position: { x: 0, z: 0 } });

    for (let i = 0; i < PHYSICS_HZ; i += 1) {
      driveRobot(robot, neutralInput());
      world.step();
    }
    const from = robot.chassis.translation();

    let peak = 0;
    for (let i = 0; i < PHYSICS_HZ * 4; i += 1) {
      driveRobot(robot, { ...neutralInput(), drive: 1 });
      world.step();
      const v = robot.chassis.linvel();
      peak = Math.max(peak, Math.hypot(v.x, v.z));
    }
    const to = robot.chassis.translation();

    const distance = Math.hypot(to.x - from.x, to.z - from.z);
    const heading = (Math.atan2(to.x - from.x, to.z - from.z) * 180) / Math.PI;

    expect(distance).toBeGreaterThan(0.5);
    expect(Math.abs(heading), 'drives forward, not sideways').toBeLessThan(20);
    expect(isInverted(robot), 'still the right way up').toBe(false);
    // The arena may not beat what the builder promised.
    expect(peak).toBeLessThanOrEqual(analyseBuild(build).topSpeed * 1.02);
  });

  it.each(MACHINES.map((m) => [m.name, m] as const))('%s turns both ways', (_name, build) => {
    for (const steer of [1, -1]) {
      const world = new PhysicsWorld();
      world.addGround(60, { friction: 1.0, restitution: 0.04 });
      const robot = spawnMachine(world.world, build, { position: { x: 0, z: 0 } });
      for (let i = 0; i < PHYSICS_HZ; i += 1) {
        driveRobot(robot, neutralInput());
        world.step();
      }

      let yaw = 0;
      let previous = headingOf(robot);
      for (let i = 0; i < PHYSICS_HZ * 2; i += 1) {
        driveRobot(robot, { ...neutralInput(), steer });
        world.step();
        const now = headingOf(robot);
        let delta = now - previous;
        // Accumulated, not compared: a heading wrapping past 180 reads as a
        // sign flip and reports the machine turning the wrong way.
        if (delta > Math.PI) delta -= 2 * Math.PI;
        if (delta < -Math.PI) delta += 2 * Math.PI;
        yaw += delta;
        previous = now;
      }
      const degrees = (yaw * 180) / Math.PI;
      expect(Math.sign(degrees), `steer ${steer} turns that way`).toBe(steer);
      expect(Math.abs(degrees)).toBeGreaterThan(45);
    }
  });
});

function headingOf(robot: ReturnType<typeof spawnMachine>): number {
  const r = robot.chassis.rotation();
  const forwardX = 2 * (r.x * r.z + r.w * r.y);
  const forwardZ = 1 - 2 * (r.x * r.x + r.y * r.y);
  return Math.atan2(forwardX, forwardZ);
}
