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

export function partMaterial(part: PartDef, opts: { ghost?: boolean } = {}): THREE.Material {
  const key = `${part.id}|${opts.ghost ? 'ghost' : 'solid'}`;
  let material = materialCache.get(key);
  if (material) return material;

  if (opts.ghost) {
    material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(part.visual.colour),
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      emissive: new THREE.Color(part.visual.emissive ?? part.visual.colour),
      emissiveIntensity: 0.4,
      metalness: 0.2,
      roughness: 0.5,
    });
  } else {
    material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(part.visual.colour),
      metalness: part.visual.metalness,
      roughness: part.visual.roughness,
      emissive: part.visual.emissive ? new THREE.Color(part.visual.emissive) : new THREE.Color('#000000'),
      emissiveIntensity: part.visual.emissive ? 0.55 : 0,
    });
  }
  materialCache.set(key, material);
  return material;
}

const ACCENT = new THREE.MeshStandardMaterial({
  color: '#0b0e14',
  metalness: 0.7,
  roughness: 0.45,
});

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
          const g = new THREE.CylinderGeometry(radius, radius, width, 24, 1);
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
        part.drive ? partMaterial(part, opts) : ACCENT,
      );
      if (part.drive && part.visual.emissive) {
        hub.material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(part.visual.emissive),
          emissive: new THREE.Color(part.visual.emissive),
          emissiveIntensity: 1.4,
          metalness: 0.3,
          roughness: 0.3,
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
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(part.visual.emissive),
            emissive: new THREE.Color(part.visual.emissive),
            emissiveIntensity: 1.6,
            toneMapped: false,
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
}
