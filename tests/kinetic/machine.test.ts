/**
 * Does the solver produce the numbers the design doc promises?
 *
 * `docs/11-machines.md` prints a table of what one motor does on two packs
 * through three gear ratios, and claims every figure in it is computed rather
 * than chosen. This file is what makes that claim true: the table is
 * reproduced here from shipped catalogue parts, so a doc that drifts from the
 * code goes red.
 *
 * The rest is the validation the builder owes the player. A builder that lets
 * you assemble something that cannot work, and only tells you by sitting still
 * in the arena, is worse than no builder at all.
 */

import { describe, expect, it } from 'vitest';
import { ALL_COMPONENTS, classFor, requireComponent, WEIGHT_CLASSES } from '@kinetic/machine/catalogue';
import { compatible, packVoltage } from '@kinetic/machine/components';
import { solve, type Link, type Machine } from '@kinetic/machine/solver';

/**
 * Assembles a machine from named instances and a list of `from>to` joins.
 *
 * Ports are resolved by kind rather than named, because a test that spells out
 * `{ from: 'esc', fromPort: 'out', to: 'motor', toPort: 'pwr' }` six times
 * stops being readable long before it stops being correct.
 */
function build(parts: Record<string, string>, wiring: readonly string[]): Machine {
  const installed = Object.entries(parts).map(([uid, id]) => ({ uid, component: requireComponent(id) }));
  const byUid = new Map(installed.map((i) => [i.uid, i]));

  const links: Link[] = wiring.map((join) => {
    const [from, to] = join.split('>').map((s) => s.trim());
    const source = byUid.get(from ?? '');
    const sink = byUid.get(to ?? '');
    if (!source || !sink) throw new Error(`no such instance in "${join}"`);

    for (const out of source.component.ports) {
      if (out.direction !== 'out') continue;
      const match = sink.component.ports.find((p) => compatible(out, p));
      if (match) return { from: source.uid, fromPort: out.id, to: sink.uid, toPort: match.id };
    }
    throw new Error(`${source.component.name} has no port that joins ${sink.component.name}`);
  });

  return { installed, links };
}

/** A complete, working electric drive: one motor, one wheel, and the loom. */
function drive(pack: string, gearbox: string, extra: Record<string, string> = {}): Machine {
  return build(
    { pack, rx: 'rcv.6', esc: 'esc.40', motor: 'mot.b22', gbx: gearbox, wheel: 'whl.140', ...extra },
    ['pack>esc', 'rx>esc', 'esc>motor', 'motor>gbx', 'gbx>wheel'],
  );
}

const errors = (m: Machine): string[] => solve(m).faults.filter((f) => f.severity === 'error').map((f) => f.message);
const warnings = (m: Machine): string[] => solve(m).faults.filter((f) => f.severity === 'warning').map((f) => f.message);

describe('the worked example in docs/11-machines.md', () => {
  // Kv 1100, 1.8 Ω, 0.3 A no-load on a 140 mm wheel — the B22 and the silicone
  // wheel, straight out of the catalogue.
  // Compared as the doc prints them, to the digit. A float tolerance let two of
  // these rows pass while the table was wrong by a hundredth, which is exactly
  // how a "computed, not chosen" claim quietly stops being true.
  const table = [
    { pack: 'pwr.3s2200', gearbox: 'gbx.8', torque: '0.33', speed: '11.2', amps: '6.2' },
    { pack: 'pwr.3s2200', gearbox: 'gbx.20', torque: '0.83', speed: '4.5', amps: '6.2' },
    { pack: 'pwr.3s2200', gearbox: 'gbx.40', torque: '1.49', speed: '2.2', amps: '6.2' },
    { pack: 'pwr.6s2200', gearbox: 'gbx.8', torque: '0.68', speed: '22.4', amps: '12.3' },
    { pack: 'pwr.6s2200', gearbox: 'gbx.20', torque: '1.69', speed: '9.0', amps: '12.3' },
    { pack: 'pwr.6s2200', gearbox: 'gbx.40', torque: '3.05', speed: '4.5', amps: '12.3' },
  ];

  for (const row of table) {
    const cells = requireComponent(row.pack).pack!.cells;
    it(`${cells}S through ${requireComponent(row.gearbox).name} makes ${row.torque} N·m`, () => {
      const solved = solve(drive(row.pack, row.gearbox));
      const wheel = solved.wheels[0];

      expect(wheel?.driven).toBe(true);
      expect(wheel!.wheelTorque.toFixed(2)).toBe(row.torque);
      expect((wheel!.freeSpeed * wheel!.radius).toFixed(1)).toBe(row.speed);
      expect(wheel!.peakAmps.toFixed(1)).toBe(row.amps);
    });
  }

  it('doubles torque AND speed AND current when the pack doubles', () => {
    // The lesson the doc leads with: voltage is not a free upgrade.
    const low = solve(drive('pwr.3s2200', 'gbx.20')).wheels[0]!;
    const high = solve(drive('pwr.6s2200', 'gbx.20')).wheels[0]!;

    expect(high.freeSpeed / low.freeSpeed).toBeCloseTo(2, 5);
    expect(high.peakAmps / low.peakAmps).toBeCloseTo(2, 5);
    // Torque falls just short of doubling: the no-load current does not scale.
    expect(high.wheelTorque / low.wheelTorque).toBeGreaterThan(2.0);
    expect(high.wheelTorque / low.wheelTorque).toBeLessThan(2.1);
  });

  it('trades speed for torque at constant power, near enough', () => {
    const fast = solve(drive('pwr.3s2200', 'gbx.8')).wheels[0]!;
    const slow = solve(drive('pwr.3s2200', 'gbx.40')).wheels[0]!;

    // 5x the reduction, so 5x the torque less the extra gear stage, and 1/5th
    // the speed exactly.
    expect(slow.freeSpeed).toBeCloseTo(fast.freeSpeed / 5, 5);
    expect(slow.wheelTorque / fast.wheelTorque).toBeCloseTo(5 * 0.9, 2);
  });
});

describe('validation', () => {
  it('a working machine has nothing to say about it', () => {
    expect(solve(drive('pwr.3s2200', 'gbx.20')).faults).toEqual([]);
  });

  it('catches a motor that is not wired to a speed controller', () => {
    const m = build(
      { pack: 'pwr.3s2200', rx: 'rcv.6', motor: 'mot.b22', gbx: 'gbx.20', wheel: 'whl.140' },
      ['motor>gbx', 'gbx>wheel'],
    );
    expect(errors(m)).toContain('B22 Outrunner is not wired to a speed controller.');
  });

  it('catches a pack the speed controller cannot take', () => {
    const m = build(
      { pack: 'pwr.6s2200', rx: 'rcv.6', esc: 'esc.20', motor: 'mot.b22', gbx: 'gbx.20', wheel: 'whl.140' },
      ['pack>esc', 'rx>esc', 'esc>motor', 'motor>gbx', 'gbx>wheel'],
    );
    expect(errors(m)).toContain('20 A Speed Controller is rated 4S, the pack is 6S.');
  });

  it('catches a pack the motor cannot take', () => {
    const m = build(
      { pack: 'pwr.6s2200', rx: 'rcv.6', esc: 'esc.80', motor: 'mot.775', gbx: 'gbx.20', wheel: 'whl.140' },
      ['pack>esc', 'rx>esc', 'esc>motor', 'motor>gbx', 'gbx>wheel'],
    );
    expect(errors(m)).toContain('775 Brushed is rated 4S, the pack is 6S.');
  });

  it('catches a gearbox the motor will strip', () => {
    const m = build(
      { pack: 'pwr.6s2200', rx: 'rcv.6', esc: 'esc.80', motor: 'mot.b50', gbx: 'gbx.8', wheel: 'whl.140' },
      ['pack>esc', 'rx>esc', 'esc>motor', 'motor>gbx', 'gbx>wheel'],
    );
    // 80 A through a 190 Kv motor is 3.95 N·m against a box rated 3.
    expect(errors(m).some((e) => e.startsWith('8:1 Planetary is handed 3.95 N·m'))).toBe(true);
  });

  it('checks each gearbox against the torque it is actually handed, not the motors', () => {
    // The regression. A 775 on 4S makes 0.34 N·m, which every box in this
    // chain survives — so comparing the motors output against the chain would
    // pass this build. By the third box the torque has been multiplied a
    // hundredfold and it is nowhere near surviving it.
    const m = build(
      {
        pack: 'pwr.4s1800',
        rx: 'rcv.6',
        esc: 'esc.80',
        motor: 'mot.775',
        a: 'gbx.4',
        b: 'gbx.40',
        c: 'gbx.4',
        wheel: 'whl.140',
      },
      ['pack>esc', 'rx>esc', 'esc>motor', 'motor>a', 'a>b', 'b>c', 'c>wheel'],
    );
    const stripped = errors(m).filter((e) => e.includes('It will strip.'));
    expect(stripped).toHaveLength(1);
    expect(stripped[0]).toContain('4:1 Planetary is handed 35.4');
  });

  it('catches a machine with nothing to command it', () => {
    const m = build(
      { pack: 'pwr.3s2200', esc: 'esc.40', motor: 'mot.b22', gbx: 'gbx.20', wheel: 'whl.140' },
      ['pack>esc', 'esc>motor', 'motor>gbx', 'gbx>wheel'],
    );
    expect(errors(m)).toContain('No receiver. Nothing can be commanded.');
  });

  it('catches a machine where nothing reaches a wheel', () => {
    const m = build({ rx: 'rcv.6', pack: 'pwr.3s2200', wheel: 'whl.140', w2: 'whl.140' }, []);
    expect(errors(m)).toContain('Nothing drives a wheel. This will sit where you drop it.');
  });

  it('catches a gearbox that drives nothing', () => {
    const m = build(
      { pack: 'pwr.3s2200', rx: 'rcv.6', esc: 'esc.40', motor: 'mot.b22', gbx: 'gbx.20', wheel: 'whl.140', spare: 'gbx.8' },
      ['pack>esc', 'rx>esc', 'esc>motor', 'motor>gbx', 'gbx>wheel'],
    );
    expect(warnings(m)).toContain('8:1 Planetary drives nothing.');
  });

  it('warns when the pack cannot supply what the machine will pull', () => {
    // Four B50s on 80 A controllers want 320 A. The 6S 2200 delivers 99.
    const m = build(
      {
        pack: 'pwr.6s2200',
        rx: 'rcv.10',
        e1: 'esc.80',
        e2: 'esc.80',
        e3: 'esc.80',
        e4: 'esc.80',
        m1: 'mot.b50',
        m2: 'mot.b50',
        m3: 'mot.b50',
        m4: 'mot.b50',
        g1: 'gbx.20',
        g2: 'gbx.20',
        g3: 'gbx.20',
        g4: 'gbx.20',
        w1: 'whl.140',
        w2: 'whl.140',
        w3: 'whl.140',
        w4: 'whl.140',
      },
      [
        'pack>e1', 'pack>e2', 'pack>e3', 'pack>e4',
        'rx>e1', 'rx>e2', 'rx>e3', 'rx>e4',
        'e1>m1', 'e2>m2', 'e3>m3', 'e4>m4',
        'm1>g1', 'm2>g2', 'm3>g3', 'm4>g4',
        'g1>w1', 'g2>w2', 'g3>w3', 'g4>w4',
      ],
    );
    const solved = solve(m);
    expect(solved.demandAmps).toBeCloseTo(320, 5);
    expect(solved.supplyAmps).toBeCloseTo(99, 5);
    expect(solved.sag).toBeCloseTo(99 / 320, 5);
    expect(warnings(m).some((w) => w.includes('it will sag to 31% under load'))).toBe(true);
  });

  it('counts current per motor, not per wheel', () => {
    // One motor through one gearbox onto two wheels is one motor's worth of
    // current. Counting per wheel would double it and invent a sag that is
    // not there.
    const one = solve(drive('pwr.3s2200', 'gbx.20'));
    const two = solve(
      build(
        { pack: 'pwr.3s2200', rx: 'rcv.6', esc: 'esc.40', motor: 'mot.b22', gbx: 'gbx.20', wheel: 'whl.140', w2: 'whl.140' },
        ['pack>esc', 'rx>esc', 'esc>motor', 'motor>gbx', 'gbx>wheel', 'gbx>w2'],
      ),
    );
    expect(two.wheels.filter((w) => w.driven)).toHaveLength(2);
    expect(two.demandAmps).toBeCloseTo(one.demandAmps, 5);
  });

  it('leaves a caster undriven and says nothing about it', () => {
    const solved = solve(drive('pwr.3s2200', 'gbx.20', { caster: 'whl.caster' }));
    const caster = solved.wheels.find((w) => w.uid === 'caster');
    expect(caster?.driven).toBe(false);
    expect(caster?.wheelTorque).toBe(0);
    expect(solved.faults).toEqual([]);
  });

  it('survives a chain wired back into itself', () => {
    const m: Machine = {
      installed: [
        { uid: 'a', component: requireComponent('gbx.4') },
        { uid: 'b', component: requireComponent('gbx.8') },
        { uid: 'wheel', component: requireComponent('whl.140') },
        { uid: 'rx', component: requireComponent('rcv.6') },
      ],
      links: [
        { from: 'a', fromPort: 'out', to: 'b', toPort: 'in' },
        { from: 'b', fromPort: 'out', to: 'a', toPort: 'in' },
        { from: 'b', fromPort: 'out', to: 'wheel', toPort: 'in' },
      ],
    };
    expect(() => solve(m)).not.toThrow();
    expect(errors(m)).toContain('Nothing drives a wheel. This will sit where you drop it.');
  });
});

describe('internal combustion', () => {
  const petrol = (parts: Record<string, string>, wiring: readonly string[]): Machine => build(parts, wiring);

  const complete = () =>
    petrol(
      { rx: 'rcv.6', tank: 'tnk.50', eng: 'eng.25', clu: 'clu.cent', gbx: 'gbx.rev', wheel: 'whl.200' },
      ['tank>eng', 'eng>clu', 'clu>gbx', 'gbx>wheel'],
    );

  it('runs without complaint when the whole chain is there', () => {
    expect(solve(complete()).faults).toEqual([]);
  });

  it('makes its peak torque at its peak rpm', () => {
    // 1200 W at 9000 rpm is 1.273 N·m, through a 6:1 two-stage box.
    const wheel = solve(complete()).wheels[0]!;
    expect(wheel.wheelTorque).toBeCloseTo((1200 / ((9000 * 2 * Math.PI) / 60)) * 6 * 0.81, 3);
  });

  it('refuses an engine with no clutch', () => {
    const m = petrol(
      { rx: 'rcv.6', tank: 'tnk.50', eng: 'eng.25', gbx: 'gbx.rev', wheel: 'whl.200' },
      ['tank>eng', 'eng>gbx', 'gbx>wheel'],
    );
    expect(errors(m)).toContain('25 cc Two-Stroke has no clutch. An engine cannot start against load.');
  });

  it('refuses an engine with nothing to burn', () => {
    const m = petrol(
      { rx: 'rcv.6', eng: 'eng.25', clu: 'clu.cent', gbx: 'gbx.rev', wheel: 'whl.200' },
      ['eng>clu', 'clu>gbx', 'gbx>wheel'],
    );
    expect(errors(m)).toContain('25 cc Two-Stroke has no fuel tank.');
  });

  it('warns that a machine with no reversing gearbox cannot back up', () => {
    const m = petrol(
      { rx: 'rcv.6', tank: 'tnk.50', eng: 'eng.25', clu: 'clu.cent', gbx: 'gbx.20', wheel: 'whl.200' },
      ['tank>eng', 'eng>clu', 'clu>gbx', 'gbx>wheel'],
    );
    expect(warnings(m)).toContain('No reversing gearbox: this machine cannot back up.');
  });

  it('catches a clutch the engine will slip past', () => {
    // The 50 cc makes 2.92 N·m; the light clutch holds 6, the drivetrain
    // behind it does not.
    const m = petrol(
      { rx: 'rcv.6', tank: 'tnk.120', eng: 'eng.50', clu: 'clu.cent', gbx: 'gbx.20', wheel: 'whl.200' },
      ['tank>eng', 'eng>clu', 'clu>gbx', 'gbx>wheel'],
    );
    expect(errors(m).some((e) => e.includes('20:1 Planetary is handed'))).toBe(true);
  });

  it('carries its fuel as mass', () => {
    expect(solve(complete()).fuel).toBeCloseTo(0.5, 5);
  });
});

describe('the catalogue itself', () => {
  it('has no duplicate ids', () => {
    const ids = ALL_COMPONENTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every component a lesson worth reading', () => {
    for (const c of ALL_COMPONENTS) {
      expect(c.lesson.length, c.id).toBeGreaterThan(30);
      expect(c.blurb.length, c.id).toBeGreaterThan(20);
    }
  });

  it('gives every port a unique id within its component', () => {
    for (const c of ALL_COMPONENTS) {
      const ids = c.ports.map((p) => p.id);
      expect(new Set(ids).size, c.id).toBe(ids.length);
    }
  });

  it('gives everything that makes or takes torque a shaft port', () => {
    for (const c of ALL_COMPONENTS) {
      const drives = c.motor ?? c.engine;
      if (drives) expect(c.ports.some((p) => p.kind === 'shaft' && p.direction === 'out'), c.id).toBe(true);
      if (c.gearbox || c.clutch) {
        expect(c.ports.some((p) => p.kind === 'shaft' && p.direction === 'in'), c.id).toBe(true);
        expect(c.ports.some((p) => p.kind === 'shaft' && p.direction === 'out'), c.id).toBe(true);
      }
    }
  });

  it('gives every motor a controller it can legally run on', () => {
    const escs = ALL_COMPONENTS.filter((c) => c.esc);
    for (const motor of ALL_COMPONENTS.filter((c) => c.motor)) {
      const usable = escs.some((e) => e.esc!.maxCells >= Math.min(motor.motor!.maxCells, 6));
      expect(usable, motor.id).toBe(true);
    }
  });

  it('prices nothing at zero and weighs nothing at zero', () => {
    for (const c of ALL_COMPONENTS) {
      expect(c.mass, c.id).toBeGreaterThan(0);
      expect(c.cost, c.id).toBeGreaterThan(0);
      expect(c.integrity, c.id).toBeGreaterThan(0);
    }
  });

  it('quotes pack voltages that match their chemistry', () => {
    for (const c of ALL_COMPONENTS.filter((p) => p.pack)) {
      const v = packVoltage(c.pack!);
      expect(v, c.id).toBeGreaterThan(6);
      expect(v, c.id).toBeLessThan(35);
    }
  });
});

describe('weight classes', () => {
  it('are the real ones, in order', () => {
    expect(WEIGHT_CLASSES.map((c) => c.limit)).toEqual([1.5, 5.4, 13.6, 27]);
  });

  it('put a machine in the lightest class it still fits', () => {
    expect(classFor(1.2)?.id).toBe('beetle');
    expect(classFor(1.5)?.id).toBe('beetle');
    expect(classFor(1.51)?.id).toBe('hobby');
    expect(classFor(13.6)?.id).toBe('feather');
    expect(classFor(30)).toBeUndefined();
  });

  it('let a complete beetleweight drive exist inside the limit', () => {
    // Four B22s, four 20:1 boxes, four wheels, four 20 A controllers, a 3S
    // pack and a receiver. If this does not fit, the catalogue is too heavy
    // for its own lightest class and the class is decorative.
    const ids = [
      'mot.b22', 'mot.b22', 'mot.b22', 'mot.b22',
      'gbx.20', 'gbx.20', 'gbx.20', 'gbx.20',
      'whl.50', 'whl.50', 'whl.50', 'whl.50',
      'esc.20', 'esc.20', 'esc.20', 'esc.20',
      'pwr.3s2200', 'rcv.6',
    ];
    const mass = ids.reduce((total, id) => total + requireComponent(id).mass, 0);
    expect(mass).toBeLessThan(1.5);
    expect(classFor(mass)?.id).toBe('beetle');
  });
});
