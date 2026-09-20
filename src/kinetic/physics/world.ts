/**
 * The physics world.
 *
 * A thin wrapper over Rapier that owns the fixed timestep and the arena
 * geometry. Rapier is loaded once and cached, because its WASM init is async
 * and every caller needs the same instance.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { GRAVITY, PHYSICS_DT } from '../core/units';

let ready: Promise<typeof RAPIER> | null = null;

/** Initialises Rapier's WASM exactly once. Safe to await from anywhere. */
export function initPhysics(): Promise<typeof RAPIER> {
  ready ??= RAPIER.init().then(() => RAPIER);
  return ready;
}

export { RAPIER };

/**
 * Collision groups.
 *
 * A machine's own parts must not collide with each other: adjacent track units
 * have overlapping end rollers, a spinner's swept circle passes over its own
 * chassis, and armour is deliberately flush against structure. Letting those
 * resolve as contacts locks the whole machine solid.
 *
 * Each robot gets one membership bit and a filter that excludes it, so parts
 * ignore their own machine while still colliding with the arena and with
 * everyone else. Static geometry lives in the top bit and collides with all.
 */
export const STATIC_GROUP = 1 << 15;
export const MAX_ROBOT_GROUPS = 15;

export function robotCollisionGroups(index: number): number {
  const membership = 1 << (index % MAX_ROBOT_GROUPS);
  const filter = 0xffff & ~membership;
  return (membership << 16) | filter;
}

export const staticCollisionGroups = (): number => (STATIC_GROUP << 16) | 0xffff;

export interface ArenaSurface {
  readonly friction: number;
  readonly restitution: number;
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  /** Bodies that should be removed once they have been still for a while. */
  readonly #debris: { body: RAPIER.RigidBody; bornAt: number }[] = [];
  #elapsed = 0;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    this.world.timestep = PHYSICS_DT;
  }

  get elapsed(): number {
    return this.#elapsed;
  }

  step(): void {
    this.world.step();
    this.#elapsed += PHYSICS_DT;
    this.#cullDebris();
  }

  /** A large static floor. Friction is what makes tyre choice matter. */
  addGround(size: number, surface: ArenaSurface): RAPIER.RigidBody {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size / 2, 0.5, size / 2)
        .setTranslation(0, -0.5, 0)
        .setFriction(surface.friction)
        .setRestitution(surface.restitution)
        .setCollisionGroups(staticCollisionGroups()),
      body,
    );
    return body;
  }

  addStaticBox(
    position: { x: number; y: number; z: number },
    halfExtents: { x: number; y: number; z: number },
    surface: ArenaSurface,
    rotationY = 0,
  ): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(position.x, position.y, position.z)
        .setRotation({ x: 0, y: Math.sin(rotationY / 2), z: 0, w: Math.cos(rotationY / 2) }),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
        .setFriction(surface.friction)
        .setRestitution(surface.restitution)
        .setCollisionGroups(staticCollisionGroups()),
      body,
    );
    return body;
  }

  /** Walls around the arena so nothing drives off into the void. */
  addArenaWalls(size: number, height: number, surface: ArenaSurface): void {
    const half = size / 2;
    const thickness = 0.4;
    const spots: [number, number, number, number][] = [
      [0, height / 2, -half, 0],
      [0, height / 2, half, 0],
      [-half, height / 2, 0, Math.PI / 2],
      [half, height / 2, 0, Math.PI / 2],
    ];
    for (const [x, y, z, rot] of spots) {
      this.addStaticBox({ x, y, z }, { x: half, y: height / 2, z: thickness }, surface, rot);
    }
  }

  /** Registers a detached part so it can be cleaned up later. */
  trackDebris(body: RAPIER.RigidBody): void {
    this.#debris.push({ body, bornAt: this.#elapsed });
  }

  /**
   * Removes debris that has settled, oldest first. Detached parts are the
   * visual payoff of a good hit, so they linger — but an arena that never
   * clears them turns into a slideshow by the third match.
   */
  #cullDebris(): void {
    if (this.#debris.length === 0) return;
    const MAX_DEBRIS = 48;
    const MIN_AGE = 6;

    while (this.#debris.length > MAX_DEBRIS) {
      const oldest = this.#debris.shift();
      if (oldest) this.world.removeRigidBody(oldest.body);
    }
    const head = this.#debris[0];
    if (head && this.#elapsed - head.bornAt > MIN_AGE) {
      const v = head.body.linvel();
      if (Math.hypot(v.x, v.y, v.z) < 0.15) {
        this.world.removeRigidBody(head.body);
        this.#debris.shift();
      }
    }
  }

  dispose(): void {
    this.world.free();
  }
}
