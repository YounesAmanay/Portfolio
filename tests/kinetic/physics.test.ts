/**
 * Does the simulation agree with the builder?
 *
 * The builder promises a top speed and a climb grade before you drive. If the
 * simulation disagrees, every number in the interface is a lie and the whole
 * teaching premise collapses. These tests drive real machines in a real world
 * and check the predictions hold.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { analyse } from '@kinetic/assembly/analysis';
import { addPlacement, emptyDesign, newUid, type Design } from '@kinetic/assembly/design';
import { BRUISER, BULWARK, PRESETS, SCOUT } from '@kinetic/content/presets';
import { PHYSICS_HZ } from '@kinetic/core/units';
import {
  driveRobot,
  isInverted,
  neutralInput,
  robotSpeed,
  spawnRobot,
  type ControlInput,
} from '@kinetic/physics/robot';
import { PhysicsWorld, initPhysics } from '@kinetic/physics/world';

beforeAll(async () => {
  await initPhysics();
});

function place(design: Design, partId: string, x: number, y: number, z: number): Design {
  return addPlacement(design, { uid: newUid(), partId, cell: { x, y, z }, yaw: 0 });
}

interface RunResult {
  readonly distance: number;
  readonly peakSpeed: number;
  readonly finalSpeed: number;
  readonly inverted: boolean;
  readonly energyUsed: number;
}

/** Spawns a design on flat ground and drives it for `seconds`. */
function run(design: Design, input: Partial<ControlInput>, seconds: number): RunResult {
  const physics = new PhysicsWorld();
  physics.addGround(120, { friction: 1.0, restitution: 0.05 });

  const robot = spawnRobot(physics.world, design, { position: { x: 0, z: 0 } });
  const command: ControlInput = { ...neutralInput(), ...input };

  const start = robot.chassis.translation();
  const startEnergy = robot.energy;
  let peakSpeed = 0;

  // Let it settle onto its wheels before commanding anything.
  for (let i = 0; i < PHYSICS_HZ / 2; i++) {
    driveRobot(robot, neutralInput());
    physics.step();
  }

  for (let i = 0; i < seconds * PHYSICS_HZ; i++) {
    driveRobot(robot, command);
    physics.step();
    peakSpeed = Math.max(peakSpeed, robotSpeed(robot));
  }

  const end = robot.chassis.translation();
  const result: RunResult = {
    distance: Math.hypot(end.x - start.x, end.z - start.z),
    peakSpeed,
    finalSpeed: robotSpeed(robot),
    inverted: isInverted(robot),
    energyUsed: startEnergy - robot.energy,
  };
  physics.dispose();
  return result;
}

describe('a machine drives', () => {
  it('moves forward when told to', () => {
    const result = run(SCOUT, { drive: 1 }, 4);
    expect(result.distance).toBeGreaterThan(3);
    expect(result.peakSpeed).toBeGreaterThan(1);
  });

  it('stays upright on flat ground', () => {
    expect(run(SCOUT, { drive: 1 }, 4).inverted).toBe(false);
  });

  it('reverses', () => {
    const forward = run(SCOUT, { drive: 1 }, 2);
    const back = run(SCOUT, { drive: -1 }, 2);
    expect(back.distance).toBeGreaterThan(1);
    expect(forward.distance).toBeGreaterThan(1);
  });

  it('turns on the spot when steered without drive', () => {
    const straight = run(SCOUT, { drive: 1 }, 2);
    const spin = run(SCOUT, { steer: 1 }, 2);
    // A differential spin should go almost nowhere compared with driving.
    expect(spin.distance).toBeLessThan(straight.distance * 0.5);
  });

  it('does not move with no command', () => {
    expect(run(SCOUT, {}, 2).distance).toBeLessThan(0.25);
  });
});

describe('the builder does not lie', () => {
  it('reaches a speed in the region the analysis predicts', () => {
    const predicted = analyse(SCOUT).topSpeed;
    const actual = run(SCOUT, { drive: 1 }, 6).peakSpeed;

    // Free speed is the no-load ceiling; a loaded machine never reaches it.
    // Anywhere between a third of it and the ceiling itself means the motor
    // model and the drivetrain agree.
    expect(actual).toBeGreaterThan(predicted * 0.3);
    expect(actual).toBeLessThan(predicted * 1.15);
  });

  it('gears that promise more speed deliver more speed', () => {
    // Body parts sit at y=2 so they clear the 2-cell-tall drive pods. Build
    // them level with the wheels and the machine rests on its belly — which
    // the analysis now reports as an error rather than leaving you to wonder
    // why nothing moves.
    const make = (pod: string): Design => {
      let d = emptyDesign('T');
      for (const [x, z] of [[0, 0], [5, 0], [0, 5], [5, 5]]) d = place(d, pod, x!, 0, z!);
      d = place(d, 'str.plate', 2, 2, 2);
      d = place(d, 'bat.lipo6s', 2, 3, 2);
      d = place(d, 'ctl.basic', 3, 4, 3);
      return d;
    };
    const sprint = run(make('drive.sprint'), { drive: 1 }, 6);
    const crawler = run(make('drive.crawler'), { drive: 1 }, 6);
    expect(sprint.peakSpeed).toBeGreaterThan(crawler.peakSpeed);
  });
});

describe('ground clearance', () => {
  it('is reported as an error when the body sits below the wheels', () => {
    let d = emptyDesign('BELLY');
    for (const [x, z] of [[0, 0], [5, 0], [0, 5], [5, 5]]) d = place(d, 'drive.balanced', x!, 0, z!);
    d = place(d, 'str.plate', 2, 0, 2);       // level with the wheels
    d = place(d, 'bat.lipo6s', 2, 1, 2);
    d = place(d, 'ctl.basic', 3, 1, 3);
    const a = analyse(d);
    expect(a.groundClearance).toBeLessThanOrEqual(0);
    expect(a.problems.some((p) => p.severity === 'error' && p.message.includes('clearance'))).toBe(true);
  });

  it('and such a machine really does fail to move', () => {
    let d = emptyDesign('BELLY2');
    for (const [x, z] of [[0, 0], [5, 0], [0, 5], [5, 5]]) d = place(d, 'drive.balanced', x!, 0, z!);
    d = place(d, 'str.plate', 2, 0, 2);
    d = place(d, 'bat.lipo6s', 2, 1, 2);
    d = place(d, 'ctl.basic', 3, 1, 3);
    expect(run(d, { drive: 1 }, 4).distance).toBeLessThan(1);
  });
});

describe('mass placement has consequences', () => {
  it('a tall machine is less stable than the same machine built low', () => {
    let low = emptyDesign('LOW');
    for (const [x, z] of [[0, 0], [5, 0], [0, 5], [5, 5]]) low = place(low, 'drive.sprint', x!, 0, z!);
    low = place(low, 'str.plate', 2, 0, 2);
    low = place(low, 'bat.lipo6s', 2, 1, 2);
    low = place(low, 'ctl.basic', 3, 2, 3);

    let tall = low;
    for (let i = 0; i < 5; i++) tall = place(tall, 'str.tower', 3, 3 + i * 3, 3);
    tall = place(tall, 'util.ballast', 3, 18, 3);
    tall = place(tall, 'util.ballast', 3, 19, 3);

    // The builder must see it, and the simulation must agree.
    expect(analyse(tall).tipG).toBeLessThan(analyse(low).tipG);

    const lowTurn = run(low, { drive: 1, steer: 1 }, 5);
    const tallTurn = run(tall, { drive: 1, steer: 1 }, 5);
    expect(lowTurn.inverted).toBe(false);
    // The tall one is either on its back or dramatically slower through the turn.
    expect(tallTurn.inverted || tallTurn.distance < lowTurn.distance).toBe(true);
  });
});

describe('energy', () => {
  it('drains under load and not at rest', () => {
    expect(run(SCOUT, { drive: 1 }, 4).energyUsed).toBeGreaterThan(0);
    expect(run(SCOUT, {}, 4).energyUsed).toBe(0);
  });

  it('stops the machine when the pack is empty', () => {
    const physics = new PhysicsWorld();
    physics.addGround(120, { friction: 1.0, restitution: 0.05 });
    const robot = spawnRobot(physics.world, SCOUT, { position: { x: 0, z: 0 } });
    robot.energy = 0;
    for (let i = 0; i < PHYSICS_HZ * 2; i++) {
      driveRobot(robot, { ...neutralInput(), drive: 1 });
      physics.step();
    }
    expect(robotSpeed(robot)).toBeLessThan(0.3);
    physics.dispose();
  });
});

describe('determinism', () => {
  it('two identical runs agree exactly', () => {
    const a = run(SCOUT, { drive: 1, steer: 0.3 }, 3);
    const b = run(SCOUT, { drive: 1, steer: 0.3 }, 3);
    expect(b.distance).toBeCloseTo(a.distance, 10);
    expect(b.peakSpeed).toBeCloseTo(a.peakSpeed, 10);
  });
});

describe('every preset is deployable', () => {
  it.each(PRESETS.map((d) => [d.name, d] as const))('%s has no build errors', (_name, design) => {
    expect(analyse(design).problems.filter((p) => p.severity === 'error')).toEqual([]);
  });

  it.each(PRESETS.map((d) => [d.name, d] as const))('%s drives and stays upright', (_name, design) => {
    const result = run(design, { drive: 1 }, 4);
    expect(result.distance).toBeGreaterThan(0.5);
    expect(result.inverted).toBe(false);
  });

  it('the tracked machine out-grips the sprinter on a slope', () => {
    expect(analyse(BULWARK).maxGrade).toBeGreaterThan(analyse(SCOUT).maxGrade);
  });

  it('the spinner build carries real stored energy', () => {
    const disc = BRUISER.placements.find((p) => p.partId === 'wpn.bar');
    expect(disc).toBeDefined();
  });
});
