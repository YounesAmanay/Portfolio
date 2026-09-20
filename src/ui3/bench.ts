/**
 * The Bench — assembling a machine from components.
 *
 * Two things happen here, and they are deliberately different gestures,
 * because they are different kinds of decision.
 *
 * **Placing** is spatial. Point at a face, drop the selected component against
 * it. A motor has to physically line up with the gearbox it drives, and
 * working out where everything fits is the puzzle that makes a chassis a
 * chassis.
 *
 * **Linking** is topological. Pick one component, pick another, and the loom
 * is assumed. You do not route wires by hand, least of all on a phone — and
 * the schematic beside the model is where that half of the machine is read.
 *
 * The overlay is the real subject. Centre of mass over its support polygon,
 * driven contacts marked, unlinked components dimmed — so "this will tip" and
 * "that motor is wired to nothing" are things you see rather than read.
 */

import * as THREE from 'three';
import { analyseBuild, type MachineAnalysis } from '../kinetic/machine/analysis';
import {
  addFitted,
  addLink,
  canFit,
  componentOf,
  emptyBuild,
  fittedCentre,
  linksOn,
  newUid,
  occupiedCells,
  removeFitted,
  removeLink,
  suggestLink,
  type Build,
  type Fitted,
  type Link,
} from '../kinetic/machine/build';
import { findComponent } from '../kinetic/machine/catalogue';
import { rotatedFootprint, type Cell, type Yaw } from '../kinetic/assembly/lattice';
import { CELL } from '../kinetic/core/units';
import { planFromBuild } from '../kinetic/physics/plan';
import { OrbitCamera } from '../render/orbit-camera';
import { buildPlannedObject } from '../render/robot-view';
import type { Stage } from '../render/stage';

const BUILD_EXTENT = 32;

export type BenchTool = 'PLACE' | 'LINK';

export interface BenchEvents {
  onChange(build: Build, analysis: MachineAnalysis): void;
  /** Something was clicked, or nothing was. */
  onSelect(uid: string | null): void;
  /** A link attempt that could not be made, in the words of the mistake. */
  onRefused(reason: string): void;
}

export class Bench {
  build: Build;
  selectedComponentId: string;
  yaw: Yaw = 0;
  tool: BenchTool = 'PLACE';
  /** The first end of a link, once one has been picked. */
  linkFrom: string | null = null;
  selected: string | null = null;

  readonly root = new THREE.Group();
  readonly #placed = new THREE.Group();
  readonly #overlay = new THREE.Group();
  #deck: THREE.Mesh | null = null;
  #ghost: THREE.Object3D | null = null;
  #hoverCell: Cell | null = null;

  readonly #raycaster = new THREE.Raycaster();
  readonly #pointer = new THREE.Vector2();
  #pointerInside = false;

  constructor(
    private readonly stage: Stage,
    private readonly camera: OrbitCamera,
    private readonly events: BenchEvents,
    build?: Build,
  ) {
    this.build = build ?? emptyBuild('NEW MACHINE');
    this.selectedComponentId = 'str.plate';

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
      new THREE.MeshStandardMaterial({ color: '#0a0f16', metalness: 0.7, roughness: 0.6 }),
    );
    deck.position.set(size / 2, -0.02, size / 2);
    deck.receiveShadow = true;
    this.root.add(deck);
    this.#deck = deck;

    const grid = new THREE.GridHelper(size, BUILD_EXTENT, '#1d3a4d', '#101a24');
    grid.position.set(size / 2, 0.002, size / 2);
    this.root.add(grid);
  }

  // ── mutation ─────────────────────────────────────────────────────────────

  setBuild(build: Build): void {
    this.build = build;
    this.selected = null;
    this.linkFrom = null;
    this.rebuild();
  }

  selectComponent(id: string): void {
    this.selectedComponentId = id;
    this.tool = 'PLACE';
    this.#refreshGhost();
  }

  setTool(tool: BenchTool): void {
    this.tool = tool;
    this.linkFrom = null;
    if (tool === 'LINK') {
      this.#ghost?.removeFromParent();
      this.#ghost = null;
    }
    this.rebuild();
  }

  rotate(): void {
    this.yaw = ((this.yaw + 1) % 4) as Yaw;
    this.#refreshGhost();
  }

  clear(): void {
    this.build = emptyBuild(this.build.name, this.build.weightClass);
    this.selected = null;
    this.linkFrom = null;
    this.rebuild();
  }

  setWeightClass(id: string): void {
    this.build = { ...this.build, weightClass: id };
    this.rebuild();
  }

  /** Removes whatever is selected, and every link that referenced it. */
  removeSelected(): void {
    if (!this.selected) return;
    this.build = removeFitted(this.build, this.selected);
    this.selected = null;
    this.rebuild();
    this.events.onSelect(null);
  }

  /** Drops every link on the selected component without moving it. */
  unlinkSelected(): void {
    if (!this.selected) return;
    const uid = this.selected;
    this.build = { ...this.build, links: this.build.links.filter((l) => l.from !== uid && l.to !== uid) };
    this.rebuild();
  }

  removeLink(link: Link): void {
    this.build = removeLink(this.build, link);
    this.rebuild();
  }

  select(uid: string | null): void {
    this.selected = uid;
    this.rebuild();
    this.events.onSelect(uid);
  }

  rebuild(): void {
    this.#placed.clear();
    // Rendered through the plan, so the bench draws a machine exactly as the
    // arena will — including which wheels the solver decided are driven.
    const plan = planFromBuild(this.build);
    for (const part of plan.parts) {
      const object = buildPlannedObject(part);
      object.position.add(new THREE.Vector3(plan.centreOfMass.x, plan.centreOfMass.y, plan.centreOfMass.z));
      this.#placed.add(object);
    }
    this.#drawOverlay();
    this.events.onChange(this.build, analyseBuild(this.build));
  }

  // ── overlay ──────────────────────────────────────────────────────────────

  /**
   * What the numbers mean, drawn on the machine.
   *
   * The centre of mass and its support polygon answer "will it tip" without
   * reading a figure. The rings under driven wheels answer "is this actually
   * connected", which under the old model could not be wrong and now can.
   */
  #drawOverlay(): void {
    this.#overlay.clear();
    if (this.build.fitted.length === 0) return;

    const report = analyseBuild(this.build);
    const { centreOfMass: com, supportPolygon, stabilityMargin } = report;
    const stable = stabilityMargin > 0;
    const colour = stable ? '#4dffb0' : '#ff5c6a';

    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 16, 12),
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

    // A ring under each contact: solid where the solver found a chain to it,
    // hollow where the wheel is just along for the ride.
    for (const contact of report.contacts) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(contact.radius * 0.5, contact.radius * (contact.driven ? 0.95 : 0.62), 24),
        new THREE.MeshBasicMaterial({
          color: contact.driven ? '#4de2ff' : '#5d646d',
          transparent: true,
          opacity: contact.driven ? 0.7 : 0.4,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(contact.position.x, 0.008, contact.position.z);
      this.#overlay.add(ring);
    }

    if (this.selected) this.#outline(this.selected, '#4de2ff');
    if (this.linkFrom && this.linkFrom !== this.selected) this.#outline(this.linkFrom, '#ffb648');
    this.#drawLinks();
  }

  /** A wire frame around one component, so a schematic click shows up here. */
  #outline(uid: string, colour: string): void {
    const fitted = this.build.fitted.find((f) => f.uid === uid);
    if (!fitted) return;
    const size = rotatedFootprint(componentOf(fitted).footprint, fitted.yaw);
    const centre = fittedCentre(fitted);
    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(
        new THREE.BoxGeometry(size.x * CELL * 1.08, size.y * CELL * 1.08, size.z * CELL * 1.08),
      ),
      new THREE.LineBasicMaterial({ color: colour, toneMapped: false }),
    );
    box.position.set(centre.x, centre.y, centre.z);
    this.#overlay.add(box);
  }

  /**
   * The loom, drawn in place.
   *
   * Only while linking. Shown permanently it turns a chassis into a bowl of
   * spaghetti, and the schematic reads it far better — but while you are
   * making a connection you want to see it land on the actual component.
   */
  #drawLinks(): void {
    if (this.tool !== 'LINK') return;

    for (const link of this.build.links) {
      const from = this.build.fitted.find((f) => f.uid === link.from);
      const to = this.build.fitted.find((f) => f.uid === link.to);
      if (!from || !to) continue;
      const a = fittedCentre(from);
      const b = fittedCentre(to);
      const port = componentOf(from).ports.find((p) => p.id === link.fromPort);
      const colour =
        port?.kind === 'power' ? '#ffb648'
        : port?.kind === 'signal' ? '#37d6a0'
        : port?.kind === 'gas' ? '#4de2ff'
        : port?.kind === 'fuel' ? '#ff8c42'
        : '#9aa6b5';

      // Lifted into an arc so a wire between two components that touch is
      // still visible rather than buried inside them.
      const lift = Math.max(0.03, a.y * 0.15 + 0.02);
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(a.x, a.y, a.z),
        new THREE.Vector3((a.x + b.x) / 2, Math.max(a.y, b.y) + lift, (a.z + b.z) / 2),
        new THREE.Vector3(b.x, b.y, b.z),
      );
      this.#overlay.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(curve.getPoints(18)),
          new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.9, toneMapped: false }),
        ),
      );
    }
  }

  // ── placement ────────────────────────────────────────────────────────────

  #refreshGhost(): void {
    this.#ghost?.removeFromParent();
    this.#ghost = null;
    if (!this.#hoverCell || this.tool !== 'PLACE') return;

    const component = findComponent(this.selectedComponentId);
    if (!component) return;

    const fitted: Fitted = {
      uid: 'ghost',
      componentId: component.id,
      cell: this.#hoverCell,
      yaw: this.yaw,
    };
    const legal = canFit(this.build, fitted);
    const plan = planFromBuild({ ...emptyBuild(), fitted: [fitted], links: [] });
    const part = plan.parts[0];
    if (!part) return;

    const object = buildPlannedObject(part, true);
    object.position.set(part.centre.x, part.centre.y, part.centre.z);
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

  #resolveTargetCell(): Cell | null {
    this.#raycaster.setFromCamera(this.#pointer, this.stage.camera);

    const targets: THREE.Object3D[] = [this.#placed];
    if (this.#deck) targets.push(this.#deck);

    const hits = this.#raycaster.intersectObjects(targets, true);
    const hit = firstBuildableHit(hits, (object) => this.#overlay.getObjectById(object.id) !== undefined);
    if (!hit?.face) return null;

    const component = findComponent(this.selectedComponentId);
    if (!component) return null;

    const normal = hit.face.normal
      .clone()
      .applyQuaternion(hit.object.getWorldQuaternion(new THREE.Quaternion()));
    const point = hit.point.clone().addScaledVector(normal, CELL * 0.5);

    const size = rotatedFootprint(component.footprint, this.yaw);
    return {
      x: Math.min(Math.max(0, Math.floor(point.x / CELL)), BUILD_EXTENT - size.x),
      y: Math.max(0, Math.floor(point.y / CELL)),
      z: Math.min(Math.max(0, Math.floor(point.z / CELL)), BUILD_EXTENT - size.z),
    };
  }

  /** Whatever component is under the pointer, if any. */
  #uidAtPointer(): string | null {
    this.#raycaster.setFromCamera(this.#pointer, this.stage.camera);
    const hits = this.#raycaster.intersectObjects([this.#placed], true);
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node && node.userData.uid === undefined) node = node.parent;
      if (node?.userData.uid !== undefined) return node.userData.uid as string;
    }
    return null;
  }

  #placeAtPointer(): void {
    const cell = this.#resolveTargetCell();
    const component = findComponent(this.selectedComponentId);
    if (!cell || !component) return;

    const fitted: Fitted = { uid: newUid(), componentId: component.id, cell, yaw: this.yaw };
    if (!canFit(this.build, fitted)) return;

    this.build = addFitted(this.build, fitted);

    // Offer the obvious connection rather than making it. A motor dropped onto
    // a gearbox almost always means shaft to shaft, and asking for that in a
    // second gesture is ceremony; but a link the player did not ask for is a
    // machine that wires itself, which is the opposite of the point. So it is
    // made, and the schematic shows it immediately.
    for (const other of this.build.fitted) {
      if (other.uid === fitted.uid) continue;
      const forward = suggestLink(this.build, other.uid, fitted.uid);
      if (forward && isShaft(this.build, forward)) {
        this.build = addLink(this.build, forward);
        break;
      }
    }

    this.rebuild();
    this.#refreshGhost();
  }

  /** Two clicks make a link: pick a source, pick a sink. */
  #linkAtPointer(): void {
    const uid = this.#uidAtPointer();
    if (!uid) {
      this.linkFrom = null;
      this.rebuild();
      return;
    }

    if (!this.linkFrom) {
      this.linkFrom = uid;
      this.select(uid);
      return;
    }
    if (this.linkFrom === uid) {
      this.linkFrom = null;
      this.rebuild();
      return;
    }

    // Try it both ways round before refusing: a player dragging a motor onto a
    // controller means the same thing as the other way about, and being told
    // "that goes the wrong way" for an obvious connection is just pedantry.
    const forward = suggestLink(this.build, this.linkFrom, uid);
    const backward = forward ?? suggestLink(this.build, uid, this.linkFrom);
    if (backward) {
      this.build = addLink(this.build, backward);
      this.linkFrom = null;
      this.rebuild();
      return;
    }

    this.events.onRefused(refusal(this.build, this.linkFrom, uid));
    this.linkFrom = null;
    this.rebuild();
  }

  #removeAtPointer(): void {
    const uid = this.#uidAtPointer();
    if (!uid) return;
    this.build = removeFitted(this.build, uid);
    if (this.selected === uid) this.selected = null;
    if (this.linkFrom === uid) this.linkFrom = null;
    this.rebuild();
    this.#refreshGhost();
  }

  // ── input ────────────────────────────────────────────────────────────────

  #bindPointer(): void {
    const canvas = this.stage.renderer.domElement;
    let downAt = 0;
    const downPos = new THREE.Vector2();

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
      if (this.tool !== 'PLACE') return;
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

    canvas.addEventListener('contextmenu', (event) => event.preventDefault());

    canvas.addEventListener('pointerdown', (event) => {
      downAt = performance.now();
      downPos.set(event.clientX, event.clientY);
    });

    canvas.addEventListener('pointerup', (event) => {
      // A drag is the camera orbiting, never a placement.
      const moved = downPos.distanceTo(new THREE.Vector2(event.clientX, event.clientY));
      const held = performance.now() - downAt;
      if (moved > 6) return;
      updatePointer(event);

      const removing = event.button === 2 || event.ctrlKey || held > 500;
      if (this.tool === 'LINK') {
        if (removing) this.#removeAtPointer();
        else this.#linkAtPointer();
        return;
      }
      if (removing) this.#removeAtPointer();
      else this.#placeAtPointer();
    });
  }

  update(): void {
    if (!this.#pointerInside && this.#ghost) {
      this.#ghost.removeFromParent();
      this.#ghost = null;
    }
  }

  /** Links touching one component, for the inspector. */
  linksFor(uid: string): Link[] {
    const component = this.build.fitted.find((f) => f.uid === uid);
    if (!component) return [];
    return componentOf(component).ports.flatMap((port) => linksOn(this.build, uid, port.id));
  }

  frameCamera(): void {
    if (this.build.fitted.length === 0) {
      const centre = (BUILD_EXTENT * CELL) / 2;
      this.camera.frame(new THREE.Vector3(centre, 0.2, centre), 1.1);
      return;
    }
    const report = analyseBuild(this.build);
    const com = report.centreOfMass;
    let radius = 0.3;
    for (const fitted of this.build.fitted) {
      for (const cell of occupiedCells(fitted)) {
        radius = Math.max(
          radius,
          new THREE.Vector3(cell.x * CELL - com.x, cell.y * CELL - com.y, cell.z * CELL - com.z).length(),
        );
      }
    }
    this.camera.frame(new THREE.Vector3(com.x, com.y, com.z), radius + 0.25);
  }

  dispose(): void {
    this.root.clear();
  }
}

function isShaft(build: Build, link: Link): boolean {
  const from = build.fitted.find((f) => f.uid === link.from);
  if (!from) return false;
  return componentOf(from).ports.find((p) => p.id === link.fromPort)?.kind === 'shaft';
}

/**
 * Why these two will not join, in the words the mistake was made in.
 *
 * `suggestLink` returning nothing means no pair of ports worked, and the
 * player deserves better than silence. The most useful answer is whichever
 * refusal the most plausible pairing gave.
 */
function refusal(build: Build, fromUid: string, toUid: string): string {
  const from = build.fitted.find((f) => f.uid === fromUid);
  const to = build.fitted.find((f) => f.uid === toUid);
  if (!from || !to) return 'One of those is no longer on the machine.';

  const a = componentOf(from);
  const bKinds = new Set(componentOf(to).ports.map((p) => p.kind));
  const shared = a.ports.some((p) => bKinds.has(p.kind));
  if (!shared) {
    return `${a.name} and ${componentOf(to).name} have nothing in common to join.`;
  }
  return `${a.name} cannot drive ${componentOf(to).name} — check what is already connected, and that shafts line up.`;
}

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
