/**
 * Physical constants and the lattice.
 *
 * Everything in KINETIC is SI. If a number has a unit, that unit is real — the
 * whole point is that intuition earned here transfers to actual hardware.
 */

/** Lattice cell size, metres. A part's footprint is an integer count of these. */
export const CELL = 0.08;

/** Physics runs at a fixed 120 Hz; rendering interpolates between steps. */
export const PHYSICS_HZ = 120;
export const PHYSICS_DT = 1 / PHYSICS_HZ;

export const GRAVITY = -9.81;

/** Air density at sea level, kg/m^3 — used for drag on fast machines. */
export const AIR_DENSITY = 1.225;

/** Ambient temperature, °C. Motors heat above this and cool toward it. */
export const AMBIENT_C = 22;

/** Convert between the lattice and metres. */
export const cellsToM = (cells: number): number => cells * CELL;
export const mToCells = (metres: number): number => Math.round(metres / CELL);

/** rad/s <-> RPM, because motor datasheets are in RPM and physics is in rad/s. */
export const rpmToRad = (rpm: number): number => (rpm * Math.PI) / 30;
export const radToRpm = (rad: number): number => (rad * 30) / Math.PI;

/** Watt-hours <-> joules. */
export const whToJ = (wh: number): number => wh * 3600;
export const jToWh = (j: number): number => j / 3600;

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const clamp01 = (v: number): number => clamp(v, 0, 1);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
