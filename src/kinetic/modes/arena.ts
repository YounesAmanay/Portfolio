/**
 * Arena modes.
 *
 * Two kinds of contest, sharing one world: a **Crucible** where machines fight
 * until one is wrecked or inverted, and a **Gauntlet** against the clock over
 * obstacles. They reward opposite builds on purpose — the machine that wins a
 * brawl is slow, heavy and over-armoured, and it will not get round a course.
 *
 * Arena geometry is generated rather than authored, so a course is a seed and
 * a handful of numbers instead of a file.
 */

import { RAPIER, PhysicsWorld, type ArenaSurface } from '../physics/world';
import type { RobotHandle } from '../physics/robot';
import { isInverted, robotSpeed } from '../physics/robot';

export type ModeKind = 'CRUCIBLE' | 'GAUNTLET' | 'PROVING';

export interface Obstacle {
  readonly position: { x: number; y: number; z: number };
  readonly halfExtents: { x: number; y: number; z: number };
  readonly rotationY: number;
  readonly kind: 'block' | 'ramp' | 'wall' | 'pillar';
}

export interface Checkpoint {
  readonly position: { x: number; z: number };
  readonly radius: number;
}

export interface ArenaSpec {
  readonly id: string;
  readonly name: string;
  readonly mode: ModeKind;
  readonly blurb: string;
  readonly size: number;
  readonly surface: ArenaSurface;
  readonly obstacles: readonly Obstacle[];
  readonly checkpoints: readonly Checkpoint[];
  /** Seconds. 0 means untimed. */
  readonly timeLimit: number;
}

const STEEL: ArenaSurface = { friction: 0.9, restitution: 0.08 };
const GRIT: ArenaSurface = { friction: 1.15, restitution: 0.04 };
const POLISHED: ArenaSurface = { friction: 0.45, restitution: 0.05 };

/** A bare box with walls. Nowhere to hide, nothing to blame. */
export const CRUCIBLE: ArenaSpec = {
  id: 'crucible',
  name: 'THE CRUCIBLE',
  mode: 'CRUCIBLE',
  blurb: 'A steel box with four walls. Last machine still driving wins. Nothing here will help you.',
  size: 22,
  surface: STEEL,
  obstacles: [
    { position: { x: 0, y: 0.25, z: 0 }, halfExtents: { x: 1.6, y: 0.25, z: 1.6 }, rotationY: Math.PI / 4, kind: 'block' },
    { position: { x: -7, y: 0.4, z: 6 }, halfExtents: { x: 0.35, y: 0.4, z: 0.35 }, rotationY: 0, kind: 'pillar' },
    { position: { x: 7, y: 0.4, z: -6 }, halfExtents: { x: 0.35, y: 0.4, z: 0.35 }, rotationY: 0, kind: 'pillar' },
  ],
  checkpoints: [],
  timeLimit: 180,
};

/** Polished floor. Grip stops being free and tyre choice starts to matter. */
export const SLICKPLATE: ArenaSpec = {
  id: 'slickplate',
  name: 'SLICKPLATE',
  mode: 'CRUCIBLE',
  blurb: 'Polished steel, friction 0.45. Every machine here is over-powered for the grip it has.',
  size: 20,
  surface: POLISHED,
  obstacles: [
    { position: { x: 0, y: 0.18, z: -5 }, halfExtents: { x: 4, y: 0.18, z: 0.3 }, rotationY: 0, kind: 'wall' },
    { position: { x: 0, y: 0.18, z: 5 }, halfExtents: { x: 4, y: 0.18, z: 0.3 }, rotationY: 0, kind: 'wall' },
  ],
  checkpoints: [],
  timeLimit: 180,
};

/** A course. Ramps, steps and a gate run, against the clock. */
export const GAUNTLET: ArenaSpec = {
  id: 'gauntlet',
  name: 'THE GAUNTLET',
  mode: 'GAUNTLET',
  blurb: 'Ramps, steps and gates against the clock. Torque gets you over; speed gets you round.',
  size: 40,
  surface: GRIT,
  obstacles: [
    // A rising ramp, then a drop.
    { position: { x: 0, y: 0.18, z: -10 }, halfExtents: { x: 3, y: 0.18, z: 2.4 }, rotationY: 0, kind: 'ramp' },
    { position: { x: 0, y: 0.42, z: -6 }, halfExtents: { x: 3, y: 0.42, z: 1.8 }, rotationY: 0, kind: 'block' },
    // Steps, which reward torque over speed.
    { position: { x: 8, y: 0.08, z: 0 }, halfExtents: { x: 2, y: 0.08, z: 1.2 }, rotationY: 0, kind: 'block' },
    { position: { x: 8, y: 0.17, z: 2.6 }, halfExtents: { x: 2, y: 0.17, z: 1.2 }, rotationY: 0, kind: 'block' },
    { position: { x: 8, y: 0.26, z: 5.2 }, halfExtents: { x: 2, y: 0.26, z: 1.2 }, rotationY: 0, kind: 'block' },
    // A slalom of pillars.
    { position: { x: -8, y: 0.5, z: 2 }, halfExtents: { x: 0.3, y: 0.5, z: 0.3 }, rotationY: 0, kind: 'pillar' },
    { position: { x: -6, y: 0.5, z: 5 }, halfExtents: { x: 0.3, y: 0.5, z: 0.3 }, rotationY: 0, kind: 'pillar' },
    { position: { x: -8, y: 0.5, z: 8 }, halfExtents: { x: 0.3, y: 0.5, z: 0.3 }, rotationY: 0, kind: 'pillar' },
    { position: { x: -6, y: 0.5, z: 11 }, halfExtents: { x: 0.3, y: 0.5, z: 0.3 }, rotationY: 0, kind: 'pillar' },
  ],
  checkpoints: [
    { position: { x: 0, z: -6 }, radius: 2.4 },
    { position: { x: 8, z: 5.2 }, radius: 2.4 },
    { position: { x: -7, z: 11 }, radius: 2.4 },
    { position: { x: 0, z: 14 }, radius: 2.6 },
  ],
  timeLimit: 120,
};

/** Empty ground. For finding out what a machine does before it matters. */
export const PROVING: ArenaSpec = {
  id: 'proving',
  name: 'PROVING GROUND',
  mode: 'PROVING',
  blurb: 'Open ground and a few obstacles. No clock, no opponent. Drive it and find out.',
  size: 46,
  surface: GRIT,
  obstacles: [
    { position: { x: 6, y: 0.2, z: 6 }, halfExtents: { x: 2.5, y: 0.2, z: 2.5 }, rotationY: 0, kind: 'ramp' },
    { position: { x: -7, y: 0.35, z: -4 }, halfExtents: { x: 1.2, y: 0.35, z: 1.2 }, rotationY: 0.4, kind: 'block' },
    { position: { x: 0, y: 0.6, z: -12 }, halfExtents: { x: 5, y: 0.6, z: 0.4 }, rotationY: 0, kind: 'wall' },
  ],
  checkpoints: [],
  timeLimit: 0,
};

export const ARENAS: readonly ArenaSpec[] = [PROVING, CRUCIBLE, SLICKPLATE, GAUNTLET];

/** Builds the static geometry for a spec into a world. */
export function buildArena(physics: PhysicsWorld, spec: ArenaSpec): void {
  physics.addGround(spec.size * 1.4, spec.surface);
  physics.addArenaWalls(spec.size, 1.2, spec.surface);
  for (const obstacle of spec.obstacles) {
    physics.addStaticBox(obstacle.position, obstacle.halfExtents, spec.surface, obstacle.rotationY);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Match state
// ─────────────────────────────────────────────────────────────────────────────

export type MatchStatus = 'COUNTDOWN' | 'RUNNING' | 'WON' | 'LOST' | 'TIMEOUT';

export interface MatchState {
  status: MatchStatus;
  elapsed: number;
  /** Gauntlet only: how many gates have been taken, in order. */
  checkpoint: number;
  /** Seconds a machine has spent upside down; too long and it is out. */
  invertedFor: number;
  message: string;
}

export const newMatch = (): MatchState => ({
  status: 'COUNTDOWN',
  elapsed: 0,
  checkpoint: 0,
  invertedFor: 0,
  message: '',
});

const INVERT_LIMIT = 6;   // seconds on your back before you are counted out

/**
 * Advances the rules for one frame.
 *
 * Being inverted is a timer, not an instant loss: real machines get flipped
 * and drive out of it, and self-righting is a legitimate design goal. Six
 * seconds is long enough to escape and short enough to matter.
 */
export function stepMatch(
  state: MatchState,
  spec: ArenaSpec,
  player: RobotHandle,
  opponents: readonly RobotHandle[],
  dt: number,
): MatchState {
  if (state.status !== 'RUNNING') return state;

  state.elapsed += dt;

  if (isInverted(player) && robotSpeed(player) < 1.2) {
    state.invertedFor += dt;
  } else {
    state.invertedFor = Math.max(0, state.invertedFor - dt * 2);
  }

  if (state.invertedFor > INVERT_LIMIT) {
    state.status = 'LOST';
    state.message = 'Inverted and unable to right itself.';
    return state;
  }

  if (!player.alive) {
    state.status = 'LOST';
    state.message = player.destroyedReason ?? 'Machine destroyed.';
    return state;
  }

  if (spec.mode === 'CRUCIBLE') {
    const standing = opponents.filter((o) => o.alive && !(isInverted(o) && robotSpeed(o) < 0.5));
    if (standing.length === 0 && opponents.length > 0) {
      state.status = 'WON';
      state.message = 'Last machine driving.';
      return state;
    }
  }

  if (spec.mode === 'GAUNTLET' && spec.checkpoints.length > 0) {
    const gate = spec.checkpoints[state.checkpoint];
    if (gate) {
      const p = player.chassis.translation();
      if (Math.hypot(p.x - gate.position.x, p.z - gate.position.z) < gate.radius) {
        state.checkpoint += 1;
        if (state.checkpoint >= spec.checkpoints.length) {
          state.status = 'WON';
          state.message = `Course complete in ${state.elapsed.toFixed(2)}s.`;
          return state;
        }
      }
    }
  }

  if (spec.timeLimit > 0 && state.elapsed >= spec.timeLimit) {
    state.status = 'TIMEOUT';
    state.message = spec.mode === 'GAUNTLET' ? 'Out of time.' : 'Time expired — no decision.';
  }

  return state;
}

/** Spawn points, spread around the middle of the arena facing inward. */
export function spawnPoints(spec: ArenaSpec, count: number): { x: number; z: number; yaw: number }[] {
  const radius = Math.min(spec.size * 0.3, 7);
  const points: { x: number; z: number; yaw: number }[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / Math.max(1, count)) * Math.PI * 2;
    // Trig at setup time only — never inside the stepped simulation.
    points.push({
      x: Math.sin(angle) * radius,
      z: Math.cos(angle) * radius,
      yaw: angle + Math.PI,
    });
  }
  return points;
}

export { RAPIER };
