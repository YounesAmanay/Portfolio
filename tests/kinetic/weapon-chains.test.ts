/**
 * Weapons on the component model.
 *
 * The change being tested is that a weapon no longer arrives with its energy
 * pre-decided. A spinner is inertia and a radius on the end of the same shaft
 * chain a wheel hangs off, so how hard you gear it is a real decision — and
 * the number it buys you, spin-up time against stored energy, is the trade the
 * whole weapon class is built on.
 *
 * Arms run on a third chain: bottle, regulator, ram. The regulator setting is
 * the decision there, and it is bounded at both ends — too low and the hit is
 * feeble, too high and the arm bends.
 */

import { describe, expect, it } from 'vitest';
import { requireComponent } from '@kinetic/machine/catalogue';
import { compatible, spinUpTime, spinnerEnergy } from '@kinetic/machine/components';
import { solve, type Link, type Machine } from '@kinetic/machine/solver';

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

/** A running machine with a weapon bolted on, so weapon faults show alone. */
function armed(weapon: Record<string, string>, wiring: readonly string[]): Machine {
  return build(
    {
      pack: 'pwr.6s2200',
      rx: 'rcv.10',
      esc: 'esc.40',
      motor: 'mot.b22',
      gbx: 'gbx.20',
      wheel: 'whl.140',
      ...weapon,
    },
    ['pack>esc', 'rx>esc', 'esc>motor', 'motor>gbx', 'gbx>wheel', ...wiring],
  );
}

const errors = (m: Machine): string[] =>
  solve(m).faults.filter((f) => f.severity === 'error').map((f) => f.message);
const warnings = (m: Machine): string[] =>
  solve(m).faults.filter((f) => f.severity === 'warning').map((f) => f.message);

describe('spinners run on the same chain a wheel does', () => {
  const geared = (gearbox: string | null) => {
    const parts: Record<string, string> = { we: 'esc.80', wm: 'mot.b50', disc: 'wpn.disc' };
    const wiring = ['pack>we', 'rx>we', 'we>wm'];
    if (gearbox) {
      parts['wg'] = gearbox;
      wiring.push('wm>wg', 'wg>disc');
    } else {
      wiring.push('wm>disc');
    }
    return armed(parts, wiring);
  };

  it('spins the disc when the chain is complete', () => {
    const solved = solve(geared(null));
    const disc = solved.spinners[0];
    expect(disc?.driven).toBe(true);
    expect(disc?.freeSpeed).toBeGreaterThan(400);
  });

  it('derives spin-up and stored energy rather than stating them', () => {
    // A B50 on 6S through an 80 A controller makes 3.95 N·m at 442 rad/s. On a
    // 0.028 kg·m² disc that is a seven-second wind-up holding 2.7 kJ.
    const disc = solve(geared(null)).spinners[0]!;
    expect(disc.torque).toBeCloseTo(3.951, 2);
    expect(disc.spinUp).toBeCloseTo(spinUpTime(0.028, disc.torque, disc.freeSpeed), 10);
    expect(disc.spinUp).toBeGreaterThan(6);
    expect(disc.spinUp).toBeLessThan(9);
    expect(disc.energy).toBeCloseTo(spinnerEnergy(0.028, disc.freeSpeed), 10);
    expect(disc.energy).toBeGreaterThan(2000);
    expect(disc.tipSpeed).toBeCloseTo(disc.freeSpeed * 0.13, 10);
  });

  it('makes gearing the weapon a real trade rather than a free upgrade', () => {
    // Four to one: four times the torque, a quarter of the speed. Energy goes
    // as speed squared, so the geared disc reaches speed far sooner and holds
    // a sixteenth of what the direct drive holds when it gets there.
    const direct = solve(geared(null)).spinners[0]!;
    const reduced = solve(geared('gbx.4')).spinners[0]!;

    expect(reduced.freeSpeed).toBeCloseTo(direct.freeSpeed / 4, 6);
    expect(reduced.spinUp).toBeLessThan(direct.spinUp / 4);
    expect(reduced.energy / direct.energy).toBeCloseTo(1 / 16, 6);
  });

  it('says so when nothing turns the weapon', () => {
    const m = armed({ disc: 'wpn.disc' }, []);
    expect(errors(m)).toContain('Steel Disc has nothing turning it.');
    expect(solve(m).spinners[0]?.energy).toBe(0);
  });

  it('warns when the wind-up is longer than a match', () => {
    // The little B22 against a heavy disc: a minute and a half to reach speed.
    const m = armed(
      { we: 'esc.40', wm: 'mot.b22', disc: 'wpn.disc' },
      ['pack>we', 'rx>we', 'we>wm', 'wm>disc'],
    );
    expect(warnings(m).some((w) => w.includes('to reach speed'))).toBe(true);
  });

  it('counts the weapon motor against the pack like any other', () => {
    const without = solve(armed({}, []));
    const with_ = solve(
      armed({ we: 'esc.80', wm: 'mot.b50', disc: 'wpn.disc' }, ['pack>we', 'rx>we', 'we>wm', 'wm>disc']),
    );
    expect(with_.demandAmps - without.demandAmps).toBeCloseTo(80, 5);
  });

  it('lets a light drum wind up quickly and hold very little', () => {
    // A B22 through 4:1 onto the eggbeater: 6 100 rpm, ready in five seconds,
    // and holding a couple of hundred joules. The disc takes longer than that
    // and arrives with ten times the energy. That is the whole trade.
    const m = armed(
      { we: 'esc.40', wm: 'mot.b22', wg: 'gbx.4', drum: 'wpn.eggbeater' },
      ['pack>we', 'rx>we', 'we>wm', 'wm>wg', 'wg>drum'],
    );
    const drum = solve(m).spinners[0]!;
    expect(drum.spinUp).toBeLessThan(6);
    expect(drum.energy).toBeGreaterThan(150);
    expect(drum.energy).toBeLessThan(400);
  });
});

describe('arms run on the gas chain', () => {
  const pneumatic = (arm: string, bottle: string, regulator: string) =>
    armed(
      { arm, bottle, reg: regulator },
      ['bottle>reg', 'reg>arm'],
    );

  it('fires when bottle, regulator and ram are all there', () => {
    const solved = solve(pneumatic('wpn.flipper', 'gas.co2', 'gas.reg8'));
    expect(solved.faults.filter((f) => f.severity === 'error')).toEqual([]);
    const flipper = solved.arms[0];
    expect(flipper?.armed).toBe(true);
    expect(flipper?.kind).toBe('FLIPPER');
  });

  it('derives its torque from bore, pressure and lever', () => {
    // 50 mm bore is 0.002 m². At 8 bar that is 1 600 N, through a lever a
    // quarter of the 0.3 m reach: 120 N·m.
    const flipper = solve(pneumatic('wpn.flipper', 'gas.co2', 'gas.reg8')).arms[0]!;
    expect(flipper.torque).toBeCloseTo(0.002 * 8 * 100_000 * 0.3 * 0.25, 6);
    expect(flipper.torque).toBeCloseTo(120, 6);
  });

  it('trades pressure against shots, in both directions', () => {
    const soft = solve(pneumatic('wpn.flipper', 'gas.co2', 'gas.reg8')).arms[0]!;
    const hard = solve(pneumatic('wpn.flipper', 'gas.co2', 'gas.reg14')).arms[0]!;

    expect(hard.torque / soft.torque).toBeCloseTo(14 / 8, 6);
    expect(hard.shots).toBeLessThan(soft.shots);
    // Gas is spent at pressure: 0.3 litres swept at 8 bar is 2.4 atmospheric.
    expect(soft.shots).toBe(Math.floor(140 / (0.3 * 8)));
  });

  it('refuses a regulator the arm cannot survive', () => {
    // The light hammer is rated 1 000 N. Fourteen bar through a 32 mm bore is
    // 1 120, and the arm bends rather than the target.
    const m = pneumatic('wpn.hammer', 'gas.co2', 'gas.reg14');
    expect(errors(m).some((e) => e.includes('against a 1000 N arm'))).toBe(true);
    // Eight bar is 640 N, and fine.
    expect(errors(pneumatic('wpn.hammer', 'gas.co2', 'gas.reg8'))).toEqual([]);
  });

  it('refuses an arm plumbed straight to the bottle', () => {
    const m = armed({ arm: 'wpn.flipper', bottle: 'gas.co2' }, ['bottle>arm']);
    expect(errors(m).some((e) => e.includes('has no regulator'))).toBe(true);
  });

  it('refuses an arm with no bottle', () => {
    const m = armed({ arm: 'wpn.flipper', reg: 'gas.reg8' }, ['reg>arm']);
    expect(errors(m)).toContain('Flipper Plate has no gas bottle.');
    expect(solve(m).arms[0]?.shots).toBe(0);
  });

  it('gives HPA far more shots than CO2 for the weight', () => {
    const co2 = solve(pneumatic('wpn.flipper', 'gas.co2', 'gas.reg8')).arms[0]!;
    const hpa = solve(pneumatic('wpn.flipper', 'gas.hpa', 'gas.reg8')).arms[0]!;
    expect(hpa.shots).toBeGreaterThan(co2.shots * 2);
    expect(requireComponent('gas.hpa').mass).toBeGreaterThan(requireComponent('gas.co2').mass * 2);
  });
});

describe('one motor, several faults, said once', () => {
  it('does not repeat a fault for every thing a chain turns', () => {
    // One motor through one gearbox onto two wheels and a disc. The gearbox
    // is handed more than it is rated for, and that is one problem, not three.
    const m = build(
      {
        pack: 'pwr.6s2200',
        rx: 'rcv.10',
        esc: 'esc.80',
        motor: 'mot.b50',
        gbx: 'gbx.8',
        w1: 'whl.140',
        w2: 'whl.140',
        disc: 'wpn.disc',
      },
      ['pack>esc', 'rx>esc', 'esc>motor', 'motor>gbx', 'gbx>w1', 'gbx>w2', 'gbx>disc'],
    );
    const stripped = errors(m).filter((e) => e.includes('It will strip.'));
    expect(stripped).toHaveLength(1);
  });
});
