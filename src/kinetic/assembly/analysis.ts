/**
 * Design analysis — the numbers the builder shows you while you work.
 *
 * This module exists because the difference between a robot that works and one
 * that rolls onto its back on the first corner is entirely visible *before* you
 * drive it, if someone bothers to compute it. So we compute it: centre of mass,
 * support polygon, tip angle, traction-limited acceleration, top speed, climb
 * grade, power margin.
 *
 * Every figure here is derived, never authored. @see docs/10-kinetic.md
 */

import { CELL, GRAVITY, clamp } from '../core/units';
import type { PartDef } from '../parts/types';
import {
  occupiedCells,
  partOf,
  placementCentre,
  type Design,
  type Placement,
} from './design';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ContactPoint {
  readonly placement: Placement;
  /** Ground contact position in design space, metres. */
  readonly position: Vec3;
  readonly radius: number;
  readonly grip: number;
  readonly driven: boolean;
}

export interface Analysis {
  readonly mass: number;
  readonly centreOfMass: Vec3;
  readonly contacts: readonly ContactPoint[];
  /** Convex hull of ground contacts, projected to the XZ plane. */
  readonly supportPolygon: readonly Vec3[];

  /** Shortest distance from the CoM's ground projection to the hull edge, m. */
  readonly stabilityMargin: number;
  /** Lateral tilt at which the machine tips, degrees. */
  readonly tipAngle: number;
  /** Lateral acceleration it can take before tipping, in g. */
  readonly tipG: number;

  readonly batteryCapacity: number;
  readonly batteryPeak: number;
  readonly peakDraw: number;
  /** Peak output divided by peak demand. Below 1 means the pack sags. */
  readonly powerMargin: number;

  readonly drivenWheels: number;
  readonly totalTorque: number;
  readonly topSpeed: number;
  /** Steepest slope the drivetrain can climb, degrees — torque or grip limited. */
  readonly maxGrade: number;
  /** Whether grip, rather than torque, is the binding limit. */
  readonly gripLimited: boolean;

  readonly channelsUsed: number;
  readonly channelsAvailable: number;
  readonly totalIntegrity: number;
  readonly cost: number;

  readonly problems: readonly Problem[];
}

export interface Problem {
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

/** Contact patches sit at the bottom of a wheel, so we need its lowest point. */
function contactFor(placement: Placement, part: PartDef): ContactPoint | null {
  const spec = part.drive ?? part.roller;
  if (!spec) return null;

  const centre = placementCentre(placement);
  let lowest = Infinity;
  for (const cell of occupiedCells(placement)) lowest = Math.min(lowest, cell.y * CELL);

  return {
    placement,
    position: { x: centre.x, y: lowest, z: centre.z },
    radius: spec.radius,
    grip: spec.grip,
    driven: Boolean(part.drive),
  };
}

export function analyse(design: Design): Analysis {
  let mass = 0;
  let mx = 0, my = 0, mz = 0;
  let batteryCapacity = 0, batteryPeak = 0, peakDraw = 0;
  let totalTorque = 0, minFreeSpeed = Infinity, wheelRadius = 0;
  let drivenWheels = 0, channelsAvailable = 0, totalIntegrity = 0, cost = 0;
  let hasController = false, hasBattery = false;
  const channels = new Set<string>();
  const contacts: ContactPoint[] = [];

  for (const placement of design.placements) {
    const part = partOf(placement);
    const centre = placementCentre(placement);

    mass += part.mass;
    mx += part.mass * centre.x;
    my += part.mass * centre.y;
    mz += part.mass * centre.z;
    totalIntegrity += part.integrity;
    cost += part.cost;

    if (part.battery) {
      batteryCapacity += part.battery.capacity;
      batteryPeak += part.battery.peakWatts;
      hasBattery = true;
    }
    if (part.controller) {
      channelsAvailable += part.controller.channels;
      hasController = true;
    }
    if (part.drive) {
      drivenWheels += 1;
      totalTorque += part.drive.wheelTorque;
      minFreeSpeed = Math.min(minFreeSpeed, part.drive.freeSpeed);
      wheelRadius = Math.max(wheelRadius, part.drive.radius);
      peakDraw += part.drive.peakWatts;
      channels.add(part.drive.channel);
    }
    if (part.thruster) {
      peakDraw += part.thruster.peakWatts;
      channels.add(part.thruster.channel);
    }
    if (part.weapon) {
      peakDraw += part.weapon.peakWatts;
      channels.add(part.weapon.channel);
    }

    const contact = contactFor(placement, part);
    if (contact) contacts.push(contact);
  }

  const centreOfMass: Vec3 =
    mass > 0 ? { x: mx / mass, y: my / mass, z: mz / mass } : { x: 0, y: 0, z: 0 };

  // ── stability ─────────────────────────────────────────────────────────────
  const hull = convexHullXZ(contacts.map((c) => c.position));
  const stabilityMargin = hull.length >= 3 ? distanceToHullEdge(centreOfMass, hull) : 0;
  const comHeight = Math.max(0.01, centreOfMass.y);
  const tipAngle = hull.length >= 3 ? (Math.atan(stabilityMargin / comHeight) * 180) / Math.PI : 0;
  const tipG = hull.length >= 3 ? stabilityMargin / comHeight : 0;

  // ── drivetrain ────────────────────────────────────────────────────────────
  const topSpeed = drivenWheels > 0 && Number.isFinite(minFreeSpeed) ? minFreeSpeed * wheelRadius : 0;

  // Tractive effort is limited by whichever runs out first: torque at the
  // wheel, or the friction the contact patch can transmit.
  const tractiveFromTorque = wheelRadius > 0 ? totalTorque / wheelRadius : 0;
  const weight = mass * Math.abs(GRAVITY);
  const drivenGrip = contacts.filter((c) => c.driven);
  const avgGrip = drivenGrip.length > 0
    ? drivenGrip.reduce((sum, c) => sum + c.grip, 0) / drivenGrip.length
    : 0;
  // Assume driven wheels carry a share of weight proportional to their count.
  const drivenShare = contacts.length > 0 ? drivenGrip.length / contacts.length : 0;
  const tractiveFromGrip = avgGrip * weight * drivenShare;

  const gripLimited = tractiveFromGrip < tractiveFromTorque;

  // Climb limit. These are two different pieces of physics and using one
  // formula for both is wrong:
  //
  //   Torque-limited — force is fixed, and the slope-parallel component of
  //   weight is mg*sin(theta):        sin(theta) = F / (mg)
  //
  //   Grip-limited  — available friction is mu*N, and N falls off as the slope
  //   steepens (N = mg*cos(theta)), so the mg terms cancel entirely:
  //                                   tan(theta) = mu
  //
  // Treating the grip case as asin(F/mg) once had a 1.35-grip crawler claiming
  // it could climb a vertical wall, because mu > 1 made the ratio exceed 1.
  const gradeFromTorque =
    weight > 0 ? Math.asin(clamp(tractiveFromTorque / weight, 0, 1)) : 0;
  const effectiveMu = avgGrip * drivenShare;
  const gradeFromGrip = Math.atan(effectiveMu);
  const maxGrade =
    drivenGrip.length > 0 ? (Math.min(gradeFromTorque, gradeFromGrip) * 180) / Math.PI : 0;

  const powerMargin = peakDraw > 0 ? batteryPeak / peakDraw : Infinity;

  // ── problems ──────────────────────────────────────────────────────────────
  const problems: Problem[] = [];
  if (design.placements.length === 0) {
    problems.push({ severity: 'error', message: 'Nothing built yet. Start with a chassis plate.' });
  } else {
    if (!hasController) {
      problems.push({ severity: 'error', message: 'No controller. Every machine needs one to accept commands.' });
    }
    if (!hasBattery) {
      problems.push({ severity: 'error', message: 'No battery. Nothing will turn.' });
    }
    if (contacts.length === 0) {
      problems.push({ severity: 'error', message: 'No wheels or tracks. This will sit where you drop it.' });
    }
    if (channels.size > channelsAvailable) {
      problems.push({
        severity: 'error',
        message: `${channels.size} functions need channels but the controller provides ${channelsAvailable}. Fit an Avionics Stack.`,
      });
    }
    if (contacts.length > 0 && contacts.length < 3 && drivenWheels < 2) {
      problems.push({ severity: 'warning', message: 'Fewer than three contact points — this will fall over unless you intend it to balance.' });
    }
    if (hull.length >= 3 && tipG < 0.35) {
      problems.push({
        severity: 'warning',
        message: `Tips at only ${tipG.toFixed(2)} g. Lower the heavy parts or widen the wheelbase.`,
      });
    }
    if (powerMargin < 1 && peakDraw > 0) {
      problems.push({
        severity: 'warning',
        message: `Peak demand ${Math.round(peakDraw)} W exceeds pack output ${Math.round(batteryPeak)} W — it will sag to ${Math.round(powerMargin * 100)}% under load.`,
      });
    }
    if (gripLimited && drivenWheels > 0) {
      problems.push({
        severity: 'warning',
        message: 'Grip-limited, not torque-limited: the wheels will spin before the motors strain. More weight over the drive wheels, or stickier tyres.',
      });
    }
  }

  return {
    mass, centreOfMass, contacts, supportPolygon: hull,
    stabilityMargin, tipAngle, tipG,
    batteryCapacity, batteryPeak, peakDraw, powerMargin,
    drivenWheels, totalTorque, topSpeed, maxGrade, gripLimited,
    channelsUsed: channels.size, channelsAvailable,
    totalIntegrity, cost, problems,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry
// ─────────────────────────────────────────────────────────────────────────────

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

  for (let i = 0; i < hull.length; i++) {
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
