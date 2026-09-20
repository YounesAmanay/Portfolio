/**
 * Driving input, from a keyboard or a thumb.
 *
 * Both produce the same `ControlInput`, so nothing downstream knows or cares
 * which is in use — the same machine can be driven with WASD, with a virtual
 * stick, or by an autonomous routine.
 *
 * Analogue values are ramped rather than snapped. A keyboard is a digital
 * device and a throttle is not; slamming from 0 to 1 in one frame makes every
 * machine feel like it is on ice.
 */

import { clamp } from '../kinetic/core/units';
import { neutralInput, type ControlInput } from '../kinetic/physics/robot';

/**
 * Ramp rates, in units per second toward the commanded value.
 *
 * Steering is deliberately much quicker than the throttle. A throttle wants
 * some weight to it, but a steering input that takes 180 ms to reach full lock
 * feels like the machine is arguing with you — which is what 5.5 did.
 */
const DRIVE_UP = 7;
const DRIVE_DOWN = 10;
const STEER_UP = 14;
const STEER_DOWN = 18;
const TRIGGER_RATE = 8;

/**
 * Radius of stick travel treated as centre.
 *
 * Capacitive touch reports a few percent of drift from a resting thumb, and
 * without a dead zone that drift is a permanent slow turn.
 */
const DEADZONE = 0.15;

export class Controls {
  readonly input: ControlInput = neutralInput();
  readonly #keys = new Set<string>();

  /** Touch stick, normalised to [-1, 1] on each axis. */
  #stickX = 0;
  #stickY = 0;
  #touchWeapon = false;
  #touchLift = false;

  #detach: (() => void)[] = [];

  constructor(target: HTMLElement | Window = window) {
    const down = (event: KeyboardEvent): void => {
      if (event.repeat) return;
      this.#keys.add(event.code);
      // Arrow keys and space scroll the page otherwise, which is fatal on a
      // driving control scheme.
      if (DRIVING_KEYS.has(event.code)) event.preventDefault();
    };
    const up = (event: KeyboardEvent): void => {
      this.#keys.delete(event.code);
    };
    const blur = (): void => this.#keys.clear();

    target.addEventListener('keydown', down as EventListener);
    target.addEventListener('keyup', up as EventListener);
    window.addEventListener('blur', blur);

    this.#detach.push(() => {
      target.removeEventListener('keydown', down as EventListener);
      target.removeEventListener('keyup', up as EventListener);
      window.removeEventListener('blur', blur);
    });
  }

  /**
   * Stick position, normalised to [-1, 1] per axis.
   *
   * The dead zone is applied radially rather than per axis, so the corners of
   * the square are not treated differently from the edges, and the remaining
   * travel is rescaled from zero — otherwise the machine jumps to 15% throttle
   * the instant the thumb leaves centre.
   */
  setStick(x: number, y: number): void {
    const shaped = shapeStick(x, y);
    this.#stickX = shaped.x;
    this.#stickY = shaped.y;
  }

  setWeapon(active: boolean): void {
    this.#touchWeapon = active;
  }

  setLift(active: boolean): void {
    this.#touchLift = active;
  }

  /** Advances the ramps and returns the current command. */
  update(dt: number): ControlInput {
    const held = (...codes: string[]): number => (codes.some((c) => this.#keys.has(c)) ? 1 : 0);

    const targetDrive = clamp(
      held('KeyW', 'ArrowUp') - held('KeyS', 'ArrowDown') - this.#stickY,
      -1,
      1,
    );
    const targetSteer = clamp(
      held('KeyD', 'ArrowRight') - held('KeyA', 'ArrowLeft') + this.#stickX,
      -1,
      1,
    );
    const targetWeapon = this.#touchWeapon || this.#keys.has('Space') ? 1 : 0;
    const targetLift = this.#touchLift || this.#keys.has('ShiftLeft') || this.#keys.has('ShiftRight') ? 1 : 0;

    this.input.drive = approach(this.input.drive, targetDrive, dt, DRIVE_UP, DRIVE_DOWN);
    this.input.steer = approach(this.input.steer, targetSteer, dt, STEER_UP, STEER_DOWN);
    this.input.weapon = approach(this.input.weapon, targetWeapon, dt, TRIGGER_RATE, TRIGGER_RATE);
    this.input.lift = approach(this.input.lift, targetLift, dt, TRIGGER_RATE, TRIGGER_RATE);
    return this.input;
  }

  reset(): void {
    this.#keys.clear();
    this.#stickX = 0;
    this.#stickY = 0;
    this.#touchWeapon = false;
    this.#touchLift = false;
    Object.assign(this.input, neutralInput());
  }

  dispose(): void {
    for (const off of this.#detach) off();
    this.#detach = [];
  }
}

const DRIVING_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight',
]);

/**
 * Dead zone and response curve for a thumb stick.
 *
 * The dead zone is radial rather than per axis, so the corners of the square
 * are not treated differently from the edges, and the remaining travel is
 * rescaled from zero — without that the machine jumps straight to 15% throttle
 * the instant a thumb leaves centre. The curve then spends most of the travel
 * on the slow half, which is where placing a machine accurately happens.
 *
 * Pure, and exported for that reason: it is the part of the control feel worth
 * pinning down in a test.
 */
export function shapeStick(x: number, y: number): { x: number; y: number } {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= DEADZONE) return { x: 0, y: 0 };

  const live = Math.min(1, (magnitude - DEADZONE) / (1 - DEADZONE));
  const scale = (live * live * 0.6 + live * 0.4) / magnitude;
  return { x: clamp(x * scale, -1, 1), y: clamp(y * scale, -1, 1) };
}

export function approach(current: number, target: number, dt: number, up: number, down: number): number {
  const rate = Math.abs(target) > Math.abs(current) ? up : down;
  const step = rate * dt;
  if (Math.abs(target - current) <= step) return target;
  return current + Math.sign(target - current) * step;
}

/**
 * A thumb stick for touch devices.
 *
 * Marked `data-no-orbit` so dragging it never also rotates the camera — the
 * two live on the same canvas and would otherwise fight for every gesture.
 */
export function createTouchStick(onMove: (x: number, y: number) => void): HTMLElement {
  const base = document.createElement('div');
  base.className = 'stick';
  base.setAttribute('data-no-orbit', '');

  const knob = document.createElement('div');
  knob.className = 'stick__knob';
  base.appendChild(knob);

  let active = -1;
  const radius = 46;

  const move = (event: PointerEvent): void => {
    if (event.pointerId !== active) return;
    const rect = base.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(dx, dy);
    const scale = distance > radius ? radius / distance : 1;
    const x = dx * scale;
    const y = dy * scale;
    knob.style.transform = `translate(${x}px, ${y}px)`;
    // Raw travel: the dead zone and response curve belong to Controls, so the
    // knob keeps tracking the thumb exactly even inside the dead zone.
    onMove(x / radius, y / radius);
  };

  const release = (event: PointerEvent): void => {
    if (event.pointerId !== active) return;
    active = -1;
    knob.style.transform = 'translate(0px, 0px)';
    onMove(0, 0);
  };

  base.addEventListener('pointerdown', (event) => {
    active = event.pointerId;
    base.setPointerCapture(event.pointerId);
    move(event);
  });
  base.addEventListener('pointermove', move);
  base.addEventListener('pointerup', release);
  base.addEventListener('pointercancel', release);

  return base;
}

export function createTouchButton(label: string, onChange: (down: boolean) => void): HTMLElement {
  const button = document.createElement('button');
  button.className = 'touch-btn';
  button.textContent = label;
  button.setAttribute('data-no-orbit', '');
  button.addEventListener('pointerdown', (event) => {
    button.setPointerCapture(event.pointerId);
    button.classList.add('is-down');
    onChange(true);
  });
  const up = (): void => {
    button.classList.remove('is-down');
    onChange(false);
  };
  button.addEventListener('pointerup', up);
  button.addEventListener('pointercancel', up);
  return button;
}

/** True when the device is primarily touch-driven. */
export function isTouchDevice(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}
