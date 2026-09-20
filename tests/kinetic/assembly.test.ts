/**
 * The attachment rule.
 *
 * A machine is one assembly: every part shares a face with another part. This
 * was absent for a long time and its absence was invisible, because the
 * simulation welds a design into a single rigid body whatever its shape — so a
 * drive pod dropped forty cells away in mid air still drove the machine, and
 * every shipped preset turned out to be four to six disconnected islands.
 *
 * These tests exist so that cannot come back silently.
 */

import { describe, expect, it } from 'vitest';
import { analyse } from '@kinetic/assembly/analysis';
import {
  addPlacement,
  assemblies,
  canPlace,
  emptyDesign,
  newUid,
  touchesDesign,
  type Design,
  type Yaw,
} from '@kinetic/assembly/design';
import { PRESETS } from '@kinetic/content/presets';

function place(design: Design, partId: string, x: number, y: number, z: number, yaw: Yaw = 0): Design {
  return addPlacement(design, { uid: newUid(), partId, cell: { x, y, z }, yaw });
}

const at = (partId: string, x: number, y: number, z: number, yaw: Yaw = 0) => ({
  uid: newUid(),
  partId,
  cell: { x, y, z },
  yaw,
});

describe('placement rules', () => {
  it('allows the first part anywhere', () => {
    expect(canPlace(emptyDesign('E'), at('str.plate', 7, 3, 9))).toBe(true);
  });

  it('accepts a part that shares a face', () => {
    const base = place(emptyDesign('B'), 'str.plate', 0, 0, 0); // occupies 0..2, y0, 0..2
    expect(canPlace(base, at('str.plate', 0, 1, 0))).toBe(true); // directly on top
    expect(canPlace(base, at('str.plate', 3, 0, 0))).toBe(true); // butted alongside
  });

  it('rejects a part floating in mid-air', () => {
    const base = place(emptyDesign('B'), 'str.plate', 0, 0, 0);
    expect(canPlace(base, at('str.plate', 0, 2, 0))).toBe(false); // one cell of clear air
    expect(canPlace(base, at('str.plate', 40, 12, 40))).toBe(false); // the old bug
  });

  it('rejects contact at an edge or corner only', () => {
    // Diagonally offset: the two touch along a line, not a face. There is no
    // surface to bolt through, so a real machine could not be assembled here.
    const base = place(emptyDesign('B'), 'str.plate', 0, 0, 0);
    expect(canPlace(base, at('str.plate', 3, 1, 0))).toBe(false);
    expect(canPlace(base, at('str.plate', 3, 1, 3))).toBe(false);
  });

  it('still rejects overlap, and still rejects going below the floor', () => {
    const base = place(emptyDesign('B'), 'str.plate', 0, 0, 0);
    expect(canPlace(base, at('str.plate', 1, 0, 1))).toBe(false);
    expect(canPlace(base, at('str.plate', 0, -1, 0))).toBe(false);
  });

  it('ignores the part being moved when re-checking its own position', () => {
    let design = place(emptyDesign('B'), 'str.plate', 0, 0, 0);
    design = place(design, 'str.plate', 0, 1, 0);
    const moving = design.placements[1];
    expect(moving).toBeDefined();
    // Without the exemption this reads as overlapping itself.
    expect(canPlace(design, { ...moving!, cell: { x: 0, y: 1, z: 0 } }, moving!.uid)).toBe(true);
  });

  it('touchesDesign is what the placement rule is built on', () => {
    const base = place(emptyDesign('B'), 'str.plate', 0, 0, 0);
    expect(touchesDesign(base, at('str.rail', 0, 1, 0))).toBe(true);
    expect(touchesDesign(base, at('str.rail', 0, 3, 0))).toBe(false);
  });
});

describe('assemblies', () => {
  it('counts one group for a connected machine', () => {
    let design = place(emptyDesign('M'), 'str.plate', 0, 0, 0);
    design = place(design, 'str.plate', 0, 1, 0);
    design = place(design, 'bat.lipo3s', 0, 2, 0);
    expect(assemblies(design)).toHaveLength(1);
  });

  it('counts each island separately', () => {
    let design = place(emptyDesign('M'), 'str.plate', 0, 0, 0);
    design = place(design, 'str.plate', 0, 1, 0);
    design = place(design, 'str.plate', 20, 0, 20); // an island
    design = place(design, 'str.plate', 20, 1, 20); // joined to the island
    const groups = assemblies(design);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.length).sort()).toEqual([2, 2]);
  });

  it('is empty for an empty design', () => {
    expect(assemblies(emptyDesign('E'))).toHaveLength(0);
  });
});

describe('analysis', () => {
  it('reports a disconnected design as an error', () => {
    // Built by hand rather than through canPlace, the way a design loaded from
    // storage or pasted as a build code can arrive.
    let design = place(emptyDesign('M'), 'str.plate', 0, 0, 0);
    design = place(design, 'str.plate', 20, 0, 20);
    const errors = analyse(design).problems.filter((p) => p.severity === 'error');
    expect(errors.some((p) => p.message.includes('not bolted to the machine'))).toBe(true);
  });
});

describe('presets', () => {
  it.each(PRESETS.map((d) => [d.name, d] as const))('%s is a single assembly', (_name, design) => {
    expect(assemblies(design)).toHaveLength(1);
  });

  it.each(PRESETS.map((d) => [d.name, d] as const))(
    '%s could be rebuilt part by part under the placement rules',
    (_name, design) => {
      // Replays the build: every part must be legally placeable given the ones
      // before it. A preset that cannot be assembled in the workshop is not a
      // preset, it is a fixture that happens to load.
      let progress = emptyDesign(design.name);
      const remaining = [...design.placements];

      while (remaining.length > 0) {
        const index = remaining.findIndex((p) => canPlace(progress, p));
        expect(
          index,
          `${design.name}: no remaining part can attach (${remaining.map((p) => p.partId).join(', ')})`,
        ).toBeGreaterThanOrEqual(0);
        const [next] = remaining.splice(index, 1);
        progress = addPlacement(progress, next!);
      }
      expect(progress.placements).toHaveLength(design.placements.length);
    },
  );
});
