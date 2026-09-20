/**
 * The machine solver.
 *
 * Walks the two chains a machine is assembled from — battery to ESC to motor,
 * and motor to gearbox to wheel — and works out what each wheel actually does.
 * Nothing in the game reads torque or speed off a component any more; both are
 * derived here from the datasheet figures through the equations in
 * `components.ts`.
 *
 * This is the single source of those numbers on purpose. The builder shows the
 * player what the solver produced and the simulation integrates what the
 * solver produced, so the two cannot drift apart. The whole design exists to
 * prevent the builder lying, and two code paths computing "top speed"
 * separately is precisely how a builder starts lying.
 */

import {
  armTorque,
  freeSpeed,
  gearboxEfficiency,
  packCurrent,
  packEnergy,
  packVoltage,
  shotsAvailable,
  spinUpTime,
  spinnerEnergy,
  stallCurrent,
  stallTorque,
  type ComponentDef,
} from './components';

/** One placed component, by instance id. */
export interface Installed {
  readonly uid: string;
  readonly component: ComponentDef;
}

/** A join between two ports on two instances. */
export interface Link {
  readonly from: string;
  readonly fromPort: string;
  readonly to: string;
  readonly toPort: string;
}

export interface Machine {
  readonly installed: readonly Installed[];
  readonly links: readonly Link[];
}

export type FaultSeverity = 'error' | 'warning';

export interface Fault {
  readonly severity: FaultSeverity;
  /** The instance the fault is about, when it is about one. */
  readonly uid?: string;
  readonly message: string;
}

/**
 * What one wheel ends up doing.
 *
 * These are exactly the fields the simulation needs, and they are the same
 * ones the readout shows.
 */
export interface SolvedWheel {
  readonly uid: string;
  readonly wheel: ComponentDef;
  /** Driven wheels have a source; idlers and casters do not. */
  readonly driven: boolean;
  /** Torque at the contact patch at zero speed, N·m. */
  readonly wheelTorque: number;
  /** Wheel speed with nothing loading it, rad/s. */
  readonly freeSpeed: number;
  readonly radius: number;
  readonly width: number;
  readonly grip: number;
  readonly lateralGrip: number;
  /** Peak electrical draw of whatever drives it, watts. */
  readonly peakWatts: number;
  /** Peak current of whatever drives it, amps. */
  readonly peakAmps: number;
  /**
   * Mass of everything that turns with this wheel, kg: the wheel itself plus
   * the motor and gearboxes driving it.
   *
   * The simulation needs it because a rolling contact is a separate rigid
   * body, and how heavy that body is decides how violently it responds to a
   * friction impulse. A bare 90 g wheel on a 4 kg machine is barely there.
   */
  readonly drivelineMass: number;
}

/**
 * What one spinning weapon ends up doing.
 *
 * A spinner is a wheel that never touches the ground: the same motor, the same
 * gearbox, the same chain, and the same solve. What differs is which numbers
 * matter — a wheel cares about torque at the patch, a spinner cares about how
 * long it takes to get to speed and how much energy it holds when it arrives.
 */
export interface SolvedSpinner {
  readonly uid: string;
  readonly component: ComponentDef;
  readonly driven: boolean;
  /** Torque at the weapon shaft, N·m. */
  readonly torque: number;
  /** Rate with nothing loading it, rad/s. */
  readonly freeSpeed: number;
  readonly inertia: number;
  readonly reach: number;
  readonly teeth: number;
  /** Seconds to reach nine tenths of free speed. */
  readonly spinUp: number;
  /** Kinetic energy at free speed, joules. */
  readonly energy: number;
  /** Speed of the striking edge at free speed, m/s. */
  readonly tipSpeed: number;
  readonly peakAmps: number;
}

/** What one arm weapon ends up doing. */
export interface SolvedArm {
  readonly uid: string;
  readonly component: ComponentDef;
  readonly armed: boolean;
  readonly kind: 'HAMMER' | 'FLIPPER';
  /** Torque about the pivot, N·m. */
  readonly torque: number;
  readonly reach: number;
  readonly inertia: number;
  /** Regulated pressure it fires at, bar. */
  readonly bar: number;
  /** Firings before the bottle is empty. */
  readonly shots: number;
}

export interface Solution {
  readonly wheels: readonly SolvedWheel[];
  readonly spinners: readonly SolvedSpinner[];
  readonly arms: readonly SolvedArm[];
  readonly faults: readonly Fault[];
  /** Supply voltage, or 0 with no pack. */
  readonly volts: number;
  /** What the pack can deliver, amps. */
  readonly supplyAmps: number;
  /** What the machine asks for with everything at stall, amps. */
  readonly demandAmps: number;
  /** Supply over demand, capped at 1. Below 1 the machine sags. */
  readonly sag: number;
  /** Stored energy, W·h. */
  readonly energy: number;
  readonly mass: number;
  /** Fuel aboard, litres. */
  readonly fuel: number;
}

// ── graph ──────────────────────────────────────────────────────────────────

interface Graph {
  readonly byUid: Map<string, Installed>;
  /** For an instance, everything joined to its `in` ports. */
  readonly upstream: Map<string, string[]>;
  /** For an instance, everything joined to its `out` ports. */
  readonly downstream: Map<string, string[]>;
}

function buildGraph(machine: Machine): Graph {
  const byUid = new Map(machine.installed.map((i) => [i.uid, i]));
  const upstream = new Map<string, string[]>();
  const downstream = new Map<string, string[]>();

  for (const link of machine.links) {
    if (!byUid.has(link.from) || !byUid.has(link.to)) continue;
    push(downstream, link.from, link.to);
    push(upstream, link.to, link.from);
  }
  return { byUid, upstream, downstream };
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Walks upstream from an instance until it finds one the predicate accepts.
 *
 * Breadth-first, and it refuses to revisit: a machine wired in a loop is a
 * mistake a player can make, and it must produce a fault rather than a hang.
 */
function findUpstream(
  graph: Graph,
  start: string,
  accept: (installed: Installed) => boolean,
  path: string[] = [],
): { found: Installed | null; path: string[] } {
  const seen = new Set<string>([start]);
  const queue: { uid: string; trail: string[] }[] = [{ uid: start, trail: path }];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    for (const from of graph.upstream.get(next.uid) ?? []) {
      if (seen.has(from)) continue;
      seen.add(from);
      const installed = graph.byUid.get(from);
      if (!installed) continue;
      const trail = [...next.trail, from];
      if (accept(installed)) return { found: installed, path: trail };
      queue.push({ uid: from, trail });
    }
  }
  return { found: null, path: [] };
}

// ── the solve ──────────────────────────────────────────────────────────────

/** What a shaft chain delivers at its far end. */
interface Driven {
  readonly torque: number;
  readonly speed: number;
  readonly amps: number;
  /** Mass of the source and everything between it and the target, kg. */
  readonly mass: number;
}

export function solve(machine: Machine): Solution {
  const graph = buildGraph(machine);
  const faults: Fault[] = [];

  // One motor can turn several things, so the same chain gets walked more than
  // once and would report the same fault each time. Faults are deduplicated as
  // they are raised: a player reading "this gearbox will strip" four times
  // learns nothing they did not learn the first time.
  const seenFaults = new Set<string>();
  const note = (fault: Fault): void => {
    const key = `${fault.severity}|${fault.uid ?? ''}|${fault.message}`;
    if (seenFaults.has(key)) return;
    seenFaults.add(key);
    faults.push(fault);
  };

  const isWheel = (uid: string): boolean => graph.byUid.get(uid)?.component.wheel !== undefined;

  const mass = machine.installed.reduce((total, i) => total + i.component.mass, 0);
  const fuel = machine.installed.reduce((total, i) => total + (i.component.tank?.litres ?? 0), 0);

  // ── the pack ────────────────────────────────────────────────────────────
  const packs = machine.installed.filter((i) => i.component.pack !== undefined);
  const volts = packs.reduce((highest, i) => Math.max(highest, packVoltage(i.component.pack!)), 0);
  const supplyAmps = packs.reduce((total, i) => total + packCurrent(i.component.pack!), 0);
  const energy = packs.reduce((total, i) => total + packEnergy(i.component.pack!), 0);

  const cells = packs.reduce((highest, i) => Math.max(highest, i.component.pack!.cells), 0);

  // ── every shaft-driven thing ────────────────────────────────────────────
  //
  // A wheel and a spinner are the same solve. Both hang off a chain that ends
  // at a motor or an engine, and the only difference is which numbers you want
  // out of the far end — torque at the contact patch, or how long the disc
  // takes to reach speed. Walking that chain once, here, is what keeps them
  // from drifting apart.
  const counted = new Set<string>();
  let demandAmps = 0;

  const traceShaft = (targetUid: string): Driven | null => {
    const source = findUpstream(
      graph,
      targetUid,
      (i) => i.component.motor !== undefined || i.component.engine !== undefined,
    );
    if (!source.found) return null;

    // The chain from the source down to the target, in that order. `path` is
    // built target-first and its last entry is the source itself.
    const chain = [...source.path].reverse().slice(1);
    const driver = source.found;
    let shaftTorque = 0;
    let shaftSpeed = 0;
    let amps = 0;

    if (driver.component.motor) {
      const motor = driver.component.motor;
      // The ESC is what actually limits current, so find it before asking the
      // motor what it can do.
      const controller = findUpstream(graph, driver.uid, (i) => i.component.esc !== undefined);
      const limit = controller.found?.component.esc?.maxAmps ?? Infinity;

      if (!controller.found) {
        note({
          severity: 'error',
          uid: driver.uid,
          message: `${driver.component.name} is not wired to a speed controller.`,
        });
      } else if (volts === 0) {
        note({ severity: 'error', uid: driver.uid, message: 'No battery reaches this motor.' });
      }

      shaftTorque = stallTorque(motor, volts, limit);
      shaftSpeed = freeSpeed(motor, volts);
      amps = Math.min(stallCurrent(motor, volts), limit);

      if (cells > motor.maxCells) {
        note({
          severity: 'error',
          uid: driver.uid,
          message: `${driver.component.name} is rated ${motor.maxCells}S, the pack is ${cells}S.`,
        });
      }
      if (controller.found?.component.esc && cells > controller.found.component.esc.maxCells) {
        note({
          severity: 'error',
          uid: controller.found.uid,
          message: `${controller.found.component.name} is rated ${controller.found.component.esc.maxCells}S, the pack is ${cells}S.`,
        });
      }
      if (amps > motor.continuousCurrent) {
        note({
          severity: 'warning',
          uid: driver.uid,
          message:
            `${driver.component.name} can pull ${amps.toFixed(0)} A against a continuous rating of ` +
            `${motor.continuousCurrent} A. It will overheat if you hold it stalled.`,
        });
      }
    } else if (driver.component.engine) {
      const engine = driver.component.engine;
      // An engine makes its torque in a band rather than at stall, so the
      // figure that matters is what it makes at its peak.
      const peak = (engine.peakRpm * 2 * Math.PI) / 60;
      shaftTorque = engine.peakPower / peak;
      shaftSpeed = peak;

      const clutch = findUpstream(graph, targetUid, (i) => i.component.clutch !== undefined);
      if (!clutch.found) {
        note({
          severity: 'error',
          uid: driver.uid,
          message: `${driver.component.name} has no clutch. An engine cannot start against load.`,
        });
      }
      const tank = findUpstream(graph, driver.uid, (i) => i.component.tank !== undefined);
      if (!tank.found) {
        note({ severity: 'error', uid: driver.uid, message: `${driver.component.name} has no fuel tank.` });
      }
      if (isWheel(targetUid)) {
        const reversing = source.path.some((uid) => graph.byUid.get(uid)?.component.gearbox?.reversing === true);
        if (!reversing) {
          note({
            severity: 'warning',
            uid: driver.uid,
            message: 'No reversing gearbox: this machine cannot back up.',
          });
        }
      }
    }

    // Walk the chain, multiplying torque up and dividing speed down, checking
    // each link against the torque it is actually handed. Checking the motor's
    // own output instead would clear a 40:1 box sitting behind a 4:1 one, and
    // that is precisely the build that strips.
    let torque = shaftTorque;
    let speed = shaftSpeed;
    for (const uid of chain) {
      const link = graph.byUid.get(uid)?.component;
      if (!link) continue;
      const rating = link.gearbox?.torqueRating ?? link.clutch?.torqueRating;
      if (rating !== undefined && torque > rating) {
        note({
          severity: 'error',
          uid,
          message:
            `${link.name} is handed ${torque.toFixed(2)} N\u00b7m against a rating of ` +
            `${rating} N\u00b7m. It will strip.`,
        });
      }
      if (link.gearbox) {
        torque *= link.gearbox.ratio * gearboxEfficiency(link.gearbox);
        speed /= link.gearbox.ratio;
      }
    }

    // Per source, not per target: one motor driving two wheels through a
    // differential draws one motor's worth of current, not two.
    if (!counted.has(driver.uid)) {
      counted.add(driver.uid);
      demandAmps += amps;
    }

    const mass =
      driver.component.mass +
      chain.reduce((total, uid) => total + (graph.byUid.get(uid)?.component.mass ?? 0), 0);

    return { torque, speed, amps, mass };
  };

  const wheels: SolvedWheel[] = [];
  for (const installed of machine.installed) {
    const spec = installed.component.wheel;
    if (!spec) continue;

    const radius = spec.diameter / 2;
    const idle: SolvedWheel = {
      uid: installed.uid,
      wheel: installed.component,
      driven: false,
      wheelTorque: 0,
      freeSpeed: 0,
      radius,
      width: spec.width,
      grip: spec.grip,
      lateralGrip: spec.lateralGrip,
      peakWatts: 0,
      peakAmps: 0,
      drivelineMass: installed.component.mass,
    };

    const driven = traceShaft(installed.uid);
    if (!driven) {
      wheels.push(idle);
      continue;
    }
    wheels.push({
      ...idle,
      driven: true,
      wheelTorque: driven.torque,
      freeSpeed: driven.speed,
      peakWatts: driven.amps * volts,
      peakAmps: driven.amps,
      drivelineMass: installed.component.mass + driven.mass,
    });
  }

  // ── spinning weapons ────────────────────────────────────────────────────
  const spinners: SolvedSpinner[] = [];
  for (const installed of machine.installed) {
    const spec = installed.component.spinner;
    if (!spec) continue;

    const driven = traceShaft(installed.uid);
    const torque = driven?.torque ?? 0;
    const free = driven?.speed ?? 0;

    if (!driven) {
      note({
        severity: 'error',
        uid: installed.uid,
        message: `${installed.component.name} has nothing turning it.`,
      });
    }

    const up = spinUpTime(spec.inertia, torque, free);
    if (driven && up > 20) {
      note({
        severity: 'warning',
        uid: installed.uid,
        message:
          `${installed.component.name} takes ${up.toFixed(0)} s to reach speed. ` +
          'Gear it lower or fit a bigger motor — a match is shorter than that.',
      });
    }

    spinners.push({
      uid: installed.uid,
      component: installed.component,
      driven: driven !== null,
      torque,
      freeSpeed: free,
      inertia: spec.inertia,
      reach: spec.reach,
      teeth: spec.teeth,
      spinUp: up,
      energy: spinnerEnergy(spec.inertia, free),
      tipSpeed: free * spec.reach,
      peakAmps: driven?.amps ?? 0,
    });
  }

  // ── arm weapons, on the gas chain ───────────────────────────────────────
  //
  // A third chain, and the shortest: bottle to regulator to ram. The
  // regulator setting is the decision — crank it up for a harder hit and the
  // bottle empties faster.
  const arms: SolvedArm[] = [];
  for (const installed of machine.installed) {
    const spec = installed.component.arm;
    const ram = installed.component.ram;
    if (!spec || !ram) continue;

    const regulator = findUpstream(graph, installed.uid, (i) => i.component.regulator !== undefined);
    const bottle = findUpstream(graph, installed.uid, (i) => i.component.gas !== undefined);
    const bar = regulator.found?.component.regulator?.bar ?? 0;

    if (!regulator.found) {
      note({
        severity: 'error',
        uid: installed.uid,
        message: `${installed.component.name} has no regulator. Bottle pressure would burst the ram.`,
      });
    }
    if (!bottle.found) {
      note({ severity: 'error', uid: installed.uid, message: `${installed.component.name} has no gas bottle.` });
    }

    const torque = armTorque(spec, ram, bar);
    const force = bar > 0 ? torque / (spec.reach * 0.25) : 0;
    if (force > spec.forceRating) {
      note({
        severity: 'error',
        uid: installed.uid,
        message:
          `${installed.component.name} is fed ${bar} bar, which is ${force.toFixed(0)} N against a ` +
          `${spec.forceRating} N arm. Turn the regulator down.`,
      });
    }

    const bottleGas = bottle.found?.component.gas;
    const shots = bottleGas && bar > 0 ? shotsAvailable(bottleGas, ram, bar) : 0;
    if (bottle.found && shots < 4 && shots > 0) {
      note({
        severity: 'warning',
        uid: installed.uid,
        message: `Only ${shots} shots at ${bar} bar. A bigger bottle, or less pressure.`,
      });
    }

    arms.push({
      uid: installed.uid,
      component: installed.component,
      armed: regulator.found !== null && bottle.found !== null,
      kind: spec.kind,
      torque,
      reach: spec.reach,
      inertia: spec.inertia,
      bar,
      shots,
    });
  }

  // ── machine-wide checks ─────────────────────────────────────────────────
  if (machine.installed.length > 0) {
    if (packs.length === 0 && !machine.installed.some((i) => i.component.engine)) {
      note({ severity: 'error', message: 'No battery and no engine. Nothing will turn.' });
    }
    if (!machine.installed.some((i) => i.component.receiver)) {
      note({ severity: 'error', message: 'No receiver. Nothing can be commanded.' });
    }
    if (!wheels.some((w) => w.driven)) {
      note({ severity: 'error', message: 'Nothing drives a wheel. This will sit where you drop it.' });
    }
    for (const installed of machine.installed) {
      if (installed.component.gearbox && (graph.downstream.get(installed.uid) ?? []).length === 0) {
        note({
          severity: 'warning',
          uid: installed.uid,
          message: `${installed.component.name} drives nothing.`,
        });
      }
    }
  }

  const sag = demandAmps > 0 && supplyAmps > 0 ? Math.min(1, supplyAmps / demandAmps) : 1;
  if (supplyAmps > 0 && demandAmps > supplyAmps) {
    note({
      severity: 'warning',
      message:
        `Peak draw ${demandAmps.toFixed(0)} A, pack delivers ${supplyAmps.toFixed(0)} A — ` +
        `it will sag to ${(sag * 100).toFixed(0)}% under load.`,
    });
  }

  return { wheels, spinners, arms, faults, volts, supplyAmps, demandAmps, sag, energy, mass, fuel };
}
