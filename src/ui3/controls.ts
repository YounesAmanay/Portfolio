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

const RAMP_UP = 5.5;     // units per second toward the commanded value
const RAMP_DOWN = 7.5;   // and back toward centre, slightly faster

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

  setStick(x: number, y: number): void {
    this.#stickX = clamp(x, -1, 1);
    this.#stickY = clamp(y, -1, 1);
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

    this.input.drive = approach(this.input.drive, targetDrive, dt);
    this.input.steer = approach(this.input.steer, targetSteer, dt);
    this.input.weapon = approach(this.input.weapon, targetWeapon, dt);
    this.input.lift = approach(this.input.lift, targetLift, dt);
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

function approach(current: number, target: number, dt: number): number {
  const rate = Math.abs(target) > Math.abs(current) ? RAMP_UP : RAMP_DOWN;
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
