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
  freeSpeed,
  gearboxEfficiency,
  packCurrent,
  packEnergy,
  packVoltage,
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
}

export interface Solution {
  readonly wheels: readonly SolvedWheel[];
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

export function solve(machine: Machine): Solution {
  const graph = buildGraph(machine);
  const faults: Fault[] = [];

  const mass = machine.installed.reduce((total, i) => total + i.component.mass, 0);
  const fuel = machine.installed.reduce((total, i) => total + (i.component.tank?.litres ?? 0), 0);

  // ── the pack ────────────────────────────────────────────────────────────
  const packs = machine.installed.filter((i) => i.component.pack !== undefined);
  const volts = packs.reduce((highest, i) => Math.max(highest, packVoltage(i.component.pack!)), 0);
  const supplyAmps = packs.reduce((total, i) => total + packCurrent(i.component.pack!), 0);
  const energy = packs.reduce((total, i) => total + packEnergy(i.component.pack!), 0);

  const cells = packs.reduce((highest, i) => Math.max(highest, i.component.pack!.cells), 0);

  // ── every wheel, driven or not ──────────────────────────────────────────
  const wheels: SolvedWheel[] = [];
  const counted = new Set<string>();
  let demandAmps = 0;

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
    };

    // Trace the drive chain back from the wheel to whatever turns it.
    const source = findUpstream(graph, installed.uid, (i) => i.component.motor !== undefined || i.component.engine !== undefined);
    if (!source.found) {
      wheels.push(idle);
      continue;
    }

    // The chain from the source down to the wheel, in that order. `path` is
    // built wheel-first, and its last entry is the source itself.
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
        faults.push({
          severity: 'error',
          uid: driver.uid,
          message: `${driver.component.name} is not wired to a speed controller.`,
        });
      } else if (volts === 0) {
        faults.push({ severity: 'error', uid: driver.uid, message: 'No battery reaches this motor.' });
      }

      shaftTorque = stallTorque(motor, volts, limit);
      shaftSpeed = freeSpeed(motor, volts);
      amps = Math.min(stallCurrent(motor, volts), limit);

      if (cells > motor.maxCells) {
        faults.push({
          severity: 'error',
          uid: driver.uid,
          message: `${driver.component.name} is rated ${motor.maxCells}S, the pack is ${cells}S.`,
        });
      }
      if (controller.found?.component.esc && cells > controller.found.component.esc.maxCells) {
        faults.push({
          severity: 'error',
          uid: controller.found.uid,
          message: `${controller.found.component.name} is rated ${controller.found.component.esc.maxCells}S, the pack is ${cells}S.`,
        });
      }
      if (amps > motor.continuousCurrent) {
        faults.push({
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

      const clutch = findUpstream(graph, installed.uid, (i) => i.component.clutch !== undefined);
      if (!clutch.found) {
        faults.push({
          severity: 'error',
          uid: driver.uid,
          message: `${driver.component.name} has no clutch. An engine cannot start against load.`,
        });
      }
      const tank = findUpstream(graph, driver.uid, (i) => i.component.tank !== undefined);
      if (!tank.found) {
        faults.push({ severity: 'error', uid: driver.uid, message: `${driver.component.name} has no fuel tank.` });
      }
      const reversing = source.path.some((uid) => graph.byUid.get(uid)?.component.gearbox?.reversing === true);
      if (!reversing) {
        faults.push({
          severity: 'warning',
          uid: driver.uid,
          message: 'No reversing gearbox: this machine cannot back up.',
        });
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
        faults.push({
          severity: 'error',
          uid,
          message:
            `${link.name} is handed ${torque.toFixed(2)} N·m against a rating of ` +
            `${rating} N·m. It will strip.`,
        });
      }
      if (link.gearbox) {
        torque *= link.gearbox.ratio * gearboxEfficiency(link.gearbox);
        speed /= link.gearbox.ratio;
      }
    }

    // Per source, not per wheel: one motor driving two wheels through a
    // differential draws one motor's worth of current, not two.
    if (!counted.has(driver.uid)) {
      counted.add(driver.uid);
      demandAmps += amps;
    }

    wheels.push({
      ...idle,
      driven: true,
      wheelTorque: torque,
      freeSpeed: speed,
      peakWatts: amps * volts,
      peakAmps: amps,
    });
  }

  // ── machine-wide checks ─────────────────────────────────────────────────
  if (machine.installed.length > 0) {
    if (packs.length === 0 && !machine.installed.some((i) => i.component.engine)) {
      faults.push({ severity: 'error', message: 'No battery and no engine. Nothing will turn.' });
    }
    if (!machine.installed.some((i) => i.component.receiver)) {
      faults.push({ severity: 'error', message: 'No receiver. Nothing can be commanded.' });
    }
    if (!wheels.some((w) => w.driven)) {
      faults.push({ severity: 'error', message: 'Nothing drives a wheel. This will sit where you drop it.' });
    }
    for (const installed of machine.installed) {
      if (installed.component.gearbox && (graph.downstream.get(installed.uid) ?? []).length === 0) {
        faults.push({
          severity: 'warning',
          uid: installed.uid,
          message: `${installed.component.name} drives nothing.`,
        });
      }
    }
  }

  const sag = demandAmps > 0 && supplyAmps > 0 ? Math.min(1, supplyAmps / demandAmps) : 1;
  if (supplyAmps > 0 && demandAmps > supplyAmps) {
    faults.push({
      severity: 'warning',
      message:
        `Peak draw ${demandAmps.toFixed(0)} A, pack delivers ${supplyAmps.toFixed(0)} A — ` +
        `it will sag to ${(sag * 100).toFixed(0)}% under load.`,
    });
  }

  return { wheels, faults, volts, supplyAmps, demandAmps, sag, energy, mass, fuel };
}
