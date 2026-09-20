/**
 * A Build is what the player authors under the component model: components
 * pinned to lattice cells, plus the links between their ports.
 *
 * Placement alone is not enough any more, and that is the point. Under the old
 * part model two parts were connected because they were touching, so a design
 * was fully described by where things sat. A machine has two chains, only one
 * of which is spatial:
 *
 *   - **Mechanical links are spatial.** A motor has to physically line up with
 *     the gearbox it drives. A shaft link is refused unless the two components
 *     share a face, which is what makes chassis layout a puzzle rather than a
 *     list.
 *   - **Electrical links are topological.** You do not route wires by hand,
 *     least of all on a phone. Pack to controller to motor is a link you make
 *     in the schematic, and where the components sit has nothing to do with it.
 *
 * Like a Design, a Build is plain serialisable data: ids, integer cells, a yaw
 * index and pairs of port names.
 */

import {
  bounds,
  cellsOf,
  fits,
  groups,
  occupancy,
  rotatedFootprint,
  touches,
  type Cell,
  type Footprint,
  type Sited,
  type Yaw,
} from '../assembly/lattice';
import { CELL } from '../core/units';
import { requireComponent } from './catalogue';
import { compatible, type ComponentDef, type Port } from './components';
import type { Link, Machine } from './solver';

export { newUid } from '../assembly/lattice';
export type { Cell, Yaw } from '../assembly/lattice';
export type { Link } from './solver';

export interface Fitted {
  /** Instance id, unique within a build. */
  readonly uid: string;
  readonly componentId: string;
  /** Anchor cell — the minimum corner of the component's footprint. */
  readonly cell: Cell;
  readonly yaw: Yaw;
}

export interface Build {
  readonly name: string;
  /** Weight class id from the catalogue. The constraint everything is traded against. */
  readonly weightClass: string;
  readonly fitted: readonly Fitted[];
  readonly links: readonly Link[];
}

export const emptyBuild = (name = 'UNTITLED', weightClass = 'hobby'): Build => ({
  name,
  weightClass,
  fitted: [],
  links: [],
});

// ── the lattice view ───────────────────────────────────────────────────────

interface SitedFitted extends Sited {
  readonly fitted: Fitted;
}

const site = (fitted: Fitted): SitedFitted => ({
  uid: fitted.uid,
  cell: fitted.cell,
  yaw: fitted.yaw,
  footprint: requireComponent(fitted.componentId).footprint,
  fitted,
});

const sited = (build: Build): SitedFitted[] => build.fitted.map(site);

export function componentOf(fitted: Fitted): ComponentDef {
  return requireComponent(fitted.componentId);
}

export function findFitted(build: Build, uid: string): Fitted | undefined {
  return build.fitted.find((f) => f.uid === uid);
}

export function occupiedCells(fitted: Fitted): Cell[] {
  return cellsOf(site(fitted));
}

export function occupancyMap(build: Build): Map<string, Fitted> {
  const map = new Map<string, Fitted>();
  for (const [key, found] of occupancy(sited(build))) map.set(key, found.fitted);
  return map;
}

export function canFit(build: Build, fitted: Fitted, ignoreUid?: string): boolean {
  return fits(sited(build), site(fitted), ignoreUid);
}

/** Runs of components bolted to each other. More than one is more than one machine. */
export function assemblies(build: Build): Fitted[][] {
  return groups(sited(build)).map((group) => group.map((s) => s.fitted));
}

export function buildBounds(build: Build): { min: Cell; max: Cell } | null {
  return bounds(sited(build));
}

/** World-space centre of a component, in metres, relative to the lattice origin. */
export function fittedCentre(fitted: Fitted): { x: number; y: number; z: number } {
  const size = sizeOf(fitted);
  return {
    x: (fitted.cell.x + size.x / 2) * CELL,
    y: (fitted.cell.y + size.y / 2) * CELL,
    z: (fitted.cell.z + size.z / 2) * CELL,
  };
}

export function fittedHalfExtents(fitted: Fitted): { x: number; y: number; z: number } {
  const size = sizeOf(fitted);
  return { x: (size.x * CELL) / 2, y: (size.y * CELL) / 2, z: (size.z * CELL) / 2 };
}

function sizeOf(fitted: Fitted): Footprint {
  return rotatedFootprint(requireComponent(fitted.componentId).footprint, fitted.yaw);
}

/** Are these two components bolted face to face? */
export function adjacent(a: Fitted, b: Fitted): boolean {
  return touches([site(b)], site(a));
}

// ── placement ──────────────────────────────────────────────────────────────

export function addFitted(build: Build, fitted: Fitted): Build {
  return { ...build, fitted: [...build.fitted, fitted] };
}

/**
 * Removes a component and every link that referenced it.
 *
 * Leaving the links behind would leave the solver walking to instances that no
 * longer exist. It ignores them, so the machine would quietly lose a chain
 * with nothing said — the exact silent failure this model exists to end.
 */
export function removeFitted(build: Build, uid: string): Build {
  return {
    ...build,
    fitted: build.fitted.filter((f) => f.uid !== uid),
    links: build.links.filter((l) => l.from !== uid && l.to !== uid),
  };
}

/**
 * Moves or turns a component, dropping any shaft link the move has broken.
 *
 * A mechanical link is a claim that two things line up. Slide the gearbox
 * across the chassis and that claim stops being true, so the link goes with
 * it. Electrical links survive the move, because a wire does not care.
 */
export function replaceFitted(build: Build, fitted: Fitted): Build {
  const moved: Build = {
    ...build,
    fitted: build.fitted.map((f) => (f.uid === fitted.uid ? fitted : f)),
  };
  return { ...moved, links: moved.links.filter((l) => linkFault(moved, l) === null) };
}

// ── linking ────────────────────────────────────────────────────────────────

export function portOf(component: ComponentDef, id: string): Port | undefined {
  return component.ports.find((p) => p.id === id);
}

/** Everything already joined to this port. */
export function linksOn(build: Build, uid: string, portId: string): Link[] {
  return build.links.filter(
    (l) => (l.from === uid && l.fromPort === portId) || (l.to === uid && l.toPort === portId),
  );
}

/**
 * Why this link cannot be made, or null if it can.
 *
 * Returned as prose rather than a code because it goes straight to the player,
 * and "shaft cannot join power" is a more useful thing to read than
 * `ERR_PORT_KIND`.
 */
export function linkFault(build: Build, link: Link): string | null {
  const from = findFitted(build, link.from);
  const to = findFitted(build, link.to);
  if (!from || !to) return 'One end of this link is not on the machine.';
  if (from.uid === to.uid) return 'A component cannot be linked to itself.';

  const source = portOf(componentOf(from), link.fromPort);
  const sink = portOf(componentOf(to), link.toPort);
  if (!source || !sink) return 'That port does not exist.';

  if (source.direction !== 'out' || sink.direction !== 'in') {
    return `${source.label} and ${sink.label} both go the same way.`;
  }
  if (!compatible(source, sink)) {
    return `${source.kind} cannot join ${sink.kind}.`;
  }

  // An input takes one source. Two motors on one shaft, or two packs into one
  // controller, is a mistake with a real-world answer: you do not do that.
  const taken = build.links.some(
    (l) => l !== link && l.to === link.to && l.toPort === link.toPort,
  );
  if (taken) return `${componentOf(to).name} already has something on its ${sink.label} port.`;

  if (build.links.some((l) => l !== link && sameLink(l, link))) return 'Already linked.';

  // The spatial half of the model. Shafts have to line up; wires do not.
  if (source.kind === 'shaft' && !adjacent(from, to)) {
    return `${componentOf(from).name} is not bolted to ${componentOf(to).name}.`;
  }

  return null;
}

const sameLink = (a: Link, b: Link): boolean =>
  a.from === b.from && a.fromPort === b.fromPort && a.to === b.to && a.toPort === b.toPort;

export function canLink(build: Build, link: Link): boolean {
  return linkFault(build, link) === null;
}

export function addLink(build: Build, link: Link): Build {
  if (!canLink(build, link)) return build;
  return { ...build, links: [...build.links, link] };
}

export function removeLink(build: Build, link: Link): Build {
  return { ...build, links: build.links.filter((l) => !sameLink(l, link)) };
}

/**
 * The first link that could legally be made between two components.
 *
 * What the builder reaches for when the player drags one component onto
 * another: there is almost always exactly one sensible answer — a motor onto a
 * gearbox means shaft to shaft — and making them pick it from a menu is
 * ceremony, not a decision.
 */
export function suggestLink(build: Build, fromUid: string, toUid: string): Link | null {
  const from = findFitted(build, fromUid);
  const to = findFitted(build, toUid);
  if (!from || !to) return null;

  for (const out of componentOf(from).ports) {
    if (out.direction !== 'out') continue;
    for (const into of componentOf(to).ports) {
      const candidate: Link = { from: fromUid, fromPort: out.id, to: toUid, toPort: into.id };
      if (canLink(build, candidate)) return candidate;
    }
  }
  return null;
}

// ── handing it to the solver ───────────────────────────────────────────────

export function toMachine(build: Build): Machine {
  return {
    installed: build.fitted.map((f) => ({ uid: f.uid, component: componentOf(f) })),
    links: build.links,
  };
}
