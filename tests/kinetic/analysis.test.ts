import { describe, expect, it } from 'vitest';
import { analyse, convexHullXZ, distanceToHullEdge } from '@kinetic/assembly/analysis';
import { addPlacement, emptyDesign, newUid, type Design, type Yaw } from '@kinetic/assembly/design';
import { CELL } from '@kinetic/core/units';

function place(design: Design, partId: string, x: number, y: number, z: number, yaw: Yaw = 0): Design {
  return addPlacement(design, { uid: newUid(), partId, cell: { x, y, z }, yaw });
}

/**
 * A symmetric four-wheel rover: plate on top, four pods at the corners.
 *
 * The stance is 3 cells, not 4, because a 3x3 deck plate physically reaches
 * that far and no further. At 4 the pods shared no face with the deck, and the
 * fixture was quietly describing a machine whose wheels were bolted to nothing.
 */
function rover(): Design {
  let d = emptyDesign('ROVER');
  d = place(d, 'drive.balanced', 0, 0, 0);
  d = place(d, 'drive.balanced', 3, 0, 0);
  d = place(d, 'drive.balanced', 0, 0, 3);
  d = place(d, 'drive.balanced', 3, 0, 3);
  d = place(d, 'str.plate', 1, 2, 1);
  d = place(d, 'bat.lipo6s', 1, 3, 1);
  d = place(d, 'ctl.basic', 1, 4, 1);
  return d;
}

describe('centre of mass', () => {
  it('is centred on a symmetric design', () => {
    let d = emptyDesign('SYM');
    d = place(d, 'drive.balanced', 0, 0, 0);
    d = place(d, 'drive.balanced', 3, 0, 0);
    d = place(d, 'drive.balanced', 0, 0, 3);
    d = place(d, 'drive.balanced', 3, 0, 3);
    const a = analyse(d);
    expect(a.centreOfMass.x).toBeCloseTo(2.5 * CELL, 6);
    expect(a.centreOfMass.z).toBeCloseTo(2.5 * CELL, 6);
  });

  it('shifts toward added mass', () => {
    const base = analyse(rover());
    const heavy = analyse(place(rover(), 'util.ballast', 0, 3, 0));
    expect(heavy.centreOfMass.x).toBeLessThan(base.centreOfMass.x);
    expect(heavy.mass).toBeCloseTo(base.mass + 0.5, 6);
  });

  it('rises when mass is stacked high, and that costs stability', () => {
    const low = analyse(rover());
    const tall = analyse(place(place(rover(), 'str.tower', 2, 3, 2), 'util.ballast', 2, 6, 2));
    expect(tall.centreOfMass.y).toBeGreaterThan(low.centreOfMass.y);
    expect(tall.tipG).toBeLessThan(low.tipG);
  });
});

describe('stability', () => {
  it('reports a positive margin when the CoM is inside the wheelbase', () => {
    const a = analyse(rover());
    expect(a.supportPolygon.length).toBeGreaterThanOrEqual(3);
    expect(a.stabilityMargin).toBeGreaterThan(0);
    expect(a.tipAngle).toBeGreaterThan(0);
  });

  it('goes negative when the CoM hangs outside the wheelbase', () => {
    let d = rover();
    for (let i = 0; i < 4; i++) d = place(d, 'str.rail', 2, 3, 6 + i * 3);
    d = place(d, 'util.ballast', 2, 3, 18);
    d = place(d, 'util.ballast', 2, 3, 19);
    const a = analyse(d);
    expect(a.stabilityMargin).toBeLessThan(0);
  });

  it('widening the wheelbase raises the tip angle', () => {
    const narrow = analyse(rover());
    // Twice the stance in both axes, bridged by four deck plates so it stays
    // one assembly — a machine is only wider if the axles are actually joined.
    // Same payload, carried at the same height and centred the same way, so the
    // only thing that differs between the two is how far apart the wheels are.
    let wide = emptyDesign('WIDE');
    wide = place(wide, 'drive.balanced', 0, 0, 0);
    wide = place(wide, 'drive.balanced', 6, 0, 0);
    wide = place(wide, 'drive.balanced', 0, 0, 6);
    wide = place(wide, 'drive.balanced', 6, 0, 6);
    wide = place(wide, 'str.plate', 1, 2, 1);
    wide = place(wide, 'str.plate', 4, 2, 1);
    wide = place(wide, 'str.plate', 1, 2, 4);
    wide = place(wide, 'str.plate', 4, 2, 4);
    wide = place(wide, 'bat.lipo6s', 3, 3, 3);
    wide = place(wide, 'ctl.basic', 3, 4, 3);
    expect(analyse(wide).tipG).toBeGreaterThan(narrow.tipG);
  });
});

describe('drivetrain', () => {
  const build = (pod: string, battery = 'bat.lipo6s'): ReturnType<typeof analyse> => {
    let d = emptyDesign('X');
    for (const [x, z] of [[0, 0], [3, 0], [0, 3], [3, 3]]) d = place(d, pod, x!, 0, z!);
    d = place(d, battery, 1, 2, 1);
    d = place(d, 'ctl.basic', 1, 3, 1);
    return analyse(d);
  };

  it('trades torque against speed across the gearing range', () => {
    const sprint = build('drive.sprint');
    const crawler = build('drive.crawler');
    expect(sprint.topSpeed).toBeGreaterThan(crawler.topSpeed);
    expect(crawler.totalTorque).toBeGreaterThan(sprint.totalTorque);
    expect(crawler.maxGrade).toBeGreaterThan(sprint.maxGrade);
  });

  it('flags a design whose wheels spin before its motors strain', () => {
    expect(build('drive.crawler', 'bat.lipo3s').gripLimited).toBe(true);
  });
});

describe('power', () => {
  it('reports sag when demand exceeds pack output', () => {
    let d = emptyDesign('THIRSTY');
    for (const [x, z] of [[0, 0], [4, 0], [0, 4], [4, 4]]) d = place(d, 'drive.balanced', x!, 0, z!);
    d = place(d, 'bat.lipo3s', 1, 2, 2);
    d = place(d, 'ctl.basic', 4, 2, 2);
    const a = analyse(d);
    expect(a.powerMargin).toBeLessThan(1);
    expect(a.problems.some((p) => p.message.includes('sag'))).toBe(true);
  });
});

describe('validation', () => {
  it('demands a controller and a battery', () => {
    const d = place(emptyDesign('BARE'), 'drive.balanced', 0, 0, 0);
    const messages = analyse(d).problems.map((p) => p.message).join(' ');
    expect(messages).toMatch(/controller/i);
    expect(messages).toMatch(/battery/i);
  });

  it('accepts a complete rover', () => {
    expect(analyse(rover()).problems.filter((p) => p.severity === 'error')).toEqual([]);
  });
});

describe('geometry', () => {
  it('hulls a square and drops interior points', () => {
    const hull = convexHullXZ([
      { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 }, { x: 0, y: 0, z: 1 },
      { x: 0.5, y: 0, z: 0.5 },
    ]);
    expect(hull.length).toBe(4);
  });

  it('measures distance to the hull edge, signed', () => {
    const square = convexHullXZ([
      { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 },
      { x: 2, y: 0, z: 2 }, { x: 0, y: 0, z: 2 },
    ]);
    expect(distanceToHullEdge({ x: 1, y: 0, z: 1 }, square)).toBeCloseTo(1, 6);
    expect(distanceToHullEdge({ x: 5, y: 0, z: 1 }, square)).toBeLessThan(0);
  });
});
