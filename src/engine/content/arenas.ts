/**
 * Arenas.
 *
 * Three maps, each built to punish a different assumption. Arena choice is
 * folded into the match seed so no Architect can tune for one and ride it.
 */

// NOTE: spawns sit at (width/2 +/- ARENA_SPAWN_SEPARATION/2, height/2). Never
// place a pylon within its own radius + ~3 m of either spawn point, or the two
// frames open with no line of sight to each other. `tests/engine/arena.test.ts`
// asserts this for every arena, because the failure mode is silent: the match
// simply runs 180 seconds with nobody firing a shot.
import { arenaId } from '../domain/ids';
import { pylon, zone, type Arena } from '../sim/arena';
import { ARENA_HEIGHT, ARENA_WIDTH } from '../tuning';

const W = ARENA_WIDTH;
const H = ARENA_HEIGHT;

/** Open ground. No cover, no help. The purest test of a build's raw numbers. */
export const PROVING_FLOOR: Arena = {
  id: arenaId('arena.proving_floor'),
  name: 'PROVING FLOOR',
  description:
    'Bare substrate. Two pylons near the centre and nothing else. Long-range builds have nowhere to be denied, and brawlers have nowhere to hide on the approach.',
  width: W,
  height: H,
  pylons: [pylon(W / 2, H / 2 - 18, 4), pylon(W / 2, H / 2 + 18, 4)],
  zones: [],
};

/** Coolant on the centre line. Contested ground for anyone running hot. */
export const HEAT_SINK: Arena = {
  id: arenaId('arena.heat_sink'),
  name: 'THE SINK',
  description:
    'A decommissioned cooling plant. Three coolant vents run down the centre line at x1.8 dissipation. Thermal builds want them badly, which makes the middle of this map the most dangerous place to stand.',
  width: W,
  height: H,
  pylons: [pylon(34, 24, 5), pylon(86, 56, 5), pylon(W / 2, H / 2 - 11, 6)],
  zones: [
    zone('COOLANT', W / 2, 16, 11),
    zone('COOLANT', W / 2, H - 16, 11),
    zone('COOLANT', W / 2 - 30, H / 2, 9),
  ],
};

/** Ion storms and rubble. Punishes camping and rewards knowing the terrain. */
export const STATIC_FIELD: Arena = {
  id: arenaId('arena.static_field'),
  name: 'STATIC FIELD',
  description:
    'Unstable substrate. Two ion storms drain 6 EN/s from anything standing in them, and rubble fields trade speed for evasion. Energy-hungry builds have to keep moving.',
  width: W,
  height: H,
  pylons: [pylon(44, H / 2 - 9, 5), pylon(76, H / 2 + 9, 5), pylon(60, 16, 4), pylon(60, 64, 4)],
  zones: [
    zone('ION_STORM', 40, 24, 13),
    zone('ION_STORM', 80, 56, 13),
    zone('RUBBLE', 60, H / 2, 15),
    zone('COOLANT', 14, 14, 8),
  ],
};

export const ALL_ARENAS: readonly Arena[] = [PROVING_FLOOR, HEAT_SINK, STATIC_FIELD];

/** Deterministic arena selection from a match seed. */
export function arenaForSeed(seed: number): Arena {
  const index = Math.abs(Math.floor(seed)) % ALL_ARENAS.length;
  return ALL_ARENAS[index] ?? PROVING_FLOOR;
}
