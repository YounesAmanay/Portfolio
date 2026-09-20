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

export class Controls {
  readonly input: ControlInput = neutralInput();
  readonly #keys = new Set<string>();

  /**
   * Touch controls, as discrete held buttons.
   *
   * Steering and throttle are separate thumbs, which is what every driving
   * game on a phone does and what a single two-axis stick cannot give you: one
   * thumb cannot hold a steady throttle and make a steering correction at the
   * same time without doing both at once, so every turn became a swerve.
   */
  #touchLeft = false;
  #touchRight = false;
  #touchForward = false;
  #touchBack = false;
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

  setSteer(direction: -1 | 1, held: boolean): void {
    if (direction < 0) this.#touchLeft = held;
    else this.#touchRight = held;
  }

  setThrottle(direction: -1 | 1, held: boolean): void {
    if (direction < 0) this.#touchBack = held;
    else this.#touchForward = held;
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

    const touch = (on: boolean): number => (on ? 1 : 0);
    const targetDrive = clamp(
      held('KeyW', 'ArrowUp') - held('KeyS', 'ArrowDown') + touch(this.#touchForward) - touch(this.#touchBack),
      -1,
      1,
    );
    const targetSteer = clamp(
      held('KeyD', 'ArrowRight') - held('KeyA', 'ArrowLeft') + touch(this.#touchRight) - touch(this.#touchLeft),
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
    this.#touchLeft = false;
    this.#touchRight = false;
    this.#touchForward = false;
    this.#touchBack = false;
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

export function approach(current: number, target: number, dt: number, up: number, down: number): number {
  const rate = Math.abs(target) > Math.abs(current) ? up : down;
  const step = rate * dt;
  if (Math.abs(target - current) <= step) return target;
  return current + Math.sign(target - current) * step;
}

/**
 * A held button for touch.
 *
 * `variant` selects its size and role in the stylesheet; the throttle is the
 * biggest target on screen because it is the one held the whole match.
 */
export function createTouchButton(
  label: string,
  onChange: (down: boolean) => void,
  variant = '',
): HTMLElement {
  const button = document.createElement('button');
  button.className = `touch-btn ${variant}`.trim();
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
  // A thumb that slides off the edge must release it, or the machine drives
  // away on its own with nothing held.
  button.addEventListener('pointerleave', up);
  return button;
}

/** True when the device is primarily touch-driven. */
export function isTouchDevice(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}
