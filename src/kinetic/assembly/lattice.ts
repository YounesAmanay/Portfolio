/**
 * The lattice, without knowing what is sitting on it.
 *
 * Placement, overlap, face contact and flood fill are geometry: they need a
 * footprint, an anchor cell and a quarter-turn, and nothing else. Keeping them
 * here means the rules about what may bolt to what are written once and obeyed
 * by every model that puts things on the grid — the part model the game ships
 * today and the component model replacing it.
 *
 * Two separate copies of "does this overlap" is how two builders start
 * disagreeing about whether a machine is legal.
 */

/** Quarter-turn about the vertical axis. Enough for every practical build. */
export type Yaw = 0 | 1 | 2 | 3;

export interface Cell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Footprint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Anything occupying lattice cells: an id, where it sits, and how big it is. */
export interface Sited {
  readonly uid: string;
  readonly cell: Cell;
  readonly yaw: Yaw;
  readonly footprint: Footprint;
}

/** A footprint as it sits after rotation: yaw swaps x and z on odd turns. */
export function rotatedFootprint(footprint: Footprint, yaw: Yaw): Footprint {
  return yaw % 2 === 0 ? footprint : { x: footprint.z, y: footprint.y, z: footprint.x };
}

export const cellKey = (cell: Cell): string => `${cell.x},${cell.y},${cell.z}`;

/** Every lattice cell something occupies. */
export function cellsOf(sited: Sited): Cell[] {
  const size = rotatedFootprint(sited.footprint, sited.yaw);
  const cells: Cell[] = [];
  for (let x = 0; x < size.x; x += 1) {
    for (let y = 0; y < size.y; y += 1) {
      for (let z = 0; z < size.z; z += 1) {
        cells.push({ x: sited.cell.x + x, y: sited.cell.y + y, z: sited.cell.z + z });
      }
    }
  }
  return cells;
}

/** Map of every filled cell to whatever fills it. */
export function occupancy<T extends Sited>(items: readonly T[], ignoreUid?: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    if (item.uid === ignoreUid) continue;
    for (const cell of cellsOf(item)) map.set(cellKey(cell), item);
  }
  return map;
}

/** The six face neighbours of a cell. Things join across faces, not corners. */
export const FACE_NEIGHBOURS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/**
 * Does this touch anything already placed?
 *
 * Face contact, not corner contact: two parts meeting only at an edge or a
 * corner have no surface to bolt through, and a real machine could not be
 * assembled that way. An empty lattice accepts anything, which is how a build
 * starts.
 */
export function touches<T extends Sited>(items: readonly T[], candidate: Sited, ignoreUid?: string): boolean {
  const occupied = occupancy(items, ignoreUid);
  if (occupied.size === 0) return true;

  for (const cell of cellsOf(candidate)) {
    for (const [dx, dy, dz] of FACE_NEIGHBOURS) {
      const found = occupied.get(cellKey({ x: cell.x + dx, y: cell.y + dy, z: cell.z + dz }));
      if (found !== undefined && found.uid !== candidate.uid) return true;
    }
  }
  return false;
}

/**
 * Can this go here?
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
export function fits<T extends Sited>(items: readonly T[], candidate: Sited, ignoreUid?: string): boolean {
  if (candidate.cell.y < 0) return false;

  const occupied = occupancy(items, ignoreUid);
  if (cellsOf(candidate).some((cell) => occupied.has(cellKey(cell)))) return false;

  return touches(items, candidate, ignoreUid);
}

/**
 * Groups into runs of things that are bolted to each other.
 *
 * One group means one machine. More than one means the build is really several
 * machines that happen to share a save file, and the simulation would silently
 * weld them into one rigid body.
 */
export function groups<T extends Sited>(items: readonly T[]): T[][] {
  const cellOwner = occupancy(items);
  const assigned = new Set<string>();
  const found: T[][] = [];

  for (const item of items) {
    if (assigned.has(item.uid)) continue;

    const members: T[] = [];
    const queue: T[] = [item];
    assigned.add(item.uid);

    while (queue.length > 0) {
      const current = queue.pop();
      if (current === undefined) break;
      members.push(current);

      for (const cell of cellsOf(current)) {
        for (const [dx, dy, dz] of FACE_NEIGHBOURS) {
          const neighbour = cellOwner.get(cellKey({ x: cell.x + dx, y: cell.y + dy, z: cell.z + dz }));
          if (neighbour !== undefined && !assigned.has(neighbour.uid)) {
            assigned.add(neighbour.uid);
            queue.push(neighbour);
          }
        }
      }
    }
    found.push(members);
  }
  return found;
}

/** Bounding box of everything placed, in cells. */
export function bounds(items: readonly Sited[]): { min: Cell; max: Cell } | null {
  if (items.length === 0) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const item of items) {
    for (const cell of cellsOf(item)) {
      minX = Math.min(minX, cell.x); maxX = Math.max(maxX, cell.x + 1);
      minY = Math.min(minY, cell.y); maxY = Math.max(maxY, cell.y + 1);
      minZ = Math.min(minZ, cell.z); maxZ = Math.max(maxZ, cell.z + 1);
    }
  }
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

let counter = 0;

/** Instance ids, unique within a run. */
export function newUid(): string {
  counter += 1;
  return `p${counter.toString(36)}`;
}
