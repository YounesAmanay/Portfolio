/**
 * ARCFORGE // KINETIC — application entry.
 *
 * Two modes sharing one stage: the Workshop, where a machine is assembled on a
 * lattice, and the Arena, where it is driven. Switching between them rebuilds
 * the scene rather than hiding it, because a physics world left running behind
 * a menu is a battery drain and a source of very confusing bugs.
 */

import * as THREE from 'three';
import { analyse, type Analysis } from '../kinetic/assembly/analysis';
import { placementCentre, placementHalfExtents, type Design } from '../kinetic/assembly/design';
import { PRESETS, PRESET_NOTES, SCOUT } from '../kinetic/content/presets';
import { radToRpm } from '../kinetic/core/units';
import { ARENAS, type ArenaSpec } from '../kinetic/modes/arena';
import { robotSpeed } from '../kinetic/physics/robot';
import { initPhysics } from '../kinetic/physics/world';
import { PART_LIBRARY, getPart } from '../kinetic/parts/library';
import type { PartCategory, PartDef } from '../kinetic/parts/types';
import { OrbitCamera } from '../render/orbit-camera';
import { Stage } from '../render/stage';
import { ArenaSession } from './arena-session';
import { Controls, createTouchButton, createTouchStick, isTouchDevice } from './controls';
import { Workshop } from './workshop';

type Mode = 'WORKSHOP' | 'ARENA';

const CATEGORY_ORDER: PartCategory[] = [
  'STRUCTURE', 'DRIVE', 'WHEEL', 'POWER', 'CONTROL', 'ARMOUR', 'WEAPON', 'THRUST', 'UTILITY',
];

const STORAGE_KEY = 'arcforge.kinetic.design.v1';

class App {
  readonly stage: Stage;
  readonly camera: OrbitCamera;
  readonly controls: Controls;

  mode: Mode = 'WORKSHOP';
  design: Design = load() ?? SCOUT;
  arenaSpec: ArenaSpec = ARENAS[0]!;

  workshop: Workshop | null = null;
  session: ArenaSession | null = null;

  #clock = new THREE.Clock();
  #root: HTMLElement;
  #hud: HTMLElement;

  constructor(root: HTMLElement) {
    this.#root = root;
    const canvas = root.querySelector<HTMLCanvasElement>('#stage canvas')!;
    this.stage = new Stage(canvas);
    this.camera = new OrbitCamera(this.stage.camera, canvas);
    this.controls = new Controls();
    this.#hud = document.createElement('div');

    this.enterWorkshop();
    this.#loop();
  }

  // ── modes ────────────────────────────────────────────────────────────────

  enterWorkshop(): void {
    this.session?.dispose();
    this.session = null;
    this.mode = 'WORKSHOP';

    this.workshop = new Workshop(this.stage, this.camera, {
      onChange: (design, analysis) => {
        this.design = design;
        save(design);
        this.#renderReadout(analysis);
      },
    }, this.design);

    this.stage.scene.add(this.workshop.root);
    this.camera.follow(null);
    this.camera.setAutoSpin(0.06);
    this.workshop.frameCamera();
    this.#renderChrome();
  }

  enterArena(): void {
    const analysis = analyse(this.design);
    if (analysis.problems.some((p) => p.severity === 'error')) return;

    this.workshop?.dispose();
    this.workshop?.root.removeFromParent();
    this.workshop = null;
    this.mode = 'ARENA';
    this.controls.reset();

    const opponents = this.arenaSpec.mode === 'CRUCIBLE'
      ? [PRESETS.find((p) => p.name !== this.design.name) ?? PRESETS[1]!]
      : [];

    this.session = new ArenaSession(this.stage, {
      spec: this.arenaSpec,
      playerDesign: this.design,
      opponentDesigns: opponents,
    });

    this.camera.setAutoSpin(0);

    // Chase distance follows the machine's own size: a 40 cm scout and a 1.2 m
    // siege tank need very different framing to read at all. Frame the machine
    // itself, not a generous sphere around it — the old 0.9 m floor framed a
    // scout as though it were nearly two metres across.
    const radius = Math.max(0.26, machineRadius(this.design));
    const player = this.session.views[0]?.focusTarget ?? null;

    // Lock on before the countdown, not after it. Machines spawn on a ring
    // several metres out, so framing the arena centre meant three seconds of
    // staring at bare floor while your machine sat off-screen — during exactly
    // the moment you want to look at what you built.
    this.camera.follow(player);
    this.camera.frame(
      player?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(0, 0.26, 0),
      radius * 1.25,
    );
    this.camera.setAngles(28, 58);
    this.#renderChrome();
  }

  // ── loop ─────────────────────────────────────────────────────────────────

  #loop = (): void => {
    const dt = Math.min(this.#clock.getDelta(), 0.1);

    if (this.mode === 'WORKSHOP') {
      this.workshop?.update();
    } else if (this.session) {
      const input = this.controls.update(dt);
      this.session.update(dt, input);

      // Following is established on entry, and panning deliberately breaks it.
      // Re-acquiring here would have overridden a player who had just taken
      // manual control, so the camera stays wherever they put it.
      this.#updateHud();
    }

    this.camera.update(dt);
    this.stage.focusShadows(this.camera.target);
    this.stage.render();
    requestAnimationFrame(this.#loop);
  };

  // ── chrome ───────────────────────────────────────────────────────────────

  #renderChrome(): void {
    const old = this.#root.querySelectorAll('.panel, .dock, .hud, .hint, .result');
    for (const node of old) node.remove();

    if (this.mode === 'WORKSHOP') {
      this.#root.appendChild(this.#buildLibrary());
      this.#root.appendChild(this.#buildReadoutPanel());
      this.#root.appendChild(this.#buildWorkshopDock());
      this.#root.appendChild(
        hint(
          isTouchDevice()
            ? 'Tap a face to add · hold to remove · drag to orbit · pinch to zoom'
            : 'Click a face to add · right-click to remove · drag to orbit · R rotates',
        ),
      );
      this.#renderReadout(analyse(this.design));
    } else {
      this.#hud = this.#buildHud();
      this.#root.appendChild(this.#hud);
    }

    this.#syncTabs();
  }

  #syncTabs(): void {
    for (const tab of this.#root.querySelectorAll<HTMLElement>('.tab[data-mode]')) {
      tab.setAttribute('aria-current', String(tab.dataset.mode === this.mode));
    }
  }

  #buildLibrary(): HTMLElement {
    const panel = el('aside', 'panel panel--library');
    panel.appendChild(head('COMPONENTS'));
    const body = el('div', 'panel__body');

    for (const category of CATEGORY_ORDER) {
      const parts = PART_LIBRARY.filter((p) => p.category === category);
      if (parts.length === 0) continue;

      const group = el('div', 'cat');
      group.appendChild(el('div', 'cat__name', category));

      for (const part of parts) {
        const button = el('button', 'part') as HTMLButtonElement;
        button.setAttribute('aria-pressed', String(this.workshop?.selectedPartId === part.id));
        button.appendChild(el('div', 'part__name', part.name));
        button.appendChild(el('div', 'part__spec', specLine(part)));
        button.onclick = (): void => {
          this.workshop?.selectPart(part.id);
          for (const other of panel.querySelectorAll('.part')) other.setAttribute('aria-pressed', 'false');
          button.setAttribute('aria-pressed', 'true');
          this.#showLesson(part);
          // On a phone the sheet covers the very model you are about to place
          // onto, and the lesson lands in the other sheet, which is closed. So
          // get out of the way and carry the lesson over as a toast.
          if (isSheetLayout()) {
            openSheet(null);
            toast(part.lesson);
          }
        };
        group.appendChild(button);
      }
      body.appendChild(group);
    }

    panel.appendChild(body);
    return panel;
  }

  #showLesson(part: PartDef): void {
    const host = this.#root.querySelector('#lesson-host');
    if (!host) return;
    host.replaceChildren();
    const box = el('div', 'lesson');
    box.appendChild(el('span', 'lesson__tag', part.name.toUpperCase()));
    box.appendChild(document.createTextNode(part.lesson));
    host.appendChild(box);
  }

  #buildReadoutPanel(): HTMLElement {
    const panel = el('aside', 'panel panel--readout');
    panel.appendChild(head('ANALYSIS'));
    const body = el('div', 'panel__body');
    body.id = 'readout-body';
    panel.appendChild(body);
    return panel;
  }

  #renderReadout(analysis: Analysis): void {
    const body = this.#root.querySelector('#readout-body');
    if (!body) return;

    const stats = el('div', 'stats');
    const add = (label: string, value: string, unit = '', tone = ''): void => {
      const stat = el('div', `stat${tone ? ` stat--${tone}` : ''}`);
      stat.appendChild(el('div', 'stat__label', label));
      const v = el('div', 'stat__value', value);
      if (unit) v.appendChild(el('span', 'stat__unit', unit));
      stat.appendChild(v);
      stats.appendChild(stat);
    };

    const tipTone = analysis.tipG <= 0 ? 'bad' : analysis.tipG < 0.4 ? 'warn' : 'good';
    const powerTone = analysis.powerMargin < 1 ? 'warn' : 'good';

    add('Mass', analysis.mass.toFixed(2), 'kg');
    add('Tips at', analysis.tipG > 0 ? analysis.tipG.toFixed(2) : '—', 'g', tipTone);
    add('Top speed', analysis.topSpeed.toFixed(1), 'm/s');
    add('Climb', analysis.maxGrade.toFixed(0), '°');
    add('Wheel torque', analysis.totalTorque.toFixed(1), 'N·m');
    add('Clearance', (analysis.groundClearance * 100).toFixed(0), 'cm',
      analysis.groundClearance <= 0 ? 'bad' : '');
    add('Battery', analysis.batteryCapacity.toFixed(0), 'W·h');
    add('Power', `${(analysis.powerMargin * 100).toFixed(0)}`, '%', powerTone);
    add('CoM height', (analysis.centreOfMass.y * 100).toFixed(0), 'cm');
    add('Cost', analysis.cost.toFixed(0), 'cr');

    body.replaceChildren(stats);

    if (analysis.problems.length > 0) {
      const list = el('div', 'problems');
      for (const problem of analysis.problems) {
        const item = el('div', `problem problem--${problem.severity}`);
        item.appendChild(el('span', 'problem__mark', problem.severity === 'error' ? '!!' : '~'));
        item.appendChild(el('span', '', problem.message));
        list.appendChild(item);
      }
      body.appendChild(list);
    }

    const lessonHost = el('div', '');
    lessonHost.id = 'lesson-host';
    body.appendChild(lessonHost);
    const selected = this.workshop ? getPart(this.workshop.selectedPartId) : undefined;
    if (selected) this.#showLesson(selected);
  }

  #buildWorkshopDock(): HTMLElement {
    const dock = el('div', 'dock');

    // Phone-only, and first in the row: without these the sheets stay parked
    // off-screen and the component library cannot be reached at all.
    dock.appendChild(sheetToggle('PARTS', '.panel--library'));
    dock.appendChild(sheetToggle('SPECS', '.panel--readout'));

    const presets = el('select', '') as HTMLSelectElement;
    presets.appendChild(new Option('LOAD PRESET…', ''));
    for (const preset of PRESETS) presets.appendChild(new Option(preset.name, preset.name));
    presets.onchange = (): void => {
      const found = PRESETS.find((p) => p.name === presets.value);
      if (!found) return;
      this.design = found;
      this.workshop?.setDesign(found);
      this.workshop?.frameCamera();
      presets.value = '';
      const note = PRESET_NOTES[found.name];
      if (note) toast(note);
    };
    dock.appendChild(presets);

    dock.appendChild(button('ROTATE  R', () => this.workshop?.rotate()));
    dock.appendChild(button('FRAME', () => this.workshop?.frameCamera()));
    dock.appendChild(button('CLEAR', () => this.workshop?.clear(), 'btn--danger'));

    const arenaSelect = el('select', '') as HTMLSelectElement;
    for (const spec of ARENAS) arenaSelect.appendChild(new Option(spec.name, spec.id));
    arenaSelect.value = this.arenaSpec.id;
    arenaSelect.onchange = (): void => {
      this.arenaSpec = ARENAS.find((a) => a.id === arenaSelect.value) ?? ARENAS[0]!;
      toast(this.arenaSpec.blurb);
    };
    dock.appendChild(arenaSelect);

    const deploy = button('DEPLOY  ▸', () => this.enterArena(), 'btn--go') as HTMLButtonElement;
    const analysis = analyse(this.design);
    deploy.disabled = analysis.problems.some((p) => p.severity === 'error');
    dock.appendChild(deploy);

    window.addEventListener('keydown', (event) => {
      if (this.mode === 'WORKSHOP' && event.code === 'KeyR') this.workshop?.rotate();
    });

    return dock;
  }

  #buildHud(): HTMLElement {
    const hud = el('div', 'hud');

    const status = el('div', 'hud__status');
    status.appendChild(el('div', 'hud__big', ''));
    status.appendChild(el('div', 'hud__msg', ''));
    hud.appendChild(status);

    const gauges = el('div', 'gauges');
    for (const [key, label] of [['speed', 'SPEED'], ['power', 'BATTERY'], ['heat', 'MOTOR TEMP']] as const) {
      const row = el('div', '');
      const head = el('div', 'gauge__row');
      head.appendChild(el('span', 'gauge__label', label));
      head.appendChild(el('span', `gauge__value gauge__value--${key}`, '—'));
      row.appendChild(head);
      const track = el('div', 'gauge__track');
      track.appendChild(el('div', `gauge__fill gauge__fill--${key}`));
      row.appendChild(track);
      gauges.appendChild(row);
    }
    hud.appendChild(gauges);

    const back = button('◂ WORKSHOP', () => this.enterWorkshop());
    back.style.cssText = 'position:absolute;right:12px;bottom:14px;';
    hud.appendChild(back);

    if (isTouchDevice()) {
      hud.appendChild(createTouchStick((x, y) => this.controls.setStick(x, y)));
      const cluster = el('div', 'touch-cluster');
      cluster.appendChild(createTouchButton('WEAPON', (d) => this.controls.setWeapon(d)));
      cluster.appendChild(createTouchButton('LIFT', (d) => this.controls.setLift(d)));
      hud.appendChild(cluster);
    }

    return hud;
  }

  #updateHud(): void {
    const session = this.session;
    if (!session) return;

    const big = this.#hud.querySelector('.hud__big');
    const msg = this.#hud.querySelector('.hud__msg');
    const match = session.match;

    if (big && msg) {
      if (match.status === 'COUNTDOWN') {
        big.textContent = match.message;
        msg.textContent = 'STAND BY';
      } else if (match.status === 'RUNNING') {
        big.textContent = session.options.spec.timeLimit > 0
          ? `${Math.max(0, session.options.spec.timeLimit - match.elapsed).toFixed(1)}`
          : match.elapsed.toFixed(1);
        msg.textContent = session.options.spec.checkpoints.length > 0
          ? `GATE ${match.checkpoint + 1} / ${session.options.spec.checkpoints.length}`
          : session.options.spec.name;
      } else {
        big.textContent = '';
        msg.textContent = '';
        this.#showResult(match.status, match.message);
      }
    }

    const speed = robotSpeed(session.player);
    const top = Math.max(1, session.player.analysis.topSpeed);
    setGauge(this.#hud, 'speed', speed / top, `${speed.toFixed(1)} m/s`);

    const charge = session.player.capacity > 0 ? session.player.energy / session.player.capacity : 0;
    setGauge(this.#hud, 'power', charge, `${(charge * 100).toFixed(0)}%`);

    const hottest = session.player.wheels.reduce((max, w) => Math.max(max, w.temperature), 22);
    const heat = Math.min(1, (hottest - 22) / 130);
    setGauge(this.#hud, 'heat', heat, `${hottest.toFixed(0)}°C`, heat > 0.55);
  }

  #showResult(status: string, message: string): void {
    if (this.#root.querySelector('.result')) return;

    const overlay = el('div', 'result');
    const card = el('div', 'result__card');
    const won = status === 'WON';
    const verdict = el('div', 'result__verdict', won ? 'COMPLETE' : status === 'LOST' ? 'WRECKED' : 'TIME');
    verdict.style.color = won ? 'var(--green)' : status === 'LOST' ? 'var(--red)' : 'var(--amber)';
    card.appendChild(verdict);
    card.appendChild(el('div', 'result__detail', message));

    const actions = el('div', 'result__actions');
    actions.appendChild(button('RETRY', () => { overlay.remove(); this.enterArena(); }, 'btn--go'));
    actions.appendChild(button('BACK TO WORKSHOP', () => { overlay.remove(); this.enterWorkshop(); }));
    card.appendChild(actions);

    overlay.appendChild(card);
    this.#root.appendChild(overlay);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Small DOM helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Rough bounding radius of a design, in metres. Used for camera framing. */
function machineRadius(design: Design): number {
  let max = 0.2;
  for (const placement of design.placements) {
    const centre = placementCentre(placement);
    const half = placementHalfExtents(placement);
    max = Math.max(max, Math.hypot(centre.x + half.x, centre.z + half.z));
  }
  return max / 2;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function head(title: string): HTMLElement {
  const node = el('div', 'panel__head');
  node.appendChild(el('span', '', title));

  // On a phone the panels are bottom sheets, so each needs its own dismiss.
  // The stylesheet hides this above the breakpoint, where the panels are
  // always-visible columns and there is nothing to dismiss.
  const close = el('button', 'sheet-close', '✕') as HTMLButtonElement;
  close.type = 'button';
  close.setAttribute('aria-label', `Close ${title.toLowerCase()}`);
  close.onclick = (): void => openSheet(null);
  node.appendChild(close);
  return node;
}

/**
 * Phone chrome: the library and the readout are bottom sheets, and only one is
 * ever up — two half-height sheets over a 3D view leaves nothing to look at.
 * Passing null closes whatever is open. Above the breakpoint the `is-open`
 * class is inert, so this is safe to call at any width.
 */
function openSheet(selector: string | null): void {
  for (const panel of document.querySelectorAll<HTMLElement>('.panel')) {
    panel.classList.toggle('is-open', selector !== null && panel.matches(selector));
  }
  for (const toggle of document.querySelectorAll<HTMLElement>('.sheet-toggle')) {
    const target = toggle.dataset.sheet;
    const panel = target === undefined ? null : document.querySelector(target);
    toggle.setAttribute('aria-pressed', String(panel?.classList.contains('is-open') === true));
  }
}

/** Matches the stylesheet's breakpoint; the two must not drift apart. */
const SHEET_BREAKPOINT = 900;

function isSheetLayout(): boolean {
  return window.matchMedia(`(max-width: ${SHEET_BREAKPOINT}px)`).matches;
}

function sheetToggle(label: string, selector: string): HTMLElement {
  const node = el('button', 'btn sheet-toggle', label) as HTMLButtonElement;
  node.type = 'button';
  node.dataset.sheet = selector;
  node.setAttribute('aria-pressed', 'false');
  node.onclick = (): void => {
    const open = document.querySelector(selector)?.classList.contains('is-open') === true;
    openSheet(open ? null : selector);
  };
  return node;
}

function button(label: string, onClick: () => void, extra = ''): HTMLElement {
  const node = el('button', `btn ${extra}`.trim(), label) as HTMLButtonElement;
  node.onclick = onClick;
  return node;
}

function hint(text: string): HTMLElement {
  return el('div', 'hint', text);
}

function setGauge(hud: HTMLElement, key: string, fraction: number, label: string, hot = false): void {
  const fill = hud.querySelector<HTMLElement>(`.gauge__fill--${key}`);
  const value = hud.querySelector<HTMLElement>(`.gauge__value--${key}`);
  if (fill) {
    fill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    fill.classList.toggle('is-hot', hot);
  }
  if (value) value.textContent = label;
}

function specLine(part: PartDef): string {
  const bits = [`${part.mass.toFixed(2)} kg`];
  if (part.drive) {
    bits.push(`${part.drive.wheelTorque.toFixed(1)} N·m`);
    bits.push(`${(part.drive.freeSpeed * part.drive.radius).toFixed(1)} m/s`);
  }
  if (part.battery) bits.push(`${part.battery.capacity.toFixed(0)} W·h`);
  if (part.weapon?.inertia && part.weapon.maxSpin) {
    const joules = 0.5 * part.weapon.inertia * part.weapon.maxSpin ** 2;
    bits.push(`${(joules / 1000).toFixed(1)} kJ`);
    bits.push(`${radToRpm(part.weapon.maxSpin).toFixed(0)} rpm`);
  }
  if (part.thruster) bits.push(`${part.thruster.thrust} N`);
  if (part.category === 'ARMOUR') bits.push(`${(part.integrity / 1000).toFixed(1)} kJ`);
  return bits.join('  ·  ');
}

let toastTimer = 0;
function toast(message: string): void {
  document.querySelector('.toast')?.remove();
  const node = el('div', 'hint toast', message);
  node.style.cssText = 'bottom:auto;top:96px;max-width:min(520px,90vw);white-space:normal;text-align:center;line-height:1.5;';
  document.getElementById('app')?.appendChild(node);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.remove(), 6000);
}

function save(design: Design): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(design));
  } catch { /* storage may be blocked; losing a save beats losing the session */ }
}

function load(): Design | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Design;
    return parsed?.placements?.length ? parsed : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  await initPhysics();
  const root = document.getElementById('app')!;
  root.querySelector('.boot')?.remove();

  const app = new App(root);
  // Exposed for debugging and for the browser smoke test. Read-only in spirit.
  (window as unknown as { arcforge?: App }).arcforge = app;

  for (const tab of root.querySelectorAll<HTMLElement>('.tab[data-mode]')) {
    tab.onclick = (): void => {
      if (tab.dataset.mode === 'ARENA') app.enterArena();
      else app.enterWorkshop();
    };
  }
}

void boot();
