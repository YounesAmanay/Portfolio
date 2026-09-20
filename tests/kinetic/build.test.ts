/**
 * The Build model: components on the lattice, and links between their ports.
 *
 * The rule under test throughout is the one the design doc leads with — a
 * shaft link is a claim that two things physically line up, and a power link
 * is not. Get that backwards in either direction and the builder either makes
 * you solder by hand or lets you drive a wheel from across the chassis.
 */

import { describe, expect, it } from 'vitest';
import {
  addFitted,
  addLink,
  adjacent,
  assemblies,
  canFit,
  canLink,
  emptyBuild,
  linkFault,
  linksOn,
  newUid,
  removeFitted,
  removeLink,
  replaceFitted,
  suggestLink,
  toMachine,
  type Build,
  type Fitted,
  type Link,
} from '@kinetic/machine/build';
import { requireComponent } from '@kinetic/machine/catalogue';
import { solve } from '@kinetic/machine/solver';

const at = (componentId: string, x: number, y: number, z: number, uid = newUid()): Fitted => ({
  uid,
  componentId,
  cell: { x, y, z },
  yaw: 0,
});

/**
 * Places a run of components in a line along z, each bolted to the last.
 *
 * It steps by each component's actual depth. Stepping by one cell instead lets
 * them overlap, and then every adjacency assertion below passes for the wrong
 * reason — which is what the first draft of this file did.
 */
function line(specs: readonly [string, string][]): Build {
  let build = emptyBuild('TEST', 'hobby');
  let z = 0;
  for (const [uid, componentId] of specs) {
    build = addFitted(build, at(componentId, 0, 0, z, uid));
    z += requireComponent(componentId).footprint.z;
  }
  return build;
}

describe('placement', () => {
  it('accepts the first component anywhere above the floor', () => {
    const build = emptyBuild();
    expect(canFit(build, at('mot.b22', 4, 2, -7))).toBe(true);
    expect(canFit(build, at('mot.b22', 0, -1, 0))).toBe(false);
  });

  it('refuses a component floating away from everything else', () => {
    const build = addFitted(emptyBuild(), at('mot.b22', 0, 0, 0, 'a'));
    expect(canFit(build, at('gbx.20', 0, 0, 1))).toBe(true);
    expect(canFit(build, at('gbx.20', 0, 0, 40))).toBe(false);
  });

  it('refuses a component overlapping one already placed', () => {
    const build = addFitted(emptyBuild(), at('mot.b22', 0, 0, 0, 'a'));
    expect(canFit(build, at('gbx.20', 0, 0, 0))).toBe(false);
  });

  it('counts a machine in one piece as one assembly', () => {
    const build = line([
      ['motor', 'mot.b22'],
      ['gbx', 'gbx.20'],
      ['wheel', 'whl.50'],
    ]);
    expect(assemblies(build)).toHaveLength(1);
  });
});

describe('links', () => {
  const chassis = (): Build =>
    line([
      ['esc', 'esc.40'],
      ['motor', 'mot.b22'],
      ['gbx', 'gbx.20'],
      ['wheel', 'whl.50'],
    ]);

  it('joins a motor to the gearbox it is bolted to', () => {
    const build = chassis();
    expect(linkFault(build, { from: 'motor', fromPort: 'out', to: 'gbx', toPort: 'in' })).toBeNull();
  });

  it('refuses a shaft link between components that do not line up', () => {
    // The gearbox is moved across the chassis. It is still on the machine —
    // bolted to a rail, say — but the motor's shaft no longer reaches it.
    const build = replaceFitted(chassis(), at('gbx.20', 4, 0, 6, 'gbx'));
    const fault = linkFault(build, { from: 'motor', fromPort: 'out', to: 'gbx', toPort: 'in' });
    expect(fault).toBe('B22 Outrunner is not bolted to 20:1 Planetary.');
  });

  it('allows a power link between components nowhere near each other', () => {
    // The other half of the rule. Wiring is topological: the pack can live at
    // the back of the machine and still feed a controller at the front.
    let build = emptyBuild();
    build = addFitted(build, at('rcv.6', 0, 0, 0, 'rx'));
    build = addFitted(build, at('esc.40', 0, 0, 1, 'esc'));
    build = addFitted(build, at('pwr.3s2200', 6, 0, 9, 'pack'));

    const esc = build.fitted[1]!;
    const pack = build.fitted[2]!;
    expect(adjacent(pack, esc)).toBe(false);
    expect(canLink(build, { from: 'pack', fromPort: 'out', to: 'esc', toPort: 'pwr' })).toBe(true);
  });

  it('refuses two outputs, or two inputs, joined to each other', () => {
    const build = chassis();
    expect(linkFault(build, { from: 'gbx', fromPort: 'in', to: 'wheel', toPort: 'in' })).toContain(
      'both go the same way',
    );
  });

  it('refuses a shaft joined to a power port', () => {
    const build = chassis();
    expect(linkFault(build, { from: 'motor', fromPort: 'out', to: 'esc', toPort: 'pwr' })).toBe(
      'shaft cannot join power.',
    );
  });

  it('refuses a component linked to itself', () => {
    const build = chassis();
    expect(linkFault(build, { from: 'gbx', fromPort: 'out', to: 'gbx', toPort: 'in' })).toBe(
      'A component cannot be linked to itself.',
    );
  });

  it('lets one output fan out but an input take only one source', () => {
    let build = emptyBuild();
    build = addFitted(build, at('pwr.3s2200', 0, 0, 0, 'pack'));
    build = addFitted(build, at('esc.40', 0, 0, 2, 'e1'));
    build = addFitted(build, at('esc.40', 0, 0, 3, 'e2'));
    build = addFitted(build, at('pwr.3s2200', 0, 0, 5, 'spare'));

    // A pack feeding two controllers is how every machine is wired.
    build = addLink(build, { from: 'pack', fromPort: 'out', to: 'e1', toPort: 'pwr' });
    build = addLink(build, { from: 'pack', fromPort: 'out', to: 'e2', toPort: 'pwr' });
    expect(build.links).toHaveLength(2);

    // Two packs into one controller is not.
    const second: Link = { from: 'spare', fromPort: 'out', to: 'e1', toPort: 'pwr' };
    expect(linkFault(build, second)).toBe('40 A Speed Controller already has something on its Pack port.');
    expect(addLink(build, second).links).toHaveLength(2);
  });

  it('reports what is hanging off a port', () => {
    let build = emptyBuild();
    build = addFitted(build, at('pwr.3s2200', 0, 0, 0, 'pack'));
    build = addFitted(build, at('esc.40', 0, 0, 2, 'e1'));
    build = addFitted(build, at('esc.40', 0, 0, 3, 'e2'));
    build = addLink(build, { from: 'pack', fromPort: 'out', to: 'e1', toPort: 'pwr' });
    build = addLink(build, { from: 'pack', fromPort: 'out', to: 'e2', toPort: 'pwr' });

    expect(linksOn(build, 'pack', 'out')).toHaveLength(2);
    expect(linksOn(build, 'e1', 'pwr')).toHaveLength(1);
    expect(linksOn(build, 'e1', 'out')).toHaveLength(0);
  });

  it('removes a link when asked', () => {
    let build = chassis();
    const link: Link = { from: 'motor', fromPort: 'out', to: 'gbx', toPort: 'in' };
    build = addLink(build, link);
    expect(build.links).toHaveLength(1);
    expect(removeLink(build, link).links).toHaveLength(0);
  });

  it('picks the obvious link when one component is dragged onto another', () => {
    const build = chassis();
    expect(suggestLink(build, 'motor', 'gbx')).toEqual({
      from: 'motor',
      fromPort: 'out',
      to: 'gbx',
      toPort: 'in',
    });
    // Nothing sensible joins a wheel to a controller.
    expect(suggestLink(build, 'wheel', 'esc')).toBeNull();
  });
});

describe('links follow their components', () => {
  const wired = (): Build => {
    let build = line([
      ['esc', 'esc.40'],
      ['motor', 'mot.b22'],
      ['gbx', 'gbx.20'],
      ['wheel', 'whl.50'],
    ]);
    build = addFitted(build, at('pwr.3s2200', 4, 0, 0, 'pack'));
    build = addLink(build, { from: 'esc', fromPort: 'out', to: 'motor', toPort: 'pwr' });
    build = addLink(build, { from: 'motor', fromPort: 'out', to: 'gbx', toPort: 'in' });
    build = addLink(build, { from: 'gbx', fromPort: 'out', to: 'wheel', toPort: 'in' });
    return build;
  };

  it('drops every link to a component that is removed', () => {
    // Leaving them behind leaves the solver walking to instances that are not
    // there. It ignores them, so the chain would break with nothing said.
    const build = removeFitted(wired(), 'motor');
    expect(build.links).toHaveLength(1);
    expect(build.links.every((l) => l.from !== 'motor' && l.to !== 'motor')).toBe(true);
  });

  it('drops a shaft link that a move has broken', () => {
    const build = replaceFitted(wired(), at('gbx.20', 9, 0, 9, 'gbx'));
    // Both shaft links through the gearbox are gone; the power link survives.
    expect(build.links).toEqual([{ from: 'esc', fromPort: 'out', to: 'motor', toPort: 'pwr' }]);
  });

  it('keeps a power link across a move, because a wire does not care', () => {
    let build = wired();
    build = addLink(build, { from: 'pack', fromPort: 'out', to: 'esc', toPort: 'pwr' });
    const moved = replaceFitted(build, at('pwr.3s2200', 6, 1, 6, 'pack'));
    expect(moved.links.some((l) => l.from === 'pack')).toBe(true);
  });
});

describe('handing a build to the solver', () => {
  it('produces a machine that solves', () => {
    let build = line([
      ['esc', 'esc.40'],
      ['motor', 'mot.b22'],
      ['gbx', 'gbx.20'],
      ['wheel', 'whl.140'],
    ]);
    build = addFitted(build, at('pwr.3s2200', 2, 0, 0, 'pack'));
    build = addFitted(build, at('rcv.6', 3, 0, 0, 'rx'));
    build = addLink(build, { from: 'pack', fromPort: 'out', to: 'esc', toPort: 'pwr' });
    build = addLink(build, { from: 'rx', fromPort: 'out', to: 'esc', toPort: 'sig' });
    build = addLink(build, { from: 'esc', fromPort: 'out', to: 'motor', toPort: 'pwr' });
    build = addLink(build, { from: 'motor', fromPort: 'out', to: 'gbx', toPort: 'in' });
    build = addLink(build, { from: 'gbx', fromPort: 'out', to: 'wheel', toPort: 'in' });

    const solved = solve(toMachine(build));
    expect(solved.faults).toEqual([]);
    expect(solved.wheels[0]?.wheelTorque.toFixed(2)).toBe('0.83');
  });

  it('leaves the chain dead when the wiring is never made', () => {
    // Every component present and correct, nothing linked. Under the old model
    // this machine drove, because touching was connecting.
    let build = line([
      ['esc', 'esc.40'],
      ['motor', 'mot.b22'],
      ['gbx', 'gbx.20'],
      ['wheel', 'whl.140'],
    ]);
    build = addFitted(build, at('pwr.3s2200', 2, 0, 0, 'pack'));
    build = addFitted(build, at('rcv.6', 3, 0, 0, 'rx'));

    const solved = solve(toMachine(build));
    expect(solved.wheels[0]?.driven).toBe(false);
    expect(solved.faults.some((f) => f.message.includes('Nothing drives a wheel'))).toBe(true);
  });
});
