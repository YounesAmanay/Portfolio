/**
 * The component catalogue.
 *
 * Real hardware, described the way its datasheet describes it. A player who
 * looks any of these up should find the game was honest: an N20 micro gearmotor
 * really does have six-odd ohms of winding, a 6S 5000 mAh LiPo really does hold
 * about 111 W·h, and a 25 cc two-stroke really does make somewhere near 1.2 kW
 * at nine thousand rpm.
 *
 * Nothing here states a torque or a top speed, because nothing here knows one.
 * Those come out of `solver.ts` once a chain is assembled, which is the whole
 * point: a motor's torque depends on the pack you hang off it and the gearbox
 * you bolt to it, and a catalogue that printed one number would be lying about
 * two decisions at once.
 *
 * Each entry carries a `lesson` — the one thing it exists to teach.
 */

import { port, type ComponentDef } from './components';

// ─────────────────────────────────────────────────────────────────────────────
// STRUCTURE — what everything else bolts to
// ─────────────────────────────────────────────────────────────────────────────

const STRUCTURE: ComponentDef[] = [
  {
    id: 'str.strut',
    name: 'Carbon Strut',
    category: 'STRUCTURE',
    footprint: { x: 1, y: 1, z: 3 },
    mass: 0.05,
    integrity: 300,
    cost: 22,
    blurb: 'Pultruded carbon tube. A quarter the weight of the alloy rail and it shatters instead of bending.',
    lesson: 'Light structure is brittle structure. Carbon survives one big hit and then it is confetti.',
    visual: { shape: 'box', colour: '#2a2e34', finish: 'carbon' },
    ports: [],
  },
  {
    id: 'str.rail',
    name: 'Alloy Rail',
    category: 'STRUCTURE',
    footprint: { x: 1, y: 1, z: 3 },
    mass: 0.22,
    integrity: 900,
    cost: 20,
    blurb: '6061 extrusion. The cheapest way to move a mounting point somewhere useful.',
    lesson: 'Structure is not free mass — every rail you add raises or shifts your centre of gravity.',
    visual: { shape: 'box', colour: '#9aa6b5', finish: 'alloy' },
    ports: [],
  },
  {
    id: 'str.pan',
    name: 'Titanium Pan',
    category: 'STRUCTURE',
    footprint: { x: 3, y: 1, z: 2 },
    mass: 0.18,
    integrity: 1400,
    cost: 90,
    blurb: 'A pressed 1.5 mm titanium baseplate. Expensive, and it is the floor of the machine.',
    lesson: 'A wide flat base is the best foundation there is: it lowers the mass and widens the stance at once.',
    visual: { shape: 'box', colour: '#8f9aa5', finish: 'alloy' },
    ports: [],
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
    lesson: 'Deck area is mounting area. Run out of it and the build starts going upward, which costs stability.',
    visual: { shape: 'box', colour: '#7f8b9c', finish: 'alloy' },
    ports: [],
  },
  {
    id: 'str.tower',
    name: 'Riser Tower',
    category: 'STRUCTURE',
    footprint: { x: 1, y: 3, z: 1 },
    mass: 0.26,
    integrity: 700,
    cost: 28,
    blurb: 'Vertical standoff. Lifts a weapon or a mount clear of the deck.',
    lesson: 'Height buys reach and costs stability. Watch the tip angle every time you build upward.',
    visual: { shape: 'box', colour: '#8c97a6', finish: 'alloy' },
    ports: [],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// ARMOUR — joules absorbed per kilogram carried, and nothing else
// ─────────────────────────────────────────────────────────────────────────────

const ARMOUR: ComponentDef[] = [
  {
    id: 'arm.uhmw',
    name: 'UHMW Skirt',
    category: 'ARMOUR',
    footprint: { x: 3, y: 1, z: 1 },
    mass: 0.3,
    integrity: 1800,
    cost: 35,
    blurb: 'Slippery polyethylene along the flank. A spinner skates off it instead of biting.',
    lesson: 'Armour that deflects beats armour that resists. Energy you never absorb costs nothing to survive.',
    visual: { shape: 'box', colour: '#d8dde3', finish: 'polymer', opacity: 0.55 },
    ports: [],
  },
  {
    id: 'arm.poly',
    name: 'Polycarbonate Shield',
    category: 'ARMOUR',
    footprint: { x: 3, y: 2, z: 1 },
    mass: 0.9,
    integrity: 2600,
    cost: 60,
    blurb: 'Springy 8 mm polycarbonate. Flexes instead of shattering, and weighs almost nothing.',
    lesson: '2 900 J per kilogram, the best ratio in the shop, and it still will not stop a serious spinner.',
    visual: { shape: 'box', colour: '#8fd7ff', finish: 'polymer', opacity: 0.38 },
    ports: [],
  },
  {
    id: 'arm.steel',
    name: 'Hardened Steel Plate',
    category: 'ARMOUR',
    footprint: { x: 3, y: 2, z: 1 },
    mass: 2.4,
    integrity: 7200,
    cost: 110,
    blurb: 'AR500 wear plate. Nothing in the arena goes through it, and you will feel every gram.',
    lesson: '3 000 J per kilogram — barely better than the polycarbonate, for nearly three times the weight.',
    visual: { shape: 'box', colour: '#6b7480', finish: 'hardened' },
    ports: [],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// DRIVE — the things that make torque
// ─────────────────────────────────────────────────────────────────────────────

const MOTORS: ComponentDef[] = [
  {
    id: 'mot.n20',
    name: 'N20 Micro Gearmotor',
    category: 'DRIVE',
    footprint: { x: 1, y: 1, z: 1 },
    mass: 0.011,
    integrity: 90,
    cost: 12,
    blurb: 'A 12 mm can the size of a thumb joint. Six ohms of winding, so it can barely draw a current.',
    lesson: 'High resistance is its own current limit. This motor cannot hurt a battery, and cannot move much either.',
    visual: { shape: 'motor', colour: '#b8bec7', finish: 'alloy' },
    ports: [port('pwr', 'power', 'in', 'Power'), port('out', 'shaft', 'out', 'Shaft')],
    motor: { kv: 3200, resistance: 6.4, noLoadCurrent: 0.08, maxCells: 2, continuousCurrent: 1.5 },
  },
  {
    id: 'mot.b22',
    name: 'B22 Outrunner',
    category: 'DRIVE',
    footprint: { x: 1, y: 1, z: 1 },
    mass: 0.055,
    integrity: 180,
    cost: 34,
    blurb: '22 mm brushless outrunner, 1100 Kv. The motor every beetleweight drivetrain starts from.',
    lesson: 'Kv 1100 on 3S spins 12 000 rpm free. You will need most of a 20:1 reduction before a wheel wants it.',
    visual: { shape: 'motor', colour: '#c8a04a', finish: 'copper' },
    ports: [port('pwr', 'power', 'in', 'Power'), port('out', 'shaft', 'out', 'Shaft')],
    motor: { kv: 1100, resistance: 1.8, noLoadCurrent: 0.3, maxCells: 6, continuousCurrent: 8 },
  },
  {
    id: 'mot.550',
    name: '550 Brushed',
    category: 'DRIVE',
    footprint: { x: 1, y: 1, z: 2 },
    mass: 0.21,
    integrity: 420,
    cost: 28,
    blurb: 'The cordless-drill motor. Cheap, brushed, and it will happily pull thirty amps until it melts.',
    lesson: 'Brushed motors are forgiving to wire and unforgiving to stall. The brushes are what burn.',
    visual: { shape: 'motor', colour: '#8d949c', finish: 'steel' },
    ports: [port('pwr', 'power', 'in', 'Power'), port('out', 'shaft', 'out', 'Shaft')],
    motor: { kv: 2100, resistance: 0.35, noLoadCurrent: 1.2, maxCells: 4, continuousCurrent: 25 },
  },
  {
    id: 'mot.775',
    name: '775 Brushed',
    category: 'DRIVE',
    footprint: { x: 1, y: 2, z: 2 },
    mass: 0.35,
    integrity: 620,
    cost: 42,
    blurb: 'A bigger can with a third of an ohm in it. Forty amps at stall, and it means it.',
    lesson: 'Winding resistance sets stall current, and stall current sets what your speed controller has to survive.',
    visual: { shape: 'motor', colour: '#7f868e', finish: 'steel' },
    ports: [port('pwr', 'power', 'in', 'Power'), port('out', 'shaft', 'out', 'Shaft')],
    motor: { kv: 1450, resistance: 0.28, noLoadCurrent: 1.6, maxCells: 4, continuousCurrent: 35 },
  },
  {
    id: 'mot.b50',
    name: 'B50 Outrunner',
    category: 'DRIVE',
    footprint: { x: 2, y: 2, z: 2 },
    mass: 0.62,
    integrity: 900,
    cost: 130,
    blurb: '50 mm can, 190 Kv, sixty milliohms. Low enough Kv to drive a wheel with very little reduction.',
    lesson: 'Low Kv is a gearbox you do not have to carry. It costs you top speed and buys you simplicity.',
    visual: { shape: 'motor', colour: '#c8a04a', finish: 'copper' },
    ports: [port('pwr', 'power', 'in', 'Power'), port('out', 'shaft', 'out', 'Shaft')],
    motor: { kv: 190, resistance: 0.06, noLoadCurrent: 1.4, maxCells: 6, continuousCurrent: 80 },
  },
  {
    id: 'mot.b80',
    name: 'B80 Outrunner',
    category: 'DRIVE',
    footprint: { x: 2, y: 2, z: 3 },
    mass: 1.35,
    integrity: 1400,
    cost: 310,
    blurb: '80 mm of magnet and copper at 120 Kv. Thirty-five milliohms, which is to say four hundred amps at stall.',
    lesson: 'Nothing on this machine will let it pull what it could. The ESC is the real spec sheet.',
    visual: { shape: 'motor', colour: '#c8a04a', finish: 'copper' },
    ports: [port('pwr', 'power', 'in', 'Power'), port('out', 'shaft', 'out', 'Shaft')],
    motor: { kv: 120, resistance: 0.035, noLoadCurrent: 2.0, maxCells: 8, continuousCurrent: 140 },
  },
];

const ENGINES: ComponentDef[] = [
  {
    id: 'eng.25',
    name: '25 cc Two-Stroke',
    category: 'DRIVE',
    footprint: { x: 2, y: 3, z: 3 },
    mass: 1.9,
    integrity: 2200,
    cost: 420,
    blurb: '1.2 kW at nine thousand rpm from under two kilograms. No pack on this shelf comes close.',
    lesson: 'Power density you cannot match electrically — paid for with a clutch, a tank, and no reverse.',
    visual: { shape: 'engine', colour: '#6f7681', finish: 'alloy' },
    ports: [port('fuel', 'fuel', 'in', 'Fuel'), port('out', 'shaft', 'out', 'Crank')],
    engine: { peakPower: 1200, peakRpm: 9000, idleRpm: 2200, burnRate: 1.6 },
  },
  {
    id: 'eng.50',
    name: '50 cc Two-Stroke',
    category: 'DRIVE',
    footprint: { x: 3, y: 3, z: 4 },
    mass: 3.4,
    integrity: 3600,
    cost: 780,
    blurb: '2.6 kW at eighty-five hundred. The engine behind the nastiest spinners ever built.',
    lesson: 'Torque lives in a band. Fall out of it under load and the engine bogs instead of pulling harder.',
    visual: { shape: 'engine', colour: '#656c76', finish: 'alloy' },
    ports: [port('fuel', 'fuel', 'in', 'Fuel'), port('out', 'shaft', 'out', 'Crank')],
    engine: { peakPower: 2600, peakRpm: 8500, idleRpm: 2000, burnRate: 3.2 },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// TRANSMISSION — the single most consequential decision on the machine
// ─────────────────────────────────────────────────────────────────────────────

const TRANSMISSION: ComponentDef[] = [
  {
    id: 'gbx.4',
    name: '4:1 Planetary',
    category: 'TRANSMISSION',
    footprint: { x: 1, y: 1, z: 1 },
    mass: 0.09,
    integrity: 320,
    cost: 38,
    blurb: 'One stage. Ninety per cent efficient and almost nothing to carry.',
    lesson: 'Each stage keeps nine tenths of what it is given. One stage is cheap; three is a quarter gone.',
    visual: { shape: 'gearbox', colour: '#9aa6b5', finish: 'alloy' },
    ports: [port('in', 'shaft', 'in', 'Input'), port('out', 'shaft', 'out', 'Output')],
    gearbox: { ratio: 4, stages: 1, torqueRating: 3, reversing: false },
  },
  {
    id: 'gbx.8',
    name: '8:1 Planetary',
    category: 'TRANSMISSION',
    footprint: { x: 1, y: 1, z: 2 },
    mass: 0.14,
    integrity: 360,
    cost: 55,
    blurb: 'Two stages. The reduction a fast machine runs, and it is barely enough to use the torque.',
    lesson: 'Gear for speed and the tyres will still spin before the motor works hard. Speed is easy; traction is not.',
    visual: { shape: 'gearbox', colour: '#9aa6b5', finish: 'alloy' },
    ports: [port('in', 'shaft', 'in', 'Input'), port('out', 'shaft', 'out', 'Output')],
    gearbox: { ratio: 8, stages: 2, torqueRating: 3, reversing: false },
  },
  {
    id: 'gbx.20',
    name: '20:1 Planetary',
    category: 'TRANSMISSION',
    footprint: { x: 1, y: 1, z: 2 },
    mass: 0.18,
    integrity: 380,
    cost: 68,
    blurb: 'Two stages of four and a half. The middle of the band, where the interesting machines live.',
    lesson: 'This is the ratio to start from. Everything either side of it is a deliberate sacrifice.',
    visual: { shape: 'gearbox', colour: '#9aa6b5', finish: 'alloy' },
    ports: [port('in', 'shaft', 'in', 'Input'), port('out', 'shaft', 'out', 'Output')],
    gearbox: { ratio: 20, stages: 2, torqueRating: 2.5, reversing: false },
  },
  {
    id: 'gbx.40',
    name: '40:1 Planetary',
    category: 'TRANSMISSION',
    footprint: { x: 1, y: 1, z: 2 },
    mass: 0.23,
    integrity: 400,
    cost: 82,
    blurb: 'Three stages. Climbs anything, catches nobody, and hands on three quarters of what it gets.',
    lesson: 'Torque you cannot put on the floor is heat. Past the tyres grip limit, more reduction buys nothing.',
    visual: { shape: 'gearbox', colour: '#9aa6b5', finish: 'alloy' },
    ports: [port('in', 'shaft', 'in', 'Input'), port('out', 'shaft', 'out', 'Output')],
    gearbox: { ratio: 40, stages: 3, torqueRating: 2.5, reversing: false },
  },
  {
    id: 'gbx.64',
    name: '64:1 Planetary',
    category: 'TRANSMISSION',
    footprint: { x: 1, y: 1, z: 3 },
    mass: 0.26,
    integrity: 400,
    cost: 95,
    blurb: 'A pusher box. Walking pace, and it will shove a machine twice its weight across the floor.',
    lesson: 'Control robots win by never letting go. They do not need speed, they need to out-push everything.',
    visual: { shape: 'gearbox', colour: '#9aa6b5', finish: 'alloy' },
    ports: [port('in', 'shaft', 'in', 'Input'), port('out', 'shaft', 'out', 'Output')],
    gearbox: { ratio: 64, stages: 3, torqueRating: 2, reversing: false },
  },
  {
    id: 'gbx.rev',
    name: 'Reversing Gearbox',
    category: 'TRANSMISSION',
    footprint: { x: 2, y: 2, z: 3 },
    mass: 0.95,
    integrity: 1100,
    cost: 240,
    blurb: '6:1 with a dog clutch for reverse. Heavy, and the only way a petrol machine ever backs up.',
    lesson: 'An engine turns one way. Reverse is a gearbox you carry, not a wire you swap.',
    visual: { shape: 'gearbox', colour: '#7f8b9c', finish: 'steel' },
    ports: [port('in', 'shaft', 'in', 'Input'), port('out', 'shaft', 'out', 'Output')],
    gearbox: { ratio: 6, stages: 2, torqueRating: 12, reversing: true },
  },
  {
    id: 'clu.cent',
    name: 'Centrifugal Clutch',
    category: 'TRANSMISSION',
    footprint: { x: 1, y: 1, z: 2 },
    mass: 0.24,
    integrity: 500,
    cost: 90,
    blurb: 'Shoes fly out and grip the drum past 2 800 rpm. Below that, the engine spins and the machine does not.',
    lesson: 'An engine cannot start against load. The clutch is what lets it idle while you sit still.',
    visual: { shape: 'cylinder', colour: '#8d949c', finish: 'steel' },
    ports: [port('in', 'shaft', 'in', 'Crank'), port('out', 'shaft', 'out', 'Output')],
    clutch: { engageRpm: 2800, torqueRating: 6 },
  },
  {
    id: 'clu.heavy',
    name: 'Heavy Centrifugal Clutch',
    category: 'TRANSMISSION',
    footprint: { x: 2, y: 2, z: 2 },
    mass: 0.55,
    integrity: 900,
    cost: 170,
    blurb: 'Bites earlier and holds eighteen newton-metres. For engines that would shred the light one.',
    lesson: 'Engage speed is a feel setting: early is smooth off the line, late keeps the engine in its band.',
    visual: { shape: 'cylinder', colour: '#7f868e', finish: 'steel' },
    ports: [port('in', 'shaft', 'in', 'Crank'), port('out', 'shaft', 'out', 'Output')],
    clutch: { engageRpm: 2400, torqueRating: 18 },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// WHEELS — diameter multiplies speed, divides torque, and lifts the machine
// ─────────────────────────────────────────────────────────────────────────────

const WHEELS: ComponentDef[] = [
  {
    id: 'whl.50',
    name: '50 mm Foam Wheel',
    category: 'WHEEL',
    footprint: { x: 1, y: 1, z: 1 },
    mass: 0.02,
    integrity: 140,
    cost: 8,
    blurb: 'Light lie-flat foam. Grips well, scrubs easily, and has no ground clearance whatsoever.',
    lesson: 'Small wheels turn torque into acceleration you can actually use. They also stop on every cable.',
    visual: { shape: 'wheel', colour: '#1c1f24', finish: 'rubber' },
    ports: [port('in', 'shaft', 'in', 'Axle')],
    wheel: { diameter: 0.05, width: 0.02, grip: 1.15, lateralGrip: 0.45 },
  },
  {
    id: 'whl.100',
    name: '100 mm Rubber Wheel',
    category: 'WHEEL',
    footprint: { x: 2, y: 2, z: 1 },
    mass: 0.09,
    integrity: 260,
    cost: 16,
    blurb: 'Moulded rubber on a nylon hub. The default, and hard to go wrong with.',
    lesson: 'Doubling diameter halves your torque at the floor. The gearbox has to pay that back.',
    visual: { shape: 'wheel', colour: '#1c1f24', finish: 'rubber' },
    ports: [port('in', 'shaft', 'in', 'Axle')],
    wheel: { diameter: 0.1, width: 0.03, grip: 1.05, lateralGrip: 0.4 },
  },
  {
    id: 'whl.140',
    name: '140 mm Silicone Wheel',
    category: 'WHEEL',
    footprint: { x: 2, y: 2, z: 1 },
    mass: 0.18,
    integrity: 300,
    cost: 30,
    blurb: 'Soft silicone tread. The stickiest thing here, and it wears out as fast as that implies.',
    lesson: 'Grip is the ceiling on everything upstream. Torque past what the tyre holds is just smoke.',
    visual: { shape: 'wheel', colour: '#24282e', finish: 'rubber' },
    ports: [port('in', 'shaft', 'in', 'Axle')],
    wheel: { diameter: 0.14, width: 0.04, grip: 1.2, lateralGrip: 0.5 },
  },
  {
    id: 'whl.200',
    name: '200 mm Pneumatic Wheel',
    category: 'WHEEL',
    footprint: { x: 3, y: 3, z: 1 },
    mass: 0.42,
    integrity: 420,
    cost: 48,
    blurb: 'An inflated tyre on a steel rim. Clears debris, soaks up hits, and grips across its tread as well as along it.',
    lesson: 'High lateral grip is a handling choice: it holds a line beautifully and fights you every time you turn.',
    visual: { shape: 'wheel', colour: '#181b1f', finish: 'rubber' },
    ports: [port('in', 'shaft', 'in', 'Axle')],
    wheel: { diameter: 0.2, width: 0.06, grip: 0.95, lateralGrip: 0.55 },
  },
  {
    id: 'whl.caster',
    name: 'Ball Caster',
    category: 'WHEEL',
    footprint: { x: 1, y: 1, z: 1 },
    mass: 0.05,
    integrity: 200,
    cost: 10,
    blurb: 'A hardened ball in a socket. Nothing drives it; it just stops that corner from dragging.',
    lesson: 'Not every contact patch needs a motor. A caster is how a two-wheel machine stays level.',
    visual: { shape: 'cylinder', colour: '#b8bec7', finish: 'hardened' },
    ports: [],
    wheel: { diameter: 0.04, width: 0.02, grip: 0.25, lateralGrip: 0.25 },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// POWER — voltage buys speed, C rating buys the right to use it
// ─────────────────────────────────────────────────────────────────────────────

const POWER: ComponentDef[] = [
  {
    id: 'pwr.2s450',
    name: '2S 450 mAh LiPo',
    category: 'POWER',
    footprint: { x: 1, y: 1, z: 1 },
    mass: 0.028,
    integrity: 60,
    cost: 14,
    blurb: '7.4 V and sixteen amps of headroom in something the size of a matchbox.',
    lesson: 'Capacity is runtime; C rating is how hard you may pull. A small pack limits both at once.',
    visual: { shape: 'box', colour: '#3b4250', finish: 'cell' },
    ports: [port('out', 'power', 'out', 'Main')],
    pack: { cells: 2, capacity: 0.45, cRating: 35, cellVolts: 3.7 },
  },
  {
    id: 'pwr.3s2200',
    name: '3S 2200 mAh LiPo',
    category: 'POWER',
    footprint: { x: 2, y: 1, z: 2 },
    mass: 0.185,
    integrity: 180,
    cost: 45,
    blurb: '11.1 V, 99 A of discharge, 24 W·h aboard. The pack most beetleweights run.',
    lesson: 'Ninety-nine amps sounds enormous until you stall four motors at once.',
    visual: { shape: 'box', colour: '#3b4250', finish: 'cell' },
    ports: [port('out', 'power', 'out', 'Main')],
    pack: { cells: 3, capacity: 2.2, cRating: 45, cellVolts: 3.7 },
  },
  {
    id: 'pwr.4s1800',
    name: '4S 1800 mAh LiPo',
    category: 'POWER',
    footprint: { x: 2, y: 1, z: 2 },
    mass: 0.21,
    integrity: 190,
    cost: 58,
    blurb: '14.8 V at 65C. Less capacity than the 3S and it will give you more of it, faster.',
    lesson: 'Trading amp-hours for C rating trades runtime for punch. Decide which one you lose matches to.',
    visual: { shape: 'box', colour: '#3b4250', finish: 'cell' },
    ports: [port('out', 'power', 'out', 'Main')],
    pack: { cells: 4, capacity: 1.8, cRating: 65, cellVolts: 3.7 },
  },
  {
    id: 'pwr.6s2200',
    name: '6S 2200 mAh LiPo',
    category: 'POWER',
    footprint: { x: 2, y: 2, z: 2 },
    mass: 0.36,
    integrity: 300,
    cost: 88,
    blurb: '22.2 V. Every motor on it spins twice as fast and pulls twice the current.',
    lesson: 'Doubling the cells is not an upgrade, it is a different machine with twice the electrical problem.',
    visual: { shape: 'box', colour: '#39404d', finish: 'cell' },
    ports: [port('out', 'power', 'out', 'Main')],
    pack: { cells: 6, capacity: 2.2, cRating: 45, cellVolts: 3.7 },
  },
  {
    id: 'pwr.6s5000',
    name: '6S 5000 mAh LiPo',
    category: 'POWER',
    footprint: { x: 3, y: 2, z: 2 },
    mass: 0.78,
    integrity: 520,
    cost: 165,
    blurb: '111 W·h and 175 A. Most of a kilogram, and it will run a featherweight for the full match.',
    lesson: 'Energy is mass. This pack alone is over half a beetleweight limit.',
    visual: { shape: 'box', colour: '#39404d', finish: 'cell' },
    ports: [port('out', 'power', 'out', 'Main')],
    pack: { cells: 6, capacity: 5.0, cRating: 35, cellVolts: 3.7 },
  },
  {
    id: 'pwr.4slfp',
    name: '4S LiFePO4',
    category: 'POWER',
    footprint: { x: 3, y: 2, z: 2 },
    mass: 0.42,
    integrity: 900,
    cost: 95,
    blurb: '12.8 V from iron-phosphate cells. Half the discharge rate of a LiPo, and it does not burn when punctured.',
    lesson: 'Chemistry shows up as volts per cell and amps per amp-hour. 3.2 V, not 3.7, changes every ratio downstream.',
    visual: { shape: 'box', colour: '#44505c', finish: 'cell' },
    ports: [port('out', 'power', 'out', 'Main')],
    pack: { cells: 4, capacity: 3.0, cRating: 20, cellVolts: 3.2 },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CONTROL — the cheap parts that die first when you get the sums wrong
// ─────────────────────────────────────────────────────────────────────────────

const CONTROL: ComponentDef[] = [
  {
    id: 'esc.20',
    name: '20 A Speed Controller',
    category: 'CONTROL',
    footprint: { x: 1, y: 1, z: 1 },
    mass: 0.024,
    integrity: 70,
    cost: 22,
    blurb: 'Four cells, twenty amps. Heat-shrink, two wires in, three out.',
    lesson: 'The ESC bounds what a motor can draw. It is also the cheapest thing on the machine and the first to die.',
    visual: { shape: 'board', colour: '#232a33', finish: 'polymer' },
    ports: [
      port('pwr', 'power', 'in', 'Pack'),
      port('sig', 'signal', 'in', 'Signal'),
      port('out', 'power', 'out', 'Motor'),
    ],
    esc: { maxCells: 4, maxAmps: 20 },
  },
  {
    id: 'esc.40',
    name: '40 A Speed Controller',
    category: 'CONTROL',
    footprint: { x: 1, y: 1, z: 2 },
    mass: 0.055,
    integrity: 90,
    cost: 40,
    blurb: 'Six cells, forty amps, a small heatsink that is doing more work than it looks like.',
    lesson: 'Rate the controller for stall current, not for cruising. Cruising was never the problem.',
    visual: { shape: 'board', colour: '#232a33', finish: 'polymer' },
    ports: [
      port('pwr', 'power', 'in', 'Pack'),
      port('sig', 'signal', 'in', 'Signal'),
      port('out', 'power', 'out', 'Motor'),
    ],
    esc: { maxCells: 6, maxAmps: 40 },
  },
  {
    id: 'esc.80',
    name: '80 A Speed Controller',
    category: 'CONTROL',
    footprint: { x: 2, y: 1, z: 2 },
    mass: 0.12,
    integrity: 140,
    cost: 78,
    blurb: 'Six cells, eighty amps. Enough to let a B50 make most of what it is capable of.',
    lesson: 'A big motor on a small ESC is a small motor. The controller is the real torque limit.',
    visual: { shape: 'board', colour: '#232a33', finish: 'polymer' },
    ports: [
      port('pwr', 'power', 'in', 'Pack'),
      port('sig', 'signal', 'in', 'Signal'),
      port('out', 'power', 'out', 'Motor'),
    ],
    esc: { maxCells: 6, maxAmps: 80 },
  },
  {
    id: 'esc.150',
    name: '150 A Speed Controller',
    category: 'CONTROL',
    footprint: { x: 2, y: 2, z: 3 },
    mass: 0.28,
    integrity: 220,
    cost: 190,
    blurb: 'Eight cells, a hundred and fifty amps, and a fan. Featherweight and up.',
    lesson: 'Let a motor pull 150 A and the pack has to find 150 A. Every limit you raise moves the problem upstream.',
    visual: { shape: 'board', colour: '#1e242c', finish: 'polymer' },
    ports: [
      port('pwr', 'power', 'in', 'Pack'),
      port('sig', 'signal', 'in', 'Signal'),
      port('out', 'power', 'out', 'Motor'),
    ],
    esc: { maxCells: 8, maxAmps: 150 },
  },
  {
    id: 'rcv.6',
    name: '6-Channel Receiver',
    category: 'CONTROL',
    footprint: { x: 1, y: 1, z: 1 },
    mass: 0.012,
    integrity: 50,
    cost: 30,
    blurb: '2.4 GHz, six channels. Two go to drive, which leaves four for everything else.',
    lesson: 'Channels are a budget. Every independently commanded thing on the machine costs one.',
    visual: { shape: 'board', colour: '#2b3440', finish: 'polymer', emissive: '#37d6a0' },
    ports: [port('out', 'signal', 'out', 'Channels')],
    receiver: { channels: 6 },
  },
  {
    id: 'rcv.10',
    name: '10-Channel Receiver',
    category: 'CONTROL',
    footprint: { x: 1, y: 1, z: 2 },
    mass: 0.02,
    integrity: 60,
    cost: 65,
    blurb: 'Ten channels with failsafe and telemetry back to the transmitter.',
    lesson: 'Failsafe is not optional in reality: a machine that keeps driving when the link drops is a loose machine.',
    visual: { shape: 'board', colour: '#2b3440', finish: 'polymer', emissive: '#37d6a0' },
    ports: [port('out', 'signal', 'out', 'Channels')],
    receiver: { channels: 10 },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY — fuel, and mass you add on purpose
// ─────────────────────────────────────────────────────────────────────────────

const UTILITY: ComponentDef[] = [
  {
    id: 'tnk.50',
    name: '0.5 L Fuel Tank',
    category: 'UTILITY',
    footprint: { x: 2, y: 2, z: 2 },
    mass: 0.49,
    integrity: 340,
    cost: 45,
    blurb: 'Half a litre of premix. About twenty minutes at peak on the small engine, far longer in practice.',
    lesson: 'Fuel is mass that drains away. The machine you finish a match in is lighter than the one you started.',
    visual: { shape: 'tank', colour: '#a8b0ba', finish: 'polymer' },
    ports: [port('out', 'fuel', 'out', 'Feed')],
    tank: { litres: 0.5 },
  },
  {
    id: 'tnk.120',
    name: '1.2 L Fuel Tank',
    category: 'UTILITY',
    footprint: { x: 3, y: 2, z: 3 },
    mass: 1.1,
    integrity: 520,
    cost: 85,
    blurb: 'Over a kilogram full. Nobody runs out, and everybody notices the weight.',
    lesson: 'Carrying fuel you will not burn is carrying ballast you did not choose.',
    visual: { shape: 'tank', colour: '#a8b0ba', finish: 'polymer' },
    ports: [port('out', 'fuel', 'out', 'Feed')],
    tank: { litres: 1.2 },
  },
  {
    id: 'utl.ballast',
    name: 'Tungsten Ballast',
    category: 'UTILITY',
    footprint: { x: 1, y: 1, z: 1 },
    mass: 0.5,
    integrity: 1800,
    cost: 60,
    blurb: 'Half a kilogram in a single cell. Denser than lead, and it goes exactly where you put it.',
    lesson: 'Reaching your weight limit is a choice about where the mass sits, not whether you carry it.',
    visual: { shape: 'box', colour: '#5d646d', finish: 'hardened' },
    ports: [],
    ballast: true,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// WEAPONS — a lump of steel on a shaft, and an arm on a pivot
// ─────────────────────────────────────────────────────────────────────────────
//
// Note what these do not carry: no damage, no energy, no spin rate. A spinner
// is inertia and a radius, and what it does depends entirely on the motor and
// gearbox behind it — the same chain a wheel hangs off, solved the same way.
// Under the old model a weapon arrived with its energy already decided, so the
// most interesting decision on the machine (how hard to gear something that
// has to reach speed before contact) did not exist.

const WEAPONS: ComponentDef[] = [
  {
    id: 'wpn.eggbeater',
    name: 'Eggbeater Drum',
    category: 'WEAPON',
    footprint: { x: 2, y: 2, z: 2 },
    mass: 0.35,
    integrity: 900,
    cost: 120,
    blurb: 'A small hardened drum on a horizontal axis. Reaches speed in a second and bites upward.',
    lesson: 'Low inertia is a weapon you can use all match. It never hits as hard, and it is always ready.',
    visual: { shape: 'disc', colour: '#5d646d', finish: 'hardened' },
    ports: [port('in', 'shaft', 'in', 'Drive')],
    spinner: { kind: 'DRUM', inertia: 0.0012, reach: 0.05, teeth: 2 },
  },
  {
    id: 'wpn.bar',
    name: 'Spinning Bar',
    category: 'WEAPON',
    footprint: { x: 5, y: 1, z: 1 },
    mass: 0.9,
    integrity: 1600,
    cost: 210,
    blurb: '400 mm of hardened bar across the machine. All the mass at the ends, where it counts.',
    lesson: 'Inertia goes as radius squared. The same kilogram twice as far out stores four times the energy.',
    visual: { shape: 'blade', colour: '#6b7480', finish: 'hardened' },
    ports: [port('in', 'shaft', 'in', 'Drive')],
    spinner: { kind: 'BAR', inertia: 0.011, reach: 0.2, teeth: 2 },
  },
  {
    id: 'wpn.drum',
    name: 'Hardened Drum',
    category: 'WEAPON',
    footprint: { x: 4, y: 2, z: 2 },
    mass: 1.4,
    integrity: 3200,
    cost: 280,
    blurb: 'A wide thick-walled drum. Four teeth, so it lands a hit on nearly any approach.',
    lesson: 'More teeth means more chances to connect and less energy in each. Drums grind; discs detonate.',
    visual: { shape: 'disc', colour: '#5d646d', finish: 'hardened' },
    ports: [port('in', 'shaft', 'in', 'Drive')],
    spinner: { kind: 'DRUM', inertia: 0.006, reach: 0.06, teeth: 4 },
  },
  {
    id: 'wpn.disc',
    name: 'Steel Disc',
    category: 'WEAPON',
    footprint: { x: 3, y: 3, z: 1 },
    mass: 2.4,
    integrity: 3800,
    cost: 340,
    blurb: '260 mm of tool steel with the mass at the rim. Takes a while to wind up and then it is terrifying.',
    lesson: 'Energy you have to spend eight seconds building is a decision made before contact, not during it.',
    visual: { shape: 'disc', colour: '#4f565f', finish: 'hardened' },
    ports: [port('in', 'shaft', 'in', 'Drive')],
    spinner: { kind: 'DISC', inertia: 0.028, reach: 0.13, teeth: 3 },
  },
  {
    id: 'wpn.hammer',
    name: 'Hammer Arm',
    category: 'WEAPON',
    footprint: { x: 1, y: 3, z: 4 },
    mass: 1.1,
    integrity: 2400,
    cost: 260,
    blurb: 'A pivoted arm with a hardened head and a 32 mm ram at its root. Comes down rather than around.',
    lesson: 'An arm is ready the instant it resets. A spinner has to be spun up before it is worth anything.',
    visual: { shape: 'hammer', colour: '#6b7480', finish: 'hardened' },
    ports: [port('gas', 'gas', 'in', 'Gas')],
    arm: { kind: 'HAMMER', reach: 0.22, inertia: 0.05, forceRating: 1000 },
    ram: { bore: 0.0008, stroke: 0.12, displacement: 0.096 },
  },
  {
    id: 'wpn.flipper',
    name: 'Flipper Plate',
    category: 'WEAPON',
    footprint: { x: 3, y: 1, z: 4 },
    mass: 1.6,
    integrity: 3000,
    cost: 320,
    blurb: 'A wedge plate on a 50 mm ram. Gets under a machine and puts it on its back, which ends most fights.',
    lesson: 'A flipper does no damage at all. It wins by making the other machine useless, which is enough.',
    visual: { shape: 'flipper', colour: '#7f8b9c', finish: 'steel' },
    ports: [port('gas', 'gas', 'in', 'Gas')],
    arm: { kind: 'FLIPPER', reach: 0.3, inertia: 0.09, forceRating: 6000 },
    ram: { bore: 0.002, stroke: 0.15, displacement: 0.3 },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// PNEUMATICS — the third chain, and the shortest
// ─────────────────────────────────────────────────────────────────────────────

const PNEUMATICS: ComponentDef[] = [
  {
    id: 'gas.co2s',
    name: '3.5 oz CO2 Bottle',
    category: 'UTILITY',
    footprint: { x: 1, y: 1, z: 3 },
    mass: 0.24,
    integrity: 600,
    cost: 40,
    blurb: 'Liquid CO2 at its own vapour pressure. About fifty litres of gas once it has boiled off.',
    lesson: 'CO2 sits at 55 bar whatever you do, and it freezes the regulator if you fire too fast.',
    visual: { shape: 'cylinder', colour: '#9aa6b5', finish: 'alloy' },
    ports: [port('out', 'gas', 'out', 'Outlet')],
    gas: { litres: 50, bar: 55 },
  },
  {
    id: 'gas.co2',
    name: '9 oz CO2 Bottle',
    category: 'UTILITY',
    footprint: { x: 2, y: 2, z: 3 },
    mass: 0.55,
    integrity: 900,
    cost: 70,
    blurb: 'The standard bottle. A hundred and forty litres, and more shots than a match has room for.',
    lesson: 'Gas is cheap and the bottle is not light. Carry the shots you will use, not the ones you might.',
    visual: { shape: 'cylinder', colour: '#9aa6b5', finish: 'alloy' },
    ports: [port('out', 'gas', 'out', 'Outlet')],
    gas: { litres: 140, bar: 55 },
  },
  {
    id: 'gas.hpa',
    name: 'HPA Bottle',
    category: 'UTILITY',
    footprint: { x: 2, y: 2, z: 4 },
    mass: 1.3,
    integrity: 1600,
    cost: 190,
    blurb: '13 cubic inches of air at 200 bar. Heavier than CO2, and it does not freeze when you empty it.',
    lesson: 'Compressed air gives up nothing to temperature. It costs you a kilogram to stop caring.',
    visual: { shape: 'cylinder', colour: '#43505c', finish: 'steel' },
    ports: [port('out', 'gas', 'out', 'Outlet')],
    gas: { litres: 380, bar: 200 },
  },
  {
    id: 'gas.reg8',
    name: '8 bar Regulator',
    category: 'UTILITY',
    footprint: { x: 1, y: 1, z: 1 },
    mass: 0.18,
    integrity: 400,
    cost: 60,
    blurb: 'Steps the bottle down to eight bar. Gentle on the ram and generous with the shot count.',
    lesson: 'Pressure is the trade: harder hits or more of them. The regulator is where you choose.',
    visual: { shape: 'cylinder', colour: '#b8bec7', finish: 'alloy' },
    ports: [port('in', 'gas', 'in', 'Inlet'), port('out', 'gas', 'out', 'Outlet')],
    regulator: { bar: 8 },
  },
  {
    id: 'gas.reg14',
    name: '14 bar Regulator',
    category: 'UTILITY',
    footprint: { x: 1, y: 1, z: 2 },
    mass: 0.22,
    integrity: 400,
    cost: 85,
    blurb: 'Fourteen bar. Nearly twice the force, and the arm has to be rated to take it.',
    lesson: 'The regulator cannot be turned above what the arm survives. Check the rating before the bottle.',
    visual: { shape: 'cylinder', colour: '#b8bec7', finish: 'alloy' },
    ports: [port('in', 'gas', 'in', 'Inlet'), port('out', 'gas', 'out', 'Outlet')],
    regulator: { bar: 14 },
  },
];

// ─────────────────────────────────────────────────────────────────────────────

export const ALL_COMPONENTS: readonly ComponentDef[] = [
  ...STRUCTURE,
  ...ARMOUR,
  ...MOTORS,
  ...ENGINES,
  ...TRANSMISSION,
  ...WHEELS,
  ...POWER,
  ...CONTROL,
  ...WEAPONS,
  ...PNEUMATICS,
  ...UTILITY,
];

const BY_ID = new Map(ALL_COMPONENTS.map((c) => [c.id, c]));

export function findComponent(id: string): ComponentDef | undefined {
  return BY_ID.get(id);
}

export function requireComponent(id: string): ComponentDef {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`unknown component: ${id}`);
  return found;
}

// ── weight classes ─────────────────────────────────────────────────────────

export interface WeightClass {
  readonly id: string;
  readonly name: string;
  /** Kilograms. */
  readonly limit: number;
  readonly blurb: string;
}

/**
 * The real classes, unchanged. The constraint the whole hobby is organised
 * around, and the reason any of the above is a trade-off rather than a
 * shopping list — without a limit the best machine is simply "all of it".
 */
export const WEIGHT_CLASSES: readonly WeightClass[] = [
  { id: 'beetle', name: 'Beetleweight', limit: 1.5, blurb: 'A machine you could carry in one hand.' },
  { id: 'hobby', name: 'Hobbyweight', limit: 5.4, blurb: 'Where the reference machines sit.' },
  { id: 'feather', name: 'Featherweight', limit: 13.6, blurb: 'Tracks, real armour, a serious spinner.' },
  { id: 'middle', name: 'Middleweight', limit: 27, blurb: 'Everything, and still not enough.' },
];

export function weightClass(id: string): WeightClass {
  const found = WEIGHT_CLASSES.find((c) => c.id === id);
  if (!found) throw new Error(`unknown weight class: ${id}`);
  return found;
}

/** The lightest class a machine of this mass still fits in, if any. */
export function classFor(mass: number): WeightClass | undefined {
  return WEIGHT_CLASSES.find((c) => mass <= c.limit);
}
