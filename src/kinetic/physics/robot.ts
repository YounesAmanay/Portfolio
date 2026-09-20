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
import { AMBIENT_C, PHYSICS_DT, clamp, clamp01 } from '../core/units';
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

export interface WeaponRuntime {
  readonly placement: Placement;
  readonly part: PartDef;
  readonly body: RAPIER.RigidBody | null;
  readonly joint: RAPIER.ImpulseJoint | null;
  spin: number;
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
  /** Pack output as a fraction of demand; below 1 the machine is sagging. */
  sag: number;
  alive: boolean;
  destroyedReason: string | null;
}

const UP: RAPIER.Vector3 = { x: 0, y: 1, z: 0 };

/**
 * Contact force below which no event is raised, in newtons. Set well above the
 * weight of a machine resting on its own wheels, or every frame reports the
 * floor pushing back and the damage model drowns in noise.
 */
const CONTACT_THRESHOLD = 260;

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
            .setFriction(spec.grip)
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
    // A spinning weapon lives in its own body, so it must NOT also get a
    // collider on the chassis: two solids in the same place resolve their
    // overlap explosively and launch the machine across the arena.
    const spins = part.weapon?.kind === 'SPINNER' || part.weapon?.kind === 'SAW';

    if (!spins) {
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

    if (spins && part.weapon) {
      // Spinners are their own body so their stored energy is real: a heavy
      // disc at speed carries genuine angular momentum, and the chassis feels
      // the reaction torque when it spins up.
      const spinPos = toWorld(local);
      const spinBody = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(spinPos.x, spinPos.y, spinPos.z)
          .setRotation(spawnRotation)
          .setAngularDamping(0.015)
          .setCanSleep(false),
      );
      // Swept radius of the weapon, from its own footprint plus its reach.
      const reach = Math.max(half.x, half.z) + part.weapon.reach;
      world.createCollider(
        RAPIER.ColliderDesc.cylinder(Math.max(0.012, half.y * 0.8), reach)
          .setFriction(0.35)
          .setRestitution(0.5)
          .setMass(part.mass)
          .setCollisionGroups(groups)
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(CONTACT_THRESHOLD),
        spinBody,
      );
      const spinJoint = world.createImpulseJoint(
        RAPIER.JointData.revolute(local, { x: 0, y: 0, z: 0 }, UP),
        chassis,
        spinBody,
        true,
      );
      weapons.push({ placement, part, body: spinBody, joint: spinJoint, spin: 0, cooldown: 0, attached: true });
    } else if (part.weapon) {
      // Flippers and hammers act through the chassis, so they need no body.
      weapons.push({ placement, part, body: null, joint: null, spin: 0, cooldown: 0, attached: true });
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
  for (const wheel of robot.wheels) {
    if (!wheel.attached || !wheel.part.drive) continue;

    const spec = wheel.part.drive;
    // Differential steering: the inside track slows, the outside speeds up.
    // One rule that works for two wheels, four, six, or tracks.
    const command = clamp(input.drive - input.steer * wheel.side, -1, 1);

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
    if (!weapon.attached || !weapon.part.weapon) continue;
    const spec = weapon.part.weapon;

    if (spec.kind === 'SPINNER' || spec.kind === 'SAW') {
      const joint = weapon.joint as RAPIER.RevoluteImpulseJoint | null;
      if (joint && spec.maxSpin) {
        joint.configureMotorVelocity(spec.maxSpin * fire, spec.drive / spec.maxSpin);
        const body = weapon.body;
        if (body) weapon.spin = Math.abs(body.angvel().y);
      }
      continue;
    }

    weapon.cooldown = Math.max(0, weapon.cooldown - PHYSICS_DT);
    if (fire > 0.5 && weapon.cooldown === 0) {
      weapon.cooldown = spec.kind === 'FLIPPER' ? 2.5 : 1.2;
      const rotation = robot.chassis.rotation();
      const dir = rotateVector(spec.kind === 'FLIPPER' ? UP : { x: 0, y: -1, z: 0 }, rotation);
      const impulse = spec.drive * PHYSICS_DT * 12;   // already a one-shot
      robot.chassis.applyImpulseAtPoint(
        { x: dir.x * impulse, y: dir.y * impulse, z: dir.z * impulse },
        worldPoint(robot.chassis, { x: 0, y: 0, z: 0 }),
        true,
      );
    }
  }

  // ── 5. energy ─────────────────────────────────────────────────────────────
  if (demand > 0 && hasEnergy) {
    robot.energy = Math.max(0, robot.energy - (demand * robot.sag * PHYSICS_DT) / 3600);
  }
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
