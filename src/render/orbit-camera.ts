/**
 * A free camera that orbits the arena.
 *
 * Written rather than imported because it needs two things OrbitControls does
 * not give cleanly: a target that can smoothly hand off between "the arena
 * centre" and "the robot that is currently moving", and a touch scheme that
 * shares the screen with driving controls.
 *
 * Everything is damped toward a goal rather than set directly, so the camera
 * has weight — which is most of why a 3D scene feels expensive or cheap.
 */

import * as THREE from 'three';

const DEG = Math.PI / 180;

export interface OrbitLimits {
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly minPolar: number;
  readonly maxPolar: number;
}

const DEFAULT_LIMITS: OrbitLimits = {
  minDistance: 1.6,
  maxDistance: 46,
  // Never quite reach the poles: straight down loses all sense of scale, and
  // straight along the floor puts the camera inside it.
  minPolar: 6 * DEG,
  maxPolar: 87 * DEG,
};

export class OrbitCamera {
  /** Where the camera looks. Follow mode eases this toward a moving object. */
  readonly target = new THREE.Vector3(0, 0.5, 0);

  #azimuth = Math.PI * 0.25;
  #polar = 58 * DEG;
  #distance = 9;

  #goalAzimuth = this.#azimuth;
  #goalPolar = this.#polar;
  #goalDistance = this.#distance;
  readonly #goalTarget = new THREE.Vector3(0, 0.5, 0);

  #following: THREE.Object3D | null = null;
  #autoSpin = 0;
  #dragging: 'orbit' | 'pan' | null = null;
  #lastPointer = new THREE.Vector2();
  #pinchDistance = 0;
  readonly #pointers = new Map<number, THREE.Vector2>();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly element: HTMLElement,
    private readonly limits: OrbitLimits = DEFAULT_LIMITS,
  ) {
    this.#bind();
  }

  /** Slowly rotates when nothing else is happening. 0 disables. */
  setAutoSpin(radiansPerSecond: number): void {
    this.#autoSpin = radiansPerSecond;
  }

  follow(object: THREE.Object3D | null): void {
    this.#following = object;
  }

  get isFollowing(): boolean {
    return this.#following !== null;
  }

  frame(centre: THREE.Vector3, radius: number): void {
    this.#goalTarget.copy(centre);
    // Fit the sphere in view with a little margin.
    const fov = (this.camera.fov * Math.PI) / 180;
    this.#goalDistance = THREE.MathUtils.clamp(
      (radius * 1.7) / Math.tan(fov / 2),
      this.limits.minDistance,
      this.limits.maxDistance,
    );
  }

  setAngles(azimuthDeg: number, polarDeg: number): void {
    this.#goalAzimuth = azimuthDeg * DEG;
    this.#goalPolar = THREE.MathUtils.clamp(polarDeg * DEG, this.limits.minPolar, this.limits.maxPolar);
  }

  update(dt: number): void {
    if (this.#following) {
      this.#following.getWorldPosition(this.#goalTarget);
      this.#goalTarget.y += 0.35;
    }
    if (this.#autoSpin !== 0 && !this.#dragging) {
      this.#goalAzimuth += this.#autoSpin * dt;
    }

    // Frame-rate independent damping: the 1 - e^(-k·dt) form keeps the feel
    // identical at 30 fps and 144 fps, which a raw lerp does not.
    const ease = (k: number): number => 1 - Math.exp(-k * dt);
    const slow = ease(9);
    const fast = ease(14);

    this.#azimuth += (this.#goalAzimuth - this.#azimuth) * slow;
    this.#polar += (this.#goalPolar - this.#polar) * slow;
    this.#distance += (this.#goalDistance - this.#distance) * slow;
    this.target.lerp(this.#goalTarget, fast);

    const sinPolar = Math.sin(this.#polar);
    this.camera.position.set(
      this.target.x + this.#distance * sinPolar * Math.sin(this.#azimuth),
      this.target.y + this.#distance * Math.cos(this.#polar),
      this.target.z + this.#distance * sinPolar * Math.cos(this.#azimuth),
    );
    this.camera.lookAt(this.target);
  }

  // ── input ──────────────────────────────────────────────────────────────

  #bind(): void {
    const el = this.element;
    el.style.touchAction = 'none';

    el.addEventListener('pointerdown', (event) => {
      // Controls layered over the canvas opt out by setting data-no-orbit.
      if ((event.target as HTMLElement)?.closest?.('[data-no-orbit]')) return;
      el.setPointerCapture(event.pointerId);
      this.#pointers.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY));
      if (this.#pointers.size === 1) {
        this.#dragging = event.button === 2 || event.shiftKey ? 'pan' : 'orbit';
        this.#lastPointer.set(event.clientX, event.clientY);
      } else if (this.#pointers.size === 2) {
        this.#dragging = 'pan';
        this.#pinchDistance = this.#spread();
      }
    });

    el.addEventListener('pointermove', (event) => {
      if (!this.#pointers.has(event.pointerId)) return;
      this.#pointers.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY));

      if (this.#pointers.size === 2) {
        const spread = this.#spread();
        if (this.#pinchDistance > 0) {
          this.#zoom(((this.#pinchDistance - spread) / this.#pinchDistance) * this.#distance * 1.1);
        }
        this.#pinchDistance = spread;
        return;
      }

      const dx = event.clientX - this.#lastPointer.x;
      const dy = event.clientY - this.#lastPointer.y;
      this.#lastPointer.set(event.clientX, event.clientY);

      if (this.#dragging === 'orbit') {
        this.#goalAzimuth -= dx * 0.006;
        this.#goalPolar = THREE.MathUtils.clamp(
          this.#goalPolar - dy * 0.006,
          this.limits.minPolar,
          this.limits.maxPolar,
        );
      } else if (this.#dragging === 'pan') {
        this.#pan(dx, dy);
      }
    });

    const release = (event: PointerEvent): void => {
      this.#pointers.delete(event.pointerId);
      if (this.#pointers.size === 0) this.#dragging = null;
      if (this.#pointers.size < 2) this.#pinchDistance = 0;
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('contextmenu', (event) => event.preventDefault());

    el.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.#zoom(event.deltaY * 0.0016 * this.#distance);
      },
      { passive: false },
    );
  }

  #spread(): number {
    const [a, b] = [...this.#pointers.values()];
    return a && b ? a.distanceTo(b) : 0;
  }

  #zoom(delta: number): void {
    this.#goalDistance = THREE.MathUtils.clamp(
      this.#goalDistance + delta,
      this.limits.minDistance,
      this.limits.maxDistance,
    );
  }

  /** Panning breaks follow mode — the player has taken manual control. */
  #pan(dx: number, dy: number): void {
    this.#following = null;
    const scale = this.#distance * 0.0016;
    const right = new THREE.Vector3(Math.cos(this.#azimuth), 0, -Math.sin(this.#azimuth));
    const forward = new THREE.Vector3(Math.sin(this.#azimuth), 0, Math.cos(this.#azimuth));
    this.#goalTarget.addScaledVector(right, -dx * scale);
    this.#goalTarget.addScaledVector(forward, -dy * scale);
  }
}
