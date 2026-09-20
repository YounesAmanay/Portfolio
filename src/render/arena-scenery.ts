/**
 * The arena, as a place rather than a box.
 *
 * What was here before was four slabs and a light strip, and it read exactly
 * like what it was: a grey room. A venue needs three things this now builds.
 *
 * Structure you can measure yourself against. Ribbed wall segments, corner
 * towers and an overhead truss give the eye repeated features at known
 * spacing, which is what turns "moving" into "moving at ten metres a second".
 * A featureless wall gives the eye nothing to clock speed against.
 *
 * Light that comes from somewhere. Fixtures are modelled where the light
 * appears to come from, and they are bright enough to bloom. A glow with no
 * visible source reads as a rendering artefact.
 *
 * Containment. Safety barriers, hazard kerbs and the audience wall behind
 * them say that this is a space built to hold something dangerous — which is
 * most of what makes a combat arena feel like one.
 *
 * All of it is static, merged where possible, and built once per match.
 */

import * as THREE from 'three';
import { chamferedBox, mergeGeometries } from './geometry';
import { finishMaterial } from './materials';

export interface VenueOptions {
  /** Arena floor size in metres, as the spec declares it. */
  readonly size: number;
  /** Low-friction arenas get a polished floor and colder lighting. */
  readonly slick: boolean;
  /** Quality tier: the low tier skips the decorative tiers and truss. */
  readonly detail: boolean;
}

const WALL_HEIGHT = 1.2;

/**
 * Builds the venue shell. Returns one group to add to the scene, plus the
 * lights, which the caller owns because they need adding to the scene root
 * rather than to a nested group for shadows to behave.
 */
export function buildVenue(options: VenueOptions): THREE.Group {
  const group = new THREE.Group();
  const { size, slick, detail } = options;
  const half = size / 2;

  const wallMetal = finishMaterial('steel', { tint: slick ? '#5c6673' : '#4d5561', repeat: 4 });
  const trimMetal = finishMaterial('alloy', { tint: '#8d97a6', repeat: 2 });
  const darkMetal = finishMaterial('steel', { tint: '#2b323c', repeat: 3 });

  group.add(new THREE.Mesh(wallSegments(size, detail), wallMetal));
  group.add(new THREE.Mesh(kerbs(size), hazardMaterial()));
  group.add(new THREE.Mesh(cornerTowers(half), trimMetal));
  group.add(new THREE.Mesh(lightStrips(size), stripMaterial(slick ? '#7fe6ff' : '#4de2ff')));

  if (detail) {
    group.add(new THREE.Mesh(audienceTiers(half), darkMetal));
    group.add(new THREE.Mesh(truss(size), trimMetal));
    group.add(new THREE.Mesh(fixtures(half), fixtureMaterial()));
    // Painted, not lit. At light-source brightness a seven-metre ring bloomed
    // across the whole frame and buried the machine standing in the middle of
    // it. Floor markings are paint that catches the overhead rig.
    group.add(new THREE.Mesh(floorInlay(size), inlayMaterial()));
  }

  for (const child of group.children) {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  }
  return group;
}

// ── materials ──────────────────────────────────────────────────────────────

/** Emissive trim. Above 1.0 so the bloom pass treats it as a light source. */
function stripMaterial(colour: string, intensity = 1.7): THREE.Material {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(colour),
    emissive: new THREE.Color(colour),
    emissiveIntensity: intensity,
    roughness: 0.4,
    metalness: 0,
  });
}

function fixtureMaterial(): THREE.Material {
  return new THREE.MeshStandardMaterial({
    color: '#ffffff',
    emissive: '#fff4e2',
    emissiveIntensity: 3.4,
    roughness: 0.3,
    metalness: 0,
  });
}

/** Floor paint: bright albedo, faintly self-lit, nowhere near bloom threshold. */
function inlayMaterial(): THREE.Material {
  return new THREE.MeshStandardMaterial({
    color: '#bfe9f7',
    emissive: '#2c5a68',
    emissiveIntensity: 0.25,
    roughness: 0.55,
    metalness: 0.1,
  });
}

function hazardMaterial(): THREE.Material {
  return finishMaterial('hardened', { tint: '#c8a24a', repeat: 6 });
}

// ── structure ──────────────────────────────────────────────────────────────

/**
 * The four walls, each broken into ribbed bays.
 *
 * The ribs are the point. A flat wall passing the camera at speed is a
 * featureless smear; bays at a fixed spacing turn the same motion into
 * countable events.
 */
function wallSegments(size: number, ribbed: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const half = size / 2;
  // Ribs are fine detail that a phone spends triangles on and barely resolves,
  // so the low tier gets the panels and the lit top edge and nothing else.
  const bays = ribbed ? Math.max(6, Math.round(size / 2.5)) : 0;

  for (const [ox, oz, rot] of sides(half)) {
    const panel = chamferedBox(size, WALL_HEIGHT, 0.45);
    panel.rotateY(rot);
    panel.translate(ox, WALL_HEIGHT / 2, oz);
    parts.push(panel);

    for (let i = 0; i < bays; i += 1) {
      const t = (i + 0.5) / bays - 0.5;
      // Positioned in the wall's own frame, then rotated and moved into
      // place with it, so all four walls get identical bay spacing.
      const rib = chamferedBox(0.16, WALL_HEIGHT * 0.92, 0.2);
      rib.translate(t * size * 0.96, WALL_HEIGHT / 2, -0.3);
      rib.rotateY(rot);
      rib.translate(ox, 0, oz);
      parts.push(rib);
    }
  }
  return mergeGeometries(parts);
}

/** A hazard-marked kerb where the floor meets the wall. */
function kerbs(size: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const half = size / 2;
  for (const [ox, oz, rot] of sides(half)) {
    const kerb = chamferedBox(size, 0.1, 0.18);
    kerb.rotateY(rot);
    kerb.translate(ox * 0.96, 0.05, oz * 0.96);
    parts.push(kerb);
  }
  return mergeGeometries(parts);
}

/** Corner towers: they close the corners and give the shell a silhouette. */
function cornerTowers(half: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const tower = chamferedBox(0.7, WALL_HEIGHT * 1.7, 0.7);
      tower.translate(sx * half, WALL_HEIGHT * 0.85, sz * half);
      parts.push(tower);

      const cap = chamferedBox(0.9, 0.12, 0.9);
      cap.translate(sx * half, WALL_HEIGHT * 1.76, sz * half);
      parts.push(cap);
    }
  }
  return mergeGeometries(parts);
}

/** The lit line along the top of the wall. */
function lightStrips(size: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const half = size / 2;
  for (const [ox, oz, rot] of sides(half)) {
    const strip = new THREE.BoxGeometry(size * 0.94, 0.05, 0.07);
    strip.rotateY(rot);
    strip.translate(ox * 0.98, WALL_HEIGHT - 0.06, oz * 0.98);
    parts.push(strip);
  }
  return mergeGeometries(parts);
}

/** Stepped tiers behind the wall, reading as stands. */
function audienceTiers(half: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const steps = 5;
  for (let i = 0; i < steps; i += 1) {
    const out = half + 0.9 + i * 0.85;
    const height = WALL_HEIGHT + 0.5 + i * 0.7;
    for (const [ox, oz, rot] of sides(out)) {
      const tier = new THREE.BoxGeometry(out * 2, 0.22, 0.85);
      tier.rotateY(rot);
      tier.translate(ox, height, oz);
      parts.push(tier);
    }
  }
  return mergeGeometries(parts);
}

/** An overhead truss. Read mostly as a silhouette against the dark. */
function truss(size: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const height = 7.2;
  const bays = 4;
  for (let i = 0; i <= bays; i += 1) {
    const t = i / bays - 0.5;
    for (const axis of [0, 1]) {
      const beam = new THREE.BoxGeometry(axis === 0 ? size * 1.1 : 0.16, 0.16, axis === 0 ? 0.16 : size * 1.1);
      beam.translate(axis === 0 ? 0 : t * size, height, axis === 0 ? t * size : 0);
      parts.push(beam);
    }
  }
  return mergeGeometries(parts);
}

/** Light fixtures on the truss, where the overhead light appears to come from. */
function fixtures(half: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pod = new THREE.BoxGeometry(1.6, 0.12, 0.5);
      pod.translate(sx * half * 0.45, 7.06, sz * half * 0.45);
      parts.push(pod);
    }
  }
  return mergeGeometries(parts);
}

/** Inlaid floor markings: a centre ring and the four approach lines. */
function floorInlay(size: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const ring = new THREE.TorusGeometry(size * 0.13, 0.018, 6, 64);
  ring.rotateX(Math.PI / 2);
  ring.translate(0, 0.008, 0);
  parts.push(ring);

  for (let i = 0; i < 4; i += 1) {
    const line = new THREE.BoxGeometry(size * 0.16, 0.01, 0.04);
    line.translate(size * 0.26, 0.008, 0);
    line.rotateY((i / 4) * Math.PI * 2);
    parts.push(line);
  }
  return mergeGeometries(parts);
}

/** The four wall positions as [offsetX, offsetZ, yaw]. */
function sides(half: number): readonly (readonly [number, number, number])[] {
  return [
    [0, -half, 0],
    [0, half, 0],
    [-half, 0, Math.PI / 2],
    [half, 0, Math.PI / 2],
  ];
}
