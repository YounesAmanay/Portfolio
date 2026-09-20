/**
 * The wiring diagram.
 *
 * The thing it has to get right is order: a chain must read left to right as
 * a chain, because that is the only reason to draw it rather than list it.
 * Everything else here is about what it refuses to draw — a diagram with
 * twelve chassis plates in it has buried the circuit.
 */

import { describe, expect, it } from 'vitest';
import { MACHINES } from '@kinetic/content/machines';
import { addFitted, addLink, emptyBuild, type Build, type Fitted } from '@kinetic/machine/build';
import { schematicOf } from '@kinetic/machine/schematic';

const at = (uid: string, componentId: string, x: number, y: number, z: number): Fitted => ({
  uid,
  componentId,
  cell: { x, y, z },
  yaw: 0,
});

/** One complete chain in a line: pack, controller, motor, gearbox, wheel. */
function chain(): Build {
  let b = emptyBuild('CHAIN', 'hobby');
  b = addFitted(b, at('pack', 'pwr.3s2200', 0, 0, 0));
  b = addFitted(b, at('rx', 'rcv.6', 3, 0, 0));
  b = addFitted(b, at('esc', 'esc.20', 0, 1, 0));
  b = addFitted(b, at('motor', 'mot.b22', 0, 2, 0));
  b = addFitted(b, at('gbx', 'gbx.20', 0, 3, 0));
  b = addFitted(b, at('wheel', 'whl.100', 0, 4, 0));

  b = addLink(b, { from: 'pack', fromPort: 'out', to: 'esc', toPort: 'pwr' });
  b = addLink(b, { from: 'rx', fromPort: 'out', to: 'esc', toPort: 'sig' });
  b = addLink(b, { from: 'esc', fromPort: 'out', to: 'motor', toPort: 'pwr' });
  b = addLink(b, { from: 'motor', fromPort: 'out', to: 'gbx', toPort: 'in' });
  b = addLink(b, { from: 'gbx', fromPort: 'out', to: 'wheel', toPort: 'in' });
  return b;
}

const rankOf = (build: Build, uid: string): number =>
  schematicOf(build).nodes.find((n) => n.uid === uid)?.rank ?? -1;

describe('layout', () => {
  it('reads a chain left to right', () => {
    const b = chain();
    expect(rankOf(b, 'pack')).toBe(0);
    expect(rankOf(b, 'esc')).toBe(1);
    expect(rankOf(b, 'motor')).toBe(2);
    expect(rankOf(b, 'gbx')).toBe(3);
    expect(rankOf(b, 'wheel')).toBe(4);
  });

  it('ranks by the longest path, not the shortest', () => {
    // The pack feeds the controller, and a second link runs straight to the
    // motor as well. The motor still belongs after the controller: taking the
    // shortest path would put it in column one beside it, and the diagram
    // would stop reading as a chain.
    let b = chain();
    b = addFitted(b, at('spare', 'esc.20', 5, 0, 0));
    b = addLink(b, { from: 'pack', fromPort: 'out', to: 'spare', toPort: 'pwr' });
    b = addLink(b, { from: 'spare', fromPort: 'out', to: 'motor', toPort: 'pwr' });
    expect(rankOf(b, 'motor')).toBe(2);
  });

  it('gives every node in a column its own row', () => {
    const s = schematicOf(MACHINES[1]!);
    const byColumn = new Map<number, Set<number>>();
    for (const node of s.nodes) {
      const rows = byColumn.get(node.rank) ?? new Set<number>();
      expect(rows.has(node.row), `${node.label} shares a row`).toBe(false);
      rows.add(node.row);
      byColumn.set(node.rank, rows);
    }
  });

  it('survives a machine wired in a loop', () => {
    let b = emptyBuild('LOOP', 'hobby');
    b = addFitted(b, at('a', 'gbx.4', 0, 0, 0));
    b = addFitted(b, at('b', 'gbx.8', 0, 1, 0));
    b = {
      ...b,
      links: [
        { from: 'a', fromPort: 'out', to: 'b', toPort: 'in' },
        { from: 'b', fromPort: 'out', to: 'a', toPort: 'in' },
      ],
    };
    expect(() => schematicOf(b)).not.toThrow();
    expect(schematicOf(b).nodes).toHaveLength(2);
  });
});

describe('what it refuses to draw', () => {
  it('leaves structure and armour out', () => {
    let b = chain();
    b = addFitted(b, at('deck', 'str.plate', 9, 0, 0));
    b = addFitted(b, at('armour', 'arm.steel', 9, 2, 0));
    const labels = schematicOf(b).nodes.map((n) => n.label);
    expect(labels).not.toContain('Chassis Plate');
    expect(labels).not.toContain('Hardened Steel Plate');
  });

  it('draws a motor that is wired to nothing, because that is the point', () => {
    let b = emptyBuild('LONE', 'hobby');
    b = addFitted(b, at('motor', 'mot.b22', 0, 0, 0));
    const s = schematicOf(b);
    expect(s.nodes).toHaveLength(1);
    expect(s.nodes[0]?.role).toBe('CONVERTER');
    expect(s.edges).toHaveLength(0);
  });
});

describe('what each node says', () => {
  it('shows a wheel what it actually does', () => {
    const wheel = schematicOf(chain()).nodes.find((n) => n.uid === 'wheel');
    expect(wheel?.detail).toMatch(/N·m · .* m\/s/);
  });

  it('shows a gearbox its ratio and its stages', () => {
    expect(schematicOf(chain()).nodes.find((n) => n.uid === 'gbx')?.detail).toBe('20:1 · 2 stages');
  });

  it('marks the component an error names', () => {
    // No controller on the chain: the motor is what the fault is about, so the
    // motor is what lights up.
    let b = chain();
    b = { ...b, links: b.links.filter((l) => l.to !== 'motor') };
    const motor = schematicOf(b).nodes.find((n) => n.uid === 'motor');
    expect(motor?.faulted).toBe(true);
    expect(schematicOf(chain()).nodes.every((n) => !n.faulted)).toBe(true);
  });

  it('carries the link kinds, so the diagram can colour them', () => {
    const kinds = new Set(schematicOf(chain()).edges.map((e) => e.kind));
    expect(kinds).toEqual(new Set(['power', 'signal', 'shaft']));
  });
});

describe('the presets', () => {
  it.each(MACHINES.map((m) => [m.name, m] as const))('%s draws without a fault marked', (_n, build) => {
    const s = schematicOf(build);
    expect(s.nodes.length).toBeGreaterThan(4);
    expect(s.nodes.filter((n) => n.faulted)).toEqual([]);
    expect(s.columns).toBeGreaterThanOrEqual(5);
  });
});
