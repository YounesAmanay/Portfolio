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
  // 22 cm. A machine is 30-60 cm across and a single component is 8, so the
  // old 1.6 m floor meant the camera physically could not get close enough to
  // look at what you had built: you could place a wheel but never see its
  // tread. The near plane is 0.05, so this still leaves plenty of room.
  minDistance: 0.22,
  maxDistance: 46,
  // Never quite reach the poles: straight down loses all sense of scale, and
  // straight along the floor puts the camera inside it.
  minPolar: 6 * DEG,
  maxPolar: 87 * DEG,
};

/**
 * How much room to leave around a framed object, as a multiple of its radius.
 * Fitting the bounding sphere exactly reads as cramped, because the sphere is
 * bigger than the machine inside it.
 */
const FRAME_MARGIN = 1.35;

/** How hard the camera swings back behind the machine, per second. */
const ALIGN_EASE = 2.6;
/** Ceiling on that swing, rad/s, so a spin on the spot cannot whip the view. */
const ALIGN_RATE = 2.2;
/** Seconds the player keeps manual control after dragging to look around. */
const ALIGN_HOLD = 2.5;

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
  #headingSource: (() => number) | null = null;
  /** Seconds of manual control remaining before auto-alignment resumes. */
  #manualHold = 0;
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

  /** Sets how far back the camera sits, independent of what it is watching. */
  setDistance(distance: number): void {
    this.#goalDistance = THREE.MathUtils.clamp(distance, this.limits.minDistance, this.limits.maxDistance);
  }

  get isFollowing(): boolean {
    return this.#following !== null;
  }

  frame(centre: THREE.Vector3, radius: number): void {
    this.#goalTarget.copy(centre);

    // Fit against whichever field of view is tighter. `camera.fov` is the
    // vertical one, so fitting to it alone overflows the width on any portrait
    // viewport: at 390x844 the horizontal field is less than half as wide, and
    // a phone cropped the machine it was supposed to be framing.
    const vertical = (this.camera.fov * Math.PI) / 180;
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * this.camera.aspect);
    const fit = Math.min(vertical, horizontal);

    this.#goalDistance = THREE.MathUtils.clamp(
      (radius * FRAME_MARGIN) / Math.tan(fit / 2),
      this.limits.minDistance,
      this.limits.maxDistance,
    );
  }

  /**
   * Keeps the camera behind a heading, in radians, as a compass bearing on the
   * ground plane (atan2(x, z), the same convention the machines use).
   *
   * Without this the camera followed position only, so a machine rotated freely
   * underneath a fixed view. Measured while driving: the camera bearing sat at
   * -152 degrees for an entire run while the machine's heading swept through
   * 180, -140, -70, 3 and 73 — a divergence peaking at 155 degrees, at which
   * point pressing forward drove the machine almost straight at the viewer.
   * Tank controls under a free camera are unusable, and that is what they were.
   *
   * Pass null to stop aligning.
   */
  followHeading(source: (() => number) | null): void {
    this.#headingSource = source;
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

    // Swing round behind the machine, unless the player is looking around.
    if (this.#manualHold > 0) this.#manualHold = Math.max(0, this.#manualHold - dt);
    if (this.#headingSource !== null && this.#manualHold === 0 && this.#dragging === null) {
      // The camera sits at `azimuth` from the target, so to look *along* the
      // heading it has to stand on the opposite bearing.
      const desired = this.#headingSource() + Math.PI;
      const diff = Math.atan2(
        Math.sin(desired - this.#goalAzimuth),
        Math.cos(desired - this.#goalAzimuth),
      );
      // Eased, then rate-limited. The limit is what stops a machine spinning
      // on the spot from whipping the camera round with it: the view lags,
      // catches up, and stays readable.
      const eased = diff * (1 - Math.exp(-ALIGN_EASE * dt));
      this.#goalAzimuth += THREE.MathUtils.clamp(eased, -ALIGN_RATE * dt, ALIGN_RATE * dt);
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
        // Looking around suspends auto-alignment rather than cancelling it, so
        // the view drifts back behind the machine once the player lets go.
        this.#manualHold = ALIGN_HOLD;
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

  /**
   * Panning moves the look-at point, and does nothing while following.
   *
   * It used to drop follow mode entirely, which meant one stray two-finger
   * drag during a match left the camera stranded and the machine gone.
   */
  #pan(dx: number, dy: number): void {
    if (this.#following !== null) return;
    const scale = this.#distance * 0.0016;
    const right = new THREE.Vector3(Math.cos(this.#azimuth), 0, -Math.sin(this.#azimuth));
    const forward = new THREE.Vector3(Math.sin(this.#azimuth), 0, Math.cos(this.#azimuth));
    this.#goalTarget.addScaledVector(right, -dx * scale);
    this.#goalTarget.addScaledVector(forward, -dy * scale);
  }
}
