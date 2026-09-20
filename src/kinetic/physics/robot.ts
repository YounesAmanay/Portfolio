/**
 * Compiling a Design into a physical machine.
 *
 * The chassis is one rigid body carrying a collider per structural part, so
 * Rapier derives mass and inertia from where those parts actually sit — which
 * is why a high battery really does raise the centre of gravity rather than
 * merely printing a worse number in the builder.
 *
 * Wheels are separate bodies on revolute joints with velocity motors. That is
 * the one decision everything else depends on: because the contact is a real
 * friction constraint, wheelspin, torque steer and a front-heavy machine
 * lifting its rear drive wheel all emerge rather than being special-cased.
 *
 * @see docs/10-kinetic.md
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { AMBIENT_C, GRAVITY, PHYSICS_DT, clamp, clamp01 } from '../core/units';
import {
  ARM_DAMPING_RATIO,
  CONTACT_THRESHOLD,
  MAX_DIFFERENTIAL,
  MAX_YAW_RATE,
  TYRE_SLIP_REFERENCE,
  YAW_GAIN,
  FLIPPER_DWELL,
  FLIPPER_RELOAD,
  FLIPPER_REST,
  FLIPPER_STRIKE,
  HAMMER_DWELL,
  HAMMER_RELOAD,
  HAMMER_REST,
  HAMMER_STRIKE,
  SPINNER_TORQUE_CEILING,
} from '../core/tuning';
import {
  occupiedCells,
  partOf,
  placementCentre,
  placementHalfExtents,
  type Design,
  type Placement,
} from '../assembly/design';
import { analyse, contactsFor, type Analysis } from '../assembly/analysis';
import { CELL } from '../core/units';
import { robotCollisionGroups } from './world';
import type { PartDef } from '../parts/types';

export interface ControlInput {
  /** -1 reverse .. +1 forward. */
  drive: number;
  /** -1 left .. +1 right. */
  steer: number;
  /** 0 .. 1 vertical thrust. */
  lift: number;
  /** 0 .. 1 weapon activation. */
  weapon: number;
  aux1: number;
  aux2: number;
}

export const neutralInput = (): ControlInput => ({
  drive: 0, steer: 0, lift: 0, weapon: 0, aux1: 0, aux2: 0,
});

export interface WheelRuntime {
  readonly placement: Placement;
  readonly part: PartDef;
  readonly body: RAPIER.RigidBody;
  readonly joint: RAPIER.ImpulseJoint;
  /** -1 for the left side of the machine, +1 for the right. */
  readonly side: number;
  /** Fraction of the unit's torque this contact delivers. Tracks split it. */
  readonly torqueShare: number;
  /** Slope of the torque curve, N·m per rad/s. Reference figure for the HUD. */
  readonly damping: number;
  /** Motor winding temperature, °C. */
  temperature: number;
  attached: boolean;
}

/** Where an arm weapon is in its cycle. */
export type ArmPhase = 'READY' | 'STRIKING' | 'DWELL' | 'RETURNING' | 'RELOADING';

export interface WeaponRuntime {
  readonly placement: Placement;
  readonly part: PartDef;
  readonly body: RAPIER.RigidBody | null;
  readonly joint: RAPIER.ImpulseJoint | null;
  /** Hinge axis in chassis space, for reading the true spin rate back. */
  readonly axis: RAPIER.Vector3;
  /** Spin rate about that axis, rad/s. Spinners only. */
  spin: number;
  phase: ArmPhase;
  /** Seconds remaining in the current phase. */
  timer: number;
  cooldown: number;
  attached: boolean;
}

export interface ThrusterRuntime {
  readonly placement: Placement;
  readonly part: PartDef;
  /** Offset from the chassis origin, metres. */
  readonly offset: RAPIER.Vector3;
  attached: boolean;
}

export interface PartState {
  readonly placement: Placement;
  readonly part: PartDef;
  /** Remaining impact energy this part can absorb, J. */
  integrity: number;
  attached: boolean;
  /** Collider handle on the chassis, for detaching. */
  colliderHandle: number | null;
}

export interface RobotHandle {
  readonly id: string;
  readonly design: Design;
  readonly analysis: Analysis;
  readonly chassis: RAPIER.RigidBody;
  readonly wheels: WheelRuntime[];
  readonly weapons: WeaponRuntime[];
  readonly thrusters: ThrusterRuntime[];
  readonly parts: Map<string, PartState>;
  /** Design-space origin offset, so render transforms line up with physics. */
  readonly originOffset: RAPIER.Vector3;

  energy: number;
  readonly capacity: number;
  readonly peakWatts: number;
  /** Electrical demand this step, W. */
  draw: number;
  /** The world this machine lives in, for contact queries. */
  readonly world: RAPIER.World;
  /** Static weight carried by each rolling contact, newtons. */
  readonly weightPerContact: number;
  /** Pack output as a fraction of demand; below 1 the machine is sagging. */
  sag: number;
  alive: boolean;
  destroyedReason: string | null;
}

const UP: RAPIER.Vector3 = { x: 0, y: 1, z: 0 };
/** Lateral axis: arm weapons hinge about it, so they swing fore and aft. */
const LATERAL: RAPIER.Vector3 = { x: 1, y: 0, z: 0 };
const ZERO: RAPIER.Vector3 = { x: 0, y: 0, z: 0 };
const IDENTITY: RAPIER.Rotation = { x: 0, y: 0, z: 0, w: 1 };

interface Extents {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Where an arm weapon hinges, relative to its own centre.
 *
 * A hammer pivots at the low rear corner so its head describes a downward arc
 * over the nose. A flipper hinges at the low *front* edge, because a flipper
 * scoops from underneath — hinge it at the back and the plate rises behind the
 * target instead of beneath it. Forward is +Z throughout.
 */
function armPivot(kind: string, half: Extents): RAPIER.Vector3 {
  if (kind === 'FLIPPER') return { x: 0, y: -half.y * 0.8, z: half.z * 0.9 };
  return { x: 0, y: -half.y * 0.55, z: -half.z * 0.7 };
}

/** The striking mass: the head of a hammer, the plate of a flipper. */
function armHead(kind: string, half: Extents): { half: Extents; offset: RAPIER.Vector3 } {
  if (kind === 'FLIPPER') {
    return {
      half: { x: half.x * 0.9, y: half.y * 0.35, z: half.z * 0.85 },
      offset: { x: 0, y: 0, z: 0 },
    };
  }
  return {
    half: { x: half.x * 0.85, y: half.y * 0.3, z: half.z * 0.22 },
    offset: { x: 0, y: half.y * 0.2, z: half.z * 0.55 },
  };
}

/** Travel stops for an arm, radians about its hinge. */
function armLimits(kind: string): { min: number; max: number } {
  return kind === 'FLIPPER'
    ? { min: FLIPPER_REST - 0.05, max: FLIPPER_STRIKE + 0.05 }
    : { min: HAMMER_REST - 0.05, max: HAMMER_STRIKE + 0.05 };
}

/** Rest and strike angles for an arm, radians. */
function armAngles(kind: string): { rest: number; strike: number; dwell: number; reload: number } {
  return kind === 'FLIPPER'
    ? { rest: FLIPPER_REST, strike: FLIPPER_STRIKE, dwell: FLIPPER_DWELL, reload: FLIPPER_RELOAD }
    : { rest: HAMMER_REST, strike: HAMMER_STRIKE, dwell: HAMMER_DWELL, reload: HAMMER_RELOAD };
}

/**
 * Contact force below which no event is raised, in newtons. Set well above the
 * weight of a machine resting on its own wheels, or every frame reports the
 * floor pushing back and the damage model drowns in noise.
 */
// Contact threshold and weapon timings live in core/tuning.

/**
 * Wheel spin axis in chassis space. A pod at yaw 0 spins about X, so the
 * machine's forward direction is +Z — which is the convention the whole
 * builder and camera assume.
 */
function wheelAxis(placement: Placement): RAPIER.Vector3 {
  return placement.yaw % 2 === 0 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
}

export interface SpawnOptions {
  /** Where to put it. `y` is optional: by default it is placed on the ground. */
  readonly position: { x: number; y?: number; z: number };
  readonly yaw?: number;
  readonly id?: string;
  /** Floor height to rest on. Default 0. */
  readonly groundY?: number;
  /** Gap left under the tyres when resting, m. */
  readonly dropGap?: number;
  /** Collision group index. Machines must differ, or they pass through each other. */
  readonly group?: number;
}

/**
 * Body-origin height that puts the lowest tyre just above the floor.
 *
 * Dropping a machine from an arbitrary height is not a neutral act: it lands
 * on one corner, tips, and spends the match on its side. Spawning it *resting*
 * is the difference between testing a design and testing a fall.
 */
export function restHeight(design: Design, groundY = 0, gap = 0.01): number {
  const analysis = analyse(design);
  let lowest = Infinity;

  for (const placement of design.placements) {
    const part = partOf(placement);
    const centre = placementCentre(placement);
    const localY = centre.y - analysis.centreOfMass.y;
    const spec = part.drive ?? part.roller;
    if (spec) {
      lowest = Math.min(lowest, localY - spec.radius);
    } else {
      lowest = Math.min(lowest, localY - placementHalfExtents(placement).y);
    }
  }

  return Number.isFinite(lowest) ? groundY + gap - lowest : groundY + 0.5;
}

export function spawnRobot(
  world: RAPIER.World,
  design: Design,
  options: SpawnOptions,
): RobotHandle {
  const analysis = analyse(design);
  const yaw = options.yaw ?? 0;
  const groups = robotCollisionGroups(options.group ?? 0);

  // Work in design space centred on the footprint so the body's origin is
  // somewhere sensible; Rapier then computes the true centre of mass from the
  // colliders themselves.
  const origin = analysis.centreOfMass;
  const offset: RAPIER.Vector3 = { x: -origin.x, y: -origin.y, z: -origin.z };

  const spawnY =
    options.position.y ?? restHeight(design, options.groundY ?? 0, options.dropGap ?? 0.01);

  // Spawn rotation, needed for every child body's world position. Placing a
  // wheel at its unrotated offset while the chassis carries a yaw leaves the
  // joint violently out of alignment: it snaps the machine onto its side in
  // the first step, which is exactly what happened in the arena but never in
  // a test that spawned facing forward.
  const spawnRotation: RAPIER.Rotation = {
    x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2),
  };
  const toWorld = (localOffset: RAPIER.Vector3): RAPIER.Vector3 => {
    const r = rotateVector(localOffset, spawnRotation);
    return {
      x: options.position.x + r.x,
      y: spawnY + r.y,
      z: options.position.z + r.z,
    };
  };

  const chassis = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(options.position.x, spawnY, options.position.z)
      .setRotation(spawnRotation)
      .setLinearDamping(0.06)
      .setAngularDamping(0.22)
      .setCanSleep(false),
  );

  const parts = new Map<string, PartState>();
  const wheels: WheelRuntime[] = [];
  const weapons: WeaponRuntime[] = [];
  const thrusters: ThrusterRuntime[] = [];

  let capacity = 0;
  let peakWatts = 0;

  for (const placement of design.placements) {
    const part = partOf(placement);
    const centre = placementCentre(placement);
    const local: RAPIER.Vector3 = {
      x: centre.x + offset.x,
      y: centre.y + offset.y,
      z: centre.z + offset.z,
    };

    if (part.battery) {
      capacity += part.battery.capacity;
      peakWatts += part.battery.peakWatts;
    }

    const state: PartState = { placement, part, integrity: part.integrity, attached: true, colliderHandle: null };
    parts.set(placement.uid, state);

    const spec = part.drive ?? part.roller;
    if (spec) {
      // ── rolling contacts: own body, joined by a free hinge ──────────────
      //
      // A wheel pod produces one contact; a track unit produces two, one near
      // each end. That is not cosmetic: modelling a track as a single rolling
      // cylinder makes a two-track machine a two-wheeled one, and it falls
      // over the instant it is asked to move. Using the same contact geometry
      // the builder reports keeps the analysis and the simulation honest with
      // each other.
      const axis = wheelAxis(placement);
      const contacts = contactsFor(placement, part);
      const shareOfMass = part.mass * 0.6 / Math.max(1, contacts.length);

      for (const contact of contacts) {
        const contactLocal: RAPIER.Vector3 = {
          x: contact.position.x + offset.x,
          y: local.y,
          z: contact.position.z + offset.z,
        };

        const worldPos = toWorld(contactLocal);
        const wheelBody = world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(worldPos.x, worldPos.y, worldPos.z)
            .setRotation(spawnRotation)
            .setAngularDamping(0.04)
            .setCanSleep(false),
        );
        world.createCollider(
          RAPIER.ColliderDesc.cylinder(spec.width / 2, spec.radius)
            // A cylinder's axis is Y by default; rotate it onto the spin axis.
            .setRotation(
              axis.x === 1
                ? { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }
                : { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 },
            )
            // The collider carries the tyre's *lateral* grip only. A rigid-body
            // solver takes one friction coefficient, and a tyre has two: it
            // grips going forwards and scrubs going sideways. The longitudinal
            // difference is applied per step in driveRobot.
            //
            // Before this, `lateralGrip` was declared on every drive part in
            // the library and read by nothing, so every tyre had full grip
            // sideways. A skid-steer machine physically could not scrub: asked
            // to turn, all four motors stalled against their own tyres at
            // 40-55 C while the machine lurched about on whatever the contact
            // solver happened to do. The pivot direction was not even
            // consistent — it came out random across a friction sweep.
            .setFriction(spec.lateralGrip)
            .setRestitution(0.1)
            .setMass(shareOfMass)
            .setCollisionGroups(groups)
            .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
            .setContactForceEventThreshold(CONTACT_THRESHOLD),
          wheelBody,
        );

        const joint = world.createImpulseJoint(
          RAPIER.JointData.revolute(contactLocal, { x: 0, y: 0, z: 0 }, axis),
          chassis,
          wheelBody,
          true,
        );

        wheels.push({
          placement, part, body: wheelBody, joint,
          side: Math.sign(contactLocal.x) || 1,
          // Torque is split across a unit's contacts so total output is
          // unchanged whether it rolls on one wheel or a whole track.
          torqueShare: 1 / contacts.length,
          damping: part.drive ? part.drive.wheelTorque / Math.max(1, part.drive.freeSpeed) : 0.02,
          temperature: AMBIENT_C,
          attached: true,
        });
      }
      continue;
    }

    // ── everything else ───────────────────────────────────────────────────
    const half = placementHalfExtents(placement);
    // Every weapon lives in its own body on a hinge, so it must NOT also get a
    // collider on the chassis: two solids in the same place resolve their
    // overlap explosively and launch the machine across the arena.
    const moves = part.weapon !== undefined;

    if (!moves) {
      const collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
          .setTranslation(local.x, local.y, local.z)
          .setMass(part.mass)
          .setFriction(0.5)
          .setRestitution(0.15)
          .setCollisionGroups(groups)
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(CONTACT_THRESHOLD),
        chassis,
      );
      state.colliderHandle = collider.handle;
    }

    if (part.thruster) {
      thrusters.push({ placement, part, offset: local, attached: true });
    }

    if (part.weapon) {
      // Every weapon is a real body on a real hinge.
      //
      // Spinners already were, so their stored energy is honest: a heavy disc
      // at speed carries genuine angular momentum and the chassis feels the
      // reaction torque. Hammers and flippers were not. They had no body at
      // all and "firing" applied an impulse to the machine's own centre of
      // mass — upward for a flipper, downward for a hammer — so a flipper
      // launched *itself* twelve metres into the air and never touched the
      // opponent, and a hammer shoved its own chassis into the floor. Neither
      // weapon could hit anything, because neither weapon moved.
      const spins = part.weapon.kind === 'SPINNER' || part.weapon.kind === 'SAW';
      const bodyPos = toWorld(local);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(bodyPos.x, bodyPos.y, bodyPos.z)
          .setRotation(spawnRotation)
          .setAngularDamping(spins ? 0.015 : 0.4)
          .setCanSleep(false),
      );

      if (spins) {
        // Swept disc: the collider is the circle the blade sweeps, because
        // that is the volume that can actually hit something.
        const reach = Math.max(half.x, half.z) + part.weapon.reach;
        const shape = RAPIER.ColliderDesc.cylinder(Math.max(0.012, half.y * 0.8), reach)
          .setFriction(0.35)
          .setRestitution(0.5)
          .setCollisionGroups(groups)
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(CONTACT_THRESHOLD);

        // The declared moment of inertia, not the one the swept cylinder
        // implies. The builder shows a spinner's stored energy as ½Iω² taken
        // from `inertia`; a solid cylinder of the swept radius works out
        // roughly three times heavier in rotation, so the readout and the
        // simulation disagreed about both spin-up time and hit energy. The
        // number the player is shown is the one that wins.
        const spin = part.weapon.inertia;
        world.createCollider(
          spin !== undefined
            ? shape.setMassProperties(
                part.mass,
                ZERO,
                // Thin disc: half about each transverse axis, as it should be.
                { x: spin * 0.5, y: spin, z: spin * 0.5 },
                IDENTITY,
              )
            : shape.setMass(part.mass),
          body,
        );
      } else {
        // The business end only: a hammer is its head, not its whole envelope.
        const head = armHead(part.weapon.kind, half);
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(head.half.x, head.half.y, head.half.z)
            .setTranslation(head.offset.x, head.offset.y, head.offset.z)
            .setFriction(0.6)
            .setRestitution(0.2)
            .setMass(part.mass)
            .setCollisionGroups(groups)
            .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
            .setContactForceEventThreshold(CONTACT_THRESHOLD),
          body,
        );
      }

      // Spinners turn about their mount; arms hinge sideways so they swing
      // fore and aft, which is the only direction that reaches a target.
      const axis = spins ? UP : LATERAL;
      const pivot = spins ? ZERO : armPivot(part.weapon.kind, half);
      const joint = world.createImpulseJoint(
        RAPIER.JointData.revolute(
          { x: local.x + pivot.x, y: local.y + pivot.y, z: local.z + pivot.z },
          pivot,
          axis,
        ),
        chassis,
        body,
        true,
      );

      if (!spins) {
        const revolute = joint as RAPIER.RevoluteImpulseJoint;
        // Force-based, not acceleration-based: the default model ignores the
        // driven body's inertia, which would make a heavy head swing exactly as
        // fast as a light one and delete the reason mass is a stat on a hammer.
        revolute.configureMotorModel(RAPIER.MotorModel.ForceBased);
        // Stops on the swing, so an arm cannot wind itself round and round.
        const limits = armLimits(part.weapon.kind);
        revolute.setLimits(limits.min, limits.max);
      }
      // Spinners get no motor configured at all. Touching the motor model on a
      // free-spinning joint enables the motor with a zero-velocity target, and
      // it then holds the blade at a dead stop — which is precisely what it was
      // doing: a manual 2.2 N·m torque impulse applied straight to the disc for
      // a full second produced an angular velocity of 0.00 rad/s.
      // They are driven by torque impulses in driveRobot instead.

      weapons.push({
        placement,
        part,
        body,
        joint,
        axis,
        spin: 0,
        phase: 'READY',
        timer: 0,
        cooldown: 0,
        attached: true,
      });
    }
  }

  return {
    id: options.id ?? design.name,
    design, analysis, chassis, wheels, weapons, thrusters, parts,
    originOffset: offset,
    energy: capacity,
    capacity,
    peakWatts,
    draw: 0,
    sag: 1,
    world,
    // Static share, not a live load transfer: good enough as a traction
    // ceiling, and it costs nothing per step to know.
    weightPerContact: (analysis.mass * -GRAVITY) / Math.max(1, wheels.length),
    alive: true,
    destroyedReason: null,
  };
}

/**
 * Applies one step of control. Order matters: demand is totalled first so the
 * battery's sag can scale every actuator by the same factor, which is what
 * makes an under-specified pack feel sluggish rather than simply failing.
 */
export function driveRobot(robot: RobotHandle, input: ControlInput): void {
  if (!robot.alive) {
    robot.draw = 0;
    return;                      // no torque: a dead machine coasts to a stop
  }

  // ── 1. demand ─────────────────────────────────────────────────────────────
  let demand = 0;
  for (const wheel of robot.wheels) {
    if (!wheel.attached || !wheel.part.drive) continue;
    const throttle = Math.abs(clamp(input.drive, -1, 1)) + Math.abs(clamp(input.steer, -1, 1)) * 0.6;
    demand += wheel.part.drive.peakWatts * wheel.torqueShare * clamp01(throttle);
  }
  for (const thruster of robot.thrusters) {
    if (thruster.attached && thruster.part.thruster) demand += thruster.part.thruster.peakWatts * clamp01(input.lift);
  }
  for (const weapon of robot.weapons) {
    if (weapon.attached && weapon.part.weapon) demand += weapon.part.weapon.peakWatts * clamp01(input.weapon);
  }

  robot.draw = demand;
  const hasEnergy = robot.energy > 0;
  robot.sag = !hasEnergy ? 0 : demand > 0 ? Math.min(1, robot.peakWatts / demand) : 1;

  // ── 2. drivetrain ─────────────────────────────────────────────────────────
  //
  // Torque is applied directly rather than through Rapier's joint motor. Two
  // reasons, both of which matter:
  //
  //   1. The DC curve is explicit. tau = tau_stall * (targetW - w) / w_free
  //      gives full torque at stall, zero at free speed, and regenerative
  //      braking when the command is zero — the real curve, not an
  //      approximation of it.
  //   2. The reaction torque lands on the chassis, where physics puts it. That
  //      is what makes a powerful machine squat under acceleration and a
  //      spinner fight its own steering.
  const chassisRotation = robot.chassis.rotation();

  // Steering is closed loop on yaw rate. The player asks for a rate, the
  // controller works out the differential needed to hold it, and every machine
  // therefore turns at a rate you can learn. An open differential instead asks
  // for full opposite lock and spins a light machine at 890 deg/s.
  const up = rotateVector(UP, chassisRotation);
  const spinning = robot.chassis.angvel();
  const yawRate = spinning.x * up.x + spinning.y * up.y + spinning.z * up.z;
  const wantedYaw = clamp(input.steer, -1, 1) * MAX_YAW_RATE;
  const differential = clamp((wantedYaw - yawRate) * YAW_GAIN, -MAX_DIFFERENTIAL, MAX_DIFFERENTIAL);

  for (const wheel of robot.wheels) {
    if (!wheel.attached || !wheel.part.drive) continue;

    const spec = wheel.part.drive;
    // Differential steering: the inside track slows, the outside speeds up.
    // One rule that works for two wheels, four, six, or tracks.
    // Each motor clamps to its own full scale, and the differential is allowed
    // to exceed the throttle, so at full lock the inside wheels drive backwards
    // rather than merely coasting.
    const command = clamp(input.drive - differential * wheel.side, -1, 1);

    const axisWorld = rotateVector(wheelAxis(wheel.placement), chassisRotation);
    const angvel = wheel.body.angvel();
    const spin = angvel.x * axisWorld.x + angvel.y * axisWorld.y + angvel.z * axisWorld.z;

    const targetSpin = command * spec.freeSpeed;
    const curve = clamp((targetSpin - spin) / spec.freeSpeed, -1, 1);
    const torque = spec.wheelTorque * wheel.torqueShare * curve * robot.sag * thermalDerate(wheel);

    // Impulses, not forces. Rapier's addForce/addTorque are *persistent*: they
    // accumulate every step until explicitly reset, so applying a torque each
    // frame silently integrates it. That bug flipped every machine onto its
    // back within a second regardless of how small the torque was.
    const tick = torque * PHYSICS_DT;
    wheel.body.applyTorqueImpulse(
      { x: axisWorld.x * tick, y: axisWorld.y * tick, z: axisWorld.z * tick },
      true,
    );
    // Newton's third law, and it is visible: a geared pod bolts its motor to
    // the chassis, so the chassis feels every newton-metre back.
    robot.chassis.applyTorqueImpulse(
      { x: -axisWorld.x * tick, y: -axisWorld.y * tick, z: -axisWorld.z * tick },
      true,
    );

    // The longitudinal grip the collider is not carrying, applied along the
    // rolling direction so the tyre still bites going forwards.
    applyTraction(robot, wheel, axisWorld, spin);

    stepWheelThermal(wheel, Math.abs(curve) * robot.sag);
  }

  // ── 3. thrust ─────────────────────────────────────────────────────────────
  const lift = clamp01(input.lift) * robot.sag;
  if (lift > 0) {
    const rotation = robot.chassis.rotation();
    for (const thruster of robot.thrusters) {
      if (!thruster.attached || !thruster.part.thruster) continue;
      // Impulse per step, for the same reason as the drivetrain above.
      const magnitude = thruster.part.thruster.thrust * lift * PHYSICS_DT;
      // Thrust acts along the machine's own up axis, so a tilted multirotor
      // translates instead of climbing — exactly how they actually fly.
      const world = rotateVector(UP, rotation);
      robot.chassis.applyImpulseAtPoint(
        { x: world.x * magnitude, y: world.y * magnitude, z: world.z * magnitude },
        worldPoint(robot.chassis, thruster.offset),
        true,
      );
    }
  }

  // ── 4. weapons ────────────────────────────────────────────────────────────
  const fire = clamp01(input.weapon) * robot.sag;
  for (const weapon of robot.weapons) {
    if (!weapon.attached || !weapon.part.weapon || !weapon.joint) continue;
    const spec = weapon.part.weapon;

    if (spec.kind === 'SPINNER' || spec.kind === 'SAW') {
      if (spec.maxSpin === undefined) continue;

      // A velocity motor with its torque capped at the part's rating. The
      // previous call passed `drive / maxSpin` as the motor's damping, which
      // for a 2.2 N·m disc rated at 6000 rpm is 0.0035 — so small that the
      // motor did essentially nothing. Measured, the blade reached 0.0 of its
      // rated 628 rad/s after three seconds at full throttle. The flagship
      // weapon in the game did not turn.
      // Driven by torque impulses, not by the joint motor.
      //
      // Rapier's velocity motor takes a gain rather than a force limit, and to
      // apply a 2.2 N·m torque against a 628 rad/s error the gain has to be
      // 0.0035 — which makes the constraint so soft that the solver does
      // essentially nothing. Measured, the blade held 0.00 rad/s through eight
      // seconds at full throttle either way: the game's flagship weapon did not
      // turn, and had not for as long as it had existed.
      //
      // The wheels already solve this correctly, so spinners now do it the same
      // way: a DC torque curve applied as an impulse, with the equal and
      // opposite reaction applied to the chassis. That reaction is not a detail
      // — it is why a big spinner fights its own steering.
      const current = spinRate(weapon, robot);
      const torque =
        spec.drive * SPINNER_TORQUE_CEILING * fire * clamp(1 - current / spec.maxSpin, -1, 1);
      const axisWorld = rotateVector(weapon.axis, robot.chassis.rotation());
      const tick = torque * PHYSICS_DT;
      const body = weapon.body;
      if (body) {
        body.applyTorqueImpulse(
          { x: axisWorld.x * tick, y: axisWorld.y * tick, z: axisWorld.z * tick },
          true,
        );
        robot.chassis.applyTorqueImpulse(
          { x: -axisWorld.x * tick, y: -axisWorld.y * tick, z: -axisWorld.z * tick },
          true,
        );
      }
      weapon.spin = Math.abs(spinRate(weapon, robot));
      continue;
    }

    stepArm(weapon, robot, fire > 0.5);
  }

  // ── 5. energy ─────────────────────────────────────────────────────────────
  if (demand > 0 && hasEnergy) {
    robot.energy = Math.max(0, robot.energy - (demand * robot.sag * PHYSICS_DT) / 3600);
  }
}

/**
 * True spin rate of a weapon about its own hinge, rad/s.
 *
 * Reading `angvel().y` was wrong the moment the machine tilted: it measures
 * rotation about the *world* vertical, not about the axis the blade actually
 * turns on, so a spinner on a machine up on two wheels reported a speed it did
 * not have. Projecting onto the hinge axis in world space is the honest
 * measurement, and it is the number the damage model reads.
 */
function spinRate(weapon: WeaponRuntime, robot: RobotHandle): number {
  const body = weapon.body;
  if (!body) return 0;
  const axis = rotateVector(weapon.axis, robot.chassis.rotation());
  const relative = body.angvel();
  return relative.x * axis.x + relative.y * axis.y + relative.z * axis.z;
}

/**
 * One step of a hammer or flipper cycle.
 *
 * The arm is driven to an angle by its joint motor rather than thrown by an
 * impulse, so the damage it does is whatever its head's momentum actually
 * delivers on contact. That is the whole point: a hammer hurts because a
 * weighted head arrives fast, not because a number was added somewhere.
 *
 * READY -> STRIKING -> DWELL -> RETURNING -> RELOADING -> READY. The dwell is
 * what stops the arm bouncing straight back off the target, and the reload is
 * what makes firing a decision rather than a button you hold.
 */
function stepArm(weapon: WeaponRuntime, robot: RobotHandle, firing: boolean): void {
  const spec = weapon.part.weapon;
  const joint = weapon.joint as RAPIER.RevoluteImpulseJoint | null;
  if (!spec || !joint) return;

  const { rest, strike, dwell, reload } = armAngles(spec.kind);

  // Rated torque at full deflection, so `drive` means the same thing for an
  // arm as it does for a spinner: how hard this actuator can push.
  const swing = Math.max(0.2, Math.abs(strike - rest));
  const stiffness = spec.drive / swing;
  // Roughly critical for a head of this mass at this radius.
  const inertia = Math.max(0.005, weapon.part.mass * 0.02);
  const damping = 2 * ARM_DAMPING_RATIO * Math.sqrt(stiffness * inertia);

  weapon.timer = Math.max(0, weapon.timer - PHYSICS_DT);

  switch (weapon.phase) {
    case 'READY':
      if (firing) {
        weapon.phase = 'STRIKING';
        // Generous: the arm is allowed longer than it should need, so a swing
        // blocked by the target it just hit still completes its cycle.
        weapon.timer = 0.6;
      }
      break;
    case 'STRIKING':
      if (weapon.timer === 0 || armReached(weapon, robot, strike)) {
        weapon.phase = 'DWELL';
        weapon.timer = dwell;
      }
      break;
    case 'DWELL':
      if (weapon.timer === 0) {
        weapon.phase = 'RETURNING';
        weapon.timer = 0.6;
      }
      break;
    case 'RETURNING':
      if (weapon.timer === 0 || armReached(weapon, robot, rest)) {
        weapon.phase = 'RELOADING';
        weapon.timer = reload;
      }
      break;
    case 'RELOADING':
      if (weapon.timer === 0) weapon.phase = 'READY';
      break;
  }

  const target = weapon.phase === 'STRIKING' || weapon.phase === 'DWELL' ? strike : rest;
  joint.configureMotorPosition(target, stiffness, damping);
  weapon.cooldown = weapon.phase === 'READY' ? 0 : Math.max(weapon.timer, 0);
}

/** Is the arm within a few degrees of the angle it was told to reach? */
function armReached(weapon: WeaponRuntime, robot: RobotHandle, target: number): boolean {
  const body = weapon.body;
  if (!body) return true;
  const angle = armAngle(weapon, robot);
  return Math.abs(angle - target) < 0.09;
}

/**
 * The arm's current angle about its hinge, radians.
 *
 * Taken from the relative rotation of the two bodies rather than from the
 * joint, because Rapier's impulse joints do not report their own position.
 */
function armAngle(weapon: WeaponRuntime, robot: RobotHandle): number {
  const body = weapon.body;
  if (!body) return 0;
  const chassisRotation = robot.chassis.rotation();
  const relative = multiplyQuaternions(conjugate(chassisRotation), body.rotation());
  // Hinge is the lateral axis, so the swing shows up as rotation about x.
  return 2 * Math.atan2(relative.x, relative.w);
}

function conjugate(q: RAPIER.Rotation): RAPIER.Rotation {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

function multiplyQuaternions(a: RAPIER.Rotation, b: RAPIER.Rotation): RAPIER.Rotation {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/** Is this wheel touching anything it could push against? */
function grounded(robot: RobotHandle, wheel: WheelRuntime): boolean {
  if (wheel.body.numColliders() === 0) return false;
  let touching = false;
  robot.world.contactPairsWith(wheel.body.collider(0), () => {
    touching = true;
  });
  return touching;
}

/**
 * Restores a tyre's longitudinal grip.
 *
 * The collider only carries lateral friction, so this supplies the difference
 * along the direction the wheel actually rolls, capped at what that extra grip
 * could deliver against the weight the wheel is carrying. The result is a tyre
 * that accelerates and brakes on its full rated grip while still being able to
 * slide sideways, which is the whole mechanism by which a machine with no
 * steered axle turns.
 */
function applyTraction(
  robot: RobotHandle,
  wheel: WheelRuntime,
  axisWorld: RAPIER.Vector3,
  spin: number,
): void {
  const spec = wheel.part.drive ?? wheel.part.roller;
  if (!spec) return;

  const extra = spec.grip - spec.lateralGrip;
  if (extra <= 0) return;

  // A tyre only grips what it is touching. Applying this unconditionally made
  // it a thruster: a machine with no ground clearance, sitting on its belly
  // with every wheel in the air, drove 10.6 m in the test that exists to prove
  // it cannot move at all.
  if (!grounded(robot, wheel)) return;

  // Rolling direction: the axle crossed with the surface normal.
  const roll = {
    x: axisWorld.y * UP.z - axisWorld.z * UP.y,
    y: axisWorld.z * UP.x - axisWorld.x * UP.z,
    z: axisWorld.x * UP.y - axisWorld.y * UP.x,
  };
  const length = Math.sqrt(roll.x * roll.x + roll.y * roll.y + roll.z * roll.z);
  // Degenerate when the wheel is lying flat, at which point it is not rolling.
  if (length < 1e-4) return;
  roll.x /= length;
  roll.y /= length;
  roll.z /= length;

  // Slip is the gap between how fast the hub is travelling and how fast the
  // tread is laying down road. Rolling without slipping makes these equal.
  const velocity = wheel.body.linvel();
  const along = velocity.x * roll.x + velocity.y * roll.y + velocity.z * roll.z;
  const slip = along - spin * spec.radius;

  const cap = extra * robot.weightPerContact;
  const force = clamp(-slip / TYRE_SLIP_REFERENCE, -1, 1) * cap;
  const tick = force * PHYSICS_DT;
  wheel.body.applyImpulse({ x: roll.x * tick, y: roll.y * tick, z: roll.z * tick }, true);

  // And the torque that force exerts on the wheel about its own axle.
  //
  // Without it this is not friction, it is a rocket: traction turns wheel
  // rotation into motion, so the tyre has to be slowed by exactly what the
  // machine gains. Applying only the linear half let the wheels run 32% past
  // their free speed — 141 rad/s against a rated 107 — and carried SCOUT to
  // 9.6 m/s against a promised 7.5. The builder is only honest if the
  // simulation cannot cheat it.
  const reaction = -force * spec.radius * PHYSICS_DT;
  wheel.body.applyTorqueImpulse(
    { x: axisWorld.x * reaction, y: axisWorld.y * reaction, z: axisWorld.z * reaction },
    true,
  );
}

/** Motors above their continuous rating lose torque, and stalling cooks them. */
function stepWheelThermal(wheel: WheelRuntime, load: number): void {
  const spec = wheel.part.drive;
  if (!spec) return;
  const speed = Math.abs(wheel.body.angvel().x) + Math.abs(wheel.body.angvel().z);
  // Stalled motors heat hardest: current, and therefore heat, peaks at zero RPM.
  const stallFactor = 1 - clamp01(speed / Math.max(1, spec.freeSpeed));
  const heating = load * load * stallFactor * 42;
  const cooling = (wheel.temperature - AMBIENT_C) * 0.55;
  wheel.temperature = Math.max(AMBIENT_C, wheel.temperature + (heating - cooling) * PHYSICS_DT);
}

const DERATE_START = 95;
const DERATE_END = 155;

function thermalDerate(wheel: WheelRuntime): number {
  if (wheel.temperature <= DERATE_START) return 1;
  if (wheel.temperature >= DERATE_END) return 0.06;
  return 1 - 0.94 * ((wheel.temperature - DERATE_START) / (DERATE_END - DERATE_START));
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function rotateVector(v: RAPIER.Vector3, q: RAPIER.Rotation): RAPIER.Vector3 {
  const { x, y, z, w } = q;
  const ix = w * v.x + y * v.z - z * v.y;
  const iy = w * v.y + z * v.x - x * v.z;
  const iz = w * v.z + x * v.y - y * v.x;
  const iw = -x * v.x - y * v.y - z * v.z;
  return {
    x: ix * w + iw * -x + iy * -z - iz * -y,
    y: iy * w + iw * -y + iz * -x - ix * -z,
    z: iz * w + iw * -z + ix * -y - iy * -x,
  };
}

function worldPoint(body: RAPIER.RigidBody, local: RAPIER.Vector3): RAPIER.Vector3 {
  const t = body.translation();
  const r = rotateVector(local, body.rotation());
  return { x: t.x + r.x, y: t.y + r.y, z: t.z + r.z };
}

/** Forward direction of the machine in world space. Robots face +Z. */
export function robotForward(robot: RobotHandle): RAPIER.Vector3 {
  return rotateVector({ x: 0, y: 0, z: 1 }, robot.chassis.rotation());
}

export function robotSpeed(robot: RobotHandle): number {
  const v = robot.chassis.linvel();
  return Math.hypot(v.x, v.y, v.z);
}

/** True when the machine is on its back and cannot right itself. */
export function isInverted(robot: RobotHandle): boolean {
  const up = rotateVector(UP, robot.chassis.rotation());
  return up.y < -0.2;
}

export function cellBounds(design: Design): number {
  let max = 0;
  for (const placement of design.placements) {
    for (const cell of occupiedCells(placement)) {
      max = Math.max(max, Math.abs(cell.x), Math.abs(cell.y), Math.abs(cell.z));
    }
  }
  return max * CELL;
}
