/**
 * Procedural texture generation.
 *
 * There is no asset pipeline and no network, so every surface map in the game
 * is drawn here at load onto a 2D canvas and uploaded. That is a constraint,
 * but it suits the subject: these are machined parts, and machined parts are
 * brushed streaks, panel lines, bolt heads and scratches — all of which draw
 * far more cheaply than they model.
 *
 * Albedo maps are drawn on a white base and tinted at the material, so one
 * panel texture serves every part colour in the library instead of one texture
 * per part. Height maps are drawn alongside and converted to tangent-space
 * normals, which is what actually makes a flat box read as a plate with bolts
 * in it rather than a coloured rectangle.
 *
 * Every draw is driven by a seeded generator, so the textures are byte-identical
 * on every load. That matters for more than tidiness: a screenshot taken to
 * compare two builds is only meaningful if the wear pattern did not move.
 */

import * as THREE from 'three';

/** Texture resolution. 512 is the point where bolt heads stop looking soft. */
export const TEXTURE_SIZE = 512;

/**
 * mulberry32 — small, fast, and good enough for scattering scratches.
 * Deliberately not Math.random: see the note about reproducibility above.
 */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Ctx = CanvasRenderingContext2D;

export function makeCanvas(size = TEXTURE_SIZE): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for texture generation');
  return { canvas, ctx };
}

export function fill(ctx: Ctx, colour: string, size = TEXTURE_SIZE): void {
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, size, size);
}

// ── surface detail ─────────────────────────────────────────────────────────

/** Fine per-pixel grain. Breaks up the flatness that reads as "untextured". */
export function grain(ctx: Ctx, rng: () => number, amount: number, size = TEXTURE_SIZE): void {
  const image = ctx.getImageData(0, 0, size, size);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const delta = (rng() - 0.5) * amount * 255;
    data[i] = clampByte((data[i] ?? 0) + delta);
    data[i + 1] = clampByte((data[i + 1] ?? 0) + delta);
    data[i + 2] = clampByte((data[i + 2] ?? 0) + delta);
  }
  ctx.putImageData(image, 0, 0);
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

/** Horizontal streaks — the directional grain of a brushed or rolled finish. */
export function brushed(ctx: Ctx, rng: () => number, count: number, alpha: number, size = TEXTURE_SIZE): void {
  ctx.save();
  for (let i = 0; i < count; i += 1) {
    const y = rng() * size;
    const length = size * (0.3 + rng() * 0.7);
    const x = rng() * size;
    const light = rng() > 0.5;
    ctx.strokeStyle = light ? `rgba(255,255,255,${alpha * rng()})` : `rgba(0,0,0,${alpha * rng()})`;
    ctx.lineWidth = rng() < 0.85 ? 1 : 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + length, y + (rng() - 0.5) * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** Longer, angled gouges — wear rather than finish. */
export function scratches(ctx: Ctx, rng: () => number, count: number, alpha: number, size = TEXTURE_SIZE): void {
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const angle = rng() * Math.PI * 2;
    const length = size * (0.04 + rng() * 0.22);
    ctx.strokeStyle = rng() > 0.4 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha * 1.4})`;
    ctx.lineWidth = rng() < 0.8 ? 1 : 1.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * An inset panel line.
 *
 * Box faces are UV-mapped 0..1, so one of these per texture puts a machined
 * border on every face of every box part — which is most of what separates a
 * plate from a rectangle at a glance.
 */
export function panelFrame(ctx: Ctx, inset: number, width: number, colour: string, size = TEXTURE_SIZE): void {
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.strokeRect(inset, inset, size - inset * 2, size - inset * 2);
  ctx.restore();
}

/** Bolt heads at the corners of a panel, drawn with a lit top-left. */
export function bolts(ctx: Ctx, inset: number, radius: number, size = TEXTURE_SIZE): void {
  const positions: readonly (readonly [number, number])[] = [
    [inset, inset],
    [size - inset, inset],
    [inset, size - inset],
    [size - inset, size - inset],
  ];
  ctx.save();
  for (const [x, y] of positions) {
    const gradient = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
    gradient.addColorStop(0, 'rgba(255,255,255,0.85)');
    gradient.addColorStop(0.55, 'rgba(190,190,190,0.5)');
    gradient.addColorStop(1, 'rgba(30,30,30,0.75)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // The recessed drive slot.
    ctx.strokeStyle = 'rgba(20,20,20,0.8)';
    ctx.lineWidth = Math.max(1, radius * 0.22);
    ctx.beginPath();
    ctx.moveTo(x - radius * 0.45, y);
    ctx.lineTo(x + radius * 0.45, y);
    ctx.stroke();
  }
  ctx.restore();
}

/** Carbon-fibre twill: alternating directional blocks. */
export function weave(ctx: Ctx, cells: number, size = TEXTURE_SIZE): void {
  const step = size / cells;
  ctx.save();
  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      const across = (x + y) % 2 === 0;
      const gradient = across
        ? ctx.createLinearGradient(x * step, y * step, (x + 1) * step, (y + 1) * step)
        : ctx.createLinearGradient((x + 1) * step, y * step, x * step, (y + 1) * step);
      gradient.addColorStop(0, 'rgba(255,255,255,0.22)');
      gradient.addColorStop(0.5, 'rgba(120,120,120,0.05)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.30)');
      ctx.fillStyle = gradient;
      ctx.fillRect(x * step, y * step, step, step);
    }
  }
  ctx.restore();
}

/** Chevron tyre tread. Wraps around a cylinder's side UVs. */
export function tread(ctx: Ctx, rows: number, size = TEXTURE_SIZE): void {
  const step = size / rows;
  ctx.save();
  ctx.lineCap = 'butt';
  for (let i = 0; i < rows; i += 1) {
    const x = i * step;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.42)';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + step * 0.55, 0);
    ctx.lineTo(x + step * 0.9, size * 0.5);
    ctx.lineTo(x + step * 0.55, size);
    ctx.lineTo(x, size);
    ctx.lineTo(x + step * 0.35, size * 0.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Hazard diagonals, for anything that will hurt you. */
export function hazard(ctx: Ctx, stripe: number, alpha: number, size = TEXTURE_SIZE): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(size / 2, size / 2);
  ctx.rotate(-Math.PI / 4);
  ctx.translate(-size, -size);
  for (let x = 0; x < size * 2; x += stripe * 2) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(x, 0, stripe, size * 2);
  }
  ctx.restore();
}

// ── conversion ─────────────────────────────────────────────────────────────

/**
 * Tangent-space normals from a greyscale height field, by central difference.
 *
 * Runs once per finish at load. A 512² Sobel in JavaScript sounds expensive and
 * measures at a couple of milliseconds, which is nothing next to compiling the
 * shaders that will sample it.
 */
export function normalFromHeight(height: HTMLCanvasElement, strength: number): THREE.CanvasTexture {
  const size = height.width;
  const source = height.getContext('2d');
  if (!source) throw new Error('2D canvas unavailable for normal generation');
  const src = source.getImageData(0, 0, size, size).data;

  const { canvas, ctx } = makeCanvas(size);
  const out = ctx.createImageData(size, size);

  const at = (x: number, y: number): number => {
    const xx = ((x % size) + size) % size;
    const yy = ((y % size) + size) % size;
    return (src[(yy * size + xx) * 4] ?? 0) / 255;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const length = Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * size + x) * 4;
      out.data[i] = ((-dx / length) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((-dy / length) * 0.5 + 0.5) * 255;
      out.data[i + 2] = (1 / length) * 0.5 * 255 + 127.5;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // Normals are vectors, not colour: converting them through sRGB bends them.
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

export interface TextureOptions {
  /** Albedo is colour and needs sRGB; roughness and normal are data and do not. */
  readonly srgb?: boolean;
  readonly repeat?: number;
}

export function toTexture(canvas: HTMLCanvasElement, options: TextureOptions = {}): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = options.srgb === true ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = 8;
  if (options.repeat !== undefined) texture.repeat.set(options.repeat, options.repeat);
  return texture;
}
