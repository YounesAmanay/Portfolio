/**
 * ARCFORGE // KINETIC — application entry.
 *
 * Two modes sharing one stage: the Workshop, where a machine is assembled on a
 * lattice, and the Arena, where it is driven. Switching between them rebuilds
 * the scene rather than hiding it, because a physics world left running behind
 * a menu is a battery drain and a source of very confusing bugs.
 */

import * as THREE from 'three';
import { MACHINES } from '../kinetic/content/machines';
import { CELL } from '../kinetic/core/units';
import { analyseBuild, type MachineAnalysis } from '../kinetic/machine/analysis';
import { componentOf, occupiedCells, type Build } from '../kinetic/machine/build';
import { ALL_COMPONENTS, findComponent, WEIGHT_CLASSES } from '../kinetic/machine/catalogue';
import type { ComponentCategory, ComponentDef } from '../kinetic/machine/components';
import { schematicOf } from '../kinetic/machine/schematic';
import { ARENAS, type ArenaSpec } from '../kinetic/modes/arena';
import { robotSpeed } from '../kinetic/physics/robot';
import { initPhysics } from '../kinetic/physics/world';
import { OrbitCamera } from '../render/orbit-camera';
import { Stage } from '../render/stage';
import { ArenaSession } from './arena-session';
import { Bench } from './bench';
import { Controls, createTouchButton, isTouchDevice } from './controls';
import { renderSchematic } from './schematic-view';

type Mode = 'WORKSHOP' | 'ARENA';

const CATEGORY_ORDER: ComponentCategory[] = [
  'STRUCTURE', 'DRIVE', 'TRANSMISSION', 'WHEEL', 'POWER', 'CONTROL', 'ARMOUR', 'WEAPON', 'UTILITY',
];

const STORAGE_KEY = 'arcforge.kinetic.build.v1';

class App {
  readonly stage: Stage;
  readonly camera: OrbitCamera;
  readonly controls: Controls;

  mode: Mode = 'WORKSHOP';
  build: Build = load() ?? MACHINES[1]!;
  arenaSpec: ArenaSpec = ARENAS[0]!;

  bench: Bench | null = null;
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
    this.camera.followHeading(null);
    this.session?.dispose();
    this.session = null;
    this.mode = 'WORKSHOP';

    this.stage.setLighting('STUDIO');
    this.bench = new Bench(this.stage, this.camera, {
      onChange: (build, analysis) => {
        this.build = build;
        save(build);
        this.#renderReadout(analysis);
        this.#renderSchematic();
        this.#syncDeploy(analysis);
      },
      onSelect: () => {
        this.#renderSchematic();
        this.#renderInspector();
      },
      onRefused: (reason) => toast(reason),
    }, this.build);

    this.stage.scene.add(this.bench.root);
    this.camera.follow(null);
    this.camera.setAutoSpin(0.06);
    this.bench.frameCamera();
    this.#renderChrome();
  }

  enterArena(): void {
    const analysis = analyseBuild(this.build);
    if (analysis.problems.some((p) => p.severity === 'error')) return;

    this.bench?.dispose();
    this.bench?.root.removeFromParent();
    this.bench = null;
    this.mode = 'ARENA';
    this.stage.setLighting('ARENA');
    this.controls.reset();

    const opponents = this.arenaSpec.mode === 'CRUCIBLE'
      ? [MACHINES.find((m) => m.name !== this.build.name) ?? MACHINES[3]!]
      : [];

    this.session = new ArenaSession(this.stage, {
      spec: this.arenaSpec,
      playerMachine: this.build,
      opponentMachines: opponents,
    });

    this.camera.setAutoSpin(0);

    // Chase distance follows the machine's own size: a 40 cm scout and a 1.2 m
    // siege tank need very different framing to read at all. Frame the machine
    // itself, not a generous sphere around it — the old 0.9 m floor framed a
    // scout as though it were nearly two metres across.
    const radius = Math.max(0.26, machineRadius(this.build));
    const player = this.session.views[0]?.focusTarget ?? null;

    // Lock on before the countdown, not after it. Machines spawn on a ring
    // several metres out, so framing the arena centre meant three seconds of
    // staring at bare floor while your machine sat off-screen — during exactly
    // the moment you want to look at what you built.
    this.camera.follow(player);
    // And behind its nose, not just above its position. Forward on the stick
    // has to mean forward on the screen or tank controls are unusable.
    this.camera.followHeading(() => headingOf(this.session));
    this.camera.frame(
      player?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(0, 0.26, 0),
      radius * 1.25,
    );
    // A low chase angle, near the machine's own height rather than looking
    // down on it. At 58 degrees the camera was pitched steeply enough that the
    // arena walls sat above the top of the frame for the whole match: the
    // venue existed and was never once on screen. Low also reads faster,
    // because the floor sweeps past instead of rotating underneath.
    this.camera.setAngles(28, 76);
    this.#renderChrome();
  }

  // ── loop ─────────────────────────────────────────────────────────────────

  #loop = (): void => {
    const dt = Math.min(this.#clock.getDelta(), 0.1);

    if (this.mode === 'WORKSHOP') {
      this.bench?.update();
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
      this.#root.appendChild(this.#buildSchematicPanel());
      this.#root.appendChild(this.#buildBenchDock());
      this.#root.appendChild(hint(this.#benchHint()));
      this.#renderReadout(analyseBuild(this.build));
      this.#renderSchematic();
    } else {
      this.#hud = this.#buildHud();
      this.#root.appendChild(this.#hud);
    }

    this.#syncTabs();
  }

  #benchHint(): string {
    if (this.bench?.tool === 'LINK') {
      return 'Pick a component, then pick what it drives · the wire appears on both views';
    }
    return isTouchDevice()
      ? 'Tap a face to add · hold to remove · drag to orbit · pinch to zoom'
      : 'Click a face to add · right-click to remove · drag to orbit · R rotates';
  }

  #syncTabs(): void {
    for (const tab of this.#root.querySelectorAll<HTMLElement>('.tab[data-mode]')) {
      tab.setAttribute('aria-current', String(tab.dataset.mode === this.mode));
    }
  }

  // ── the catalogue ────────────────────────────────────────────────────────

  #buildLibrary(): HTMLElement {
    const panel = el('aside', 'panel panel--library');
    panel.appendChild(head('CATALOGUE'));
    const body = el('div', 'panel__body');

    for (const category of CATEGORY_ORDER) {
      const components = ALL_COMPONENTS.filter((c) => c.category === category);
      if (components.length === 0) continue;

      const group = el('div', 'cat');
      group.appendChild(el('div', 'cat__name', category));

      for (const component of components) {
        const button = el('button', 'part') as HTMLButtonElement;
        button.setAttribute('aria-pressed', String(this.bench?.selectedComponentId === component.id));
        button.appendChild(el('div', 'part__name', component.name));
        button.appendChild(el('div', 'part__spec', specLine(component)));
        button.onclick = (): void => {
          this.bench?.selectComponent(component.id);
          for (const other of panel.querySelectorAll('.part')) other.setAttribute('aria-pressed', 'false');
          button.setAttribute('aria-pressed', 'true');
          this.#showLesson(component);
          this.#renderChrome();
          // On a phone the sheet covers the very model you are about to place
          // onto, and the lesson lands in the other sheet, which is closed. So
          // get out of the way and carry the lesson over as a toast.
          if (isSheetLayout()) {
            openSheet(null);
            toast(component.lesson);
          }
        };
        group.appendChild(button);
      }
      body.appendChild(group);
    }

    panel.appendChild(body);
    return panel;
  }

  #showLesson(component: ComponentDef): void {
    const host = this.#root.querySelector('#lesson-host');
    if (!host) return;
    host.replaceChildren();
    const box = el('div', 'lesson');
    box.appendChild(el('span', 'lesson__tag', component.name.toUpperCase()));
    box.appendChild(document.createTextNode(component.lesson));
    host.appendChild(box);
  }

  // ── the schematic ────────────────────────────────────────────────────────

  /**
   * The circuit, beside the model.
   *
   * This is the half of a machine that the 3D view physically cannot show. A
   * motor that looks bolted in but was never wired to anything is correct from
   * every angle, and the only way to see it is to draw the chain.
   */
  #buildSchematicPanel(): HTMLElement {
    const panel = el('aside', 'panel panel--schematic');
    panel.appendChild(head('CIRCUIT'));
    const body = el('div', 'panel__body');
    body.id = 'schematic-body';
    panel.appendChild(body);
    return panel;
  }

  #renderSchematic(): void {
    const body = this.#root.querySelector<HTMLElement>('#schematic-body');
    if (!body || !this.bench) return;

    body.replaceChildren();
    const frame = el('div', 'schematic__scroll');
    renderSchematic(frame, schematicOf(this.build), this.bench.selected, {
      onSelect: (uid) => {
        this.bench?.select(uid);
        this.#renderSchematic();
        this.#renderInspector();
      },
    });
    body.appendChild(frame);
    this.#renderInspector(body);
  }

  /** What is selected, what it is joined to, and what can be done about it. */
  #renderInspector(host?: HTMLElement): void {
    const body = host ?? this.#root.querySelector<HTMLElement>('#schematic-body');
    if (!body || !this.bench) return;
    body.querySelector('.inspector')?.remove();

    const uid = this.bench.selected;
    if (!uid) return;
    const fitted = this.build.fitted.find((f) => f.uid === uid);
    if (!fitted) return;

    const component = componentOf(fitted);
    const box = el('div', 'inspector');
    box.appendChild(el('div', 'inspector__name', component.name));
    box.appendChild(el('p', 'inspector__blurb', component.blurb));

    const links = this.bench.linksFor(uid);
    if (links.length === 0) {
      box.appendChild(el('div', 'inspector__none', 'Not connected to anything.'));
    } else {
      for (const link of links) {
        const other = link.from === uid ? link.to : link.from;
        const found = this.build.fitted.find((f) => f.uid === other);
        if (!found) continue;
        const row = el('div', 'inspector__link');
        row.appendChild(
          el('span', 'inspector__dir', link.from === uid ? '\u2192' : '\u2190'),
        );
        row.appendChild(el('span', 'inspector__peer', componentOf(found).name));
        const cut = el('button', 'inspector__cut', 'cut') as HTMLButtonElement;
        cut.onclick = (): void => {
          this.bench?.removeLink(link);
          this.#renderSchematic();
        };
        row.appendChild(cut);
        box.appendChild(row);
      }
    }

    const actions = el('div', 'inspector__actions');
    actions.appendChild(button('UNLINK', () => {
      this.bench?.unlinkSelected();
      this.#renderSchematic();
    }));
    actions.appendChild(button('REMOVE', () => {
      this.bench?.removeSelected();
      this.#renderSchematic();
    }, 'btn--danger'));
    box.appendChild(actions);

    body.appendChild(box);
  }

  // ── the readout ──────────────────────────────────────────────────────────

  #buildReadoutPanel(): HTMLElement {
    const panel = el('aside', 'panel panel--readout');
    panel.appendChild(head('ANALYSIS'));
    const body = el('div', 'panel__body');
    body.id = 'readout-body';
    panel.appendChild(body);
    return panel;
  }

  #renderReadout(report: MachineAnalysis): void {
    const body = this.#root.querySelector('#readout-body');
    if (!body) return;

    // The weight class first, because it is the constraint everything else is
    // a trade against. A bar reads "how much is left" at a glance; a number
    // makes you do the subtraction.
    const cls = el('div', 'classbar');
    const over = report.massMargin < 0;
    cls.appendChild(
      el('div', 'classbar__head',
        `${report.weightClass.name} \u00b7 ${report.mass.toFixed(2)} / ${report.weightClass.limit} kg`),
    );
    const track = el('div', 'classbar__track');
    const fill = el('div', `classbar__fill${over ? ' is-over' : ''}`);
    fill.style.width = `${Math.min(100, (report.mass / report.weightClass.limit) * 100).toFixed(1)}%`;
    track.appendChild(fill);
    cls.appendChild(track);

    const stats = el('div', 'stats');
    const add = (label: string, value: string, unit = '', tone = ''): void => {
      const stat = el('div', `stat${tone ? ` stat--${tone}` : ''}`);
      stat.appendChild(el('div', 'stat__label', label));
      const v = el('div', 'stat__value', value);
      if (unit) v.appendChild(el('span', 'stat__unit', unit));
      stat.appendChild(v);
      stats.appendChild(stat);
    };

    const solution = report.solution;
    const tipTone = report.tipG <= 0 ? 'bad' : report.tipG < 0.4 ? 'warn' : 'good';
    const sagTone = solution.sag < 1 ? 'warn' : 'good';

    add('Top speed', report.topSpeed.toFixed(1), 'm/s');
    add('Wheel torque', report.totalTorque.toFixed(1), 'N\u00b7m');
    add('Tips at', report.tipG > 0 ? report.tipG.toFixed(2) : '\u2014', 'g', tipTone);
    add('Climb', report.maxGrade.toFixed(0), '\u00b0');
    add('Pack', `${solution.volts.toFixed(1)}`, 'V');
    add('Draw', `${solution.demandAmps.toFixed(0)}/${solution.supplyAmps.toFixed(0)}`, 'A', sagTone);
    add('Endurance', report.endurance > 0 ? (report.endurance / 60).toFixed(1) : '\u2014', 'min');
    add('Clearance', (report.groundClearance * 100).toFixed(1), 'cm',
      report.groundClearance <= 0 ? 'bad' : '');
    add('Channels', `${report.channelsUsed}/${report.channelsAvailable}`, '');
    add('Cost', report.cost.toFixed(0), 'cr');

    body.replaceChildren(cls, stats);

    for (const spinner of solution.spinners) {
      const row = el('div', 'weaponline');
      row.appendChild(el('span', 'weaponline__name', spinner.component.name));
      row.appendChild(el('span', 'weaponline__spec',
        spinner.driven
          ? `${spinner.energy.toFixed(0)} J \u00b7 ${spinner.spinUp.toFixed(1)} s \u00b7 ${spinner.tipSpeed.toFixed(0)} m/s tip`
          : 'nothing turning it'));
      body.appendChild(row);
    }
    for (const arm of solution.arms) {
      const row = el('div', 'weaponline');
      row.appendChild(el('span', 'weaponline__name', arm.component.name));
      row.appendChild(el('span', 'weaponline__spec',
        arm.armed ? `${arm.torque.toFixed(0)} N\u00b7m \u00b7 ${arm.bar} bar \u00b7 ${arm.shots} shots` : 'no gas'));
      body.appendChild(row);
    }

    if (report.problems.length > 0) {
      const list = el('div', 'problems');
      for (const problem of report.problems) {
        const item = el('button', `problem problem--${problem.severity}`) as HTMLButtonElement;
        item.appendChild(el('span', 'problem__mark', problem.severity === 'error' ? '!!' : '~'));
        item.appendChild(el('span', '', problem.message));
        // A fault that names a component selects it, so "which one" is never
        // a question you have to answer by hunting round the model.
        if (problem.uid) {
          item.classList.add('problem--locatable');
          item.onclick = (): void => {
            this.bench?.select(problem.uid!);
            this.#renderSchematic();
          };
        } else {
          item.disabled = true;
        }
        list.appendChild(item);
      }
      body.appendChild(list);
    }

    const lessonHost = el('div', '');
    lessonHost.id = 'lesson-host';
    body.appendChild(lessonHost);
    const selected = this.bench ? findComponent(this.bench.selectedComponentId) : undefined;
    if (selected) this.#showLesson(selected);
  }

  #syncDeploy(report: MachineAnalysis): void {
    const deploy = this.#root.querySelector<HTMLButtonElement>('.btn--go');
    if (deploy) deploy.disabled = report.problems.some((p) => p.severity === 'error');
  }

  // ── the dock ─────────────────────────────────────────────────────────────

  #buildBenchDock(): HTMLElement {
    const dock = el('div', 'dock');

    // Phone-only, and first in the row: without these the sheets stay parked
    // off-screen and the catalogue cannot be reached at all.
    dock.appendChild(sheetToggle('PARTS', '.panel--library'));
    dock.appendChild(sheetToggle('CIRCUIT', '.panel--schematic'));
    dock.appendChild(sheetToggle('SPECS', '.panel--readout'));

    // The two gestures, side by side, because they are the whole interaction.
    const tools = el('div', 'toolset');
    for (const [tool, label] of [['PLACE', 'BUILD'], ['LINK', 'WIRE']] as const) {
      const btn = el('button', 'tool') as HTMLButtonElement;
      btn.textContent = label;
      btn.setAttribute('aria-pressed', String(this.bench?.tool === tool));
      btn.onclick = (): void => {
        this.bench?.setTool(tool);
        this.#renderChrome();
      };
      tools.appendChild(btn);
    }
    dock.appendChild(tools);

    const classes = el('select', '') as HTMLSelectElement;
    for (const weight of WEIGHT_CLASSES) {
      classes.appendChild(new Option(`${weight.name}  ${weight.limit} kg`, weight.id));
    }
    classes.value = this.build.weightClass;
    classes.onchange = (): void => {
      this.bench?.setWeightClass(classes.value);
      toast(WEIGHT_CLASSES.find((w) => w.id === classes.value)?.blurb ?? '');
    };
    dock.appendChild(classes);

    const presets = el('select', '') as HTMLSelectElement;
    presets.appendChild(new Option('LOAD MACHINE\u2026', ''));
    for (const machine of MACHINES) presets.appendChild(new Option(machine.name, machine.name));
    presets.onchange = (): void => {
      const found = MACHINES.find((m) => m.name === presets.value);
      if (!found) return;
      this.build = found;
      this.bench?.setBuild(found);
      this.bench?.frameCamera();
      presets.value = '';
      this.#renderChrome();
    };
    dock.appendChild(presets);

    dock.appendChild(button('ROTATE  R', () => this.bench?.rotate()));
    dock.appendChild(button('FRAME', () => this.bench?.frameCamera()));
    dock.appendChild(button('CLEAR', () => this.bench?.clear(), 'btn--danger'));

    const arenaSelect = el('select', '') as HTMLSelectElement;
    for (const spec of ARENAS) arenaSelect.appendChild(new Option(spec.name, spec.id));
    arenaSelect.value = this.arenaSpec.id;
    arenaSelect.onchange = (): void => {
      this.arenaSpec = ARENAS.find((a) => a.id === arenaSelect.value) ?? ARENAS[0]!;
      toast(this.arenaSpec.blurb);
    };
    dock.appendChild(arenaSelect);

    const deploy = button('DEPLOY  \u25b8', () => this.enterArena(), 'btn--go') as HTMLButtonElement;
    deploy.disabled = analyseBuild(this.build).problems.some((p) => p.severity === 'error');
    dock.appendChild(deploy);

    window.addEventListener('keydown', (event) => {
      if (this.mode !== 'WORKSHOP') return;
      if (event.code === 'KeyR') this.bench?.rotate();
      if (event.code === 'KeyW') {
        this.bench?.setTool(this.bench.tool === 'LINK' ? 'PLACE' : 'LINK');
        this.#renderChrome();
      }
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
      // Steering under the left thumb, throttle under the right, the way every
      // driving game on a phone lays it out. A single two-axis stick made one
      // thumb responsible for both, so holding a throttle and correcting a line
      // were the same gesture and every turn came out as a swerve.
      const steering = el('div', 'pad pad--steer');
      steering.appendChild(createTouchButton('◀', (d) => this.controls.setSteer(-1, d), 'touch-btn--steer'));
      steering.appendChild(createTouchButton('▶', (d) => this.controls.setSteer(1, d), 'touch-btn--steer'));
      hud.appendChild(steering);

      const driving = el('div', 'pad pad--drive');
      // Weapon sits above the throttle, reachable without letting go of it.
      driving.appendChild(createTouchButton('WEAPON', (d) => this.controls.setWeapon(d), 'touch-btn--weapon'));
      // Thrusters only appear on a machine that has any.
      // No lift control: nothing in the component catalogue flies. The
      // thrusters the part model carried have no equivalent yet, and a button
      // wired to nothing is worse than a missing one.
      const pedals = el('div', 'pedals');
      pedals.appendChild(createTouchButton('▼', (d) => this.controls.setThrottle(-1, d), 'touch-btn--reverse'));
      pedals.appendChild(createTouchButton('▲', (d) => this.controls.setThrottle(1, d), 'touch-btn--throttle'));
      driving.appendChild(pedals);
      hud.appendChild(driving);
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
    const top = Math.max(1, session.player.plan.topSpeed);
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

/**
 * The player machine's heading as a ground-plane bearing, radians.
 *
 * Taken straight from the chassis rotation rather than from its velocity: a
 * combat robot that reverses away from a spinner is still facing forward, and
 * a velocity-aligned camera would spin to look at its own back.
 */
function headingOf(session: ArenaSession | null): number {
  const chassis = session?.player.chassis;
  if (!chassis) return 0;
  const q = chassis.rotation();
  // The machine's +Z axis, rotated into the world and flattened.
  const x = 2 * (q.x * q.z + q.w * q.y);
  const z = 1 - 2 * (q.x * q.x + q.y * q.y);
  return Math.atan2(x, z);
}

/** Rough bounding radius of a machine, in metres. Used for camera framing. */
function machineRadius(build: Build): number {
  const report = analyseBuild(build);
  let max = 0.2;
  for (const fitted of build.fitted) {
    for (const cell of occupiedCells(fitted)) {
      max = Math.max(
        max,
        Math.hypot(cell.x * CELL - report.centreOfMass.x, cell.z * CELL - report.centreOfMass.z),
      );
    }
  }
  return max;
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

/**
 * The one line under a catalogue entry.
 *
 * Datasheet figures only — Kv, ohms, a ratio, a cell count. Deliberately never
 * a torque or a top speed, because a component does not have one: those depend
 * on the pack behind it and the gearbox in front, and printing a number here
 * would be the catalogue lying about two decisions at once.
 */
function specLine(c: ComponentDef): string {
  const bits = [`${(c.mass * 1000).toFixed(0)} g`];
  if (c.motor) bits.push(`${c.motor.kv} Kv`, `${c.motor.resistance} \u03a9`, `${c.motor.maxCells}S max`);
  if (c.engine) bits.push(`${(c.engine.peakPower / 1000).toFixed(1)} kW`, `${c.engine.peakRpm} rpm`);
  if (c.gearbox) bits.push(`${c.gearbox.ratio}:1`, `${c.gearbox.stages} stage${c.gearbox.stages === 1 ? '' : 's'}`);
  if (c.clutch) bits.push(`${c.clutch.engageRpm} rpm`, `${c.clutch.torqueRating} N\u00b7m`);
  if (c.wheel) bits.push(`${(c.wheel.diameter * 1000).toFixed(0)} mm`, `grip ${c.wheel.grip}`);
  if (c.pack) {
    bits.push(`${c.pack.cells}S`, `${(c.pack.capacity * 1000).toFixed(0)} mAh`, `${c.pack.cRating}C`);
  }
  if (c.esc) bits.push(`${c.esc.maxCells}S`, `${c.esc.maxAmps} A`);
  if (c.receiver) bits.push(`${c.receiver.channels} ch`);
  if (c.spinner) bits.push(`${c.spinner.inertia} kg\u00b7m\u00b2`, `${(c.spinner.reach * 1000).toFixed(0)} mm`);
  if (c.arm) bits.push(`${(c.arm.reach * 1000).toFixed(0)} mm`, `${c.arm.forceRating} N max`);
  if (c.gas) bits.push(`${c.gas.litres} L`, `${c.gas.bar} bar`);
  if (c.regulator) bits.push(`${c.regulator.bar} bar`);
  if (c.tank) bits.push(`${c.tank.litres} L`);
  if (c.category === 'ARMOUR' || c.category === 'STRUCTURE') {
    bits.push(`${(c.integrity / 1000).toFixed(1)} kJ`);
  }
  return bits.join('  \u00b7  ');
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

function save(build: Build): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(build));
  } catch { /* storage may be blocked; losing a save beats losing the session */ }
}

/**
 * The last machine, if there is one and it still makes sense.
 *
 * A save from an older catalogue can name components that no longer exist, and
 * rebuilding it would throw somewhere deep in the solver. Checking here means a
 * stale save costs the player their machine, not their session.
 */
function load(): Build | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Build;
    if (!parsed?.fitted?.length) return null;
    if (!parsed.fitted.every((f) => findComponent(f.componentId))) return null;
    return {
      name: parsed.name ?? 'SAVED MACHINE',
      weightClass: parsed.weightClass ?? 'hobby',
      fitted: parsed.fitted,
      links: parsed.links ?? [],
    };
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
