/**
 * Planar geometry the builder needs to answer "will it tip?".
 *
 * A machine stands up as long as its centre of mass, dropped straight down,
 * lands inside the shape its ground contacts make. That is a convex hull and a
 * point-to-edge distance, and both are wanted by every analysis that has an
 * opinion about stability — so they live here rather than in one of them.
 */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Andrew's monotone chain, on the XZ plane. */
export function convexHullXZ(points: readonly Vec3[]): Vec3[] {
  if (points.length < 3) return [...points];

  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (o: Vec3, a: Vec3, b: Vec3): number =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);

  const build = (input: Vec3[]): Vec3[] => {
    const stack: Vec3[] = [];
    for (const point of input) {
      while (stack.length >= 2 && cross(stack[stack.length - 2]!, stack[stack.length - 1]!, point) <= 0) {
        stack.pop();
      }
      stack.push(point);
    }
    stack.pop();
    return stack;
  };

  const hull = [...build(sorted), ...build([...sorted].reverse())];
  return hull.length >= 3 ? hull : [...points];
}

/**
 * Shortest distance from the point's ground projection to the hull boundary.
 * Negative when the projection falls outside — the machine is already tipping.
 */
export function distanceToHullEdge(point: Vec3, hull: readonly Vec3[]): number {
  let minDistance = Infinity;
  let inside = true;

  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const length = Math.sqrt(ex * ex + ez * ez);
    if (length < 1e-9) continue;

    // Signed distance: positive is to the left of the directed edge.
    const side = ((point.x - a.x) * ez - (point.z - a.z) * ex) / length;
    if (side > 0) inside = false;
    minDistance = Math.min(minDistance, Math.abs(side));
  }

  if (!Number.isFinite(minDistance)) return 0;
  return inside ? minDistance : -minDistance;
}
