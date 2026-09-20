/**
 * The visual for one component.
 *
 * This module is the dispatcher: it picks the right builder from `geometry.ts`
 * for a part's declared shape, assigns materials from the finish library, and
 * caches the result by shape and size so a machine with four identical wheels
 * builds one wheel.
 *
 * Sub-parts get their own materials on purpose. A wheel is rubber *and*
 * machined alloy *and* a lit hub, and one material across all three is most of
 * what made these read as toys. Anything that is not the part's own substance —
 * rims, brackets, pivots, vents — comes from the shared detail metals below,
 * which keeps the material count flat as the library grows.
 */

import * as THREE from 'three';
import type { MeshPart } from '../kinetic/appearance';
import {
  bladeDisc,
  cannedCylinder,
  chamferedBox,
  ductParts,
  flipperParts,
  hammerParts,
  rimGeometry,
  rotorParts,
  spinnerBar,
  treadLugs,
  tyre,
  vents,
  motorParts,
  gearboxParts,
  engineParts,
  tankParts,
  boardParts,
} from './geometry';
import { disposeMaterials, finishMaterial } from './materials';

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

// ── materials ──────────────────────────────────────────────────────────────

/**
 * The part's own substance.
 *
 * No emissive here. `visual.emissive` is an accent colour, and applying it
 * across the body made every tyre glow cyan instead of being black rubber —
 * a surface lit from within cannot read as a material at all. The lamps and
 * stripes below carry it instead.
 */
export function partMaterial(part: MeshPart, opts: { ghost?: boolean } = {}): THREE.Material {
  if (opts.ghost !== true) {
    const solid = finishMaterial(part.finish, { tint: part.colour });
    if (part.opacity === undefined || part.opacity >= 1) return solid;

    // Cloned rather than mutated: finishMaterial caches by finish and tint, so
    // turning the shared instance transparent would make every steel plate on
    // every machine see-through.
    const key = `${part.id}|clear${part.opacity}`;
    const cached = materialCache.get(key);
    if (cached) return cached;
    const clear = solid.clone() as THREE.MeshStandardMaterial;
    clear.transparent = true;
    clear.opacity = part.opacity;
    // Depth writes off, or the plate hides everything behind it exactly as an
    // opaque one would and the transparency buys nothing.
    clear.depthWrite = false;
    materialCache.set(key, clear);
    return clear;
  }

  const key = `${part.id}|ghost`;
  const cached = materialCache.get(key);
  if (cached) return cached;

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(part.colour),
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    emissive: new THREE.Color(part.emissive ?? part.colour),
    emissiveIntensity: 0.4,
    metalness: 0.2,
    roughness: 0.5,
  });
  materialCache.set(key, material);
  return material;
}

/**
 * Shared detail metals, built on first use.
 *
 * Lazily, because generating a material draws its texture maps on a canvas —
 * doing that at module scope makes this file unimportable without a DOM, which
 * broke the workshop's raycast tests. None of those render anything.
 */
const brightMetal = (): THREE.Material => finishMaterial('alloy', { tint: '#9aa6b8' });
const darkMetal = (): THREE.Material => finishMaterial('steel', { tint: '#454d5a' });
/**
 * Fallback for a striking surface that declares no finish of its own.
 *
 * Darker than it was. At a near-white tint on full metalness a curved blade
 * catches the key light hard enough to clear the bloom threshold, and a 50 mm
 * drum lit the whole nose of the machine white. Tool steel is not that bright.
 */
const weaponMetal = (): THREE.Material => finishMaterial('hardened', { tint: '#7d838d' });

/** An indicator lamp. Pushed above 1.0 so it survives tone mapping and blooms. */
function lamp(colour: string, intensity = 2.2): THREE.Material {
  return finishMaterial('polymer', { tint: colour, emissive: colour, emissiveIntensity: intensity });
}

export interface MeshSize {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function add(group: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  group.add(mesh);
  return mesh;
}

/**
 * Builds the visual for one part at a given size in metres.
 *
 * Wheels and discs ignore the footprint's minor axis and use the part's own
 * radius, so a 140 mm tyre looks like a 140 mm tyre rather than being stretched
 * to fill its lattice box — and, more to the point, looks like the radius the
 * simulation is actually integrating.
 */
export function buildPartMesh(part: MeshPart, size: MeshSize, opts: { ghost?: boolean } = {}): THREE.Group {
  const group = new THREE.Group();
  const ghost = opts.ghost === true;
  const body = partMaterial(part, opts);
  // A ghost is a placement preview: one flat translucent colour throughout,
  // because picking out its rims and vents only makes it harder to read.
  const detail = ghost ? body : brightMetal();
  const dark = ghost ? body : darkMetal();
  // A weapon that declares a finish gets it; only one that does not falls back
  // to plain tool steel. Under the component model every catalogue entry states
  // its material outright, so this is what makes a bronze drum bronze.
  const weapon = ghost ? body : part.finish === 'hardened' ? body : weaponMetal();
  const key = `${size.x.toFixed(3)}:${size.y.toFixed(3)}:${size.z.toFixed(3)}`;

  switch (part.shape) {
    case 'wheel': {
      const radius = part.wheel?.radius ?? Math.min(size.x, size.y) / 2;
      const width = part.wheel?.width ?? size.z * 0.6;
      const driven = part.wheel?.driven === true;
      const id = `${radius.toFixed(3)}:${width.toFixed(3)}`;

      add(group, cachedGeometry(`tyre:${id}`, () => tyre(radius, width)), body);
      add(group, cachedGeometry(`lugs:${id}`, () => treadLugs(radius, width, 18)), body);
      add(group, cachedGeometry(`rim:${id}:${driven}`, () => rimGeometry({ radius, width, driven })), detail);

      if (driven && part.emissive !== undefined && !ghost) {
        const ring = add(
          group,
          cachedGeometry(`wlamp:${id}`, () => {
            const g = new THREE.TorusGeometry(radius * 0.3, radius * 0.05, 8, 20);
            g.rotateY(Math.PI / 2);
            return g;
          }),
          lamp(part.emissive, 1.8),
        );
        ring.position.x = width * 0.36;
      }
      break;
    }

    case 'disc': {
      const radius = part.reach ?? Math.max(size.x, size.z) / 2;
      const teeth = part.toothy === true ? 14 : 8;
      add(
        group,
        cachedGeometry(`disc:${radius.toFixed(3)}:${teeth}`, () => bladeDisc(radius, radius * 0.18, teeth)),
        weapon,
      );
      add(
        group,
        cachedGeometry(`dhub:${radius.toFixed(3)}`, () =>
          new THREE.CylinderGeometry(radius * 0.22, radius * 0.22, radius * 0.34, 16),
        ),
        detail,
      );
      break;
    }

    case 'blade': {
      add(group, cachedGeometry(`bar:${key}`, () => spinnerBar(size.x, size.y, size.z * 0.42)), weapon);
      add(
        group,
        cachedGeometry(`bhub:${key}`, () =>
          new THREE.CylinderGeometry(size.y * 0.32, size.y * 0.32, size.z * 0.62, 16),
        ),
        detail,
      );
      break;
    }

    case 'hammer': {
      add(group, cachedGeometry(`ham.pivot:${key}`, () => hammerParts(size).pivot), detail);
      add(group, cachedGeometry(`ham.arm:${key}`, () => hammerParts(size).arm), dark);
      add(group, cachedGeometry(`ham.head:${key}`, () => hammerParts(size).head), weapon);
      break;
    }

    case 'flipper': {
      add(group, cachedGeometry(`flip.plate:${key}`, () => flipperParts(size).plate), body);
      add(group, cachedGeometry(`flip.ram:${key}`, () => flipperParts(size).ram), detail);
      break;
    }

    case 'motor': {
      // Along X, because a motor's shaft is what it lines up with and every
      // drive chain in the catalogue runs across the machine.
      const radius = Math.min(size.y, size.z) * 0.42;
      const length = size.x;
      const id = `${radius.toFixed(3)}:${length.toFixed(3)}`;
      add(group, cachedGeometry(`mot.can:${id}`, () => motorParts(radius, length).can), body);
      add(group, cachedGeometry(`mot.bell:${id}`, () => motorParts(radius, length).bell), dark);
      add(group, cachedGeometry(`mot.shaft:${id}`, () => motorParts(radius, length).shaft), detail);
      break;
    }

    case 'gearbox': {
      const radius = Math.min(size.y, size.z) * 0.44;
      const length = size.x;
      const id = `${radius.toFixed(3)}:${length.toFixed(3)}`;
      add(group, cachedGeometry(`gbx.house:${id}`, () => gearboxParts(radius, length).housing), body);
      add(group, cachedGeometry(`gbx.detail:${id}`, () => gearboxParts(radius, length).detail), detail);
      break;
    }

    case 'engine': {
      add(group, cachedGeometry(`eng.block:${key}`, () => engineParts(size).block), body);
      add(group, cachedGeometry(`eng.fins:${key}`, () => engineParts(size).fins), detail);
      add(group, cachedGeometry(`eng.detail:${key}`, () => engineParts(size).detail), dark);
      break;
    }

    case 'tank': {
      const radius = Math.min(size.x, size.z) * 0.44;
      const length = Math.max(size.y, radius * 2.2);
      const id = `${radius.toFixed(3)}:${length.toFixed(3)}`;
      add(group, cachedGeometry(`tnk.shell:${id}`, () => tankParts(radius, length).shell), body);
      add(group, cachedGeometry(`tnk.detail:${id}`, () => tankParts(radius, length).detail), detail);
      break;
    }

    case 'board': {
      add(group, cachedGeometry(`brd.sub:${key}`, () => boardParts(size).substrate), body);
      add(group, cachedGeometry(`brd.detail:${key}`, () => boardParts(size).detail), dark);
      // A live board says so. This is the one place an emissive accent belongs
      // on the whole component: a status LED is exactly what it is.
      if (part.emissive !== undefined && !ghost) {
        const led = add(
          group,
          cachedGeometry(`brd.led:${key}`, () =>
            new THREE.SphereGeometry(Math.min(size.x, size.z) * 0.06, 8, 6),
          ),
          lamp(part.emissive, 2.6),
        );
        led.position.set(size.x * 0.3, size.y * 0.06, size.z * 0.22);
      }
      break;
    }

    case 'rotor': {
      const radius = Math.max(size.x, size.z) / 2;
      const id = `${radius.toFixed(3)}:${size.y.toFixed(3)}`;
      add(group, cachedGeometry(`rot.hub:${id}`, () => rotorParts(radius, size.y).hub), detail);
      add(group, cachedGeometry(`rot.blades:${id}`, () => rotorParts(radius, size.y).blades), dark);
      break;
    }

    case 'duct': {
      const radius = Math.min(size.x, size.z) / 2;
      const id = `${radius.toFixed(3)}:${size.y.toFixed(3)}`;
      add(group, cachedGeometry(`duct.shroud:${id}`, () => ductParts(radius, size.y).shroud), body);
      add(group, cachedGeometry(`duct.vanes:${id}`, () => ductParts(radius, size.y).vanes), detail);
      break;
    }

    case 'cylinder': {
      const radius = Math.min(size.x, size.z) / 2;
      const id = `${radius.toFixed(3)}:${size.y.toFixed(3)}`;
      add(group, cachedGeometry(`can.body:${id}`, () => cannedCylinder(radius, size.y).body), body);
      add(group, cachedGeometry(`can.rings:${id}`, () => cannedCylinder(radius, size.y).rings), detail);
      break;
    }

    case 'dome': {
      const radius = Math.min(size.x, size.z) / 2;
      add(
        group,
        cachedGeometry(`dome:${radius.toFixed(3)}`, () =>
          new THREE.SphereGeometry(radius, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2),
        ),
        body,
      );
      break;
    }

    case 'box':
    default: {
      add(group, cachedGeometry(`box:${key}`, () => chamferedBox(size.x, size.y, size.z)), body);

      // Powered housings get louvres and an indicator. Dumb structure does not:
      // a ballast weight with cooling vents in it would be a lie.
      if (part.powered === true && !ghost) {
        const louvres = add(
          group,
          cachedGeometry(`vents:${key}`, () => vents(size.x * 0.52, size.z * 0.62, 4)),
          dark,
        );
        louvres.position.y = size.y / 2;
      }

      if (part.emissive !== undefined && !ghost) {
        const stripe = add(
          group,
          cachedGeometry(`stripe:${key}`, () => chamferedBox(size.x * 0.62, size.y * 0.06, size.z * 0.1)),
          lamp(part.emissive),
        );
        stripe.position.set(0, size.y / 2 + 0.0015, -size.z * 0.26);
      }
      break;
    }
  }

  for (const child of group.children) {
    if (child instanceof THREE.Mesh) {
      child.castShadow = !ghost;
      child.receiveShadow = !ghost;
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
