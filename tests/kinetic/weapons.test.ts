/**
 * Do the weapons do anything?
 *
 * They did not. Measured on the code as it stood: a spinner held 0.0 rad/s of
 * its rated 628 through eight seconds at full throttle, and neither the hammer
 * nor the flipper had a body at all — firing applied an impulse to the
 * machine's own centre of mass, upward for a flipper and downward for a hammer,
 * so a flipper threw *itself* twelve metres into the air and never touched the
 * opponent. Every weapon in the game was inert, and nothing failed.
 *
 * These tests are the ones that would have caught it.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { addPlacement, canPlace, newUid, type Design } from '@kinetic/assembly/design';
import { SCOUT } from '@kinetic/content/presets';
import { PHYSICS_HZ } from '@kinetic/core/units';
import { FLIPPER_STRIKE, HAMMER_REST, HAMMER_STRIKE } from '@kinetic/core/tuning';
import { driveRobot, neutralInput, spawnRobot, type RobotHandle } from '@kinetic/physics/robot';
import { PhysicsWorld, initPhysics } from '@kinetic/physics/world';
import { requirePart } from '@kinetic/parts/library';

beforeAll(async () => {
  await initPhysics();
});

/**
 * Bolts a weapon onto SCOUT, high up.
 *
 * Height matters and is not a detail: a spinner mounted at floor level buries
 * its swept circle below the ground, where it grinds to a halt and reads as a
 * broken motor. Found the hard way while writing these.
 */
function armed(partId: string): Design {
  for (let y = 6; y >= 3; y -= 1) {
    for (let x = -6; x <= 10; x += 1) {
      for (let z = -8; z <= 12; z += 1) {
        const candidate = { uid: newUid(), partId, cell: { x, y, z }, yaw: 0 as const };
        if (canPlace(SCOUT, candidate)) return addPlacement(SCOUT, candidate);
      }
    }
  }
  throw new Error(`nowhere to mount ${partId}`);
}

function stage(design: Design): { world: PhysicsWorld; robot: RobotHandle } {
  const world = new PhysicsWorld();
  world.addGround(60, { friction: 1.0, restitution: 0.04 });
  const robot = spawnRobot(world.world, design, { position: { x: 0, z: 0 } });
  return { world, robot };
}

function settle(world: PhysicsWorld, robot: RobotHandle, seconds = 1): void {
  for (let i = 0; i < PHYSICS_HZ * seconds; i += 1) {
    driveRobot(robot, neutralInput());
    world.step();
  }
}

function hold(world: PhysicsWorld, robot: RobotHandle, seconds: number): void {
  for (let i = 0; i < PHYSICS_HZ * seconds; i += 1) {
    driveRobot(robot, { ...neutralInput(), weapon: 1 });
    world.step();
  }
}

/** The arm's angle about its hinge, read from the two bodies' relative rotation. */
function armAngle(robot: RobotHandle): number {
  const weapon = robot.weapons[0];
  const body = weapon?.body;
  if (!weapon || !body) return 0;
  const c = robot.chassis.rotation();
  const b = body.rotation();
  const inv = { x: -c.x, y: -c.y, z: -c.z, w: c.w };
  const rel = {
    w: inv.w * b.w - inv.x * b.x - inv.y * b.y - inv.z * b.z,
    x: inv.w * b.x + inv.x * b.w + inv.y * b.z - inv.z * b.y,
  };
  return 2 * Math.atan2(rel.x, rel.w);
}

describe('spinners', () => {
  it('actually turn', () => {
    const { world, robot } = stage(armed('wpn.disc'));
    settle(world, robot);
    hold(world, robot, 3);
    expect(robot.weapons[0]?.spin ?? 0).toBeGreaterThan(100);
  });

  it('spin up along the curve their rated torque and inertia imply', () => {
    // A DC motor driving a flywheel approaches its free speed exponentially,
    // with a time constant of I*w_free/torque. For the disc that is
    // 0.028 * 628 / 2.2 = 8.0 s, so three seconds should reach about 31%.
    const spec = requirePart('wpn.disc').weapon;
    expect(spec?.inertia).toBeDefined();
    expect(spec?.maxSpin).toBeDefined();

    const tau = (spec!.inertia! * spec!.maxSpin!) / spec!.drive;
    const expected = spec!.maxSpin! * (1 - Math.exp(-3 / tau));

    const { world, robot } = stage(armed('wpn.disc'));
    settle(world, robot);
    hold(world, robot, 3);

    const measured = robot.weapons[0]?.spin ?? 0;
    // Within 20%: the machine is on the ground and the chassis takes some of
    // the reaction, so this is not a frictionless bench.
    expect(measured).toBeGreaterThan(expected * 0.8);
    expect(measured).toBeLessThan(expected * 1.2);
  });

  it('are slowed by their own declared inertia, not by their collider shape', () => {
    // The swept-cylinder collider implies roughly three times the declared
    // inertia. If the shape were driving the simulation, spin-up would be that
    // much slower and the builder's stored-energy readout would be a fiction.
    const { world, robot } = stage(armed('wpn.disc'));
    settle(world, robot);
    hold(world, robot, 1);
    const spec = requirePart('wpn.disc').weapon!;
    const oneSecond = spec.maxSpin! * (1 - Math.exp(-spec.drive / (spec.inertia! * spec.maxSpin!)));
    expect(robot.weapons[0]?.spin ?? 0).toBeGreaterThan(oneSecond * 0.7);
  });

  it('do not turn when the trigger is released', () => {
    const { world, robot } = stage(armed('wpn.disc'));
    settle(world, robot);
    settle(world, robot, 2);
    expect(robot.weapons[0]?.spin ?? 0).toBeLessThan(1);
  });
});

describe('arms', () => {
  it('a hammer rests cocked and swings through to its strike angle', () => {
    const { world, robot } = stage(armed('wpn.hammer'));
    settle(world, robot);
    expect(armAngle(robot)).toBeCloseTo(HAMMER_REST, 1);

    // Long enough to strike, not long enough to have returned.
    for (let i = 0; i < 12; i += 1) {
      driveRobot(robot, { ...neutralInput(), weapon: 1 });
      world.step();
    }
    expect(armAngle(robot)).toBeGreaterThan(HAMMER_REST + 1);
    expect(armAngle(robot)).toBeLessThanOrEqual(HAMMER_STRIKE + 0.1);
  });

  it('a flipper throws its plate up and comes back down', () => {
    const { world, robot } = stage(armed('wpn.flipper'));
    settle(world, robot);
    expect(armAngle(robot)).toBeCloseTo(0, 1);

    for (let i = 0; i < 12; i += 1) {
      driveRobot(robot, { ...neutralInput(), weapon: 1 });
      world.step();
    }
    expect(armAngle(robot)).toBeGreaterThan(FLIPPER_STRIKE * 0.7);

    hold(world, robot, 3);
    expect(armAngle(robot)).toBeLessThan(0.3);
  });

  it('run a full cycle and become ready again', () => {
    const { world, robot } = stage(armed('wpn.hammer'));
    settle(world, robot);
    const weapon = robot.weapons[0]!;

    const seen = new Set<string>([weapon.phase]);
    for (let i = 0; i < PHYSICS_HZ * 3; i += 1) {
      driveRobot(robot, { ...neutralInput(), weapon: 1 });
      world.step();
      seen.add(weapon.phase);
    }
    expect([...seen].sort()).toEqual(['DWELL', 'READY', 'RELOADING', 'RETURNING', 'STRIKING']);
  });

  it('does not launch the machine that fired it', () => {
    // The regression this whole file exists for. A flipper used to apply its
    // impulse to its own chassis: measured, the firer rose 12.3 m and the
    // target rose 0.16 m, which is to say the weapon hit nobody but its owner.
    const { world, robot } = stage(armed('wpn.flipper'));
    settle(world, robot);
    const before = robot.chassis.translation().y;

    let peak = before;
    for (let i = 0; i < PHYSICS_HZ * 3; i += 1) {
      driveRobot(robot, { ...neutralInput(), weapon: 1 });
      world.step();
      peak = Math.max(peak, robot.chassis.translation().y);
    }
    // A hard flipper firing against the floor does lift its own machine a
    // little, and should. Twelve metres is not a little.
    expect(peak - before).toBeLessThan(1.0);
  });
});

describe('hitting things', () => {
  it('a hammer delivers momentum to what it lands on', () => {
    const { world, robot } = stage(armed('wpn.hammer'));
    settle(world, robot);

    const weapon = robot.weapons[0]!;
    const head = weapon.body!.translation();

    // A loose block parked directly under the arc, rather than a whole machine:
    // this measures the weapon, not the pathfinding.
    const target = world.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(head.x, head.y - 0.06, head.z + 0.16).setCanSleep(false),
    );
    world.world.createCollider(RAPIER.ColliderDesc.cuboid(0.09, 0.05, 0.09).setMass(0.4), target);

    for (let i = 0; i < 6; i += 1) world.step();
    const restVelocity = Math.abs(target.linvel().y);

    let struck = 0;
    for (let i = 0; i < PHYSICS_HZ; i += 1) {
      driveRobot(robot, { ...neutralInput(), weapon: 1 });
      world.step();
      struck = Math.max(struck, Math.hypot(target.linvel().x, target.linvel().y, target.linvel().z));
    }
    expect(struck).toBeGreaterThan(restVelocity + 0.5);
  });
});
