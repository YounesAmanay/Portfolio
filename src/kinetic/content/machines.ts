/**
 * The machines you start from.
 *
 * Four complete builds, one per point on the weight ladder, each assembled the
 * way a real one goes together: a deck to bolt to, a motor bolted to that, a
 * gearbox on the motor, a wheel on the gearbox, and a loom joining the pack to
 * the controllers to the motors.
 *
 * They are worked examples more than they are opponents. Every one is meant to
 * be opened up and taken apart, and every one makes a decision you can
 * disagree with — NIPPER gears for speed and cannot push, BULWARK gears for
 * torque and cannot catch anyone, TIPPER spends a quarter of its weight on a
 * weapon that does no damage at all.
 *
 * Nothing here states a torque or a top speed. Those come out of the solver,
 * so editing a preset immediately tells you what you have done to it.
 */

import {
  addFitted,
  addLink,
  canFit,
  emptyBuild,
  type Build,
  type Fitted,
} from '../machine/build';

const at = (uid: string, componentId: string, x: number, y: number, z: number): Fitted => ({
  uid,
  componentId,
  cell: { x, y, z },
  yaw: 0,
});

/**
 * Places a component, refusing to build something impossible.
 *
 * `addFitted` does not validate — that is the builder's job, and it is this
 * file's job too. Without it a preset can quietly stack a motor inside a
 * wheel: the machine still spawns, still reports four driven contacts, and
 * drives off sideways.
 */
function place(build: Build, fitted: Fitted): Build {
  if (!canFit(build, fitted)) {
    throw new Error(
      `${build.name}: ${fitted.componentId} does not fit at ` +
        `${fitted.cell.x},${fitted.cell.y},${fitted.cell.z}`,
    );
  }
  return addFitted(build, fitted);
}

/** Pack to controller to motor, motor to gearbox to wheel. The whole loom. */
function wireChain(build: Build, side: string, pack: string): Build {
  let next = build;
  next = addLink(next, { from: pack, fromPort: 'out', to: `e${side}`, toPort: 'pwr' });
  next = addLink(next, { from: 'rx', fromPort: 'out', to: `e${side}`, toPort: 'sig' });
  next = addLink(next, { from: `e${side}`, fromPort: 'out', to: `m${side}`, toPort: 'pwr' });
  next = addLink(next, { from: `m${side}`, fromPort: 'out', to: `g${side}`, toPort: 'in' });
  next = addLink(next, { from: `g${side}`, fromPort: 'out', to: `w${side}`, toPort: 'in' });
  return next;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * NIPPER — beetleweight, 0.8 kg.
 *
 * Two driven wheels on 4:1, a caster at the nose, and nothing else. Eight
 * metres a second on 50 mm wheels and almost no push at all: it wins by
 * getting behind things.
 *
 * It carries no weapon on purpose. A drum and the chain to spin it is half a
 * kilogram, and on a 1.5 kg machine that is a third of the weight hanging
 * ahead of the front axle — measured, it put the centre of mass outside the
 * wheelbase whatever the wheelbase was. Weapons want a heavier class, and
 * finding that out is the lesson.
 */
export function nipper(): Build {
  let b = emptyBuild('NIPPER', 'beetle');

  b = place(b, at('deck', 'str.pan', 1, 1, 2));          // x1..3, y1, z2..3
  b = place(b, at('caster', 'whl.caster', 2, 0, 2));

  for (const [side, x] of [['l', 0], ['r', 4]] as const) {
    b = place(b, at(`m${side}`, 'mot.b22', x, 1, 3));
    b = place(b, at(`g${side}`, 'gbx.4', x, 1, 4));
    b = place(b, at(`w${side}`, 'whl.50', x, 0, 4));
    b = place(b, at(`e${side}`, 'esc.20', x, 2, 3));
  }

  b = place(b, at('pack', 'pwr.3s2200', 1, 2, 2));       // x1..2, y2, z2..3
  b = place(b, at('rx', 'rcv.6', 3, 2, 2));

  for (const side of ['l', 'r'] as const) b = wireChain(b, side, 'pack');
  return b;
}

/**
 * SCOUT — hobbyweight, 4.7 kg.
 *
 * Four driven wheels on 20:1, an eggbeater on the nose geared 4:1 so it is up
 * to speed in five seconds rather than a minute, and one polycarbonate plate
 * across the front deck.
 *
 * The weapon is the same half kilogram that will not fit on a beetleweight.
 * Here it is a tenth of the machine and sits comfortably inside the wheelbase,
 * which is most of what a weight class buys you.
 */
export function scout(): Build {
  let b = emptyBuild('SCOUT', 'hobby');

  b = place(b, at('deck', 'str.plate', 1, 2, 0));        // x1..3, y2, z0..2
  b = place(b, at('deck2', 'str.plate', 1, 2, 3));       // x1..3, y2, z3..5

  // [uid suffix, wheel x, chain x, z]
  const corners: [string, number, number, number][] = [
    ['fl', -2, 0, 1],
    ['fr', 5, 4, 1],
    ['rl', -2, 0, 4],
    ['rr', 5, 4, 4],
  ];
  for (const [side, wx, cx, z] of corners) {
    b = place(b, at(`m${side}`, 'mot.550', cx, 2, z));
    b = place(b, at(`g${side}`, 'gbx.20', cx, 1, z));
    b = place(b, at(`w${side}`, 'whl.100', wx, 0, z));
    b = place(b, at(`e${side}`, 'esc.20', cx, 3, z));
  }

  b = place(b, at('pack', 'pwr.3s2200', 1, 3, 0));
  b = place(b, at('rx', 'rcv.10', 3, 3, 0));
  b = place(b, at('armour', 'arm.poly', 1, 3, 2));

  // The drum overhangs the nose, with its own motor and reduction beside it.
  b = place(b, at('drum', 'wpn.eggbeater', 1, 2, -2));   // x1..2, y2..3, z-2..-1
  b = place(b, at('mwep', 'mot.b22', 3, 2, -1));
  b = place(b, at('gwep', 'gbx.4', 3, 2, -2));
  b = place(b, at('ewep', 'esc.20', 3, 3, -1));

  for (const [side] of corners) b = wireChain(b, side, 'pack');
  b = addLink(b, { from: 'pack', fromPort: 'out', to: 'ewep', toPort: 'pwr' });
  b = addLink(b, { from: 'rx', fromPort: 'out', to: 'ewep', toPort: 'sig' });
  b = addLink(b, { from: 'ewep', fromPort: 'out', to: 'mwep', toPort: 'pwr' });
  b = addLink(b, { from: 'mwep', fromPort: 'out', to: 'gwep', toPort: 'in' });
  b = addLink(b, { from: 'gwep', fromPort: 'out', to: 'drum', toPort: 'in' });
  return b;
}

/**
 * TIPPER — hobbyweight, 4.6 kg.
 *
 * Four wheels and a flipper that does no damage whatsoever. It wins by putting
 * the other machine on its back, which ends most fights, and it carries twenty
 * shots at eight bar to do it with. The gas chain costs the pack nothing.
 */
export function tipper(): Build {
  let b = emptyBuild('TIPPER', 'hobby');

  // The wedge runs the full nose, and the front wheels sit *beside* it rather
  // than behind it. A flipper and its bottle are a third of this machine's
  // weight, all of it forward; put the front axle behind that and the centre
  // of mass falls outside the wheelbase and it noses over under braking.
  b = place(b, at('flip', 'wpn.flipper', 1, 2, 0));      // x1..3, y2, z0..3
  b = place(b, at('deck', 'str.pan', 1, 2, 4));          // x1..3, y2, z4..5
  b = place(b, at('deck2', 'str.pan', 1, 2, 6));         // x1..3, y2, z6..7

  const corners: [string, number, number, number][] = [
    ['fl', -2, 0, 1],
    ['fr', 5, 4, 1],
    ['rl', -2, 0, 6],
    ['rr', 5, 4, 6],
  ];
  for (const [side, wx, cx, z] of corners) {
    b = place(b, at(`m${side}`, 'mot.550', cx, 2, z));
    b = place(b, at(`g${side}`, 'gbx.20', cx, 1, z));
    b = place(b, at(`w${side}`, 'whl.100', wx, 0, z));
    b = place(b, at(`e${side}`, 'esc.20', cx, 3, z));
  }

  b = place(b, at('pack', 'pwr.3s2200', 1, 3, 4));
  b = place(b, at('rx', 'rcv.10', 3, 3, 4));
  b = place(b, at('bottle', 'gas.co2s', 1, 3, 0));       // x1, y3, z0..2
  b = place(b, at('reg', 'gas.reg8', 1, 4, 0));

  for (const [side] of corners) b = wireChain(b, side, 'pack');
  b = addLink(b, { from: 'bottle', fromPort: 'out', to: 'reg', toPort: 'in' });
  b = addLink(b, { from: 'reg', fromPort: 'out', to: 'flip', toPort: 'gas' });
  return b;
}

/**
 * BULWARK — featherweight, 11.8 kg.
 *
 * Four big outrunners on 8:1 through 140 mm tyres, two five-amp-hour packs and
 * four kilograms of hardened steel. It makes about ten times the tractive
 * effort its tyres can put down, which is the point: it cannot be pushed, and
 * it will shove anything in its class into a wall and hold it there.
 */
export function bulwark(): Build {
  let b = emptyBuild('BULWARK', 'feather');

  b = place(b, at('deck', 'str.plate', 1, 3, 0));        // x1..3, y3, z0..2
  b = place(b, at('deck2', 'str.plate', 1, 3, 3));       // x1..3, y3, z3..5

  // [uid suffix, wheel x, motor x, chain x, z]
  // Front and rear as far apart as the decks allow: four kilograms of steel
  // wants a long wheelbase to sit inside.
  const corners: [string, number, number, number, number][] = [
    ['fl', -2, -1, 0, 0],
    ['fr', 5, 4, 4, 0],
    ['rl', -2, -1, 0, 5],
    ['rr', 5, 4, 4, 5],
  ];
  for (const [side, wx, mx, cx, z] of corners) {
    b = place(b, at(`m${side}`, 'mot.b50', mx, 3, z));
    b = place(b, at(`g${side}`, 'gbx.8', cx, 2, z));
    b = place(b, at(`w${side}`, 'whl.140', wx, 1, z));
    b = place(b, at(`e${side}`, 'esc.40', cx, 5, z));
  }

  b = place(b, at('pack', 'pwr.6s5000', 1, 4, 0));       // x1..3, y4..5, z0..1
  b = place(b, at('pack2', 'pwr.6s5000', 1, 4, 3));
  b = place(b, at('rx', 'rcv.10', 1, 6, 0));
  // Steel on the bumpers, down at axle height. Carried up on the deck at y4 it
  // put nearly half the machine's mass above everything else and dropped the
  // tip limit to 0.08 g — a featherweight that falls over if you look at it.
  b = place(b, at('armF', 'arm.steel', 1, 2, -1));
  b = place(b, at('armR', 'arm.steel', 1, 2, 6));

  // Front chains off the first pack, rear off the second, because one pack
  // feeding four 40 A controllers is 160 A and this pack gives 175.
  b = wireChain(b, 'fl', 'pack');
  b = wireChain(b, 'fr', 'pack');
  b = wireChain(b, 'rl', 'pack2');
  b = wireChain(b, 'rr', 'pack2');
  return b;
}

export const MACHINES: readonly Build[] = [nipper(), scout(), tipper(), bulwark()];
