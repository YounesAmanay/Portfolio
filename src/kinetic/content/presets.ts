/**
 * Preset machines.
 *
 * These exist for two reasons: a new player needs something that already works
 * to take apart and learn from, and the arena needs opponents. Each one is a
 * legible archetype built only from library parts, with no hidden tuning — open
 * any of them in the builder and every number is visible.
 */

import { addPlacement, emptyDesign, type Design, type Yaw } from '../assembly/design';

interface Spec {
  readonly part: string;
  readonly at: readonly [number, number, number];
  readonly yaw?: Yaw;
}

function build(name: string, specs: readonly Spec[]): Design {
  let design = emptyDesign(name);
  specs.forEach((spec, index) => {
    design = addPlacement(design, {
      uid: `${name.toLowerCase()}_${index}`,
      partId: spec.part,
      cell: { x: spec.at[0], y: spec.at[1], z: spec.at[2] },
      yaw: spec.yaw ?? 0,
    });
  });
  return design;
}

/**
 * Four balanced pods, low deck, battery over the floor. The reference machine.
 *
 * Every preset below is a single connected assembly: each part shares a face
 * with another. That sounds obvious and none of them used to be — the pods were
 * parked beside the deck with a whole cell of air between, and the simulation
 * welded the lot into one rigid body regardless, so four wheels bolted to
 * nothing drove the machine perfectly well.
 *
 * Making it a rule immediately bit, and the bite is the interesting part. A
 * 3x3 deck plate reaches a 3-cell stance and no further, and a 3-cell stance is
 * too narrow: the machine pitches up under its own torque and beaches on its
 * pod housings with the wheels spinning — 0.4 m travelled in three seconds
 * against 16 m at four cells. So a wide stance has to be *built*, with rails
 * out to the far pods, which is exactly the lesson the rail carries: structure
 * is not free mass, and a wheelbase you have not joined is not a wheelbase.
 *
 * They share one chassis pattern: pods on a 5-cell square, two deck plates down
 * the spine, and two cross rails reaching the outboard pair. Controllers sit
 * beside their batteries rather than on top of them — stacking them put the
 * centre of mass above half the wheelbase and both light machines flipped
 * themselves over under power.
 */
export const SCOUT: Design = build('SCOUT', [
  // Longer than it is wide. It flips about the pitch axis long before the roll
  // axis, because that is the one it accelerates along — at an even 5x5 stance
  // it put itself on its back after four seconds of full throttle.
  { part: 'drive.balanced', at: [0, 0, 0] },
  { part: 'drive.balanced', at: [5, 0, 0] },
  { part: 'drive.balanced', at: [0, 0, 6] },
  { part: 'drive.balanced', at: [5, 0, 6] },
  { part: 'str.plate', at: [1, 2, 1] },
  { part: 'str.plate', at: [1, 2, 4] },
  { part: 'str.rail', at: [3, 2, 0], yaw: 1 },
  { part: 'str.rail', at: [3, 2, 7], yaw: 1 },
  { part: 'bat.lipo6s', at: [1, 3, 1] },
  { part: 'ctl.basic', at: [1, 3, 3] },
  { part: 'arm.poly', at: [1, 3, 5] },
]);

/** Crawler pods, steel, and a bar spinner. Slow, heavy, and it hits back. */
export const BRUISER: Design = build('BRUISER', [
  { part: 'drive.crawler', at: [0, 0, 0] },
  { part: 'drive.crawler', at: [5, 0, 0] },
  { part: 'drive.crawler', at: [0, 0, 5] },
  { part: 'drive.crawler', at: [5, 0, 5] },
  { part: 'str.plate', at: [1, 2, 1] },
  { part: 'str.plate', at: [1, 2, 4] },
  { part: 'str.rail', at: [3, 2, 0], yaw: 1 },
  { part: 'str.rail', at: [4, 2, 6], yaw: 1 },
  { part: 'bat.lipo6s', at: [1, 3, 1] },
  { part: 'bat.supercap', at: [1, 3, 3] },
  { part: 'ctl.advanced', at: [1, 3, 5] },
  { part: 'arm.steel', at: [1, 3, 7] },
  // The spinner overhangs the nose on its own rail, so its swept circle never
  // meets a wheel.
  { part: 'str.rail', at: [1, 2, -2] },
  { part: 'wpn.bar', at: [-1, 3, -2] },
]);

/** Tracks and titanium. Enormous grip, hard to flip, no weapon at all. */
export const BULWARK: Design = build('BULWARK', [
  // Track units are 2x2x4, so two per side in line makes a long, low hull.
  // A tracked vehicle wider than it is long pitches over under its own
  // acceleration; length is the whole point of tracks.
  { part: 'drive.tread', at: [0, 0, 0] },
  { part: 'drive.tread', at: [5, 0, 0] },
  { part: 'drive.tread', at: [0, 0, 5] },
  { part: 'drive.tread', at: [5, 0, 5] },
  { part: 'str.plate', at: [1, 2, 1] },
  { part: 'str.plate', at: [1, 2, 4] },
  { part: 'str.rail', at: [3, 2, 0], yaw: 1 },
  { part: 'str.rail', at: [4, 2, 6], yaw: 1 },
  { part: 'bat.lifepo', at: [1, 3, 1] },
  { part: 'ctl.basic', at: [1, 3, 3] },
  { part: 'bat.lipo6s', at: [1, 3, 5] },
  { part: 'arm.titanium', at: [1, 3, 7] },
  // Ballast low and outboard, where it does the most for the tip angle.
  { part: 'util.ballast', at: [3, 3, 0] },
  { part: 'util.ballast', at: [4, 3, 0] },
]);

/** Sprint pods and a flipper. Wins by putting the other machine on its back. */
export const TIPPER: Design = build('TIPPER', [
  // The fastest machine here, so it gets the longest wheelbase of the four.
  { part: 'drive.sprint', at: [0, 0, 0] },
  { part: 'drive.sprint', at: [5, 0, 0] },
  { part: 'drive.sprint', at: [0, 0, 6] },
  { part: 'drive.sprint', at: [5, 0, 6] },
  { part: 'str.plate', at: [1, 2, 1] },
  { part: 'str.plate', at: [1, 2, 4] },
  { part: 'str.rail', at: [3, 2, 0], yaw: 1 },
  { part: 'str.rail', at: [3, 2, 7], yaw: 1 },
  { part: 'bat.lipo6s', at: [1, 3, 1] },
  { part: 'ctl.basic', at: [1, 3, 3] },
  // The flipper hangs off the tail deck, which is what takes the recoil.
  { part: 'wpn.flipper', at: [1, 3, 5] },
]);

export const PRESETS: readonly Design[] = [SCOUT, BRUISER, BULWARK, TIPPER];

export const PRESET_NOTES: Readonly<Record<string, string>> = {
  SCOUT: 'The reference machine. Balanced gearing, low battery, wide stance. Start here and change one thing at a time.',
  BRUISER: 'Crawler gearing and a bar spinner. Slow across the floor, devastating on contact, and the spinner’s reaction torque fights its own steering.',
  BULWARK: 'Tracks and titanium. Almost impossible to flip or out-grip, and it carries nothing to hurt you with.',
  TIPPER: 'Fast pods and a flipper. Does no real damage — it wins by inverting you, which is the oldest trick in the sport.',
};
