/**
 * The placement raycast.
 *
 * This covers a bug that made the workshop completely unusable while every
 * other test stayed green: the lattice grid and the platform outline are
 * LineSegments, Three raycasts lines against a one-metre threshold, and the
 * build platform is only ~1.3 m across. Nearly every ray therefore reported a
 * grid line as its nearest hit; lines have no face, the resolver bailed on the
 * first faceless hit, and no part could be placed at any pointer position.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { firstBuildableHit } from '../../src/ui3/bench';

/** Minimal stand-in for a Three intersection; only the read fields matter. */
function hit(object: THREE.Object3D, distance: number, withFace: boolean): THREE.Intersection {
  return {
    distance,
    object,
    point: new THREE.Vector3(),
    ...(withFace ? { face: new THREE.Triangle() as unknown as THREE.Face } : {}),
  } as THREE.Intersection;
}

function mesh(): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
}

function line(): THREE.LineSegments {
  return new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
}

const never = (): boolean => false;

describe('firstBuildableHit', () => {
  it('skips a nearer line hit and finds the face behind it', () => {
    const grid = line();
    const plate = mesh();
    const found = firstBuildableHit([hit(grid, 0.4, false), hit(plate, 1.2, true)], never);
    expect(found?.object).toBe(plate);
  });

  it('skips several line hits in a row', () => {
    const plate = mesh();
    const hits = [hit(line(), 0.1, false), hit(line(), 0.2, false), hit(line(), 0.3, false), hit(plate, 0.9, true)];
    expect(firstBuildableHit(hits, never)?.object).toBe(plate);
  });

  it('takes the nearest face when several are hit', () => {
    const near = mesh();
    const far = mesh();
    expect(firstBuildableHit([hit(near, 0.5, true), hit(far, 2.0, true)], never)?.object).toBe(near);
  });

  it('ignores overlay geometry such as the ghost and the support polygon', () => {
    const ghost = mesh();
    const plate = mesh();
    const found = firstBuildableHit([hit(ghost, 0.3, true), hit(plate, 1.1, true)], (o) => o === ghost);
    expect(found?.object).toBe(plate);
  });

  it('ignores hidden objects', () => {
    const hidden = mesh();
    hidden.visible = false;
    const plate = mesh();
    expect(firstBuildableHit([hit(hidden, 0.2, true), hit(plate, 1.0, true)], never)?.object).toBe(plate);
  });

  it('returns null when nothing buildable was hit', () => {
    expect(firstBuildableHit([hit(line(), 0.4, false)], never)).toBeNull();
    expect(firstBuildableHit([], never)).toBeNull();
  });
});
