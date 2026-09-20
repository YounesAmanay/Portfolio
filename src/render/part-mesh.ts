/**
 * Procedural geometry for components.
 *
 * There is no asset pipeline, so every part is built from primitives at load
 * and cached by shape and size. That is a constraint, but it suits the subject:
 * these are machines assembled from stock parts, and stock parts *are* boxes,
 * cylinders and discs. Detail comes from materials, emissive accents and the
 * small chamfers and hubs added below, not from polygon count.
 */

import * as THREE from 'three';
import type { PartDef } from '../kinetic/parts/types';
import { disposeMaterials, finishFor, finishMaterial } from './materials';

const geometryCache = new Map<string, THREE.BufferGeometry>();
const materialCache = new Map<string, THREE.Material>();

function cachedGeometry(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let geometry = geometryCache.get(key);
  if (!geometry) {
    geometry = build();
    geometryCache.set(key, geometry);
  }
  return geometry;
}

/**
 * The material for a part.
 *
 * Solid parts come from the finish library, which owns the surface maps and
 * the physical constants. The ghost is deliberately untextured: it is a
 * placement preview, and panel lines on a translucent overlay read as dirt.
 */
export function partMaterial(part: PartDef, opts: { ghost?: boolean } = {}): THREE.Material {
  if (!opts.ghost) {
    // No emissive on the body. `visual.emissive` is an *accent* colour, and
    // applying it to the whole part made every tyre glow cyan instead of being
    // black rubber — a part lit from within cannot read as a material at all.
    // The accent geometry below (hubs, stripes) is what carries it.
    return finishMaterial(finishFor(part), { tint: part.visual.colour });
  }

  const key = `${part.id}|ghost`;
  const cached = materialCache.get(key);
  if (cached) return cached;

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(part.visual.colour),
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    emissive: new THREE.Color(part.visual.emissive ?? part.visual.colour),
    emissiveIntensity: 0.4,
    metalness: 0.2,
    roughness: 0.5,
  });
  materialCache.set(key, material);
  return material;
}

/**
 * Dark machined detail: hubs, brackets, anything that is not the part itself.
 *
 * Built on first use rather than at module load. Generating a material draws
 * its texture maps on a canvas, so doing it at import time makes this module
 * impossible to import anywhere without a DOM — which broke the workshop's
 * raycast tests, none of which render anything.
 */
function accentMaterial(): THREE.Material {
  return finishMaterial('steel', { tint: '#4a5260' });
}

export interface MeshSize {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Builds the visual for one part at a given size in metres.
 *
 * Wheels and discs ignore the footprint's minor axis and use the part's own
 * radius, so a 140 mm tyre looks like a 140 mm tyre rather than being stretched
 * to fill its lattice box.
 */
export function buildPartMesh(part: PartDef, size: MeshSize, opts: { ghost?: boolean } = {}): THREE.Group {
  const group = new THREE.Group();
  const material = partMaterial(part, opts);
  const shape = part.visual.shape;

  switch (shape) {
    case 'wheel': {
      const radius = part.drive?.radius ?? part.roller?.radius ?? Math.min(size.x, size.y) / 2;
      const width = part.drive?.width ?? part.roller?.width ?? size.z * 0.6;

      const tyre = new THREE.Mesh(
        cachedGeometry(`tyre:${radius}:${width}`, () => {
          const g = new THREE.CylinderGeometry(radius, radius, width, 32, 1);
          g.rotateZ(Math.PI / 2);
          return g;
        }),
        material,
      );
      group.add(tyre);

      // A bright hub reads as "this one is powered" at a glance.
      const hub = new THREE.Mesh(
        cachedGeometry(`hub:${radius}:${width}`, () => {
          const g = new THREE.CylinderGeometry(radius * 0.42, radius * 0.42, width * 1.06, 16, 1);
          g.rotateZ(Math.PI / 2);
          return g;
        }),
        part.drive ? partMaterial(part, opts) : accentMaterial(),
      );
      if (part.drive && part.visual.emissive) {
        hub.material = finishMaterial('alloy', {
          tint: part.visual.emissive,
          emissive: part.visual.emissive,
          emissiveIntensity: 1.1,
        });
      }
      group.add(hub);
      break;
    }

    case 'disc': {
      const radius = Math.max(size.x, size.z) / 2;
      const disc = new THREE.Mesh(
        cachedGeometry(`disc:${radius}`, () => {
          const g = new THREE.CylinderGeometry(radius, radius, radius * 0.16, 28, 1);
          return g;
        }),
        material,
      );
      group.add(disc);
      // Teeth, so a spinner reads as dangerous rather than decorative.
      for (let i = 0; i < 3; i++) {
        const tooth = new THREE.Mesh(
          cachedGeometry(`tooth:${radius}`, () => new THREE.BoxGeometry(radius * 0.3, radius * 0.22, radius * 0.3)),
          material,
        );
        const angle = (i / 3) * Math.PI * 2;
        tooth.position.set(Math.cos(angle) * radius * 0.92, 0, Math.sin(angle) * radius * 0.92);
        tooth.rotation.y = -angle;
        group.add(tooth);
      }
      break;
    }

    case 'blade': {
      const bar = new THREE.Mesh(
        cachedGeometry(`blade:${size.x}:${size.z}`, () =>
          new THREE.BoxGeometry(size.x, size.y * 0.8, size.z * 0.42),
        ),
        material,
      );
      group.add(bar);
      for (const end of [-1, 1]) {
        const tip = new THREE.Mesh(
          cachedGeometry(`tip:${size.z}`, () => new THREE.BoxGeometry(size.x * 0.12, size.y, size.z * 0.6)),
          material,
        );
        tip.position.x = (end * size.x) / 2.3;
        group.add(tip);
      }
      break;
    }

    case 'rotor': {
      const radius = Math.max(size.x, size.z) / 2;
      const hub = new THREE.Mesh(
        cachedGeometry(`rhub:${radius}`, () => new THREE.CylinderGeometry(radius * 0.18, radius * 0.22, size.y, 12)),
        material,
      );
      group.add(hub);
      for (let i = 0; i < 2; i++) {
        const blade = new THREE.Mesh(
          cachedGeometry(`rblade:${radius}`, () => {
            const g = new THREE.BoxGeometry(radius * 1.9, size.y * 0.16, radius * 0.24);
            return g;
          }),
          material,
        );
        blade.rotation.y = (i / 2) * Math.PI;
        blade.rotation.z = 0.18;
        group.add(blade);
      }
      break;
    }

    case 'cylinder': {
      const radius = Math.min(size.x, size.z) / 2;
      group.add(
        new THREE.Mesh(
          cachedGeometry(`cyl:${radius}:${size.y}`, () => new THREE.CylinderGeometry(radius, radius, size.y, 20)),
          material,
        ),
      );
      break;
    }

    case 'dome': {
      const radius = Math.min(size.x, size.z) / 2;
      group.add(
        new THREE.Mesh(
          cachedGeometry(`dome:${radius}`, () => new THREE.SphereGeometry(radius, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2)),
          material,
        ),
      );
      break;
    }

    case 'box':
    default: {
      const body = new THREE.Mesh(
        cachedGeometry(`box:${size.x}:${size.y}:${size.z}`, () => new THREE.BoxGeometry(size.x, size.y, size.z)),
        material,
      );
      group.add(body);

      // A thin emissive stripe along the long axis: enough to tell powered
      // components apart from dumb structure without modelling detail.
      if (part.visual.emissive && !opts.ghost) {
        const stripe = new THREE.Mesh(
          cachedGeometry(`stripe:${size.x}:${size.z}`, () =>
            new THREE.BoxGeometry(size.x * 0.7, size.y * 0.08, size.z * 0.14),
          ),
          // Deliberately over 1.0 so it survives tone mapping as a light source
          // and gives the bloom pass something real to pick up.
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(part.visual.emissive),
            emissive: new THREE.Color(part.visual.emissive),
            emissiveIntensity: 2.4,
          }),
        );
        stripe.position.y = size.y / 2 + 0.001;
        group.add(stripe);
      }
      break;
    }
  }

  for (const child of group.children) {
    if (child instanceof THREE.Mesh) {
      child.castShadow = !opts.ghost;
      child.receiveShadow = !opts.ghost;
    }
  }
  return group;
}

export function disposeCaches(): void {
  for (const geometry of geometryCache.values()) geometry.dispose();
  for (const material of materialCache.values()) material.dispose();
  geometryCache.clear();
  materialCache.clear();
  disposeMaterials();
}
