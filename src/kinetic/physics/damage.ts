/**
 * Damage by impact energy.
 *
 * There is no damage stat anywhere in this game. When two machines touch, the
 * energy in the collision is computed from their relative motion, and parts
 * absorb it until they cannot:
 *
 *     E = ½ · m_reduced · v_rel²
 *
 * A spinning weapon adds its rim speed to that relative velocity, which is why
 * a 2.4 kg disc at 6000 RPM throws machines across the arena: the energy was
 * always real, the contact just released it.
 *
 * When a part runs out of integrity its attachment fails and it becomes debris
 * — which is both the most satisfying thing that can happen on screen and
 * exactly how real combat robots come apart.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from './world';
import type { PartState, RobotHandle } from './robot';

/** Below this the contact is a nudge, not a hit. Keeps the log meaningful. */
const MIN_EVENT_ENERGY = 12;
/** Fraction of collision energy an armour part actually absorbs. */
const ABSORPTION = 0.55;

export interface DamageEvent {
  readonly robotId: string;
  readonly partName: string;
  readonly energy: number;
  readonly detached: boolean;
  readonly position: { x: number; y: number; z: number };
}

interface Owned {
  readonly robot: RobotHandle;
  readonly uid: string;
}

export class DamageTracker {
  readonly #owners = new Map<number, Owned>();
  readonly #events = new RAPIER.EventQueue(true);

  /** Registers every collider a machine owns so hits can be attributed. */
  register(robot: RobotHandle): void {
    for (const [uid, state] of robot.parts) {
      if (state.colliderHandle !== null) this.#owners.set(state.colliderHandle, { robot, uid });
    }
    for (const wheel of robot.wheels) {
      for (let i = 0; i < wheel.body.numColliders(); i++) {
        this.#owners.set(wheel.body.collider(i).handle, { robot, uid: wheel.placement.uid });
      }
    }
    for (const weapon of robot.weapons) {
      if (!weapon.body) continue;
      for (let i = 0; i < weapon.body.numColliders(); i++) {
        this.#owners.set(weapon.body.collider(i).handle, { robot, uid: weapon.placement.uid });
      }
    }
  }

  get queue(): RAPIER.EventQueue {
    return this.#events;
  }

  /**
   * Reads this step's contacts and applies their energy. Call immediately
   * after stepping the world with `queue`.
   */
  resolve(physics: PhysicsWorld): DamageEvent[] {
    const out: DamageEvent[] = [];

    this.#events.drainContactForceEvents((event) => {
      const a = this.#owners.get(event.collider1());
      const b = this.#owners.get(event.collider2());
      if (!a && !b) return;
      // Same machine: parts are in one collision group and should never meet,
      // but a joint can still force an overlap. Never self-damage.
      if (a && b && a.robot === b.robot) return;

      const energy = impactEnergy(a, b);
      if (energy < MIN_EVENT_ENERGY) return;

      for (const side of [a, b]) {
        if (!side) continue;
        const result = this.#applyTo(physics, side, energy);
        if (result) out.push(result);
      }
    });

    return out;
  }

  #applyTo(physics: PhysicsWorld, owned: Owned, energy: number): DamageEvent | null {
    const state = owned.robot.parts.get(owned.uid);
    if (!state || !state.attached) return null;

    state.integrity -= energy * ABSORPTION;
    const position = owned.robot.chassis.translation();

    if (state.integrity > 0) {
      return {
        robotId: owned.robot.id,
        partName: state.part.name,
        energy,
        detached: false,
        position: { x: position.x, y: position.y, z: position.z },
      };
    }

    this.#detach(physics, owned.robot, state);
    return {
      robotId: owned.robot.id,
      partName: state.part.name,
      energy,
      detached: true,
      position: { x: position.x, y: position.y, z: position.z },
    };
  }

  /**
   * Tears a part off. The collider leaves the chassis and reappears as a free
   * body carrying the chassis's velocity, so it flies rather than drops.
   */
  #detach(physics: PhysicsWorld, robot: RobotHandle, state: PartState): void {
    state.attached = false;

    if (state.colliderHandle !== null) {
      const collider = physics.world.getCollider(state.colliderHandle);
      if (collider) {
        const translation = collider.translation();
        const rotation = collider.rotation();
        const half = collider.halfExtents?.() ?? { x: 0.04, y: 0.04, z: 0.04 };

        physics.world.removeCollider(collider, true);
        this.#owners.delete(state.colliderHandle);
        state.colliderHandle = null;

        const debris = physics.world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(translation.x, translation.y, translation.z)
            .setRotation(rotation)
            .setLinvel(robot.chassis.linvel().x, robot.chassis.linvel().y + 1.4, robot.chassis.linvel().z)
            .setAngvel({ x: 4, y: 6, z: 3 }),
        );
        physics.world.createCollider(
          RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
            .setMass(state.part.mass)
            .setRestitution(0.35),
          debris,
        );
        physics.trackDebris(debris);
      }
    }

    // Losing a wheel is not the same as losing a bracket.
    for (const wheel of robot.wheels) {
      if (wheel.placement.uid === state.placement.uid) wheel.attached = false;
    }
    for (const weapon of robot.weapons) {
      if (weapon.placement.uid === state.placement.uid) weapon.attached = false;
    }
    for (const thruster of robot.thrusters) {
      if (thruster.placement.uid === state.placement.uid) thruster.attached = false;
    }

    // A machine is finished when it loses the parts that make it a machine.
    if (state.part.controller) {
      robot.alive = false;
      robot.destroyedReason = 'Controller torn off — no way to command it.';
    } else if (state.part.battery && remainingCapacity(robot) <= 0) {
      robot.alive = false;
      robot.destroyedReason = 'Last battery destroyed.';
    } else if (robot.wheels.every((w) => !w.attached) && robot.thrusters.every((t) => !t.attached)) {
      robot.alive = false;
      robot.destroyedReason = 'Drivetrain gone — nothing left to move it.';
    }
  }
}

function remainingCapacity(robot: RobotHandle): number {
  let total = 0;
  for (const [, state] of robot.parts) {
    if (state.attached && state.part.battery) total += state.part.battery.capacity;
  }
  return total;
}

/**
 * Energy at the contact.
 *
 * Reduced mass is used rather than either body's own, because that is what
 * actually governs a two-body collision: a light part hitting a heavy machine
 * exchanges energy on the light part's terms.
 */
function impactEnergy(a: Owned | undefined, b: Owned | undefined): number {
  const bodyA = a ? a.robot.chassis : null;
  const bodyB = b ? b.robot.chassis : null;

  const va = bodyA?.linvel() ?? { x: 0, y: 0, z: 0 };
  const vb = bodyB?.linvel() ?? { x: 0, y: 0, z: 0 };
  const relative = Math.hypot(va.x - vb.x, va.y - vb.y, va.z - vb.z);

  // A spinning weapon's rim is moving far faster than its machine is.
  const rim = Math.max(rimSpeed(a), rimSpeed(b));
  const speed = relative + rim;

  const ma = bodyA?.mass() ?? 1e6;
  const mb = bodyB?.mass() ?? 1e6;
  const reduced = (ma * mb) / (ma + mb);

  return 0.5 * reduced * speed * speed;
}

function rimSpeed(owned: Owned | undefined): number {
  if (!owned) return 0;
  const weapon = owned.robot.weapons.find((w) => w.placement.uid === owned.uid);
  if (!weapon?.body || !weapon.part.weapon?.reach) return 0;
  const angular = weapon.body.angvel();
  const omega = Math.hypot(angular.x, angular.y, angular.z);
  return omega * weapon.part.weapon.reach;
}
