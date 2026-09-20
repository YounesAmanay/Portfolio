/**
 * A Design is what the player authors: a list of parts pinned to lattice cells.
 *
 * It is plain serialisable data — ids, integer cells and a yaw index. No part
 * objects, no geometry, no physics. That is what lets a design be saved,
 * shared as a code, and rebuilt identically on another machine.
 *
 * The lattice rules themselves live in `lattice.ts`, shared with the component
 * model. This file is the part model's view of them.
 */

import { CELL } from '../core/units';
import { requirePart } from '../parts/library';
import type { PartDef } from '../parts/types';
import {
  bounds,
  cellsOf,
  cellKey,
  fits,
  groups,
  occupancy,
  rotatedFootprint,
  touches,
  type Cell,
  type Footprint,
  type Sited,
  type Yaw,
} from './lattice';

export { newUid, rotatedFootprint } from './lattice';
export type { Cell, Yaw } from './lattice';

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

/** A placement as the lattice sees it: a box of cells with an id. */
interface SitedPlacement extends Sited {
  readonly placement: Placement;
}

const site = (placement: Placement): SitedPlacement => ({
  uid: placement.uid,
  cell: placement.cell,
  yaw: placement.yaw,
  footprint: requirePart(placement.partId).footprint,
  placement,
});

const sited = (design: Design): SitedPlacement[] => design.placements.map(site);

/** Every lattice cell a placement occupies. */
export function occupiedCells(placement: Placement): Cell[] {
  return cellsOf(site(placement));
}

/** Map of every filled cell to the placement filling it. */
export function occupancyMap(design: Design): Map<string, Placement> {
  const map = new Map<string, Placement>();
  for (const [key, found] of occupancy(sited(design))) map.set(key, found.placement);
  return map;
}

/** Does this placement touch anything already in the design? */
export function touchesDesign(design: Design, placement: Placement, ignoreUid?: string): boolean {
  return touches(sited(design), site(placement), ignoreUid);
}

/** Can this placement go here? Above the floor, not overlapping, bolted to something. */
export function canPlace(design: Design, placement: Placement, ignoreUid?: string): boolean {
  return fits(sited(design), site(placement), ignoreUid);
}

/** Groups the design into runs of parts that are bolted to each other. */
export function assemblies(design: Design): Placement[][] {
  return groups(sited(design)).map((group) => group.map((s) => s.placement));
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
  const size = sizeOf(placement);
  return {
    x: (placement.cell.x + size.x / 2) * CELL,
    y: (placement.cell.y + size.y / 2) * CELL,
    z: (placement.cell.z + size.z / 2) * CELL,
  };
}

/** Half-extents of a placement in metres, for colliders and meshes. */
export function placementHalfExtents(placement: Placement): { x: number; y: number; z: number } {
  const size = sizeOf(placement);
  return { x: (size.x * CELL) / 2, y: (size.y * CELL) / 2, z: (size.z * CELL) / 2 };
}

function sizeOf(placement: Placement): Footprint {
  return rotatedFootprint(requirePart(placement.partId).footprint, placement.yaw);
}

export function partOf(placement: Placement): PartDef {
  return requirePart(placement.partId);
}

/** Bounding box of the whole design, in cells. */
export function designBounds(design: Design): { min: Cell; max: Cell } | null {
  return bounds(sited(design));
}

export { cellKey };
