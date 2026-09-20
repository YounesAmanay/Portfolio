/**
 * The material library.
 *
 * Every component in the game is made of one of a small set of real materials,
 * and each one is authored here once: albedo, roughness and normal maps drawn
 * procedurally, plus the physical constants that make it behave like that
 * substance under the environment map.
 *
 * The important idea is that a *finish* is separate from a *colour*. Albedo
 * maps are drawn on a white base and multiplied by the material's colour at
 * render time, so one brushed-steel texture serves the whole library and a part
 * only has to say "I am machined aluminium, and I am painted blue". Adding a
 * part costs no texture memory.
 *
 * Why this exists: before it, every part was a flat untextured colour. A
 * battery, a steel plate and a spinning blade all rendered as the same soft
 * pastel box, and no amount of lighting or post-processing fixed that, because
 * there was nothing on the surfaces to light.
 */

import * as THREE from 'three';
import type { PartCategory, PartDef, PartFinish } from '../kinetic/parts/types';
import { TOY_FINISH } from './palette';
import {
  bolts,
  brushed,
  fill,
  grain,
  hazard,
  makeCanvas,
  normalFromHeight,
  panelFrame,
  scratches,
  seeded,
  toTexture,
  tread,
  weave,
} from './texture';

/**
 * Re-exported so render code can talk about finishes without reaching into the
 * parts layer, while the union itself stays defined beside the part contract.
 */
export type Finish = PartFinish;

interface FinishSpec {
  readonly metalness: number;
  /** Baked into the roughness map, so material.roughness stays at 1. */
  readonly roughness: number;
  readonly roughnessVariation: number;
  readonly normalStrength: number;
  readonly draw: (seed: number) => { albedo: HTMLCanvasElement; height: HTMLCanvasElement };
}

// ── the finishes ───────────────────────────────────────────────────────────

/**
 * A machined panel: brushed grain, an inset border and four bolts.
 *
 * Shared by the metals, because a box face UV-mapped 0..1 turns this into a
 * bolted plate, which is the single biggest step away from "coloured
 * rectangle" available for the cost.
 */
function panel(seed: number, opts: { wear: number; boltRadius: number; brushCount: number }): {
  albedo: HTMLCanvasElement;
  height: HTMLCanvasElement;
} {
  const rng = seeded(seed);
  const albedo = makeCanvas();
  const height = makeCanvas();

  fill(albedo.ctx, '#ffffff');
  brushed(albedo.ctx, rng, opts.brushCount, 0.09);
  grain(albedo.ctx, seeded(seed + 1), 0.05);
  // Strong, because a lattice cell is 80 mm: these panels are read small and
  // a subtle line disappears entirely at the distances the game is played at.
  panelFrame(albedo.ctx, 34, 5, 'rgba(0,0,0,0.58)');
  panelFrame(albedo.ctx, 29, 2, 'rgba(255,255,255,0.26)');
  bolts(albedo.ctx, 18, opts.boltRadius);
  scratches(albedo.ctx, seeded(seed + 2), Math.round(opts.wear * 160), 0.16);

  // Height: bolts proud, panel line recessed, everything else near flat.
  fill(height.ctx, '#808080');
  panelFrame(height.ctx, 34, 6, '#1e1e1e');
  bolts(height.ctx, 18, opts.boltRadius);
  brushed(height.ctx, seeded(seed), opts.brushCount, 0.05);
  scratches(height.ctx, seeded(seed + 2), Math.round(opts.wear * 160), 0.12);

  return { albedo: albedo.canvas, height: height.canvas };
}

const FINISHES: Record<Finish, FinishSpec> = {
  steel: {
    metalness: 1,
    roughness: 0.44,
    roughnessVariation: 0.16,
    normalStrength: 2.4,
    draw: (seed) => panel(seed, { wear: 0.6, boltRadius: 9, brushCount: 900 }),
  },
  alloy: {
    metalness: 1,
    roughness: 0.3,
    roughnessVariation: 0.12,
    normalStrength: 2.0,
    draw: (seed) => panel(seed, { wear: 0.3, boltRadius: 8, brushCount: 1400 }),
  },
  armour: {
    metalness: 0.92,
    roughness: 0.58,
    roughnessVariation: 0.22,
    normalStrength: 3.2,
    draw: (seed) => panel(seed, { wear: 1.6, boltRadius: 11, brushCount: 600 }),
  },
  hardened: {
    metalness: 1,
    roughness: 0.34,
    roughnessVariation: 0.2,
    normalStrength: 2.6,
    draw: (seed) => {
      const base = panel(seed, { wear: 1.2, boltRadius: 7, brushCount: 800 });
      const ctx = base.albedo.getContext('2d');
      // Hazard diagonals: this is the end that hurts. Wide and faint — at 26px
      // and 0.3 they covered the whole head and read as upholstery rather than
      // as a marking on machined steel.
      if (ctx) hazard(ctx, 48, 0.16);
      return base;
    },
  },
  carbon: {
    metalness: 0.14,
    roughness: 0.28,
    roughnessVariation: 0.1,
    normalStrength: 1.6,
    draw: (seed) => {
      const rng = seeded(seed);
      const albedo = makeCanvas();
      const height = makeCanvas();
      fill(albedo.ctx, '#ffffff');
      weave(albedo.ctx, 24);
      grain(albedo.ctx, rng, 0.04);
      panelFrame(albedo.ctx, 26, 2.5, 'rgba(0,0,0,0.34)');
      fill(height.ctx, '#808080');
      weave(height.ctx, 24);
      return { albedo: albedo.canvas, height: height.canvas };
    },
  },
  rubber: {
    metalness: 0,
    roughness: 0.94,
    roughnessVariation: 0.08,
    normalStrength: 4.5,
    draw: (seed) => {
      const rng = seeded(seed);
      const albedo = makeCanvas();
      const height = makeCanvas();
      fill(albedo.ctx, '#ffffff');
      tread(albedo.ctx, 16);
      grain(albedo.ctx, rng, 0.09);
      fill(height.ctx, '#5a5a5a');
      tread(height.ctx, 16);
      grain(height.ctx, seeded(seed + 3), 0.06);
      return { albedo: albedo.canvas, height: height.canvas };
    },
  },
  cell: {
    metalness: 0.22,
    roughness: 0.46,
    roughnessVariation: 0.14,
    normalStrength: 2.2,
    draw: (seed) => {
      const rng = seeded(seed);
      const albedo = makeCanvas();
      const height = makeCanvas();
      fill(albedo.ctx, '#ffffff');
      // Cell banding across the wrap.
      for (let i = 0; i < 6; i += 1) {
        const y = (i / 6) * 512;
        albedo.ctx.fillStyle = i % 2 === 0 ? 'rgba(0,0,0,0.20)' : 'rgba(255,255,255,0.10)';
        albedo.ctx.fillRect(0, y, 512, 512 / 6 - 3);
        height.ctx.fillStyle = i % 2 === 0 ? '#6a6a6a' : '#9a9a9a';
        height.ctx.fillRect(0, y, 512, 512 / 6 - 3);
      }
      grain(albedo.ctx, rng, 0.05);
      panelFrame(albedo.ctx, 22, 3, 'rgba(0,0,0,0.5)');
      return { albedo: albedo.canvas, height: height.canvas };
    },
  },
  polymer: {
    metalness: 0.04,
    roughness: 0.62,
    roughnessVariation: 0.1,
    normalStrength: 1.4,
    draw: (seed) => {
      const rng = seeded(seed);
      const albedo = makeCanvas();
      const height = makeCanvas();
      fill(albedo.ctx, '#ffffff');
      grain(albedo.ctx, rng, 0.12);
      panelFrame(albedo.ctx, 28, 2.5, 'rgba(0,0,0,0.38)');
      bolts(albedo.ctx, 20, 6);
      fill(height.ctx, '#808080');
      panelFrame(height.ctx, 28, 3, '#4a4a4a');
      bolts(height.ctx, 20, 6);
      return { albedo: albedo.canvas, height: height.canvas };
    },
  },
  copper: {
    metalness: 1,
    roughness: 0.36,
    roughnessVariation: 0.14,
    normalStrength: 3.0,
    draw: (seed) => {
      const albedo = makeCanvas();
      const height = makeCanvas();
      fill(albedo.ctx, '#ffffff');
      // Windings.
      for (let i = 0; i < 40; i += 1) {
        const x = (i / 40) * 512;
        albedo.ctx.strokeStyle = i % 2 === 0 ? 'rgba(0,0,0,0.30)' : 'rgba(255,255,255,0.18)';
        albedo.ctx.lineWidth = 512 / 40 / 2;
        albedo.ctx.beginPath();
        albedo.ctx.moveTo(x, 0);
        albedo.ctx.lineTo(x, 512);
        albedo.ctx.stroke();

        height.ctx.strokeStyle = i % 2 === 0 ? '#3c3c3c' : '#c0c0c0';
        height.ctx.lineWidth = 512 / 40 / 2;
        height.ctx.beginPath();
        height.ctx.moveTo(x, 0);
        height.ctx.lineTo(x, 512);
        height.ctx.stroke();
      }
      grain(albedo.ctx, seeded(seed), 0.05);
      return { albedo: albedo.canvas, height: height.canvas };
    },
  },
};

// ── roughness maps ─────────────────────────────────────────────────────────

/**
 * A roughness map from the same height field the normals come from.
 *
 * Scratches and machining marks scatter light, so wherever the surface is
 * disturbed it is rougher. Deriving roughness from height rather than drawing
 * it separately keeps the two agreeing with each other, which is what stops a
 * scratch from reading as a painted-on line.
 */
function roughnessFromHeight(height: HTMLCanvasElement, base: number, variation: number): THREE.CanvasTexture {
  const size = height.width;
  const source = height.getContext('2d');
  if (!source) throw new Error('2D canvas unavailable for roughness generation');
  const src = source.getImageData(0, 0, size, size).data;

  const { canvas, ctx } = makeCanvas(size);
  const out = ctx.createImageData(size, size);
  for (let i = 0; i < out.data.length; i += 4) {
    // Distance from the mid grey of an undisturbed surface.
    const disturbance = Math.abs((src[i] ?? 128) / 255 - 0.5) * 2;
    const rough = Math.min(1, Math.max(0, base + disturbance * variation));
    const byte = rough * 255;
    out.data[i] = byte;
    out.data[i + 1] = byte;
    out.data[i + 2] = byte;
    out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return toTexture(canvas);
}

// ── assembly ───────────────────────────────────────────────────────────────

interface FinishMaps {
  readonly map: THREE.Texture;
  readonly normalMap: THREE.Texture;
  readonly roughnessMap: THREE.Texture;
  readonly spec: FinishSpec;
}

const mapCache = new Map<Finish, FinishMaps>();
const materialCache = new Map<string, THREE.MeshStandardMaterial>();

function mapsFor(finish: Finish): FinishMaps {
  const cached = mapCache.get(finish);
  if (cached) return cached;

  const spec = FINISHES[finish];
  // A stable per-finish seed, so wear is identical on every load.
  const seed = [...finish].reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 7);
  const { albedo, height } = spec.draw(seed);

  const maps: FinishMaps = {
    map: toTexture(albedo, { srgb: true }),
    normalMap: normalFromHeight(height, spec.normalStrength),
    roughnessMap: roughnessFromHeight(height, spec.roughness, spec.roughnessVariation),
    spec,
  };
  mapCache.set(finish, maps);
  return maps;
}

export interface MaterialOptions {
  /** Tints the white-base albedo. */
  readonly tint: string;
  readonly emissive?: string | undefined;
  readonly emissiveIntensity?: number;
  /** UV repeats; a long rail wants its panel repeated, not stretched. */
  readonly repeat?: number;
}

/** A material for one finish and tint, cached across the whole library. */
export function finishMaterial(finish: Finish, options: MaterialOptions): THREE.MeshStandardMaterial {
  const key = `${finish}|${options.tint}|${options.emissive ?? '-'}|${options.emissiveIntensity ?? 0}|${options.repeat ?? 1}`;
  const cached = materialCache.get(key);
  if (cached) return cached;

  // ── the toy path ────────────────────────────────────────────────────────
  //
  // Flat moulded plastic: one strong colour, a soft highlight, no maps at all.
  // The procedural wear below is still built and still correct, and at the
  // size a part occupies on screen it read as noise — a dozen carefully
  // scratched grey boxes that merged into one grey shape. Colour separates
  // them; scratches never did.
  const toy = TOY_FINISH[finish];
  if (toy) {
    const flat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(options.tint),
      roughness: toy.roughness,
      metalness: toy.metalness,
      emissive: new THREE.Color(options.emissive ?? '#000000'),
      emissiveIntensity: options.emissive !== undefined ? (options.emissiveIntensity ?? 0.6) : 0,
    });
    materialCache.set(key, flat);
    return flat;
  }

  const maps = mapsFor(finish);
  const repeat = options.repeat ?? 1;

  // Textures carry their own wrap settings, so a repeat needs its own clone
  // rather than mutating the shared one out from under every other material.
  const map = repeat === 1 ? maps.map : maps.map.clone();
  const normalMap = repeat === 1 ? maps.normalMap : maps.normalMap.clone();
  const roughnessMap = repeat === 1 ? maps.roughnessMap : maps.roughnessMap.clone();
  if (repeat !== 1) {
    for (const texture of [map, normalMap, roughnessMap]) {
      texture.repeat.set(repeat, repeat);
      texture.needsUpdate = true;
    }
  }

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(options.tint),
    map,
    normalMap,
    roughnessMap,
    // The absolute roughness is baked into the map, so this stays at 1 and
    // lets the map speak. Same for metalness, which is uniform per finish.
    roughness: 1,
    metalness: maps.spec.metalness,
    normalScale: new THREE.Vector2(1, 1),
    emissive: new THREE.Color(options.emissive ?? '#000000'),
    emissiveIntensity: options.emissive !== undefined ? (options.emissiveIntensity ?? 0.6) : 0,
  });
  materialCache.set(key, material);
  return material;
}

/**
 * The finish a part is made of.
 *
 * Parts may declare one; most do not need to, because what a component is made
 * of follows from what it is. A battery is a polymer-wrapped cell pack whoever
 * built it.
 */
export function finishFor(part: PartDef): Finish {
  if (part.visual.finish) return part.visual.finish;
  if (part.battery) return 'cell';
  if (part.weapon) return 'hardened';
  if (part.drive || part.roller) return 'rubber';
  if (part.controller) return 'polymer';
  if (part.thruster) return 'alloy';
  return byCategory(part.category);
}

function byCategory(category: PartCategory): Finish {
  switch (category) {
    case 'ARMOUR':
      return 'armour';
    case 'STRUCTURE':
      return 'steel';
    case 'POWER':
      return 'cell';
    case 'CONTROL':
      return 'polymer';
    default:
      return 'alloy';
  }
}

export function disposeMaterials(): void {
  for (const material of materialCache.values()) material.dispose();
  materialCache.clear();
  for (const maps of mapCache.values()) {
    maps.map.dispose();
    maps.normalMap.dispose();
    maps.roughnessMap.dispose();
  }
  mapCache.clear();
}
