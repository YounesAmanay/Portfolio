/**
 * Laying a machine out as a circuit diagram.
 *
 * Every real builder works with CAD in one window and a wiring diagram in the
 * other, because the two answer different questions: the model tells you what
 * fits, and the schematic tells you what is connected. A builder that only
 * shows you the model makes you hold the circuit in your head, and that is
 * precisely where mistakes live — a motor that looks bolted in but was never
 * wired to anything looks completely correct from every angle.
 *
 * This is the layout only: nodes, ranks and edges, with no drawing in it. The
 * renderer turns it into SVG, the tests check the topology, and neither has an
 * opinion about the other.
 */

import { componentOf, toMachine, type Build } from './build';
import type { PortKind } from './components';
import { solve, type Fault } from './solver';

/** What a node is for, which is what decides how it is drawn. */
export type NodeRole =
  | 'SOURCE'      // pack, bottle, tank — where energy comes from
  | 'CONTROL'     // receiver, ESC, regulator — what meters it
  | 'CONVERTER'   // motor, engine — what turns it into torque
  | 'TRANSMISSION'// gearbox, clutch — what changes it
  | 'OUTPUT'      // wheel, spinner, arm — what does the work
  | 'PASSIVE';    // structure, armour, ballast — on the machine, not in a chain

export interface SchematicNode {
  readonly uid: string;
  readonly label: string;
  readonly role: NodeRole;
  /** Column, counted in links from the nearest source. */
  readonly rank: number;
  /** Row within the column. */
  readonly row: number;
  /** One line of the figure that matters most for this node. */
  readonly detail: string;
  /** True when this node is named by an error. */
  readonly faulted: boolean;
}

export interface SchematicEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: PortKind;
}

export interface Schematic {
  readonly nodes: readonly SchematicNode[];
  readonly edges: readonly SchematicEdge[];
  /** Widest column count, for sizing the drawing. */
  readonly columns: number;
  readonly rows: number;
  readonly faults: readonly Fault[];
}

function roleOf(uid: string, build: Build): NodeRole {
  const c = componentOf(build.fitted.find((f) => f.uid === uid)!);
  if (c.pack || c.gas || c.tank) return 'SOURCE';
  if (c.esc || c.receiver || c.regulator) return 'CONTROL';
  if (c.motor || c.engine) return 'CONVERTER';
  if (c.gearbox || c.clutch) return 'TRANSMISSION';
  if (c.wheel || c.spinner || c.arm) return 'OUTPUT';
  return 'PASSIVE';
}

/**
 * Ranks a node by the longest path from a source.
 *
 * Longest rather than shortest on purpose: a pack feeding both an ESC and,
 * through it, a motor should put the motor two columns along, not one. Taking
 * the shortest path would stack them and the diagram would stop reading as a
 * chain.
 */
function rankNodes(uids: readonly string[], edges: readonly SchematicEdge[]): Map<string, number> {
  const incoming = new Map<string, string[]>();
  for (const uid of uids) incoming.set(uid, []);
  for (const edge of edges) incoming.get(edge.to)?.push(edge.from);

  const rank = new Map<string, number>();
  // Depth-first with a visiting set, so a machine wired in a loop settles at a
  // rank instead of recursing forever. A loop is a mistake a player can make.
  const visiting = new Set<string>();

  const resolve = (uid: string): number => {
    const known = rank.get(uid);
    if (known !== undefined) return known;
    if (visiting.has(uid)) return 0;

    visiting.add(uid);
    let deepest = 0;
    for (const from of incoming.get(uid) ?? []) {
      deepest = Math.max(deepest, resolve(from) + 1);
    }
    visiting.delete(uid);
    rank.set(uid, deepest);
    return deepest;
  };

  for (const uid of uids) resolve(uid);
  return rank;
}

/** One line worth reading about each node, taken from the solve. */
function detailOf(uid: string, build: Build, solution: ReturnType<typeof solve>): string {
  const fitted = build.fitted.find((f) => f.uid === uid);
  if (!fitted) return '';
  const c = componentOf(fitted);

  const wheel = solution.wheels.find((w) => w.uid === uid);
  if (wheel) {
    return wheel.driven
      ? `${wheel.wheelTorque.toFixed(2)} N·m · ${(wheel.freeSpeed * wheel.radius).toFixed(1)} m/s`
      : 'idler';
  }
  const spinner = solution.spinners.find((s) => s.uid === uid);
  if (spinner) {
    return spinner.driven
      ? `${spinner.energy.toFixed(0)} J · ${spinner.spinUp.toFixed(1)} s to speed`
      : 'not driven';
  }
  const arm = solution.arms.find((a) => a.uid === uid);
  if (arm) return arm.armed ? `${arm.torque.toFixed(0)} N·m · ${arm.shots} shots` : 'no gas';

  if (c.pack) return `${solution.volts.toFixed(1)} V · ${(c.pack.capacity * c.pack.cRating).toFixed(0)} A`;
  if (c.esc) return `${c.esc.maxCells}S · ${c.esc.maxAmps} A`;
  if (c.motor) return `${c.motor.kv} Kv · ${c.motor.resistance} Ω`;
  if (c.engine) return `${(c.engine.peakPower / 1000).toFixed(1)} kW @ ${c.engine.peakRpm}`;
  if (c.gearbox) return `${c.gearbox.ratio}:1 · ${c.gearbox.stages} stage${c.gearbox.stages === 1 ? '' : 's'}`;
  if (c.clutch) return `engages ${c.clutch.engageRpm} rpm`;
  if (c.receiver) return `${c.receiver.channels} channels`;
  if (c.gas) return `${c.gas.litres} L @ ${c.gas.bar} bar`;
  if (c.regulator) return `${c.regulator.bar} bar out`;
  if (c.tank) return `${c.tank.litres} L`;
  return `${(c.mass * 1000).toFixed(0)} g`;
}

/**
 * Builds the diagram.
 *
 * Passive components are left out entirely. A chassis plate is on the machine
 * but it is not in a chain, and drawing twelve of them alongside the circuit
 * would bury the thing the diagram exists to show.
 */
export function schematicOf(build: Build): Schematic {
  const solution = solve(toMachine(build));
  const faultedUids = new Set(
    solution.faults.filter((f) => f.severity === 'error' && f.uid).map((f) => f.uid!),
  );

  const edges: SchematicEdge[] = [];
  for (const link of build.links) {
    const from = build.fitted.find((f) => f.uid === link.from);
    if (!from) continue;
    const port = componentOf(from).ports.find((p) => p.id === link.fromPort);
    if (!port) continue;
    edges.push({ from: link.from, to: link.to, kind: port.kind });
  }

  const linked = new Set<string>();
  for (const edge of edges) {
    linked.add(edge.from);
    linked.add(edge.to);
  }

  // Anything in a chain, plus anything that could be but is not yet — an
  // unwired motor is exactly what the diagram needs to show.
  const uids = build.fitted
    .filter((f) => linked.has(f.uid) || roleOf(f.uid, build) !== 'PASSIVE')
    .map((f) => f.uid);
  const included = new Set(uids);
  const kept = edges.filter((e) => included.has(e.from) && included.has(e.to));

  const rank = rankNodes(uids, kept);
  const perColumn = new Map<number, number>();

  const nodes: SchematicNode[] = uids.map((uid) => {
    const column = rank.get(uid) ?? 0;
    const row = perColumn.get(column) ?? 0;
    perColumn.set(column, row + 1);
    const fitted = build.fitted.find((f) => f.uid === uid)!;
    return {
      uid,
      label: componentOf(fitted).name,
      role: roleOf(uid, build),
      rank: column,
      row,
      detail: detailOf(uid, build, solution),
      faulted: faultedUids.has(uid),
    };
  });

  return {
    nodes,
    edges: kept,
    columns: nodes.reduce((most, n) => Math.max(most, n.rank + 1), 0),
    rows: [...perColumn.values()].reduce((most, n) => Math.max(most, n), 0),
    faults: solution.faults,
  };
}
