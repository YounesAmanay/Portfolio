/**
 * The arena renderer.
 *
 * Draws a 20 Hz simulation at 60 fps by interpolating position between the
 * last two ticks. The simulation itself never interpolates — this is purely a
 * presentation concern, and keeping it here is what lets the engine stay pure.
 *
 * The visual rule from the design brief applies literally: if it glows, it is
 * reporting a value. Every colour on this canvas means something.
 */

import {
  DAMAGE_INFO,
  ZONE_INFO,
  heatRatio,
  structureRatio,
  type Arena,
  type FrameRuntime,
  type MatchState,
  type SimEvent,
  type Vec2,
} from '@engine/index';

const PALETTE = {
  void: '#03040a',
  grid: 'rgba(125, 195, 255, 0.055)',
  gridMajor: 'rgba(125, 195, 255, 0.1)',
  pylon: 'rgba(150, 190, 230, 0.16)',
  pylonEdge: 'rgba(160, 205, 255, 0.4)',
  frameA: '#4de2ff',
  frameB: '#ff8a5c',
  ink: '#dbeaff',
} as const;

/** A shot rendered as a fading tracer. */
interface Tracer {
  readonly from: Vec2;
  readonly to: Vec2;
  readonly colour: string;
  readonly hit: boolean;
  readonly crit: boolean;
  /** Remaining life, in seconds. */
  life: number;
}

export class ArenaRenderer {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  #scale = 1;
  #tracers: Tracer[] = [];
  /** Previous tick's positions, for interpolation. */
  #previous = new Map<number, Vec2>();

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.#ctx = ctx;
  }

  /** The canvas this renderer draws into, for the view to mount. */
  get canvas(): HTMLCanvasElement {
    return this.#canvas;
  }

  /** Sizes the backing store to the arena and the device pixel ratio. */
  resize(arena: Arena, cssWidth: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.#scale = cssWidth / arena.width;
    const cssHeight = arena.height * this.#scale;

    this.#canvas.style.width = `${cssWidth}px`;
    this.#canvas.style.height = `${cssHeight}px`;
    this.#canvas.width = Math.round(cssWidth * dpr);
    this.#canvas.height = Math.round(cssHeight * dpr);
    this.#ctx.setTransform(dpr * this.#scale, 0, 0, dpr * this.#scale, 0, 0);
  }

  /** Records this tick's shots so they can be drawn as fading tracers. */
  ingest(events: readonly SimEvent[]): void {
    for (const event of events) {
      if (event.kind !== 'SHOT') continue;
      this.#tracers.push({
        from: event.from,
        to: event.to,
        colour: DAMAGE_INFO[event.damageType].colour,
        hit: event.hit,
        crit: event.crit,
        life: event.hit ? 0.22 : 0.12,
      });
    }
    // Bound the list so a long match cannot grow it without limit.
    if (this.#tracers.length > 160) this.#tracers.splice(0, this.#tracers.length - 160);
  }

  /** Remembers positions so the next frame can interpolate from them. */
  snapshot(state: MatchState): void {
    for (const frame of state.frames) this.#previous.set(frame.index, frame.position);
  }

  reset(): void {
    this.#tracers = [];
    this.#previous.clear();
  }

  /**
   * @param alpha Fraction through the current tick, 0..1. Used to interpolate
   *              between the previous and current positions.
   * @param dt    Seconds since the last draw, for tracer decay.
   */
  draw(state: MatchState, alpha: number, dt: number): void {
    const { arena } = state;
    const ctx = this.#ctx;

    ctx.clearRect(0, 0, arena.width, arena.height);
    this.#drawSubstrate(arena);
    this.#drawZones(arena);
    this.#drawPylons(arena);
    this.#drawTracers(dt);

    for (const frame of state.frames) {
      const previous = this.#previous.get(frame.index) ?? frame.position;
      const position = {
        x: previous.x + (frame.position.x - previous.x) * alpha,
        y: previous.y + (frame.position.y - previous.y) * alpha,
      };
      this.#drawFrame(frame, position, frame.index === 0 ? PALETTE.frameA : PALETTE.frameB);
    }
  }

  // ── layers ────────────────────────────────────────────────────────────────

  #drawSubstrate(arena: Arena): void {
    const ctx = this.#ctx;
    ctx.fillStyle = PALETTE.void;
    ctx.fillRect(0, 0, arena.width, arena.height);

    ctx.lineWidth = 0.12;
    for (let x = 0; x <= arena.width; x += 10) {
      ctx.strokeStyle = x % 30 === 0 ? PALETTE.gridMajor : PALETTE.grid;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, arena.height);
      ctx.stroke();
    }
    for (let y = 0; y <= arena.height; y += 10) {
      ctx.strokeStyle = y % 20 === 0 ? PALETTE.gridMajor : PALETTE.grid;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(arena.width, y);
      ctx.stroke();
    }
  }

  #drawZones(arena: Arena): void {
    const ctx = this.#ctx;
    for (const zone of arena.zones) {
      const colour = ZONE_INFO[zone.kind].colour;
      const gradient = ctx.createRadialGradient(
        zone.position.x, zone.position.y, 0,
        zone.position.x, zone.position.y, zone.radius,
      );
      gradient.addColorStop(0, `${colour}26`);
      gradient.addColorStop(1, `${colour}00`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(zone.position.x, zone.position.y, zone.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `${colour}44`;
      ctx.lineWidth = 0.2;
      ctx.setLineDash([1.2, 1.2]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  #drawPylons(arena: Arena): void {
    const ctx = this.#ctx;
    for (const pylon of arena.pylons) {
      ctx.fillStyle = PALETTE.pylon;
      ctx.strokeStyle = PALETTE.pylonEdge;
      ctx.lineWidth = 0.25;
      ctx.beginPath();
      ctx.arc(pylon.position.x, pylon.position.y, pylon.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  #drawTracers(dt: number): void {
    const ctx = this.#ctx;
    const surviving: Tracer[] = [];

    for (const tracer of this.#tracers) {
      tracer.life -= dt;
      if (tracer.life <= 0) continue;
      surviving.push(tracer);

      const fade = Math.max(0, Math.min(1, tracer.life / 0.22));
      ctx.globalAlpha = tracer.hit ? fade : fade * 0.35;
      ctx.strokeStyle = tracer.colour;
      ctx.lineWidth = tracer.crit ? 0.7 : tracer.hit ? 0.42 : 0.2;
      if (!tracer.hit) ctx.setLineDash([1, 1.5]);

      ctx.beginPath();
      ctx.moveTo(tracer.from.x, tracer.from.y);
      ctx.lineTo(tracer.to.x, tracer.to.y);
      ctx.stroke();
      ctx.setLineDash([]);

      if (tracer.hit) {
        ctx.fillStyle = tracer.colour;
        ctx.globalAlpha = fade * 0.8;
        ctx.beginPath();
        ctx.arc(tracer.to.x, tracer.to.y, tracer.crit ? 1.9 : 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;
    this.#tracers = surviving;
  }

  #drawFrame(runtime: FrameRuntime, position: Vec2, colour: string): void {
    const ctx = this.#ctx;
    const radius = runtime.frame.stats.radius;
    const heat = heatRatio(runtime);
    const alive = runtime.structure > 0;

    ctx.save();
    ctx.translate(position.x, position.y);

    // Heat halo — the frame literally glows as it approaches overload.
    if (heat > 0.5 && alive) {
      const intensity = Math.min(1, (heat - 0.5) / 0.5);
      const halo = ctx.createRadialGradient(0, 0, radius, 0, 0, radius * 3.4);
      halo.addColorStop(0, `rgba(255, 140, 60, ${0.34 * intensity})`);
      halo.addColorStop(1, 'rgba(255, 140, 60, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 3.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Shield bubble.
    if (runtime.shield > 0) {
      const fraction = runtime.shield / Math.max(1, runtime.frame.stats.shieldCapacity);
      ctx.strokeStyle = `rgba(77, 226, 255, ${0.2 + fraction * 0.45})`;
      ctx.lineWidth = 0.28;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 1.55, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Body. Overloaded frames desaturate to red and stop being drawn crisply.
    const overloaded = runtime.heatState === 'OVERLOADED';
    const body = !alive ? 'rgba(90, 100, 120, 0.4)' : overloaded ? '#ff5c6a' : colour;

    ctx.fillStyle = `${body}22`;
    ctx.strokeStyle = body;
    ctx.lineWidth = 0.34;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Facing indicator, drawn from the unit vector — no trigonometry needed.
    if (alive) {
      const facing = runtime.facing;
      if (facing.x !== 0 || facing.y !== 0) {
        ctx.strokeStyle = body;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(facing.x * radius * 0.4, facing.y * radius * 0.4);
        ctx.lineTo(facing.x * radius * 1.85, facing.y * radius * 1.85);
        ctx.stroke();
      }
    }

    // Structure arc above the frame: a short bar that empties left to right.
    const width = radius * 2.4;
    const fraction = Math.max(0, structureRatio(runtime));
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(-width / 2, -radius - 2.1, width, 0.55);
    ctx.fillStyle = fraction > 0.35 ? '#4dffb0' : '#ff5c6a';
    ctx.fillRect(-width / 2, -radius - 2.1, width * fraction, 0.55);

    if (overloaded && alive) {
      ctx.fillStyle = '#ff5c6a';
      ctx.font = '2px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('OVERLOAD', 0, -radius - 3.4);
    }

    ctx.restore();
  }
}
