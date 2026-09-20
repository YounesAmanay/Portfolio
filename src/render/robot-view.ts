/**
 * Turning designs and simulated machines into things on screen.
 *
 * Two jobs that share geometry: the workshop needs a static view of a Design
 * laid out in lattice space, and the arena needs a live view whose transforms
 * follow physics bodies every frame.
 *
 * Wheels are separate bodies in the simulation, so they are separate objects
 * here too — which is what lets you watch a tyre spin, and watch it keep
 * spinning uselessly when the machine is stuck on its belly.
 */

import * as THREE from 'three';
import {
  placementCentre,
  placementHalfExtents,
  partOf,
  type Design,
  type Placement,
} from '../kinetic/assembly/design';
import type { PlannedPart } from '../kinetic/physics/plan';
import type { RobotHandle } from '../kinetic/physics/robot';
import { meshPartOfPart } from '../kinetic/appearance';
import { buildPartMesh } from './part-mesh';

const YAW_QUATS = [0, 1, 2, 3].map((yaw) =>
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (yaw * Math.PI) / 2),
);

/** One placement as a positioned object in design space. */
export function buildPlacementObject(placement: Placement, ghost = false): THREE.Object3D {
  const part = partOf(placement);
  const half = placementHalfExtents(placement);
  const centre = placementCentre(placement);

  const mesh = buildPartMesh(meshPartOfPart(part), { x: half.x * 2, y: half.y * 2, z: half.z * 2 }, { ghost });
  mesh.position.set(centre.x, centre.y, centre.z);
  mesh.quaternion.copy(YAW_QUATS[placement.yaw]!);
  mesh.userData.uid = placement.uid;
  return mesh;
}

/** One planned part as a positioned object in build space. */
export function buildPlannedObject(part: PlannedPart, ghost = false): THREE.Object3D {
  const mesh = buildPartMesh(
    part.render,
    { x: part.half.x * 2, y: part.half.y * 2, z: part.half.z * 2 },
    { ghost },
  );
  mesh.position.set(part.centre.x, part.centre.y, part.centre.z);
  mesh.quaternion.copy(YAW_QUATS[part.yaw]!);
  mesh.userData.uid = part.uid;
  return mesh;
}

/** A whole design, in lattice space, with the origin at the lattice origin. */
export function buildDesignView(design: Design, ghost = false): THREE.Group {
  const group = new THREE.Group();
  for (const placement of design.placements) group.add(buildPlacementObject(placement, ghost));
  return group;
}

/**
 * A live machine. The chassis group holds every fixed part at its offset from
 * the centre of mass; wheels track their own bodies.
 */
export class RobotView {
  readonly root = new THREE.Group();
  readonly chassisGroup = new THREE.Group();
  readonly #wheelObjects: THREE.Object3D[] = [];
  readonly #partObjects = new Map<string, THREE.Object3D>();
  readonly #weaponObjects: THREE.Object3D[] = [];

  constructor(private readonly robot: RobotHandle) {
    const com = robot.plan.centreOfMass;

    for (const part of robot.plan.parts) {
      const object = buildPlannedObject(part);
      // Physics puts the body origin at the centre of mass, so shift the
      // visuals to match or everything renders offset from where it collides.
      object.position.sub(new THREE.Vector3(com.x, com.y, com.z));

      if (part.drive) {
        // Rendered once per unit even though a track has two contact bodies:
        // a track's belt does not visibly rotate, and two overlapping tyres
        // would read as a modelling error.
        object.userData.wheelUid = part.uid;
        this.#wheelObjects.push(object);
        this.root.add(object);
      } else if (part.weapon) {
        // Every weapon has its own body on a hinge now, not just the spinners,
        // so hammers and flippers animate through the same path.
        object.userData.weaponUid = part.uid;
        this.#weaponObjects.push(object);
        this.root.add(object);
      } else {
        this.chassisGroup.add(object);
      }
      this.#partObjects.set(part.uid, object);
    }

    this.root.add(this.chassisGroup);
  }

  /** Copies this frame's physics transforms onto the meshes. */
  sync(): void {
    const t = this.robot.chassis.translation();
    const r = this.robot.chassis.rotation();
    this.chassisGroup.position.set(t.x, t.y, t.z);
    this.chassisGroup.quaternion.set(r.x, r.y, r.z, r.w);

    for (const object of this.#wheelObjects) {
      const wheel = this.robot.wheels.find((w) => w.part.uid === object.userData.wheelUid);
      if (!wheel) continue;
      object.visible = wheel.attached;
      const wt = wheel.body.translation();
      const wr = wheel.body.rotation();
      object.position.set(wt.x, wt.y, wt.z);
      object.quaternion.set(wr.x, wr.y, wr.z, wr.w);
    }

    for (const object of this.#weaponObjects) {
      const weapon = this.robot.weapons.find((w) => w.uid === object.userData.weaponUid);
      if (!weapon?.body) continue;
      object.visible = weapon.attached;
      const wt = weapon.body.translation();
      const wr = weapon.body.rotation();
      object.position.set(wt.x, wt.y, wt.z);
      object.quaternion.set(wr.x, wr.y, wr.z, wr.w);
    }

    for (const [uid, state] of this.robot.parts) {
      if (state.attached) continue;
      const object = this.#partObjects.get(uid);
      if (object && object.parent === this.chassisGroup) object.visible = false;
    }
  }

  /**
   * What a camera should follow. `root` stays at the origin because its
   * children carry world transforms, so following it follows nothing.
   */
  get focusTarget(): THREE.Object3D {
    return this.chassisGroup;
  }

  get position(): THREE.Vector3 {
    const t = this.robot.chassis.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}
