/**
 * What the builder tells you before you drive.
 *
 * The contract under test is that the readout and the solver agree, because
 * the readout does not recompute anything — it passes the solver's numbers
 * through and adds only what the solver has no business knowing: where the
 * mass sits, whether the machine stands up, and whether grip or torque is the
 * thing actually holding it back.
 */

import { describe, expect, it } from 'vitest';
import { analyseBuild } from '@kinetic/machine/analysis';
import {
  addFitted,
  addLink,
  emptyBuild,
  removeFitted,
  removeLink,
  replaceFitted,
  type Build,
  type Fitted,
} from '@kinetic/machine/build';
import { solve } from '@kinetic/machine/solver';
import { toMachine } from '@kinetic/machine/build';

const at = (uid: string, componentId: string, x: number, y: number, z: number): Fitted => ({
  uid,
  componentId,
  cell: { x, y, z },
  yaw: 0,
});

/**
 * A complete beetleweight, assembled the way you would assemble one.
 *
 * Titanium pan on the floor of the build at y=1, the two drive chains running
 * back from it, the wheels hanging a cell lower so the machine has clearance,
 * a caster at the nose, and the loom above the pan.
 *
 *   y=2        esc  pack/rx  esc
 *   y=1   [------ pan ------] motor─gearbox
 *   y=0        caster              wheel
 */
function beetle(): Build {
  let build = emptyBuild('BEETLE', 'beetle');

  build = addFitted(build, at('pan', 'str.pan', 0, 1, 0));        // x0..2, z0..1
  build = addFitted(build, at('caster', 'whl.caster', 1, 0, 0));

  for (const [side, x] of [['l', 0], ['r', 2]] as const) {
    build = addFitted(build, at(`m${side}`, 'mot.b22', x, 1, 2));
    build = addFitted(build, at(`g${side}`, 'gbx.20', x, 1, 3));   // z3..4
    build = addFitted(build, at(`w${side}`, 'whl.50', x, 0, 3));
    build = addFitted(build, at(`e${side}`, 'esc.20', x, 2, 0));
  }

  build = addFitted(build, at('pack', 'pwr.2s450', 1, 2, 0));
  build = addFitted(build, at('rx', 'rcv.6', 1, 2, 1));

  for (const side of ['l', 'r'] as const) {
    build = addLink(build, { from: 'pack', fromPort: 'out', to: `e${side}`, toPort: 'pwr' });
    build = addLink(build, { from: 'rx', fromPort: 'out', to: `e${side}`, toPort: 'sig' });
    build = addLink(build, { from: `e${side}`, fromPort: 'out', to: `m${side}`, toPort: 'pwr' });
    build = addLink(build, { from: `m${side}`, fromPort: 'out', to: `g${side}`, toPort: 'in' });
    build = addLink(build, { from: `g${side}`, fromPort: 'out', to: `w${side}`, toPort: 'in' });
  }
  return build;
}

const errors = (build: Build): string[] =>
  analyseBuild(build).problems.filter((p) => p.severity === 'error').map((p) => p.message);

describe('a machine that is actually finished', () => {
  it('assembles into one piece with every link made', () => {
    const build = beetle();
    expect(build.fitted).toHaveLength(12);
    expect(build.links).toHaveLength(10);
    expect(errors(build)).toEqual([]);
  });

  it('fits its weight class with room to spare', () => {
    const report = analyseBuild(beetle());
    expect(report.weightClass.id).toBe('beetle');
    expect(report.mass).toBeCloseTo(0.828, 3);
    expect(report.massMargin).toBeCloseTo(1.5 - 0.828, 3);
  });

  it('drives two of its three contact points', () => {
    const report = analyseBuild(beetle());
    expect(report.contacts).toHaveLength(3);
    expect(report.drivenWheels).toBe(2);
  });

  it('stands on a real triangle rather than a line', () => {
    const report = analyseBuild(beetle());
    expect(report.supportPolygon.length).toBeGreaterThanOrEqual(3);
    expect(report.stabilityMargin).toBeGreaterThan(0);
    expect(report.tipG).toBeGreaterThan(0.35);
  });

  it('keeps its body off the floor', () => {
    const report = analyseBuild(beetle());
    expect(report.groundClearance).toBeGreaterThan(0.02);
  });

  it('runs for a sensible length of time on a 450 mAh pack', () => {
    // 3.33 W·h against 61 W of draw. Flat out, and nothing is flat out for a
    // whole match.
    const report = analyseBuild(beetle());
    expect(report.endurance).toBeGreaterThan(120);
    expect(report.endurance).toBeLessThan(260);
  });

  it('spends one receiver channel per controller', () => {
    const report = analyseBuild(beetle());
    expect(report.channelsUsed).toBe(2);
    expect(report.channelsAvailable).toBe(6);
  });
});

describe('the readout never computes anything twice', () => {
  it('passes the solver`s wheels through untouched', () => {
    const build = beetle();
    const direct = solve(toMachine(build));
    const report = analyseBuild(build);
    expect(report.solution.wheels).toEqual(direct.wheels);
    expect(report.totalTorque).toBeCloseTo(direct.wheels.reduce((s, w) => s + w.wheelTorque, 0), 12);
  });

  it('carries every solver fault into the problem list', () => {
    const build = removeLink(beetle(), {
      from: 'rx',
      fromPort: 'out',
      to: 'el',
      toPort: 'sig',
    });
    const report = analyseBuild(build);
    // The controller is still wired to the pack and the motor, so the chain
    // still solves — but a channel is no longer spent on it.
    expect(report.channelsUsed).toBe(1);
    expect(report.problems).toEqual(expect.arrayContaining([...report.solution.faults]));
  });

  it('takes top speed from the slowest driven wheel, not the fastest', () => {
    // Geared 20:1 on one side and 8:1 on the other. The two are tied together
    // through the floor: this machine does not do the fast side's speed, it
    // fights itself. Reporting the maximum would promise almost three times
    // what the machine can do.
    let build = beetle();
    build = removeFitted(build, 'gr');
    build = addFitted(build, at('gr', 'gbx.8', 2, 1, 3));
    build = addLink(build, { from: 'mr', fromPort: 'out', to: 'gr', toPort: 'in' });
    build = addLink(build, { from: 'gr', fromPort: 'out', to: 'wr', toPort: 'in' });

    const report = analyseBuild(build);
    const speeds = report.solution.wheels.filter((w) => w.driven).map((w) => w.freeSpeed * w.radius);
    expect(Math.max(...speeds) / Math.min(...speeds)).toBeCloseTo(2.5, 5);
    expect(report.topSpeed).toBeCloseTo(Math.min(...speeds), 12);
  });
});

describe('the physics the solver does not do', () => {
  it('knows a 20:1 beetle is grip-limited, not torque-limited', () => {
    // 0.54 N·m on a 25 mm wheel is 21 N per side against a machine that weighs
    // 8 N. There is nowhere near enough friction to use it.
    const report = analyseBuild(beetle());
    expect(report.gripLimited).toBe(true);
    expect(report.tractiveEffort).toBeLessThan(report.totalTorque / 0.025);
    // And says so, because this one is carrying gearing it can never use.
    // Being grip-limited at all is normal and goes unremarked; three times
    // over is wasted weight.
    expect(report.problems.some((p) => p.message.includes('than the tyres can put down'))).toBe(true);
  });

  it('caps a grip-limited climb with tan, not asin', () => {
    // The regression: asin(F/mg) with mu > 1 once had a crawler claiming it
    // could climb a vertical wall. A grip limit is atan(mu) and cannot reach
    // ninety degrees however much torque is behind it.
    const report = analyseBuild(beetle());
    expect(report.maxGrade).toBeGreaterThan(20);
    expect(report.maxGrade).toBeLessThan(45);
  });

  it('accelerates at what the tyres allow, not what the motors make', () => {
    const report = analyseBuild(beetle());
    expect(report.acceleration).toBeCloseTo(report.tractiveEffort / report.mass, 10);
    expect(report.acceleration).toBeLessThan(Math.abs(-9.81));
  });
});

describe('problems', () => {
  it('says so when the build is over its class', () => {
    // A steel plate on a beetleweight. It is 2.4 kg on a 1.5 kg limit before
    // anything else is counted.
    const build = addFitted(beetle(), at('armour', 'arm.steel', 0, 2, 2));
    expect(errors(build).some((e) => e.includes('in a 1.5 kg class'))).toBe(true);
  });

  it('says so when the class is barely met', () => {
    // Same machine entered as a hobbyweight, where the steel fits easily.
    const build: Build = { ...addFitted(beetle(), at('armour', 'arm.steel', 0, 2, 2)), weightClass: 'hobby' };
    expect(errors(build)).toEqual([]);
  });

  it('says so when part of the machine is not bolted on', () => {
    const build = replaceFitted(beetle(), at('pack', 'pwr.2s450', 9, 9, 9));
    expect(errors(build).some((e) => e.includes('not bolted to the machine'))).toBe(true);
  });

  it('says so when the body sits below the contact line', () => {
    // Drop the pan to the floor and the wheels are carrying nothing.
    const build = replaceFitted(beetle(), at('pan', 'str.pan', 0, 0, 0));
    expect(errors(build).some((e) => e.includes('rest on its belly'))).toBe(true);
  });

  it('says so when more things are wired than the receiver has channels', () => {
    // A two-channel receiver would be the honest way to test this; there is
    // not one, so wire eight controllers to a six-channel receiver.
    let build = beetle();
    for (let i = 0; i < 8; i += 1) {
      build = addFitted(build, at(`x${i}`, 'esc.20', 1, 3, i % 2));
      build = addLink(build, { from: 'rx', fromPort: 'out', to: `x${i}`, toPort: 'sig' });
    }
    expect(errors(build).some((e) => e.includes('the receiver has 6 channels'))).toBe(true);
  });

  it('says nothing at all about an empty build except to start one', () => {
    const report = analyseBuild(emptyBuild());
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]?.message).toContain('Nothing built yet');
    expect(report.mass).toBe(0);
    expect(report.topSpeed).toBe(0);
  });
});
