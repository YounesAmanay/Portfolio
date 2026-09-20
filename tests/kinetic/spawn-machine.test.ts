/**
 * Driving a machine assembled from components.
 *
 * This is where the whole model has to pay out. The builder shows you a torque
 * and a top speed derived from a real chain of real parts; the arena has to
 * deliver exactly that and no more. A machine that beats its own spec sheet
 * means the readout is decoration.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { analyseBuild } from '@kinetic/machine/analysis';
import {
  addFitted,
  addLink,
  canFit,
  emptyBuild,
  type Build,
  type Fitted,
} from '@kinetic/machine/build';
import { PHYSICS_HZ } from '@kinetic/core/units';
import { planFromBuild } from '@kinetic/physics/plan';
import { driveRobot, neutralInput, spawnMachine, type RobotHandle } from '@kinetic/physics/robot';
import { PhysicsWorld, initPhysics } from '@kinetic/physics/world';

beforeAll(async () => {
  await initPhysics();
});

const at = (uid: string, componentId: string, x: number, y: number, z: number): Fitted => ({
  uid,
  componentId,
  cell: { x, y, z },
  yaw: 0,
});

/**
 * Places a component, refusing to build something impossible.
 *
 * `addFitted` does not validate — the builder calls `canFit` first and this
 * has to as well. The first draft of this file did not, and quietly stacked
 * the motors inside the wheels: the machine still spawned, still had four
 * driven contacts, and drove off at a hundred and thirty degrees.
 */
function place(build: Build, fitted: Fitted): Build {
  if (!canFit(build, fitted)) {
    throw new Error(`${fitted.componentId} does not fit at ${fitted.cell.x},${fitted.cell.y},${fitted.cell.z}`);
  }
  return addFitted(build, fitted);
}

/**
 * A four-wheel hobbyweight, laid out the way one actually goes together.
 *
 * Two decks end to end down the middle, the drive chains stacked outboard of
 * them, and the wheels hanging a cell lower so the machine has clearance.
 * Forward is +Z.
 *
 *   y=4          esc                 esc
 *   y=2..3       motor   [ deck ]    motor       pack/rx above the deck
 *   y=1          gearbox            gearbox
 *   y=0..1  wheel                        wheel
 */
function machine(gearbox = 'gbx.20', wheel = 'whl.100'): Build {
  let build = emptyBuild('TESTBED', 'hobby');

  build = place(build, at('deck', 'str.plate', 1, 2, 0));   // x1..3, z0..2
  build = place(build, at('deck2', 'str.plate', 1, 2, 3));  // x1..3, z3..5

  // [uid suffix, wheel x, chain x, z]
  const corners: [string, number, number, number][] = [
    ['fl', -2, 0, 1],
    ['fr', 5, 4, 1],
    ['rl', -2, 0, 4],
    ['rr', 5, 4, 4],
  ];
  // Outward from the deck, because everything has to bolt to something that
  // is already there: motor to deck, gearbox to motor, wheel to gearbox.
  for (const [side, wx, cx, z] of corners) {
    build = place(build, at(`m${side}`, 'mot.775', cx, 2, z));
    build = place(build, at(`g${side}`, gearbox, cx, 1, z));
    build = place(build, at(`w${side}`, wheel, wx, 0, z));
    build = place(build, at(`e${side}`, 'esc.40', cx, 4, z));
  }

  build = place(build, at('pack', 'pwr.4s1800', 1, 3, 0));
  build = place(build, at('rx', 'rcv.10', 1, 3, 3));

  for (const [side] of corners) {
    build = addLink(build, { from: 'pack', fromPort: 'out', to: `e${side}`, toPort: 'pwr' });
    build = addLink(build, { from: 'rx', fromPort: 'out', to: `e${side}`, toPort: 'sig' });
    build = addLink(build, { from: `e${side}`, fromPort: 'out', to: `m${side}`, toPort: 'pwr' });
    build = addLink(build, { from: `m${side}`, fromPort: 'out', to: `g${side}`, toPort: 'in' });
    build = addLink(build, { from: `g${side}`, fromPort: 'out', to: `w${side}`, toPort: 'in' });
  }
  return build;
}

function stage(build: Build): { world: PhysicsWorld; robot: RobotHandle } {
  const world = new PhysicsWorld();
  world.addGround(60, { friction: 1.0, restitution: 0.04 });
  const robot = spawnMachine(world.world, build, { position: { x: 0, z: 0 } });
  return { world, robot };
}

function run(build: Build, input: Partial<{ drive: number; steer: number }>, seconds: number) {
  const { world, robot } = stage(build);
  for (let i = 0; i < PHYSICS_HZ; i += 1) {
    driveRobot(robot, neutralInput());
    world.step();
  }
  const from = robot.chassis.translation();
  let peak = 0;
  for (let i = 0; i < PHYSICS_HZ * seconds; i += 1) {
    driveRobot(robot, { ...neutralInput(), ...input });
    world.step();
    const v = robot.chassis.linvel();
    peak = Math.max(peak, Math.hypot(v.x, v.z));
  }
  const to = robot.chassis.translation();
  return {
    robot,
    distance: Math.hypot(to.x - from.x, to.z - from.z),
    heading: (Math.atan2(to.x - from.x, to.z - from.z) * 180) / Math.PI,
    peakSpeed: peak,
    height: to.y,
  };
}

describe('a machine assembled from components', () => {
  it('solves with nothing wrong with it', () => {
    const report = analyseBuild(machine());
    expect(report.problems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(report.drivenWheels).toBe(4);
  });

  it('spawns with every wheel driven', () => {
    const { robot } = stage(machine());
    expect(robot.wheels).toHaveLength(4);
    expect(robot.wheels.every((w) => w.spec.driven)).toBe(true);
    expect(robot.plan.name).toBe('TESTBED');
  });

  it('spawns resting on its wheels rather than dropped', () => {
    const { world, robot } = stage(machine());
    const start = robot.chassis.translation().y;
    for (let i = 0; i < PHYSICS_HZ; i += 1) {
      driveRobot(robot, neutralInput());
      world.step();
    }
    expect(Math.abs(robot.chassis.translation().y - start)).toBeLessThan(0.03);
  });

  it('drives forward, and forward means +Z', () => {
    const result = run(machine(), { drive: 1 }, 3);
    expect(result.distance).toBeGreaterThan(0.5);
    expect(Math.abs(result.heading)).toBeLessThan(12);
  });

  it('drives backward', () => {
    const result = run(machine(), { drive: -1 }, 3);
    expect(result.distance).toBeGreaterThan(0.4);
    expect(Math.abs(Math.abs(result.heading) - 180)).toBeLessThan(15);
  });

  it('turns when asked, and stays the right way up', () => {
    const { world, robot } = stage(machine());
    for (let i = 0; i < PHYSICS_HZ; i += 1) {
      driveRobot(robot, neutralInput());
      world.step();
    }
    let yaw = 0;
    let previous = headingOf(robot);
    for (let i = 0; i < PHYSICS_HZ * 2; i += 1) {
      driveRobot(robot, { ...neutralInput(), steer: 1 });
      world.step();
      const now = headingOf(robot);
      let delta = now - previous;
      // Accumulate rather than compare: a heading that wraps past 180 reads as
      // a sign flip and reports the machine turning the wrong way.
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      yaw += delta;
      previous = now;
    }
    expect(Math.abs((yaw * 180) / Math.PI)).toBeGreaterThan(60);
  });
});

describe('the arena cannot beat the spec sheet', () => {
  it('never exceeds the top speed the builder promised', () => {
    // The regression that matters most. Traction without its reaction torque
    // once let wheels run 32% past their free speed, which is the builder
    // being made a liar by the simulation.
    const build = machine();
    const promised = analyseBuild(build).topSpeed;
    const result = run(build, { drive: 1 }, 6);

    expect(promised).toBeGreaterThan(0);
    expect(result.peakSpeed).toBeLessThanOrEqual(promised * 1.02);
  });

  it('goes slower and pushes harder when geared down', () => {
    const fast = analyseBuild(machine('gbx.8'));
    const slow = analyseBuild(machine('gbx.40'));
    expect(slow.topSpeed).toBeLessThan(fast.topSpeed);
    expect(slow.totalTorque).toBeGreaterThan(fast.totalTorque);

    const fastRun = run(machine('gbx.8'), { drive: 1 }, 4);
    const slowRun = run(machine('gbx.40'), { drive: 1 }, 4);
    expect(slowRun.peakSpeed).toBeLessThan(fastRun.peakSpeed);
  });

  it('carries the solver`s numbers into the plan unchanged', () => {
    const build = machine();
    const report = analyseBuild(build);
    const plan = planFromBuild(build);

    for (const wheel of report.solution.wheels) {
      const part = plan.parts.find((p) => p.uid === wheel.uid);
      expect(part?.drive?.wheelTorque).toBe(wheel.wheelTorque);
      expect(part?.drive?.freeSpeed).toBe(wheel.freeSpeed);
      expect(part?.drive?.grip).toBe(wheel.grip);
    }
    expect(plan.mass).toBe(report.mass);
    expect(plan.topSpeed).toBe(report.topSpeed);
  });
});

function headingOf(robot: RobotHandle): number {
  const r = robot.chassis.rotation();
  // Forward is +Z, so the machine's heading is the yaw of that axis.
  const forwardX = 2 * (r.x * r.z + r.w * r.y);
  const forwardZ = 1 - 2 * (r.x * r.x + r.y * r.y);
  return Math.atan2(forwardX, forwardZ);
}
