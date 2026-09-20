/**
 * Component geometry.
 *
 * Every part in the game is built here from primitives at load. There is no
 * asset pipeline and no network to fetch one, so nothing is imported — but
 * "no assets" is not an excuse for boxes. A wheel gets a tyre with moulded
 * lugs, a rim, spokes and a hub; a hammer gets a shaft, a pivot bracket and a
 * weighted head; a spinner gets a real toothed blade profile.
 *
 * Two rules keep this honest:
 *
 * Geometry follows the physics. A wheel is drawn at the radius and width the
 * drive spec declares, not at whatever fills its lattice box, because those
 * numbers are the ones the simulation integrates. If a tyre looks bigger than
 * it drives, the builder is lying.
 *
 * Bodies keep clean box UVs. The material library maps a bolted panel across
 * each face at 0..1, so the main mass of a part stays a box and detail is
 * added as separate geometry around it. Chamfers come from RoundedBoxGeometry
 * at a radius small enough to read as a machined edge rather than a pebble.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Machined edge break, in metres. A lattice cell is 80 mm, so this is ~2 mm. */
export const CHAMFER = 0.002;

/**
 * A body with broken edges.
 *
 * A raw box reads as untextured no matter what is on it, because a real
 * machined part has no perfectly sharp corners to catch a highlight. The
 * chamfer is what gives every edge a bright line under the overhead rig.
 */
export function chamferedBox(x: number, y: number, z: number): THREE.BufferGeometry {
  const radius = Math.min(CHAMFER, Math.min(x, y, z) * 0.18);
  // One segment, not two: a single bevel face is what a machined edge break
  // actually is, and it halves the triangle count of every body in the game.
  // Two segments spent them rounding a 2 mm corner nobody can resolve.
  return new RoundedBoxGeometry(x, y, z, 1, radius);
}

// ── wheels ─────────────────────────────────────────────────────────────────

export interface WheelSpec {
  readonly radius: number;
  readonly width: number;
  /** Powered wheels get a motor can and a deeper rim. */
  readonly driven: boolean;
}

/**
 * The tyre carcass, as a revolved profile rather than a cylinder.
 *
 * The shoulders matter more than they sound: a plain cylinder catches the
 * overhead lights as one flat band and reads as a disc of plastic, while a
 * crowned profile rolls the highlight around the shoulder and reads as rubber
 * under load.
 */
function tyreGeometry(radius: number, width: number): THREE.BufferGeometry {
  const half = width / 2;
  const bead = radius * 0.62;
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(bead, -half),
    new THREE.Vector2(radius * 0.88, -half),
    new THREE.Vector2(radius * 0.99, -half * 0.74),
    new THREE.Vector2(radius, -half * 0.36),
    new THREE.Vector2(radius, half * 0.36),
    new THREE.Vector2(radius * 0.99, half * 0.74),
    new THREE.Vector2(radius * 0.88, half),
    new THREE.Vector2(bead, half),
  ];
  const geometry = new THREE.LatheGeometry(profile, 36);
  // Lathe revolves around Y; the axle runs along X.
  geometry.rotateZ(Math.PI / 2);
  return geometry;
}

/** Moulded tread blocks around the circumference. Real geometry, not a map. */
export function treadLugs(radius: number, width: number, count: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const lugWidth = width * 0.78;
  const lugHeight = radius * 0.07;
  const lugLength = ((Math.PI * 2 * radius) / count) * 0.55;

  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const lug = new THREE.BoxGeometry(lugWidth, lugHeight, lugLength);
    // Angled across the tyre, which is what makes a rolling wheel read as
    // turning rather than sliding.
    lug.rotateX(i % 2 === 0 ? 0.28 : -0.28);
    lug.translate(0, radius - lugHeight * 0.35, 0);
    lug.rotateX(angle);
    parts.push(lug);
  }
  return mergeGeometries(parts);
}

/** Rim, spokes and hub — the part that says whether a wheel is driven. */
export function rimGeometry(spec: WheelSpec): THREE.BufferGeometry {
  const { radius, width, driven } = spec;
  const parts: THREE.BufferGeometry[] = [];
  const rimRadius = radius * 0.63;

  const barrel = new THREE.CylinderGeometry(rimRadius, rimRadius, width * 0.86, 24, 1, true);
  barrel.rotateZ(Math.PI / 2);
  parts.push(barrel);

  const face = new THREE.CylinderGeometry(rimRadius, rimRadius * 0.94, width * 0.16, 24);
  face.rotateZ(Math.PI / 2);
  face.translate(width * 0.34, 0, 0);
  parts.push(face);

  const spokes = driven ? 6 : 5;
  for (let i = 0; i < spokes; i += 1) {
    const angle = (i / spokes) * Math.PI * 2;
    const spoke = new THREE.BoxGeometry(width * 0.2, rimRadius * 0.92, radius * 0.16);
    spoke.translate(width * 0.34, rimRadius * 0.46, 0);
    spoke.rotateX(angle);
    parts.push(spoke);
  }

  // The hub, and on a driven wheel the motor can behind it.
  const hub = new THREE.CylinderGeometry(radius * 0.26, radius * 0.26, width * 0.5, 18);
  hub.rotateZ(Math.PI / 2);
  hub.translate(width * 0.28, 0, 0);
  parts.push(hub);

  if (driven) {
    const can = new THREE.CylinderGeometry(radius * 0.42, radius * 0.42, width * 0.62, 20);
    can.rotateZ(Math.PI / 2);
    can.translate(-width * 0.5, 0, 0);
    parts.push(can);

    // Cooling fins around the can: the detail that makes it read as a motor.
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2;
      const fin = new THREE.BoxGeometry(width * 0.5, radius * 0.1, radius * 0.05);
      fin.translate(-width * 0.5, radius * 0.44, 0);
      fin.rotateX(angle);
      parts.push(fin);
    }
  }

  return mergeGeometries(parts);
}

export function tyre(radius: number, width: number): THREE.BufferGeometry {
  return tyreGeometry(radius, width);
}

// ── weapons ────────────────────────────────────────────────────────────────

/**
 * A toothed spinner or saw blade.
 *
 * Built as an extruded outline so the teeth are real geometry with real
 * silhouette. A cylinder with three boxes stuck on it — which is what this was
 * — reads as decoration; a blade that visibly bites reads as a weapon.
 */
export function bladeDisc(radius: number, thickness: number, teeth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const root = radius * 0.8;
  const step = (Math.PI * 2) / teeth;

  // A hooked tooth: a near-radial cutting face, a short flat tip, then a long
  // back slope down into the gullet. The asymmetry is the whole point — it is
  // what reads as "this bites in one direction" rather than as a cog.
  const at = (r: number, a: number): readonly [number, number] => [Math.cos(a) * r, Math.sin(a) * r];
  for (let i = 0; i < teeth; i += 1) {
    const a0 = i * step;
    const face = at(root, a0);
    const tip = at(radius, a0 + step * 0.06);
    const crest = at(radius, a0 + step * 0.34);
    const gullet = at(root, a0 + step * 0.92);

    if (i === 0) shape.moveTo(face[0], face[1]);
    else shape.lineTo(face[0], face[1]);
    shape.lineTo(tip[0], tip[1]);
    shape.lineTo(crest[0], crest[1]);
    shape.lineTo(gullet[0], gullet[1]);
  }
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: thickness * 0.28,
    bevelSize: radius * 0.02,
    bevelSegments: 2,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -thickness / 2);
  // Extrude builds in XY; the disc spins about Y.
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/** A spinning bar with hardened, angled tips. */
export function spinnerBar(length: number, height: number, thickness: number): THREE.BufferGeometry {
  const half = length / 2;
  const tip = height * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-half, -height * 0.18);
  shape.lineTo(-half + tip * 0.6, -height * 0.5);
  shape.lineTo(half - tip * 0.6, -height * 0.5);
  shape.lineTo(half, -height * 0.18);
  shape.lineTo(half, height * 0.2);
  shape.lineTo(half - tip * 0.8, height * 0.5);
  shape.lineTo(-half + tip * 0.8, height * 0.5);
  shape.lineTo(-half, height * 0.2);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: thickness * 0.2,
    bevelSize: thickness * 0.18,
    bevelSegments: 1,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -thickness / 2);
  return geometry;
}

/**
 * An overhead hammer: pivot bracket, arm, and a weighted head.
 *
 * This was a plain box, which is a poor showing for the part whose whole
 * appeal is watching it come down. The mass is deliberately all at the end,
 * because that is also where the simulation puts it.
 */
export function hammerParts(size: { x: number; y: number; z: number }): {
  pivot: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
} {
  // The arm runs along Z, which is this part's long axis (4 cells against 2),
  // and rises as it goes. Built along X first, it was squashed into a plate.
  const pivotAt = { y: -size.y * 0.32, z: -size.z * 0.36 };
  const headAt = { y: size.y * 0.24, z: size.z * 0.3 };

  const dy = headAt.y - pivotAt.y;
  const dz = headAt.z - pivotAt.z;
  const reach = Math.sqrt(dy * dy + dz * dz);
  // Rotation about X carries +Z toward -Y, hence the negation.
  const tilt = -Math.atan2(dy, dz);

  // Proportions matter here: an earlier pass gave the pivot a bearing wider
  // than the head, so the part read as a motor with a flap rather than as a
  // hammer. The head has to visibly outweigh everything behind it.
  const pivot = new THREE.CylinderGeometry(size.y * 0.14, size.y * 0.14, size.x * 0.66, 16);
  pivot.rotateZ(Math.PI / 2);
  pivot.translate(0, pivotAt.y, pivotAt.z);

  const arm = chamferedBox(size.x * 0.34, size.y * 0.17, reach);
  arm.rotateX(tilt);
  arm.translate(0, (pivotAt.y + headAt.y) / 2, (pivotAt.z + headAt.z) / 2);

  // All of the mass at the end, which is also where the simulation puts it.
  const head = chamferedBox(size.x * 0.98, size.y * 0.54, size.z * 0.3);
  head.rotateX(tilt);
  head.translate(0, headAt.y, headAt.z);

  return { pivot, arm, head };
}

/** A flipper: a wedge plate on a pneumatic ram. */
export function flipperParts(size: { x: number; y: number; z: number }): {
  plate: THREE.BufferGeometry;
  ram: THREE.BufferGeometry;
} {
  const shape = new THREE.Shape();
  shape.moveTo(-size.x / 2, -size.y * 0.3);
  shape.lineTo(size.x / 2, -size.y * 0.5);
  shape.lineTo(size.x / 2, -size.y * 0.16);
  shape.lineTo(-size.x / 2, size.y * 0.5);
  shape.closePath();

  const plate = new THREE.ExtrudeGeometry(shape, {
    depth: size.z * 0.82,
    bevelEnabled: true,
    bevelThickness: size.y * 0.04,
    bevelSize: size.y * 0.04,
    bevelSegments: 1,
    curveSegments: 1,
  });
  plate.translate(0, 0, -size.z * 0.41);

  const ram = new THREE.CylinderGeometry(size.y * 0.2, size.y * 0.2, size.x * 0.5, 14);
  ram.rotateZ(Math.PI / 2);
  ram.translate(-size.x * 0.16, -size.y * 0.22, 0);

  return { plate, ram };
}

// ── thrust ─────────────────────────────────────────────────────────────────

/** A rotor: hub plus twisted, tapered blades. */
export function rotorParts(radius: number, height: number): {
  hub: THREE.BufferGeometry;
  blades: THREE.BufferGeometry;
} {
  const hub = new THREE.CylinderGeometry(radius * 0.2, radius * 0.26, height, 14);

  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 2; i += 1) {
    const shape = new THREE.Shape();
    shape.moveTo(0, -radius * 0.1);
    shape.lineTo(radius * 0.94, -radius * 0.05);
    shape.lineTo(radius * 0.94, radius * 0.04);
    shape.lineTo(0, radius * 0.16);
    shape.closePath();

    const blade = new THREE.ExtrudeGeometry(shape, {
      depth: height * 0.18,
      bevelEnabled: false,
      curveSegments: 1,
    });
    blade.rotateX(-Math.PI / 2);
    // Pitch, so it looks like it would actually move air.
    blade.rotateZ(0.32);
    blade.rotateY((i / 2) * Math.PI * 2);
    parts.push(blade);
  }
  return { hub, blades: mergeGeometries(parts) };
}

/** A ducted fan: shroud ring, stator vanes and a spinner. */
export function ductParts(radius: number, height: number): {
  shroud: THREE.BufferGeometry;
  vanes: THREE.BufferGeometry;
} {
  const shroud = new THREE.CylinderGeometry(radius, radius, height, 28, 1, true);

  const parts: THREE.BufferGeometry[] = [];
  const centre = new THREE.CylinderGeometry(radius * 0.26, radius * 0.2, height * 0.8, 14);
  parts.push(centre);
  for (let i = 0; i < 7; i += 1) {
    const vane = new THREE.BoxGeometry(radius * 0.72, height * 0.5, radius * 0.06);
    vane.translate(radius * 0.48, 0, 0);
    vane.rotateY((i / 7) * Math.PI * 2);
    parts.push(vane);
  }
  return { shroud, vanes: mergeGeometries(parts) };
}

// ── housings ───────────────────────────────────────────────────────────────

/** A cylindrical can with end rings, for capacitor banks and the like. */
export function cannedCylinder(radius: number, height: number): {
  body: THREE.BufferGeometry;
  rings: THREE.BufferGeometry;
} {
  const body = new THREE.CylinderGeometry(radius, radius, height, 24);
  const parts: THREE.BufferGeometry[] = [];
  for (const end of [-1, 1]) {
    const ring = new THREE.TorusGeometry(radius * 0.98, radius * 0.07, 8, 24);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, (end * height) / 2.4, 0);
    parts.push(ring);
  }
  return { body, rings: mergeGeometries(parts) };
}

/**
 * Vent louvres for the top face of a housing.
 *
 * Small, cheap, and does a disproportionate amount of work: a box with vents
 * in it is equipment, and a box without them is a box.
 */
export function vents(width: number, depth: number, count: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const slot = depth / (count * 2);
  for (let i = 0; i < count; i += 1) {
    const louvre = new THREE.BoxGeometry(width, slot * 0.5, slot);
    louvre.translate(0, 0, (i - (count - 1) / 2) * slot * 2);
    parts.push(louvre);
  }
  return mergeGeometries(parts);
}

// ── merge ──────────────────────────────────────────────────────────────────

/**
 * Concatenates geometries into one buffer.
 *
 * Three ships BufferGeometryUtils for this, but it needs every input to carry
 * an identical attribute set, and mixing extrusions with primitives here does
 * not satisfy that. This takes the intersection of the attributes instead, so
 * a lug box and a lathed tyre can merge without either being rebuilt.
 *
 * The point is draw calls: a wheel is one mesh, not thirty.
 */
export function mergeGeometries(geometries: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = geometries.map((g) => (g.index ? g.toNonIndexed() : g));
  const names = ['position', 'normal', 'uv'].filter((name) =>
    nonIndexed.every((g) => g.getAttribute(name) !== undefined),
  );

  const merged = new THREE.BufferGeometry();
  for (const name of names) {
    let total = 0;
    for (const g of nonIndexed) total += (g.getAttribute(name) as THREE.BufferAttribute).array.length;

    const array = new Float32Array(total);
    let offset = 0;
    let itemSize = 3;
    for (const g of nonIndexed) {
      const attribute = g.getAttribute(name) as THREE.BufferAttribute;
      itemSize = attribute.itemSize;
      array.set(attribute.array as Float32Array, offset);
      offset += attribute.array.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
  }

  // Inputs that were cloned to non-indexed are throwaway; the originals are
  // owned by the caller and disposed with the cache.
  for (let i = 0; i < nonIndexed.length; i += 1) {
    if (nonIndexed[i] !== geometries[i]) nonIndexed[i]?.dispose();
  }
  merged.computeBoundingSphere();
  return merged;
}
