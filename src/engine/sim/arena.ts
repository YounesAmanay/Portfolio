/**
 * Arenas — the ground the match is fought over.
 *
 * Arenas are pure data plus a few spatial queries. Arena choice is folded into
 * the match seed, so an Architect cannot tune a build for one map and ride it.
 *
 * @see docs/01-rules.md §9
 */

import { distance, distanceToSegment, vec, type Vec2 } from '../core/vec';
import type { ArenaId } from '../domain/ids';
import { ARENA_HEIGHT, ARENA_WIDTH } from '../tuning';

export const ZONE_KINDS = ['COOLANT', 'ION_STORM', 'RUBBLE'] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

/** Blocks movement and line of sight. */
export interface Pylon {
  readonly position: Vec2;
  readonly radius: number;
}

/** Modifies whoever stands in it. */
export interface Zone {
  readonly kind: ZoneKind;
  readonly position: Vec2;
  readonly radius: number;
}

export interface Arena {
  readonly id: ArenaId;
  readonly name: string;
  readonly description: string;
  readonly width: number;
  readonly height: number;
  readonly pylons: readonly Pylon[];
  readonly zones: readonly Zone[];
}

/** Zones containing a point, in stable declaration order. */
export function zonesAt(arena: Arena, point: Vec2): readonly Zone[] {
  return arena.zones.filter((zone) => distance(zone.position, point) <= zone.radius);
}

export function inZone(arena: Arena, point: Vec2, kind: ZoneKind): boolean {
  return arena.zones.some(
    (zone) => zone.kind === kind && distance(zone.position, point) <= zone.radius,
  );
}

/** Nearest zone of a kind, or undefined. Drives the `SEEK_COOLANT` action. */
export function nearestZone(arena: Arena, point: Vec2, kind: ZoneKind): Zone | undefined {
  let best: Zone | undefined;
  let bestDist = Infinity;
  for (const zone of arena.zones) {
    if (zone.kind !== kind) continue;
    const d = distance(zone.position, point);
    if (d < bestDist) {
      bestDist = d;
      best = zone;
    }
  }
  return best;
}

/**
 * Line of sight between two points. A pylon blocks if the segment passes
 * within its radius. Weapons flagged `arcing` bypass this check entirely.
 */
export function hasLineOfSight(arena: Arena, from: Vec2, to: Vec2): boolean {
  for (const pylon of arena.pylons) {
    if (distanceToSegment(pylon.position, from, to) < pylon.radius) return false;
  }
  return true;
}

/** Helper for content files. Keeps arena definitions to a readable shape. */
export function pylon(x: number, y: number, radius: number): Pylon {
  return { position: vec(x, y), radius };
}

export function zone(kind: ZoneKind, x: number, y: number, radius: number): Zone {
  return { kind, position: vec(x, y), radius };
}

export const ARENA_BOUNDS = { width: ARENA_WIDTH, height: ARENA_HEIGHT } as const;

export const ZONE_INFO: Readonly<Record<ZoneKind, { label: string; colour: string; blurb: string }>> = {
  COOLANT: { label: 'Coolant vent', colour: '#4de2ff', blurb: 'Dissipation x1.8 while standing in it. Contested ground.' },
  ION_STORM: { label: 'Ion storm', colour: '#c06bff', blurb: 'Drains 6 EN/s. Punishes camping.' },
  RUBBLE: { label: 'Rubble', colour: '#8a7f6d', blurb: 'Speed x0.75, evasion +10. Trade mobility for cover.' },
};
