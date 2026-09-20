/**
 * The dark edge that makes a machine read as a toy.
 *
 * It is the single strongest tell of this style, and it earns its place by
 * doing real work. A machine here is a dozen components bolted face to face:
 * a motor against a gearbox against a wheel, all at similar values. Without an
 * edge between them they merge into one lump and the assembly — the thing the
 * whole game is about — becomes unreadable.
 *
 * Drawn as an inverted hull: the same geometry, pushed out along its normals,
 * with front faces culled so only the shell behind the part survives. One
 * extra draw call per mesh and no post-processing pass, which matters because
 * the arena already spends its post budget on bloom.
 *
 * The alternative, a selective outline pass, costs a full-screen render per
 * frame and cannot draw an edge *between* two touching parts at all — it
 * outlines the silhouette of the whole machine, which is exactly the shape
 * that was already readable.
 */

import * as THREE from 'three';
import { OUTLINE_COLOUR, OUTLINE_WIDTH } from './palette';

let shell: THREE.Material | null = null;

function shellMaterial(): THREE.Material {
  shell ??= new THREE.MeshBasicMaterial({
    color: new THREE.Color(OUTLINE_COLOUR),
    side: THREE.BackSide,
    toneMapped: false,
  });
  return shell;
}

/**
 * Adds an outline shell to every mesh under an object.
 *
 * The shell is a child of the mesh it outlines, so it inherits every transform
 * the part gets for free — a spinning weapon's outline spins with it without
 * anything tracking it per frame.
 *
 * Scale rather than a vertex shader push: geometry here is built from
 * primitives whose normals are already correct, and a uniform scale about the
 * mesh's own origin gives an even edge on the boxes, cylinders and capsules
 * that make up nearly everything. It goes wrong on a very elongated part,
 * where the edge is thicker along the long axis — hence the per-axis scale
 * below, which divides the fixed width by each dimension of the part's own
 * bounds.
 */
export function addOutlines(root: THREE.Object3D, width = OUTLINE_WIDTH): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((child) => {
    if (child instanceof THREE.Mesh && child.userData.isOutline !== true) meshes.push(child);
  });

  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) continue;

    const size = box.getSize(new THREE.Vector3());
    // A constant shell thickness whatever the part's proportions. Scaling by a
    // flat 1.02 instead gives a 200 mm wheel a fat edge and a 10 mm pin none.
    const scale = new THREE.Vector3(
      size.x > 1e-5 ? 1 + (width * 2) / size.x : 1,
      size.y > 1e-5 ? 1 + (width * 2) / size.y : 1,
      size.z > 1e-5 ? 1 + (width * 2) / size.z : 1,
    );

    const outline = new THREE.Mesh(geometry, shellMaterial());
    outline.scale.copy(scale);
    // Centred on the geometry's own bounds, not its origin, or a part modelled
    // off-centre gets an edge that sits to one side of it.
    const centre = box.getCenter(new THREE.Vector3());
    outline.position.set(
      centre.x * (1 - scale.x),
      centre.y * (1 - scale.y),
      centre.z * (1 - scale.z),
    );
    outline.userData.isOutline = true;
    outline.castShadow = false;
    outline.receiveShadow = false;
    // Behind everything, so a shell never covers the part it belongs to.
    outline.renderOrder = -1;
    mesh.add(outline);
  }
}
