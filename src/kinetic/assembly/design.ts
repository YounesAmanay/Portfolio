/**
 * A Design is what the player authors: a list of parts pinned to lattice cells.
 *
 * It is plain serialisable data — ids, integer cells and a yaw index. No part
 * objects, no geometry, no physics. That is what lets a design be saved,
 * shared as a code, and rebuilt identically on another machine.
 */

import { CELL } from '../core/units';
import { requirePart } from '../parts/library';
import type { Footprint, PartDef } from '../parts/types';


/** Quarter-turn about the vertical axis. Enough for every practical build. */
export type Yaw = 0 | 1 | 2 | 3;

export interface Cell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Placement {
  /** Instance id, unique within a design. */
  readonly uid: string;
  readonly partId: string;
  /** Anchor cell — the minimum corner of the part's footprint. */
  readonly cell: Cell;
  readonly yaw: Yaw;
}

export interface Design {
  readonly name: string;
  readonly placements: readonly Placement[];
}

export const emptyDesign = (name = 'UNTITLED'): Design => ({ name, placements: [] });

/** A footprint as it sits after rotation: yaw swaps x and z on odd turns. */
export function rotatedFootprint(footprint: Footprint, yaw: Yaw): Footprint {
  return yaw % 2 === 0
    ? footprint
    : { x: footprint.z, y: footprint.y, z: footprint.x };
}

/** Every lattice cell a placement occupies. */
export function occupiedCells(placement: Placement): Cell[] {
  const part = requirePart(placement.partId);
  const size = rotatedFootprint(part.footprint, placement.yaw);
  const cells: Cell[] = [];
  for (let x = 0; x < size.x; x++) {
    for (let y = 0; y < size.y; y++) {
      for (let z = 0; z < size.z; z++) {
        cells.push({
          x: placement.cell.x + x,
          y: placement.cell.y + y,
          z: placement.cell.z + z,
        });
      }
    }
  }
  return cells;
}

const key = (cell: Cell): string => `${cell.x},${cell.y},${cell.z}`;

/** Map of every filled cell to the placement filling it. */
export function occupancyMap(design: Design): Map<string, Placement> {
  const map = new Map<string, Placement>();
  for (const placement of design.placements) {
    for (const cell of occupiedCells(placement)) map.set(key(cell), placement);
  }
  return map;
}

/** The six face neighbours of a cell. Parts join across faces, not corners. */
const FACE_NEIGHBOURS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/**
 * Does this placement touch anything already in the design?
 *
 * Face contact, not corner contact: two parts meeting only at an edge or a
 * corner have no surface to bolt through, and a real machine could not be
 * assembled that way.
 */
export function touchesDesign(design: Design, placement: Placement, ignoreUid?: string): boolean {
  const occupied = occupancyMapExcluding(design, ignoreUid);
  if (occupied.size === 0) return true;

  for (const cell of occupiedCells(placement)) {
    for (const [dx, dy, dz] of FACE_NEIGHBOURS) {
      const neighbour = key({ x: cell.x + dx, y: cell.y + dy, z: cell.z + dz });
      const found = occupied.get(neighbour);
      if (found !== undefined && found.uid !== placement.uid) return true;
    }
  }
  return false;
}

/**
 * Can this placement go here?
 *
 * Three rules: stay above the floor, do not overlap anything already placed,
 * and bolt to something. Everything beyond that is allowed — including
 * machines that cannot possibly work, because discovering that is the lesson.
 *
 * The attachment rule is the one that was missing, and its absence made the
 * whole premise incoherent: a part could be dropped forty cells away in mid
 * air and the simulation would weld it into the chassis anyway, so a wheel
 * bolted to nothing still drove the machine. A lattice you can build
 * disconnected islands on is not an assembly system.
 */
export function canPlace(design: Design, placement: Placement, ignoreUid?: string): boolean {
  if (placement.cell.y < 0) return false;

  const occupied = occupancyMapExcluding(design, ignoreUid);
  const overlaps = occupiedCells(placement).some((cell) => occupied.has(key(cell)));
  if (overlaps) return false;

  return touchesDesign(design, placement, ignoreUid);
}

function occupancyMapExcluding(design: Design, ignoreUid?: string): Map<string, Placement> {
  const occupied = new Map<string, Placement>();
  for (const existing of design.placements) {
    if (existing.uid === ignoreUid) continue;
    for (const cell of occupiedCells(existing)) occupied.set(key(cell), existing);
  }
  return occupied;
}

/**
 * Groups the design into runs of parts that are bolted to each other.
 *
 * One group means one machine. More than one means the design is really
 * several machines that happen to share a save file, and the simulation would
 * silently weld them into one rigid body.
 */
export function assemblies(design: Design): Placement[][] {
  const cellOwner = occupancyMap(design);
  const groupOf = new Map<string, number>();
  const groups: Placement[][] = [];

  for (const placement of design.placements) {
    if (groupOf.has(placement.uid)) continue;

    // Flood fill outward across face contacts from this placement.
    const index = groups.length;
    const members: Placement[] = [];
    const queue: Placement[] = [placement];
    groupOf.set(placement.uid, index);

    while (queue.length > 0) {
      const current = queue.pop();
      if (current === undefined) break;
      members.push(current);

      for (const cell of occupiedCells(current)) {
        for (const [dx, dy, dz] of FACE_NEIGHBOURS) {
          const found = cellOwner.get(key({ x: cell.x + dx, y: cell.y + dy, z: cell.z + dz }));
          if (found !== undefined && !groupOf.has(found.uid)) {
            groupOf.set(found.uid, index);
            queue.push(found);
          }
        }
      }
    }
    groups.push(members);
  }
  return groups;
}

export function addPlacement(design: Design, placement: Placement): Design {
  return { ...design, placements: [...design.placements, placement] };
}

export function removePlacement(design: Design, uid: string): Design {
  return { ...design, placements: design.placements.filter((p) => p.uid !== uid) };
}

export function replacePlacement(design: Design, placement: Placement): Design {
  return {
    ...design,
    placements: design.placements.map((p) => (p.uid === placement.uid ? placement : p)),
  };
}

/** World-space centre of a placement, in metres, relative to the lattice origin. */
export function placementCentre(placement: Placement): { x: number; y: number; z: number } {
  const part = requirePart(placement.partId);
  const size = rotatedFootprint(part.footprint, placement.yaw);
  return {
    x: (placement.cell.x + size.x / 2) * CELL,
    y: (placement.cell.y + size.y / 2) * CELL,
    z: (placement.cell.z + size.z / 2) * CELL,
  };
}

/** Half-extents of a placement in metres, for colliders and meshes. */
export function placementHalfExtents(placement: Placement): { x: number; y: number; z: number } {
  const part = requirePart(placement.partId);
  const size = rotatedFootprint(part.footprint, placement.yaw);
  return { x: (size.x * CELL) / 2, y: (size.y * CELL) / 2, z: (size.z * CELL) / 2 };
}

export function partOf(placement: Placement): PartDef {
  return requirePart(placement.partId);
}

/** Bounding box of the whole design, in cells. */
export function designBounds(design: Design): { min: Cell; max: Cell } | null {
  if (design.placements.length === 0) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const placement of design.placements) {
    for (const cell of occupiedCells(placement)) {
      minX = Math.min(minX, cell.x); maxX = Math.max(maxX, cell.x + 1);
      minY = Math.min(minY, cell.y); maxY = Math.max(maxY, cell.y + 1);
      minZ = Math.min(minZ, cell.z); maxZ = Math.max(maxZ, cell.z + 1);
    }
  }
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

let counter = 0;
export function newUid(): string {
  counter += 1;
  return `p${counter.toString(36)}`;
}
