/**
 * A machine, described in the terms the simulation actually needs.
 *
 * The spawner used to walk a `Design` and reach into `PartDef` behaviour
 * blocks, which made the physics a function of the part model. It is not. A
 * machine is a list of solids with mass and extent, some rolling contacts with
 * torque curves, some weapons on hinges, and where the whole thing balances.
 *
 * Both models produce one of these, so a machine assembled from real
 * components is simulated by exactly the same code as one built from parts —
 * and more importantly, the numbers in a plan built from a `Build` come
 * straight out of the solver, so the arena integrates precisely what the
 * builder showed you.
 */

import { analyse, contactsFor } from '../assembly/analysis';
import {
  occupiedCells,
  partOf,
  placementCentre,
  placementHalfExtents,
  type Design,
} from '../assembly/design';
import type { Yaw } from '../assembly/lattice';
import type { Vec3 } from '../core/geometry';
import { CELL } from '../core/units';
import { analyseBuild } from '../machine/analysis';
import { packEnergy } from '../machine/components';
import {
  componentOf,
  fittedCentre,
  fittedHalfExtents,
  occupiedCells as occupiedBuildCells,
  type Build,
} from '../machine/build';
import { meshPartOfComponent, meshPartOfPart, type MeshPart } from '../appearance';
import type { DriveSpec, WeaponSpecRuntime } from './robot';

/** One rolling contact. A wheel makes one; a track makes one near each end. */
export interface PlannedContact {
  /** Unique per contact, so two contacts on one track are separable. */
  readonly uid: string;
  /** Contact centre in build space, metres. */
  readonly centre: Vec3;
  /** Fraction of the unit's torque this contact delivers. */
  readonly share: number;
  /**
   * Mass of the rigid body this contact becomes, kg.
   *
   * Everything that turns with the wheel: under the part model that is most of
   * a pod, which already contained its motor and gearbox; under the component
   * model the solver adds them up from the actual chain. A wheel body given
   * only the tyre's own mass is far too light to take a friction impulse
   * steadily, and the machine shakes itself sideways.
   */
  readonly mass: number;
}

export interface PlannedPart {
  readonly uid: string;
  readonly name: string;
  /** Centre of its lattice box in build space, metres. */
  readonly centre: Vec3;
  readonly half: Vec3;
  readonly yaw: Yaw;
  readonly mass: number;
  /** Impact energy it absorbs before its mount fails, J. */
  readonly integrity: number;
  /** Lowest point of the thing itself, metres. Tyres sit above their box. */
  readonly bottom: number;
  /** How to draw it. */
  readonly render: MeshPart;

  readonly drive?: DriveSpec;
  readonly contacts?: readonly PlannedContact[];
  readonly weapon?: WeaponSpecRuntime;
  readonly thruster?: { readonly thrust: number; readonly peakWatts: number };

  /**
   * True when this is what accepts commands. Tear it off and the machine is
   * finished, however intact the rest of it is.
   */
  readonly commands?: boolean;
  /** Stored energy in this part alone, W·h. Lose them all and it stops. */
  readonly stores?: number;
}

export interface MachinePlan {
  readonly name: string;
  readonly parts: readonly PlannedPart[];
  readonly mass: number;
  readonly centreOfMass: Vec3;
  /** Stored energy, W·h. */
  readonly energy: number;
  /** What the pack can deliver, W. */
  readonly peakWatts: number;
  /** What the builder promised, m/s. The arena must not beat it. */
  readonly topSpeed: number;
}

// ── the part model ─────────────────────────────────────────────────────────

export function planFromDesign(design: Design): MachinePlan {
  const analysis = analyse(design);
  const parts: PlannedPart[] = [];
  let energy = 0;
  let peakWatts = 0;

  for (const placement of design.placements) {
    const part = partOf(placement);
    const centre = placementCentre(placement);
    const half = placementHalfExtents(placement);

    if (part.battery) {
      energy += part.battery.capacity;
      peakWatts += part.battery.peakWatts;
    }

    const rolling = part.drive ?? part.roller;
    const drive: DriveSpec | undefined = rolling
      ? {
          driven: part.drive !== undefined,
          radius: rolling.radius,
          width: rolling.width,
          grip: rolling.grip,
          lateralGrip: rolling.lateralGrip,
          wheelTorque: part.drive?.wheelTorque ?? 0,
          freeSpeed: part.drive?.freeSpeed ?? 0,
          peakWatts: part.drive?.peakWatts ?? 0,
        }
      : undefined;

    // A wheel pod produces one contact; a track unit produces two, one near
    // each end. That is not cosmetic — modelling a track as a single rolling
    // cylinder makes a two-track machine a two-wheeled one, and it falls over
    // the instant it is asked to move.
    const found = rolling ? contactsFor(placement, part) : [];
    const contacts: PlannedContact[] = found.map((contact, index) => ({
      uid: `${placement.uid}#${index}`,
      centre: { x: contact.position.x, y: centre.y, z: contact.position.z },
      share: 1 / found.length,
      mass: (part.mass * 0.6) / found.length,
    }));

    const weapon: WeaponSpecRuntime | undefined = part.weapon
      ? {
          kind: part.weapon.kind,
          torque: part.weapon.drive,
          maxSpin: part.weapon.maxSpin ?? 0,
          inertia: part.weapon.inertia ?? Math.max(0.005, part.mass * 0.02),
          reach: part.weapon.reach,
          peakWatts: part.weapon.peakWatts,
        }
      : undefined;

    let boxBottom = Infinity;
    for (const cell of occupiedCells(placement)) boxBottom = Math.min(boxBottom, cell.y * CELL);

    parts.push({
      uid: placement.uid,
      name: part.name,
      centre,
      half,
      yaw: placement.yaw,
      mass: part.mass,
      integrity: part.integrity,
      bottom: rolling ? centre.y - rolling.radius : boxBottom,
      render: meshPartOfPart(part),
      ...(drive ? { drive } : {}),
      ...(contacts.length > 0 ? { contacts } : {}),
      ...(weapon ? { weapon } : {}),
      ...(part.thruster ? { thruster: { thrust: part.thruster.thrust, peakWatts: part.thruster.peakWatts } } : {}),
      ...(part.controller ? { commands: true } : {}),
      ...(part.battery ? { stores: part.battery.capacity } : {}),
    });
  }

  return {
    name: design.name,
    parts,
    mass: analysis.mass,
    centreOfMass: analysis.centreOfMass,
    energy,
    peakWatts,
    topSpeed: analysis.topSpeed,
  };
}

// ── the component model ────────────────────────────────────────────────────

/**
 * Every number here comes out of the solver.
 *
 * Nothing is recomputed and nothing is invented: a wheel's torque, a disc's
 * free speed and a flipper's pivot torque are the same objects the readout
 * showed. If the arena and the builder ever disagree about what a machine
 * does, it is because someone added a second calculation, and that is the one
 * failure this whole model exists to prevent.
 */
export function planFromBuild(build: Build): MachinePlan {
  const report = analyseBuild(build);
  const solution = report.solution;
  const wheels = new Map(solution.wheels.map((w) => [w.uid, w]));
  const spinners = new Map(solution.spinners.map((w) => [w.uid, w]));
  const arms = new Map(solution.arms.map((a) => [a.uid, a]));

  const parts: PlannedPart[] = [];

  for (const fitted of build.fitted) {
    const component = componentOf(fitted);
    const centre = fittedCentre(fitted);
    const half = fittedHalfExtents(fitted);

    const wheel = wheels.get(fitted.uid);
    const spinner = spinners.get(fitted.uid);
    const arm = arms.get(fitted.uid);

    const drive: DriveSpec | undefined = wheel
      ? {
          driven: wheel.driven,
          radius: wheel.radius,
          width: wheel.width,
          grip: wheel.grip,
          lateralGrip: wheel.lateralGrip,
          wheelTorque: wheel.wheelTorque,
          freeSpeed: wheel.freeSpeed,
          peakWatts: wheel.peakWatts,
        }
      : undefined;

    let weapon: WeaponSpecRuntime | undefined;
    if (spinner) {
      weapon = {
        kind: 'SPINNER',
        torque: spinner.torque,
        maxSpin: spinner.freeSpeed,
        inertia: spinner.inertia,
        reach: spinner.reach,
        peakWatts: spinner.peakAmps * solution.volts,
      };
    } else if (arm) {
      weapon = {
        kind: arm.kind,
        torque: arm.torque,
        maxSpin: 0,
        // About the pivot, which is what the joint motor is tuned against.
        inertia: arm.inertia,
        reach: arm.reach,
        // A gas ram costs the pack nothing. It costs shots instead.
        peakWatts: 0,
      };
    }

    let boxBottom = Infinity;
    for (const cell of occupiedBuildCells(fitted)) boxBottom = Math.min(boxBottom, cell.y * CELL);

    parts.push({
      uid: fitted.uid,
      name: component.name,
      centre,
      half,
      yaw: fitted.yaw,
      mass: component.mass,
      integrity: component.integrity,
      // A 140 mm tyre in a two-cell box has a centimetre of air under it.
      bottom: wheel ? centre.y - wheel.radius : boxBottom,
      render: meshPartOfComponent(component, wheel?.driven === true),
      ...(drive ? { drive } : {}),
      ...(wheel ? { contacts: [{ uid: fitted.uid, centre, share: 1, mass: wheel.drivelineMass * 0.6 }] } : {}),
      ...(weapon ? { weapon } : {}),
      ...(component.receiver ? { commands: true } : {}),
      ...(component.pack ? { stores: packEnergy(component.pack) } : {}),
    });
  }

  return {
    name: build.name,
    parts,
    mass: report.mass,
    centreOfMass: report.centreOfMass,
    energy: solution.energy,
    peakWatts: solution.supplyAmps * solution.volts,
    topSpeed: report.topSpeed,
  };
}

// ── shared geometry ────────────────────────────────────────────────────────

/**
 * Body-origin height that puts the lowest point just above the floor.
 *
 * Dropping a machine from an arbitrary height is not a neutral act: it lands
 * on one corner, tips, and spends the match on its side. Spawning it *resting*
 * is the difference between testing a design and testing a fall.
 */
export function planRestHeight(plan: MachinePlan, groundY = 0, gap = 0.01): number {
  let lowest = Infinity;
  for (const part of plan.parts) {
    lowest = Math.min(lowest, part.bottom - plan.centreOfMass.y);
  }
  return Number.isFinite(lowest) ? groundY + gap - lowest : groundY + 0.5;
}
