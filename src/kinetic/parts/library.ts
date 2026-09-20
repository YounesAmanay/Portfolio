/**
 * The component library.
 *
 * Every number here is chosen to be plausible against real hardware: a 775
 * brushed motor really does stall near 0.4 N·m, a 6S 5000 mAh LiPo really does
 * hold about 111 W·h, and a 2.4 kg disc at 6000 RPM really does store several
 * kilojoules. Players who look these up should find the game was honest.
 *
 * Each part carries a `lesson` — the one thing it exists to teach. The builder
 * surfaces it, because a component library that only lists numbers teaches
 * nothing.
 */

import { rpmToRad } from '../core/units';
import type { PartDef } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// STRUCTURE — cheap mass you use to reach, brace and shape
// ─────────────────────────────────────────────────────────────────────────────

const STRUCTURE: PartDef[] = [
  {
    id: 'str.rail',
    name: 'Alloy Rail',
    category: 'STRUCTURE',
    footprint: { x: 1, y: 1, z: 3 },
    mass: 0.22,
    integrity: 900,
    cost: 20,
    blurb: '6061 aluminium extrusion. The cheapest way to move a mounting point somewhere useful.',
    lesson: 'Structure is not free mass — every rail you add raises or shifts your centre of gravity.',
    visual: { shape: 'box', colour: '#9aa6b5' },
  },
  {
    id: 'str.plate',
    name: 'Chassis Plate',
    category: 'STRUCTURE',
    footprint: { x: 3, y: 1, z: 3 },
    mass: 0.55,
    integrity: 1600,
    cost: 45,
    blurb: 'Flat structural deck. Spreads load across the lattice and gives you somewhere to bolt things.',
    lesson: 'A wide, low plate is the single best foundation: it lowers the CoM and widens the support polygon at once.',
    visual: { shape: 'box', colour: '#7f8b9c' },
  },
  {
    id: 'str.tower',
    name: 'Riser Tower',
    category: 'STRUCTURE',
    footprint: { x: 1, y: 3, z: 1 },
    mass: 0.26,
    integrity: 700,
    cost: 28,
    blurb: 'Vertical standoff. Lifts a sensor, a weapon or a thruster clear of the deck.',
    lesson: 'Height buys reach and costs stability. Watch the tip angle as you build upward.',
    visual: { shape: 'box', colour: '#8c97a6' },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// ARMOUR — integrity per kilogram, and nothing else
// ─────────────────────────────────────────────────────────────────────────────

const ARMOUR: PartDef[] = [
  {
    id: 'arm.poly',
    name: 'Polycarbonate Shield',
    category: 'ARMOUR',
    footprint: { x: 3, y: 2, z: 1 },
    mass: 0.9,
    integrity: 2600,
    cost: 60,
    blurb: 'Springy 8 mm polycarbonate. Flexes instead of shattering, and weighs almost nothing.',
    lesson: '2 900 J per kilogram. The best armour-to-weight in the shop, and it still will not stop a spinner.',
    visual: { shape: 'box', colour: '#8fd7ff' },
  },
  {
    id: 'arm.steel',
    name: 'Hardened Steel Plate',
    category: 'ARMOUR',
    footprint: { x: 3, y: 2, z: 1 },
    mass: 3.4,
    integrity: 9400,
    cost: 130,
    blurb: 'AR500 wear plate. Heavy, cheap, and very hard to get through.',
    lesson: '2 760 J/kg — slightly worse per kilo than poly, but 3.6x the absolute stopping power. Mount it low.',
    visual: { shape: 'box', colour: '#5d6672' },
  },
  {
    id: 'arm.titanium',
    name: 'Titanium Wedge',
    category: 'ARMOUR',
    footprint: { x: 3, y: 1, z: 2 },
    mass: 2.1,
    integrity: 11200,
    cost: 420,
    blurb: 'Grade 5 titanium, angled. Deflects rather than absorbs — the geometry does half the work.',
    lesson: '5 330 J/kg. Twice the armour per kilo of anything else, for six times the price.',
    visual: { shape: 'box', colour: '#c7c2b6' },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// POWER — capacity is endurance, peak output is how hard you can pull
// ─────────────────────────────────────────────────────────────────────────────

const POWER: PartDef[] = [
  {
    id: 'bat.lipo3s',
    name: 'LiPo 3S 2200',
    category: 'POWER',
    footprint: { x: 2, y: 1, z: 1 },
    mass: 0.19,
    integrity: 400,
    cost: 35,
    blurb: '11.1 V, 2200 mAh, 30C. The starter pack: light, cheap, and quickly out of its depth.',
    lesson: '24 W·h and 800 W peak. Fine for one small drive pod; add a second and it sags.',
    visual: { shape: 'box', colour: '#2d3a4d', emissive: '#4de2ff' },
    battery: { capacity: 24.4, peakWatts: 800 },
  },
  {
    id: 'bat.lipo6s',
    name: 'LiPo 6S 5000',
    category: 'POWER',
    footprint: { x: 3, y: 1, z: 2 },
    mass: 0.72,
    integrity: 900,
    cost: 95,
    blurb: '22.2 V, 5000 mAh, 65C. The workhorse pack behind most competition machines.',
    lesson: '111 W·h, 2 200 W peak. Enough to run four drive pods hard — and heavy enough to matter where you put it.',
    visual: { shape: 'box', colour: '#26354a', emissive: '#4de2ff' },
    battery: { capacity: 111, peakWatts: 2200 },
  },
  {
    id: 'bat.lifepo',
    name: 'LiFePO₄ Brick',
    category: 'POWER',
    footprint: { x: 3, y: 2, z: 2 },
    mass: 1.45,
    integrity: 2200,
    cost: 140,
    blurb: 'Lithium iron phosphate. Twice the weight of a LiPo and far harder to set on fire.',
    lesson: 'More capacity, less punch. Endurance events love it; spinners hate it.',
    visual: { shape: 'box', colour: '#2f4438', emissive: '#4dffb0' },
    battery: { capacity: 128, peakWatts: 1200 },
  },
  {
    id: 'bat.supercap',
    name: 'Supercapacitor Bank',
    category: 'POWER',
    footprint: { x: 2, y: 1, z: 2 },
    mass: 0.55,
    integrity: 600,
    cost: 180,
    blurb: 'Holds almost nothing and delivers it almost instantly. A weapon’s best friend.',
    lesson: '4 W·h but 6 000 W peak. Pair it with a real battery: it covers the spikes, the pack covers the run.',
    visual: { shape: 'cylinder', colour: '#3a2f4d', emissive: '#d98bff' },
    battery: { capacity: 4, peakWatts: 6000 },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// DRIVE — motor, gearbox and tyre as one pod. Gearing is the whole lesson.
// ─────────────────────────────────────────────────────────────────────────────

const DRIVE: PartDef[] = [
  {
    id: 'drive.sprint',
    name: 'Sprint Pod 5:1',
    category: 'DRIVE',
    footprint: { x: 2, y: 2, z: 2 },
    mass: 0.55,
    integrity: 1100,
    cost: 110,
    blurb: 'Brushless 5065 through a light 5:1 planetary onto a 120 mm slick.',
    lesson: 'Geared for speed: 14 m/s flat out, but only 0.5 N\u00b7m at the wheel. It will not climb.',
    visual: { shape: 'wheel', colour: '#1f242c', emissive: '#4de2ff' },
    drive: {
      wheelTorque: 0.5, freeSpeed: rpmToRad(2230), radius: 0.06, width: 0.04,
      grip: 1.0, lateralGrip: 0.9, peakWatts: 700, thermalLimit: 0.45, channel: 'DRIVE',
    },
  },
  {
    id: 'drive.balanced',
    name: 'Standard Pod 12:1',
    category: 'DRIVE',
    footprint: { x: 2, y: 2, z: 2 },
    mass: 0.68,
    integrity: 1400,
    cost: 130,
    blurb: 'The default. 12:1 planetary, 140 mm treaded tyre, nothing clever.',
    lesson: '1.0 N\u00b7m and 7.5 m/s. If you do not know what you need, you need this.',
    visual: { shape: 'wheel', colour: '#23282f', emissive: '#4de2ff' },
    drive: {
      wheelTorque: 1.0, freeSpeed: rpmToRad(1023), radius: 0.07, width: 0.045,
      grip: 1.1, lateralGrip: 0.9, peakWatts: 700, thermalLimit: 0.5, channel: 'DRIVE',
    },
  },
  {
    id: 'drive.crawler',
    name: 'Crawler Pod 40:1',
    category: 'DRIVE',
    footprint: { x: 2, y: 2, z: 2 },
    mass: 0.95,
    integrity: 1700,
    cost: 165,
    blurb: 'Deep 40:1 reduction onto a 160 mm knobbly. Slow, and almost impossible to stall.',
    lesson: '2.6 N\u00b7m at 2.8 m/s \u2014 five times the pull of a Sprint Pod at a fifth of the speed. Same motor, different gearbox.',
    visual: { shape: 'wheel', colour: '#2a2620', emissive: '#ffab4d' },
    drive: {
      wheelTorque: 2.6, freeSpeed: rpmToRad(335), radius: 0.08, width: 0.055,
      grip: 1.35, lateralGrip: 0.95, peakWatts: 700, thermalLimit: 0.6, channel: 'DRIVE',
    },
  },
  {
    id: 'drive.tread',
    name: 'Track Unit',
    category: 'DRIVE',
    footprint: { x: 2, y: 2, z: 4 },
    mass: 1.6,
    integrity: 2400,
    cost: 210,
    blurb: 'Rubber track over four idlers. Enormous contact patch, terrible on a polished floor.',
    lesson: 'Grip 1.6 — the most traction available. Long contact patch also resists being flipped.',
    visual: { shape: 'box', colour: '#1b1e23', emissive: '#ffab4d' },
    drive: {
      wheelTorque: 2.2, freeSpeed: rpmToRad(430), radius: 0.07, width: 0.06,
      grip: 1.6, lateralGrip: 1.2, peakWatts: 850, thermalLimit: 0.55, channel: 'DRIVE',
    },
  },
  {
    id: 'drive.omni',
    name: 'Omni Pod',
    category: 'DRIVE',
    footprint: { x: 2, y: 2, z: 2 },
    mass: 0.6,
    integrity: 900,
    cost: 155,
    blurb: 'Rollers set around the rim let it slide sideways freely while driving forward.',
    lesson: 'Lateral grip 0.25. Four of these give you a robot that strafes — and one that cannot hold a line.',
    visual: { shape: 'wheel', colour: '#2b3540', emissive: '#d98bff' },
    drive: {
      wheelTorque: 0.7, freeSpeed: rpmToRad(820), radius: 0.065, width: 0.05,
      grip: 0.85, lateralGrip: 0.25, peakWatts: 620, thermalLimit: 0.45, channel: 'DRIVE',
    },
  },
];

const ROLLERS: PartDef[] = [
  {
    id: 'wheel.caster',
    name: 'Swivel Caster',
    category: 'WHEEL',
    footprint: { x: 1, y: 2, z: 1 },
    mass: 0.12,
    integrity: 400,
    cost: 18,
    blurb: 'Free-swivelling support wheel. Carries load, contributes nothing to drive.',
    lesson: 'A third contact point turns a tippy two-wheeler into a stable tricycle for 120 grams.',
    visual: { shape: 'wheel', colour: '#39414c' },
    roller: { radius: 0.035, width: 0.025, grip: 0.7, steerable: true },
  },
  {
    id: 'wheel.idler',
    name: 'Idler Wheel',
    category: 'WHEEL',
    footprint: { x: 2, y: 2, z: 1 },
    mass: 0.2,
    integrity: 600,
    cost: 24,
    blurb: 'Fixed-axis unpowered wheel. Rolls forward, resists sideways.',
    lesson: 'Undriven wheels still carry weight off your drive pods — which changes how much grip those pods have.',
    visual: { shape: 'wheel', colour: '#333a44' },
    roller: { radius: 0.055, width: 0.03, grip: 0.95, steerable: false },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// THRUST — for machines that leave the floor
// ─────────────────────────────────────────────────────────────────────────────

const THRUST: PartDef[] = [
  {
    id: 'thr.rotor',
    name: 'Rotor 10"',
    category: 'THRUST',
    footprint: { x: 3, y: 1, z: 3 },
    mass: 0.19,
    integrity: 300,
    cost: 70,
    blurb: 'Large slow-turning propeller. Efficient, fragile, and it needs clear air above and below.',
    lesson: '9 N for 180 W. Four of these lift about 3.6 kg — so your whole machine must come in under that.',
    visual: { shape: 'rotor', colour: '#2e3742', emissive: '#4de2ff' },
    thruster: { thrust: 9, peakWatts: 180, channel: 'LIFT' },
  },
  {
    id: 'thr.edf',
    name: 'Ducted Fan',
    category: 'THRUST',
    footprint: { x: 2, y: 2, z: 2 },
    mass: 0.32,
    integrity: 700,
    cost: 130,
    blurb: 'Shrouded high-RPM impeller. Compact and loud, and it drinks power.',
    lesson: '14 N for 420 W — half the efficiency of a rotor, in a third of the space.',
    visual: { shape: 'duct', colour: '#242b35', emissive: '#4de2ff' },
    thruster: { thrust: 14, peakWatts: 420, channel: 'LIFT' },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// WEAPONS — stored energy, released on contact
// ─────────────────────────────────────────────────────────────────────────────

const WEAPONS: PartDef[] = [
  {
    id: 'wpn.disc',
    name: 'Spinner Disc',
    category: 'WEAPON',
    footprint: { x: 4, y: 1, z: 4 },
    mass: 2.4,
    integrity: 3200,
    cost: 260,
    blurb: 'A 300 mm hardened disc on a direct-drive hub. Takes eight seconds to spin up.',
    lesson: 'E = ½Iω² stores 5.5 kJ at full speed — more than a rifle round. Newton takes his half out of you.',
    visual: { shape: 'disc', colour: '#6a7180', emissive: '#ff5c6a' },
    weapon: { kind: 'SPINNER', inertia: 0.028, maxSpin: rpmToRad(6000), drive: 2.2, peakWatts: 1400, reach: 0.1, channel: 'WEAPON' },
  },
  {
    id: 'wpn.bar',
    name: 'Spinner Bar',
    category: 'WEAPON',
    footprint: { x: 6, y: 1, z: 2 },
    mass: 3.1,
    integrity: 4100,
    cost: 320,
    blurb: 'A 500 mm steel bar with hardened tips. Mass concentrated far from the axis.',
    lesson: 'Same weight as a disc, far more inertia — because I scales with r². Reach is energy.',
    visual: { shape: 'blade', colour: '#767d8a', emissive: '#ff5c6a' },
    weapon: { kind: 'SPINNER', inertia: 0.065, maxSpin: rpmToRad(3600), drive: 2.8, peakWatts: 1600, reach: 0.16, channel: 'WEAPON' },
  },
  {
    id: 'wpn.flipper',
    name: 'Pneumatic Flipper',
    category: 'WEAPON',
    footprint: { x: 3, y: 1, z: 3 },
    mass: 1.8,
    integrity: 2600,
    cost: 230,
    blurb: 'CO₂ ram under a hinged wedge. One violent shove, then a long reload.',
    lesson: 'Does almost no damage. Wins by putting the other machine on its back, where its wheels are useless.',
    visual: { shape: 'flipper', colour: '#8a6a3a', emissive: '#ffab4d' },
    weapon: { kind: 'FLIPPER', drive: 900, peakWatts: 300, reach: 0.22, channel: 'WEAPON' },
  },
  {
    id: 'wpn.hammer',
    name: 'Overhead Hammer',
    category: 'WEAPON',
    footprint: { x: 2, y: 3, z: 4 },
    mass: 2.2,
    integrity: 2900,
    cost: 210,
    blurb: 'Weighted head on a powered arm. Hits downward, where armour is usually thinnest.',
    lesson: 'Concentrates its energy on a small area instead of spreading it — armour thickness matters more than total integrity.',
    visual: { shape: 'hammer', colour: '#5a5f68', emissive: '#ff5c6a' },
    weapon: { kind: 'HAMMER', drive: 420, peakWatts: 700, reach: 0.3, channel: 'WEAPON' },
  },
  {
    id: 'wpn.saw',
    name: 'Cutting Disc',
    category: 'WEAPON',
    footprint: { x: 3, y: 1, z: 1 },
    mass: 1.4,
    integrity: 1500,
    cost: 175,
    blurb: 'Abrasive wheel at very high RPM. Low stored energy, but it keeps applying it.',
    lesson: 'Sustained low damage instead of one big hit — the answer to armour too thick to shatter.',
    visual: { shape: 'disc', colour: '#8a8378', emissive: '#ffab4d' },
    weapon: { kind: 'SAW', inertia: 0.004, maxSpin: rpmToRad(9000), drive: 0.9, peakWatts: 600, reach: 0.08, channel: 'WEAPON' },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CONTROL & UTILITY
// ─────────────────────────────────────────────────────────────────────────────

const CONTROL: PartDef[] = [
  {
    id: 'ctl.basic',
    name: 'Flight Controller',
    category: 'CONTROL',
    footprint: { x: 1, y: 1, z: 2 },
    mass: 0.06,
    integrity: 250,
    cost: 40,
    blurb: 'Receiver, ESC bus and a small IMU. Every machine needs one.',
    lesson: 'Three channels: drive, steer, and one more. Lose this part and the robot is scrap metal.',
    visual: { shape: 'box', colour: '#1d5a4a', emissive: '#4dffb0' },
    controller: { channels: 3, stabilisation: 0 },
  },
  {
    id: 'ctl.advanced',
    name: 'Avionics Stack',
    category: 'CONTROL',
    footprint: { x: 2, y: 1, z: 2 },
    mass: 0.11,
    integrity: 320,
    cost: 120,
    blurb: 'Six channels with a rate-damping loop on all three axes.',
    lesson: 'Stabilisation fights rotation you did not ask for. It is what makes a multirotor flyable at all.',
    visual: { shape: 'box', colour: '#1d4a5a', emissive: '#4de2ff' },
    controller: { channels: 6, stabilisation: 0.65 },
  },
];

const UTILITY: PartDef[] = [
  {
    id: 'util.ballast',
    name: 'Tungsten Ballast',
    category: 'UTILITY',
    footprint: { x: 1, y: 1, z: 1 },
    mass: 0.5,
    integrity: 1800,
    cost: 30,
    blurb: 'A dense block that does nothing at all, which is exactly the point.',
    lesson: 'The cheapest fix for a robot that tips: add mass low and outboard to drag the CoM down and out.',
    visual: { shape: 'box', colour: '#4a4a52' },
    ballast: true,
  },
];

export const PART_LIBRARY: readonly PartDef[] = [
  ...STRUCTURE, ...ARMOUR, ...POWER, ...DRIVE, ...ROLLERS,
  ...THRUST, ...WEAPONS, ...CONTROL, ...UTILITY,
];

const BY_ID = new Map(PART_LIBRARY.map((part) => [part.id, part]));

export function getPart(id: string): PartDef | undefined {
  return BY_ID.get(id);
}

export function requirePart(id: string): PartDef {
  const part = BY_ID.get(id);
  if (!part) throw new Error(`Unknown part: ${id}`);
  return part;
}

export function partsByCategory(category: PartDef['category']): readonly PartDef[] {
  return PART_LIBRARY.filter((part) => part.category === category);
}
