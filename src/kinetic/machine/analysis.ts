/**
 * What the builder tells you about a machine while you assemble it.
 *
 * The difference between a machine that works and one that rolls onto its back
 * on the first corner is entirely visible before you drive it, if someone
 * bothers to compute it. So this computes it.
 *
 * The rule that matters here is that **nothing is computed twice**. Torque,
 * speed, current and sag come out of `solve()` and are passed through
 * untouched; the simulation integrates the same object. What this file adds is
 * only what the solver has no business knowing — where the mass sits, whether
 * the machine stands up, whether it fits its weight class, and whether grip or
 * torque is the thing actually holding it back.
 *
 * If the readout and the arena ever disagree, the builder is lying, and that
 * is the one failure the whole model exists to prevent.
 */

import { convexHullXZ, distanceToHullEdge, type Vec3 } from '../core/geometry';
import { CELL, GRAVITY, clamp } from '../core/units';
import {
  componentOf,
  fittedCentre,
  occupiedCells,
  assemblies,
  toMachine,
  type Build,
  type Fitted,
} from './build';
import { weightClass, type WeightClass } from './catalogue';
import { solve, type Fault, type Solution, type SolvedWheel } from './solver';

export interface Contact {
  readonly uid: string;
  /** Where the tyre meets the floor, in build space, metres. */
  readonly position: Vec3;
  readonly radius: number;
  readonly grip: number;
  readonly driven: boolean;
}

export interface MachineAnalysis {
  /** Everything the solver derived, untouched. */
  readonly solution: Solution;

  readonly mass: number;
  readonly weightClass: WeightClass;
  /** Kilograms left before the machine is over its class. Negative is over. */
  readonly massMargin: number;

  readonly centreOfMass: Vec3;
  readonly contacts: readonly Contact[];
  /** Convex hull of ground contacts, projected to the XZ plane. */
  readonly supportPolygon: readonly Vec3[];
  /** Shortest distance from the CoM's ground projection to the hull edge, m. */
  readonly stabilityMargin: number;
  /** Lateral tilt at which the machine tips, degrees. */
  readonly tipAngle: number;
  /** Lateral acceleration it can take before tipping, in g. */
  readonly tipG: number;
  /** Gap between the lowest bodywork and the wheel contact line, m. */
  readonly groundClearance: number;

  readonly drivenWheels: number;
  /** Sum of every driven wheel's torque, N·m. */
  readonly totalTorque: number;
  /** Set by the slowest driven wheel: the others are tied to it through the floor. */
  readonly topSpeed: number;
  /** Force at the floor, whichever of torque and grip runs out first, newtons. */
  readonly tractiveEffort: number;
  /** True when the tyres give up before the motors do. */
  readonly gripLimited: boolean;
  /** Steepest slope it can climb, degrees. */
  readonly maxGrade: number;
  /** Standing-start acceleration, m/s². */
  readonly acceleration: number;

  readonly channelsUsed: number;
  readonly channelsAvailable: number;
  /** Seconds at full throttle, from the pack or from the tank. */
  readonly endurance: number;

  readonly integrity: number;
  readonly cost: number;

  readonly problems: readonly Fault[];
}

/**
 * Where a wheel actually touches the floor.
 *
 * One radius below its centre, not the bottom of its lattice box. A 140 mm
 * wheel in a two-cell box has a centimetre of air under it, and using the box
 * would put the contact patch underground and report a ground clearance a
 * centimetre worse than the machine has.
 */
function contactOf(fitted: Fitted, wheel: SolvedWheel): Contact {
  const centre = fittedCentre(fitted);
  return {
    uid: fitted.uid,
    position: { x: centre.x, y: centre.y - wheel.radius, z: centre.z },
    radius: wheel.radius,
    grip: wheel.grip,
    driven: wheel.driven,
  };
}

export function analyseBuild(build: Build): MachineAnalysis {
  const solution = solve(toMachine(build));
  const byUid = new Map(build.fitted.map((f) => [f.uid, f]));
  const wheelsByUid = new Map(solution.wheels.map((w) => [w.uid, w]));

  // ── mass and where it sits ──────────────────────────────────────────────
  let mass = 0;
  let mx = 0, my = 0, mz = 0;
  let integrity = 0;
  let cost = 0;
  let channelsAvailable = 0;

  for (const fitted of build.fitted) {
    const component = componentOf(fitted);
    const centre = fittedCentre(fitted);
    mass += component.mass;
    mx += component.mass * centre.x;
    my += component.mass * centre.y;
    mz += component.mass * centre.z;
    integrity += component.integrity;
    cost += component.cost;
    channelsAvailable += component.receiver?.channels ?? 0;
  }

  const centreOfMass: Vec3 =
    mass > 0 ? { x: mx / mass, y: my / mass, z: mz / mass } : { x: 0, y: 0, z: 0 };

  const cls = weightClass(build.weightClass);
  const massMargin = cls.limit - mass;

  // ── standing up ─────────────────────────────────────────────────────────
  const contacts: Contact[] = [];
  for (const wheel of solution.wheels) {
    const fitted = byUid.get(wheel.uid);
    if (fitted) contacts.push(contactOf(fitted, wheel));
  }

  const hull = convexHullXZ(contacts.map((c) => c.position));
  const standing = hull.length >= 3;
  const stabilityMargin = standing ? distanceToHullEdge(centreOfMass, hull) : 0;
  const comHeight = Math.max(0.01, centreOfMass.y);
  const tipAngle = standing ? (Math.atan(stabilityMargin / comHeight) * 180) / Math.PI : 0;
  const tipG = standing ? stabilityMargin / comHeight : 0;

  // Ground clearance: the lowest bodywork against the lowest contact patch.
  // Negative means the machine rests on its belly with the wheels turning in
  // the air — the single most common first build mistake.
  let lowestBody = Infinity;
  for (const fitted of build.fitted) {
    if (wheelsByUid.has(fitted.uid)) continue;
    for (const cell of occupiedCells(fitted)) lowestBody = Math.min(lowestBody, cell.y * CELL);
  }
  const lowestContact = contacts.reduce((low, c) => Math.min(low, c.position.y), Infinity);
  const groundClearance =
    Number.isFinite(lowestBody) && Number.isFinite(lowestContact) ? lowestBody - lowestContact : 0;

  // ── what it can actually do ─────────────────────────────────────────────
  const driven = solution.wheels.filter((w) => w.driven);
  const totalTorque = driven.reduce((sum, w) => sum + w.wheelTorque, 0);

  // Top speed is the *slowest* driven wheel's, not the fastest. They are tied
  // together through the floor, so a machine geared 8:1 on one side and 40:1
  // on the other does not do eleven metres a second, it fights itself.
  const topSpeed = driven.reduce((slowest, w) => Math.min(slowest, w.freeSpeed * w.radius), Infinity);

  const weight = mass * Math.abs(GRAVITY);
  const fromTorque = driven.reduce((sum, w) => sum + (w.radius > 0 ? w.wheelTorque / w.radius : 0), 0);

  // Friction available at the driven patches. The driven wheels carry a share
  // of the weight proportional to how many of the contacts they are.
  const averageGrip = driven.length > 0 ? driven.reduce((sum, w) => sum + w.grip, 0) / driven.length : 0;
  const drivenShare = contacts.length > 0 ? driven.length / contacts.length : 0;
  const fromGrip = averageGrip * weight * drivenShare;

  const gripLimited = driven.length > 0 && fromGrip < fromTorque;
  const tractiveEffort = driven.length > 0 ? Math.min(fromTorque, fromGrip) : 0;
  const acceleration = mass > 0 ? tractiveEffort / mass : 0;

  // Two different pieces of physics, and one formula for both is wrong.
  //
  //   Torque-limited — force is fixed and the slope-parallel component of
  //   weight is mg·sin(theta):   sin(theta) = F / mg
  //   Grip-limited   — friction is mu·N and N falls as the slope steepens
  //   (N = mg·cos(theta)), so the mg terms cancel:   tan(theta) = mu
  //
  // Treating the grip case as asin(F/mg) once had a 1.35-grip crawler claiming
  // it could climb a vertical wall, because mu > 1 made the ratio exceed one.
  const gradeFromTorque = weight > 0 ? Math.asin(clamp(fromTorque / weight, 0, 1)) : 0;
  const gradeFromGrip = Math.atan(averageGrip * drivenShare);
  const maxGrade = driven.length > 0 ? (Math.min(gradeFromTorque, gradeFromGrip) * 180) / Math.PI : 0;

  // ── endurance ───────────────────────────────────────────────────────────
  // Seconds at full throttle. A pack runs down; a tank burns.
  const burn = build.fitted.reduce((total, f) => total + (componentOf(f).engine?.burnRate ?? 0), 0);
  const electrical = solution.demandAmps > 0 ? (solution.energy / (solution.demandAmps * solution.volts)) * 3600 : 0;
  const petrol = burn > 0 ? (solution.fuel / burn) * 3600 : 0;
  const endurance = burn > 0 ? (electrical > 0 ? Math.min(electrical, petrol) : petrol) : electrical;

  // ── channels ────────────────────────────────────────────────────────────
  // One per commanded thing. A receiver channel is spent the moment something
  // is wired to it, whether or not you ever move that stick.
  const channelsUsed = new Set(build.links.filter(isSignal(build)).map((l) => `${l.to}:${l.toPort}`)).size;

  // ── problems ────────────────────────────────────────────────────────────
  const problems: Fault[] = [];

  if (build.fitted.length === 0) {
    problems.push({ severity: 'error', message: 'Nothing built yet. Start with a chassis plate.' });
  } else {
    const groups = assemblies(build);
    if (groups.length > 1) {
      const loose = build.fitted.length - (groups[0]?.length ?? 0);
      problems.push({
        severity: 'error',
        message:
          `${loose} component${loose === 1 ? ' is' : 's are'} not bolted to the machine. ` +
          'Everything must share a face with the rest of the build.',
      });
    }

    if (massMargin < 0) {
      problems.push({
        severity: 'error',
        message: `${mass.toFixed(2)} kg in a ${cls.limit} kg class. Take off ${Math.abs(massMargin).toFixed(2)} kg.`,
      });
    } else if (massMargin < cls.limit * 0.03) {
      problems.push({
        severity: 'warning',
        message: `${(massMargin * 1000).toFixed(0)} g under the limit. Nothing left for a repair or a heavier tyre.`,
      });
    }

    // Everything the solver found about the chains themselves.
    problems.push(...solution.faults);

    if (channelsUsed > channelsAvailable) {
      problems.push({
        severity: 'error',
        message: `${channelsUsed} things are wired for commands and the receiver has ${channelsAvailable} channels.`,
      });
    }

    if (contacts.length > 0 && groundClearance <= 0) {
      problems.push({
        severity: 'error',
        message:
          `No ground clearance — the body sits ${Math.abs(groundClearance * 100).toFixed(1)} cm below the contact ` +
          'line. It will rest on its belly with the wheels turning in the air.',
      });
    } else if (contacts.length > 0 && groundClearance < 0.02) {
      problems.push({
        severity: 'warning',
        message: `Only ${(groundClearance * 1000).toFixed(0)} mm of ground clearance. Anything on the floor will ground it out.`,
      });
    }

    if (contacts.length > 0 && contacts.length < 3) {
      problems.push({
        severity: 'warning',
        message: 'Fewer than three contact points — this will fall over unless you meant it to balance.',
      });
    }

    if (standing && tipG < 0.35) {
      problems.push({
        severity: 'warning',
        message: `Tips at only ${tipG.toFixed(2)} g. Lower the heavy components or widen the wheelbase.`,
      });
    }

    // Being grip-limited is the normal state of a combat robot — you gear for
    // push and accept that the floor gives out first. Saying so on every
    // machine is noise, so this fires only when the excess is large enough
    // that the gearing and motor mass are being carried for nothing.
    if (gripLimited && fromTorque > fromGrip * 3) {
      problems.push({
        severity: 'warning',
        message:
          `${(fromTorque / fromGrip).toFixed(1)}x more tractive effort than the tyres can put down. ` +
          'The extra gearing and motor are weight you cannot use: gear it higher, or put more ' +
          'weight over the driven wheels.',
      });
    }
  }

  return {
    solution,
    mass,
    weightClass: cls,
    massMargin,
    centreOfMass,
    contacts,
    supportPolygon: hull,
    stabilityMargin,
    tipAngle,
    tipG,
    groundClearance,
    drivenWheels: driven.length,
    totalTorque,
    topSpeed: Number.isFinite(topSpeed) ? topSpeed : 0,
    tractiveEffort,
    gripLimited,
    maxGrade,
    acceleration,
    channelsUsed,
    channelsAvailable,
    endurance,
    integrity,
    cost,
    problems,
  };
}

/** Links carrying commands, which are the ones that spend a channel. */
function isSignal(build: Build) {
  const byUid = new Map(build.fitted.map((f) => [f.uid, f]));
  return (link: { from: string; fromPort: string }): boolean => {
    const from = byUid.get(link.from);
    if (!from) return false;
    return componentOf(from).ports.some((p) => p.id === link.fromPort && p.kind === 'signal');
  };
}
