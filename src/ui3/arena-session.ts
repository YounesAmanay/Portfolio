/**
 * A live arena session: world, machines, rules and camera, advanced together.
 *
 * Physics runs on a fixed 120 Hz accumulator while rendering runs as fast as
 * the device allows. That separation is what lets a phone at 30 fps and a
 * desktop at 144 fps produce the same match, and it is why the camera can
 * interpolate smoothly over a simulation that only moves in discrete steps.
 */

import * as THREE from 'three';
import { PHYSICS_DT } from '../kinetic/core/units';
import type { Design } from '../kinetic/assembly/design';
import {
  buildArena,
  newMatch,
  spawnPoints,
  stepMatch,
  type ArenaSpec,
  type MatchState,
} from '../kinetic/modes/arena';
import { DamageTracker, type DamageEvent } from '../kinetic/physics/damage';
import {
  driveRobot,
  neutralInput,
  spawnRobot,
  type ControlInput,
  type RobotHandle,
} from '../kinetic/physics/robot';
import { PhysicsWorld } from '../kinetic/physics/world';
import { RobotView } from '../render/robot-view';
import type { Stage } from '../render/stage';
import { simpleAutopilot } from './autopilot';

export interface SessionOptions {
  readonly spec: ArenaSpec;
  readonly playerDesign: Design;
  readonly opponentDesigns: readonly Design[];
}

export class ArenaSession {
  readonly physics = new PhysicsWorld();
  readonly damage = new DamageTracker();
  readonly root = new THREE.Group();
  readonly match: MatchState = newMatch();

  player!: RobotHandle;
  readonly opponents: RobotHandle[] = [];
  readonly views: RobotView[] = [];
  readonly log: DamageEvent[] = [];

  #accumulator = 0;
  #countdown = 3;

  constructor(private readonly stage: Stage, readonly options: SessionOptions) {
    buildArena(this.physics, options.spec);
    this.#buildScenery();

    const machines = [options.playerDesign, ...options.opponentDesigns];
    const points = spawnPoints(options.spec, machines.length);

    machines.forEach((design, index) => {
      const point = points[index]!;
      const robot = spawnRobot(this.physics.world, design, {
        position: { x: point.x, z: point.z },
        yaw: point.yaw,
        id: index === 0 ? 'player' : `opponent-${index}`,
        group: index,
      });
      this.damage.register(robot);
      if (index === 0) this.player = robot;
      else this.opponents.push(robot);

      const view = new RobotView(robot);
      this.views.push(view);
      this.root.add(view.root);
    });

    this.stage.scene.add(this.root);
  }

  /** Floor, walls and obstacles, matching the physics geometry exactly. */
  #buildScenery(): void {
    const spec = this.options.spec;
    const size = spec.size;

    const span = size * 1.4;
    const slick = spec.surface.friction < 0.6;

    // One texture repeat per metre, so a cell is always a metre of real floor
    // and the eye can read speed straight off it.
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(span, 0.5, span),
      new THREE.MeshStandardMaterial({
        map: floorTexture(slick),
        color: slick ? '#1b2430' : '#171e28',
        metalness: slick ? 0.85 : 0.35,
        roughness: slick ? 0.18 : 0.9,
      }),
    );
    const map = (floor.material as THREE.MeshStandardMaterial).map;
    if (map) map.repeat.set(span, span);
    floor.position.y = -0.25;
    floor.receiveShadow = true;
    this.root.add(floor);

    // Two grids at fixed world cell sizes, not a fixed division count.
    //
    // The previous grid divided the floor into one-metre cells, but the chase
    // camera sits about two metres from a machine half a metre wide, so barely
    // a metre and a half of floor is ever on screen — often with no grid line
    // in it at all. The floor read as a black void and nothing conveyed speed.
    // 25 cm cells guarantee several lines in frame at any chase distance; the
    // metre grid on top gives a coarser reference that survives motion blur.
    // The floor markings are a texture, not geometry — see floorTexture.

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: '#202935', metalness: 0.7, roughness: 0.45,
    });
    const half = size / 2;
    for (const [x, z, rot] of [[0, -half, 0], [0, half, 0], [-half, 0, Math.PI / 2], [half, 0, Math.PI / 2]] as const) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(size, 1.2, 0.8), wallMaterial);
      wall.position.set(x, 0.6, z);
      wall.rotation.y = rot;
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.root.add(wall);
    }

    // Emissive strips along the walls. They read as arena lighting and, more
    // usefully, give the eye a fixed reference for how fast you are moving.
    const stripMaterial = new THREE.MeshStandardMaterial({
      color: '#4de2ff', emissive: '#4de2ff', emissiveIntensity: 1.1, toneMapped: false,
    });
    for (const [x, z, rot] of [[0, -half, 0], [0, half, 0], [-half, 0, Math.PI / 2], [half, 0, Math.PI / 2]] as const) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(size * 0.92, 0.035, 0.05), stripMaterial);
      strip.position.set(x, 1.16, z);
      strip.rotation.y = rot;
      this.root.add(strip);
    }

    const obstacleMaterial = new THREE.MeshStandardMaterial({
      color: '#33404f', metalness: 0.55, roughness: 0.6,
    });
    for (const obstacle of spec.obstacles) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(obstacle.halfExtents.x * 2, obstacle.halfExtents.y * 2, obstacle.halfExtents.z * 2),
        obstacleMaterial,
      );
      mesh.position.set(obstacle.position.x, obstacle.position.y, obstacle.position.z);
      mesh.rotation.y = obstacle.rotationY;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }

    // Gates glow so the route reads at a glance.
    spec.checkpoints.forEach((gate, index) => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(gate.radius, 0.05, 8, 40),
        new THREE.MeshStandardMaterial({
          color: '#4de2ff', emissive: '#4de2ff', emissiveIntensity: 1.2, toneMapped: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(gate.position.x, 0.08, gate.position.z);
      ring.userData.gateIndex = index;
      this.root.add(ring);
    });
  }

  /** Advances physics, rules and views. `dt` is real seconds since last frame. */
  update(dt: number, input: ControlInput): void {
    if (this.match.status === 'COUNTDOWN') {
      this.#countdown -= dt;
      this.match.message = `${Math.ceil(Math.max(0, this.#countdown))}`;
      if (this.#countdown <= 0) {
        this.match.status = 'RUNNING';
        this.match.message = '';
      }
    }

    const command = this.match.status === 'RUNNING' ? input : neutralInput();
    this.#accumulator += Math.min(dt, 0.1);

    let steps = 0;
    while (this.#accumulator >= PHYSICS_DT && steps < 8) {
      this.#accumulator -= PHYSICS_DT;
      steps += 1;

      driveRobot(this.player, command);
      for (const opponent of this.opponents) {
        driveRobot(opponent, this.match.status === 'RUNNING'
          ? simpleAutopilot(opponent, this.player)
          : neutralInput());
      }

      this.physics.step(this.damage.queue);
      const hits = this.damage.resolve(this.physics);
      if (hits.length > 0) this.log.push(...hits);

      stepMatch(this.match, this.options.spec, this.player, this.opponents, PHYSICS_DT);
    }

    for (const view of this.views) view.sync();

    // Gates ahead of the player stay lit; ones already taken go dark.
    for (const child of this.root.children) {
      const index = child.userData.gateIndex;
      if (typeof index === 'number') child.visible = index >= this.match.checkpoint;
    }
  }

  get playerPosition(): THREE.Vector3 {
    return this.views[0]?.position ?? new THREE.Vector3();
  }

  dispose(): void {
    for (const view of this.views) view.dispose();
    this.root.removeFromParent();
    this.physics.dispose();
  }
}

/**
 * The arena floor's markings, as a repeating texture rather than a GridHelper.
 *
 * Two grid helpers drew the floor before this, correctly, and the arena still
 * read as a black void. A line is one device pixel wide no matter how close
 * the camera gets, so at the chase camera's couple of metres the cells under
 * the machine were invisible, while the distant ones piled into a smear along
 * the horizon — exactly backwards from what conveys speed. A texture gets
 * mipmaps and anisotropic filtering, so the cell beside the wheels reads as
 * clearly as the one at the far wall.
 *
 * Drawn once per arena at 512px for a one-metre cell: quarter-metre gridlines
 * inside a brighter metre boundary, plus a corner tick that gives the eye
 * something asymmetric to track when the machine spins.
 */
function floorTexture(slick: boolean): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for the arena floor');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  // Quarter-metre subdivisions, faint.
  ctx.strokeStyle = slick ? 'rgba(150,205,235,0.30)' : 'rgba(120,180,215,0.24)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 1; i < 4; i += 1) {
    const at = (size / 4) * i;
    ctx.moveTo(at, 0);
    ctx.lineTo(at, size);
    ctx.moveTo(0, at);
    ctx.lineTo(size, at);
  }
  ctx.stroke();

  // The metre boundary, and a tick at its corner for rotational reference.
  ctx.strokeStyle = 'rgba(110,215,255,0.62)';
  ctx.lineWidth = 7;
  ctx.strokeRect(0, 0, size, size);
  ctx.lineWidth = 11;
  ctx.beginPath();
  ctx.moveTo(0, size * 0.14);
  ctx.lineTo(0, 0);
  ctx.lineTo(size * 0.14, 0);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
