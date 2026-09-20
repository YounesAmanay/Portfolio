/**
 * The Workshop — a 3D lattice editor.
 *
 * Interaction is the voxel-editor idiom because it is the one people already
 * know: point at a face, click to add the selected component against it,
 * right-click to remove. The camera orbits freely the whole time, because
 * judging a machine means walking round it.
 *
 * The readouts are the real subject though. Centre of mass is drawn as a
 * marker over its support polygon, so "this will tip" is something you see
 * rather than something you read.
 */

import * as THREE from 'three';
import { analyse, type Analysis } from '../kinetic/assembly/analysis';
import {
  addPlacement,
  canPlace,
  emptyDesign,
  newUid,
  occupiedCells,
  partOf,
  placementHalfExtents,
  removePlacement,
  rotatedFootprint,
  type Cell,
  type Design,
  type Placement,
  type Yaw,
} from '../kinetic/assembly/design';
import { CELL } from '../kinetic/core/units';
import { getPart, PART_LIBRARY } from '../kinetic/parts/library';
import type { PartDef } from '../kinetic/parts/types';
import { OrbitCamera } from '../render/orbit-camera';
import { buildPlacementObject } from '../render/robot-view';
import type { Stage } from '../render/stage';

const BUILD_EXTENT = 24;   // lattice cells across the build platform

export interface WorkshopEvents {
  onChange(design: Design, analysis: Analysis): void;
}

export class Workshop {
  design: Design;
  selectedPartId: string;
  yaw: Yaw = 0;

  readonly root = new THREE.Group();
  readonly #placed = new THREE.Group();
  readonly #overlay = new THREE.Group();
  /** The platform surface — the only thing besides a placed part you can build on. */
  #deck: THREE.Mesh | null = null;
  #ghost: THREE.Object3D | null = null;
  #hoverCell: Cell | null = null;

  readonly #raycaster = new THREE.Raycaster();
  readonly #pointer = new THREE.Vector2();
  #pointerInside = false;

  constructor(
    private readonly stage: Stage,
    private readonly camera: OrbitCamera,
    private readonly events: WorkshopEvents,
    design?: Design,
  ) {
    this.design = design ?? emptyDesign('NEW MACHINE');
    this.selectedPartId = PART_LIBRARY[0]?.id ?? 'str.plate';

    this.root.add(this.#placed, this.#overlay);
    this.#buildPlatform();
    this.rebuild();
    this.#bindPointer();
  }

  // ── platform ─────────────────────────────────────────────────────────────

  #buildPlatform(): void {
    const size = BUILD_EXTENT * CELL;

    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(size, 0.04, size),
      new THREE.MeshStandardMaterial({ color: '#0c1119', metalness: 0.6, roughness: 0.75 }),
    );
    deck.position.set(size / 2, -0.02, size / 2);
    deck.receiveShadow = true;
    this.root.add(deck);
    this.#deck = deck;

    // Lattice lines, so cell boundaries are visible without a heavy grid mesh.
    const grid = new THREE.GridHelper(size, BUILD_EXTENT, '#1d3a4d', '#12202c');
    grid.position.set(size / 2, 0.002, size / 2);
    this.root.add(grid);

    // A thin outline marks the buildable area. An earlier version used a large
    // ring, which from a close camera read as a stray arc across the scene.
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(size, 0.001, size)),
      new THREE.LineBasicMaterial({ color: '#4de2ff', transparent: true, opacity: 0.22 }),
    );
    edge.position.set(size / 2, 0.004, size / 2);
    this.root.add(edge);
  }

  // ── design mutation ──────────────────────────────────────────────────────

  setDesign(design: Design): void {
    this.design = design;
    this.rebuild();
  }

  selectPart(id: string): void {
    this.selectedPartId = id;
    this.#refreshGhost();
  }

  rotate(): void {
    this.yaw = ((this.yaw + 1) % 4) as Yaw;
    this.#refreshGhost();
  }

  clear(): void {
    this.design = emptyDesign(this.design.name);
    this.rebuild();
  }

  rebuild(): void {
    this.#placed.clear();
    for (const placement of this.design.placements) {
      this.#placed.add(buildPlacementObject(placement));
    }
    this.#drawAnalysis();
    this.events.onChange(this.design, analyse(this.design));
  }

  // ── analysis overlay ─────────────────────────────────────────────────────

  /**
   * Draws what the numbers mean: a marker at the centre of mass, a dropped
   * line to the floor, and the support polygon it has to stay inside. Red when
   * the projection falls outside, because at that point the machine is already
   * on its way over.
   */
  #drawAnalysis(): void {
    this.#overlay.clear();
    const analysis = analyse(this.design);
    if (this.design.placements.length === 0) return;

    const { centreOfMass: com, supportPolygon, stabilityMargin } = analysis;
    const stable = stabilityMargin > 0;
    const colour = stable ? '#4dffb0' : '#ff5c6a';

    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 16, 12),
      new THREE.MeshBasicMaterial({ color: colour, toneMapped: false }),
    );
    marker.position.set(com.x, com.y, com.z);
    this.#overlay.add(marker);

    const plumb = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(com.x, com.y, com.z),
        new THREE.Vector3(com.x, 0.004, com.z),
      ]),
      new THREE.LineDashedMaterial({ color: colour, dashSize: 0.02, gapSize: 0.015, toneMapped: false }),
    );
    plumb.computeLineDistances();
    this.#overlay.add(plumb);

    if (supportPolygon.length >= 3) {
      const points = supportPolygon.map((p) => new THREE.Vector3(p.x, 0.006, p.z));
      points.push(points[0]!.clone());
      this.#overlay.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.85, toneMapped: false }),
        ),
      );
    }
  }

  // ── placement ────────────────────────────────────────────────────────────

  #refreshGhost(): void {
    this.#ghost?.removeFromParent();
    this.#ghost = null;
    if (!this.#hoverCell) return;

    const part = getPart(this.selectedPartId);
    if (!part) return;

    const placement: Placement = {
      uid: 'ghost',
      partId: part.id,
      cell: this.#hoverCell,
      yaw: this.yaw,
    };
    const legal = canPlace(this.design, placement);
    const object = buildPlacementObject(placement, true);
    object.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
        child.material = child.material.clone();
        child.material.color.set(legal ? '#4de2ff' : '#ff5c6a');
        child.material.emissive.set(legal ? '#4de2ff' : '#ff5c6a');
      }
    });
    this.#ghost = object;
    this.#overlay.add(object);
  }

  /**
   * Where should the selected part go, given this pointer position?
   *
   * Hits on an existing part stack the new one against the face that was hit;
   * hits on the deck place at floor level. The result is clamped so nothing
   * can be built below the platform.
   */
  #resolveTargetCell(): Cell | null {
    this.#raycaster.setFromCamera(this.#pointer, this.stage.camera);

    // Only real build surfaces are raycast. Pointing the ray at `root` also
    // swept the lattice grid and the platform outline, which is what broke
    // placement entirely — see firstBuildableHit.
    const targets: THREE.Object3D[] = [this.#placed];
    if (this.#deck) targets.push(this.#deck);

    const hits = this.#raycaster.intersectObjects(targets, true);
    const hit = firstBuildableHit(hits, (object) => this.#overlay.getObjectById(object.id) !== undefined);
    if (!hit?.face) return null;

    const part = getPart(this.selectedPartId);
    if (!part) return null;

    // Step out along the hit normal so the new part lands beside, not inside.
    const normal = hit.face.normal.clone().applyQuaternion(
      hit.object.getWorldQuaternion(new THREE.Quaternion()),
    );
    const point = hit.point.clone().addScaledVector(normal, CELL * 0.5);

    const size = rotatedFootprint(part.footprint, this.yaw);
    const cell: Cell = {
      x: Math.floor(point.x / CELL),
      y: Math.max(0, Math.floor(point.y / CELL)),
      z: Math.floor(point.z / CELL),
    };

    // Keep the whole footprint on the platform.
    return {
      x: Math.min(Math.max(0, cell.x), BUILD_EXTENT - size.x),
      y: cell.y,
      z: Math.min(Math.max(0, cell.z), BUILD_EXTENT - size.z),
    };
  }

  #placeAtPointer(): void {
    const cell = this.#resolveTargetCell();
    const part = getPart(this.selectedPartId);
    if (!cell || !part) return;

    const placement: Placement = { uid: newUid(), partId: part.id, cell, yaw: this.yaw };
    if (!canPlace(this.design, placement)) return;

    this.design = addPlacement(this.design, placement);
    this.rebuild();
    this.#refreshGhost();
  }

  #removeAtPointer(): void {
    this.#raycaster.setFromCamera(this.#pointer, this.stage.camera);
    const hits = this.#raycaster.intersectObjects([this.#placed], true);
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node && !node.userData.uid) node = node.parent;
      if (node?.userData.uid) {
        this.design = removePlacement(this.design, node.userData.uid as string);
        this.rebuild();
        this.#refreshGhost();
        return;
      }
    }
  }

  // ── input ────────────────────────────────────────────────────────────────

  #bindPointer(): void {
    const canvas = this.stage.renderer.domElement;
    let downAt = 0;
    let downPos = new THREE.Vector2();

    const updatePointer = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      this.#pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      this.#pointerInside = true;
    };

    canvas.addEventListener('pointermove', (event) => {
      updatePointer(event);
      const cell = this.#resolveTargetCell();
      const changed =
        cell?.x !== this.#hoverCell?.x ||
        cell?.y !== this.#hoverCell?.y ||
        cell?.z !== this.#hoverCell?.z;
      this.#hoverCell = cell;
      if (changed) this.#refreshGhost();
    });

    canvas.addEventListener('pointerleave', () => {
      this.#pointerInside = false;
      this.#hoverCell = null;
      this.#refreshGhost();
    });

    // Right-click removes a part, so the browser's own menu must not open.
    // Touch gets the same gesture as a long press, which would otherwise raise
    // the selection callout instead.
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());

    canvas.addEventListener('pointerdown', (event) => {
      downAt = performance.now();
      downPos.set(event.clientX, event.clientY);
    });

    canvas.addEventListener('pointerup', (event) => {
      // Distinguish a click from a camera drag: orbiting must not place parts.
      const moved = downPos.distanceTo(new THREE.Vector2(event.clientX, event.clientY));
      const held = performance.now() - downAt;
      if (moved > 6) return;
      updatePointer(event);

      if (event.button === 2 || event.ctrlKey || held > 500) this.#removeAtPointer();
      else this.#placeAtPointer();
    });
  }

  update(): void {
    if (!this.#pointerInside && this.#ghost) {
      this.#ghost.removeFromParent();
      this.#ghost = null;
    }
  }

  /** Centres the camera on whatever has been built so far. */
  frameCamera(): void {
    const analysis = analyse(this.design);
    if (this.design.placements.length === 0) {
      const centre = (BUILD_EXTENT * CELL) / 2;
      this.camera.frame(new THREE.Vector3(centre, 0.2, centre), 1.1);
      return;
    }
    let radius = 0.3;
    for (const placement of this.design.placements) {
      for (const cell of occupiedCells(placement)) {
        radius = Math.max(
          radius,
          new THREE.Vector3(
            cell.x * CELL - analysis.centreOfMass.x,
            cell.y * CELL - analysis.centreOfMass.y,
            cell.z * CELL - analysis.centreOfMass.z,
          ).length(),
        );
      }
    }
    this.camera.frame(
      new THREE.Vector3(analysis.centreOfMass.x, analysis.centreOfMass.y, analysis.centreOfMass.z),
      radius + 0.25,
    );
  }

  partOfSelection(): PartDef | undefined {
    return getPart(this.selectedPartId);
  }

  dispose(): void {
    this.root.clear();
  }
}

/** Half-extent helper re-exported for the HUD's part previews. */
export { placementHalfExtents, partOf };

/**
 * The nearest hit that can actually be built against.
 *
 * Helper geometry — the lattice grid, the platform outline — is made of lines,
 * and Three raycasts a line against a one-metre threshold. The build platform
 * is only about 1.3 m across, so very nearly every ray passed within a metre
 * of some grid line and reported that line as the nearest hit. A line carries
 * no face, so taking the nearest hit unconditionally resolved to null and
 * *no part could ever be placed*, at any pointer position, on any device.
 *
 * Faces only, never the overlay. Kept separate from the class so it can be
 * tested without a WebGL context.
 */
export function firstBuildableHit(
  hits: readonly THREE.Intersection[],
  isOverlay: (object: THREE.Object3D) => boolean,
): THREE.Intersection | null {
  return hits.find((hit) => hit.face != null && hit.object.visible && !isOverlay(hit.object)) ?? null;
}
