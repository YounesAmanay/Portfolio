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

/** Four balanced pods, low deck, battery on the floor. The reference machine. */
export const SCOUT: Design = build('SCOUT', [
  { part: 'drive.balanced', at: [0, 0, 0] },
  { part: 'drive.balanced', at: [5, 0, 0] },
  { part: 'drive.balanced', at: [0, 0, 5] },
  { part: 'drive.balanced', at: [5, 0, 5] },
  { part: 'str.plate', at: [2, 2, 2] },
  { part: 'bat.lipo6s', at: [2, 3, 2] },
  { part: 'ctl.basic', at: [3, 4, 3] },
  { part: 'arm.poly', at: [2, 3, 0] },
]);

/** Crawler pods, steel, and a bar spinner. Slow, heavy, and it hits back. */
export const BRUISER: Design = build('BRUISER', [
  // Wide stance, everything heavy on the deck, spinner overhanging the nose so
  // its swept circle never meets a wheel.
  { part: 'drive.crawler', at: [0, 0, 0] },
  { part: 'drive.crawler', at: [7, 0, 0] },
  { part: 'drive.crawler', at: [0, 0, 6] },
  { part: 'drive.crawler', at: [7, 0, 6] },
  { part: 'str.plate', at: [2, 2, 1] },
  { part: 'str.plate', at: [5, 2, 1] },
  { part: 'str.plate', at: [2, 2, 4] },
  { part: 'str.plate', at: [5, 2, 4] },
  { part: 'bat.lipo6s', at: [3, 3, 3] },
  { part: 'bat.supercap', at: [6, 3, 3] },
  { part: 'ctl.advanced', at: [2, 3, 2] },
  { part: 'arm.steel', at: [3, 3, 6] },
  { part: 'wpn.bar', at: [2, 3, -3] },
]);

/** Tracks and titanium. Enormous grip, hard to flip, no weapon at all. */
export const BULWARK: Design = build('BULWARK', [
  // Four track units, two per side in line. A tracked vehicle that is wider
  // than it is long pitches over under its own acceleration; length is the
  // whole point of tracks.
  { part: 'drive.tread', at: [0, 0, 0] },
  { part: 'drive.tread', at: [6, 0, 0] },
  { part: 'drive.tread', at: [0, 0, 4] },
  { part: 'drive.tread', at: [6, 0, 4] },
  { part: 'str.plate', at: [2, 2, 1] },
  { part: 'str.plate', at: [2, 2, 4] },
  { part: 'bat.lifepo', at: [2, 3, 2] },
  { part: 'bat.lipo6s', at: [5, 3, 5] },
  { part: 'ctl.basic', at: [5, 3, 2] },
  { part: 'arm.titanium', at: [2, 3, 6] },
  { part: 'util.ballast', at: [2, 3, 0] },
  { part: 'util.ballast', at: [5, 3, 0] },
]);

/** Sprint pods and a flipper. Wins by putting the other machine on its back. */
export const TIPPER: Design = build('TIPPER', [
  // Long and wide: a flipper needs to survive its own recoil.
  { part: 'drive.sprint', at: [0, 0, 0] },
  { part: 'drive.sprint', at: [6, 0, 0] },
  { part: 'drive.sprint', at: [0, 0, 6] },
  { part: 'drive.sprint', at: [6, 0, 6] },
  { part: 'str.plate', at: [2, 2, 1] },
  { part: 'str.plate', at: [2, 2, 4] },
  { part: 'bat.lipo6s', at: [2, 3, 2] },
  { part: 'ctl.basic', at: [5, 3, 3] },
  { part: 'wpn.flipper', at: [2, 3, 7] },
]);

export const PRESETS: readonly Design[] = [SCOUT, BRUISER, BULWARK, TIPPER];

export const PRESET_NOTES: Readonly<Record<string, string>> = {
  SCOUT: 'The reference machine. Balanced gearing, low battery, wide stance. Start here and change one thing at a time.',
  BRUISER: 'Crawler gearing and a bar spinner. Slow across the floor, devastating on contact, and the spinner’s reaction torque fights its own steering.',
  BULWARK: 'Tracks and titanium. Almost impossible to flip or out-grip, and it carries nothing to hurt you with.',
  TIPPER: 'Fast pods and a flipper. Does no real damage — it wins by inverting you, which is the oldest trick in the sport.',
};
