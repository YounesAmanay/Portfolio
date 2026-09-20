/**
 * The component contract.
 *
 * A component is one real thing you could hold: a motor, a gearbox, a wheel, a
 * battery, a speed controller. It is not a drivetrain. The part model this
 * replaces put a motor, a gearbox, a shaft, a hub, a tyre and a controller in
 * one lattice cell and called it a "Sprint Pod 5:1", which meant the single
 * most consequential decision in a combat robot — the gear ratio — was made
 * for the player before they started.
 *
 * Components connect through **ports**, and nothing turns until a chain is
 * complete. See [`docs/11-machines.md`](../../../docs/11-machines.md) for the
 * model and the equations.
 *
 * What is here is what carries a decision. Wire gauge, connector types, solder
 * joints, screw sizes and bearing part numbers are all real and none of them is
 * a choice, so none of them is modelled.
 */

/**
 * What a port carries.
 *
 * Shafts carry rotation, power carries current, signal carries commands, fuel
 * carries fuel and gas carries pressure. A port only connects to its opposite:
 * `shaft-out` to `shaft-in`, never `shaft-out` to `shaft-out`.
 */
export type PortKind = 'shaft' | 'power' | 'signal' | 'fuel' | 'gas';

export type PortDirection = 'in' | 'out';

export interface Port {
  readonly id: string;
  readonly kind: PortKind;
  readonly direction: PortDirection;
  /** Human label, shown on the schematic. */
  readonly label: string;
}

/** Footprint in lattice cells, as before. */
export interface Footprint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

// ── the roles a component can play ─────────────────────────────────────────

/**
 * An electric motor, described the way its datasheet describes it.
 *
 * Everything the game needs is derived from these four numbers, which is the
 * point: the builder can draw the torque curve because it computed the torque
 * curve, not because someone typed a torque in.
 */
export interface MotorSpec {
  /** Unloaded rpm per volt. The number printed on the can. */
  readonly kv: number;
  /** Winding resistance, ohms. This is what sets stall current. */
  readonly resistance: number;
  /** Current drawn spinning free, amps. */
  readonly noLoadCurrent: number;
  /** Cells this motor will tolerate before it cooks. */
  readonly maxCells: number;
  /** Continuous current before the windings overheat, amps. */
  readonly continuousCurrent: number;
}

/**
 * An internal combustion engine.
 *
 * A genuinely different machine rather than a reskin: torque lives in a band
 * rather than peaking at stall, it cannot idle at zero so it needs a clutch,
 * it cannot reverse, and it burns a tank that empties as the match runs.
 */
export interface EngineSpec {
  /** Peak shaft power, watts. */
  readonly peakPower: number;
  /** The rpm that peak power is quoted at. */
  readonly peakRpm: number;
  /** Below this it stalls, which is why a clutch is compulsory. */
  readonly idleRpm: number;
  /** Fuel burned at peak power, litres per hour. */
  readonly burnRate: number;
}

/** A centrifugal clutch: engages once the engine is spinning fast enough. */
export interface ClutchSpec {
  readonly engageRpm: number;
  readonly torqueRating: number;
}

/**
 * A reduction gearbox.
 *
 * `stages` is not decoration: efficiency compounds per stage, so a three-stage
 * 40:1 box hands on about three quarters of what it is given.
 */
export interface GearboxSpec {
  readonly ratio: number;
  readonly stages: number;
  /** Input torque it survives, N·m. More than this and it strips. */
  readonly torqueRating: number;
  /** True if it can be driven backwards, which an engine needs. */
  readonly reversing: boolean;
}

/** A wheel and its tyre. Diameter multiplies speed and divides torque. */
export interface WheelSpec {
  readonly diameter: number;
  readonly width: number;
  /** Friction along the roll. */
  readonly grip: number;
  /** Friction across it. The gap between the two is how a machine turns. */
  readonly lateralGrip: number;
}

/** A battery pack. Cells set voltage, C rating sets how many amps it can give. */
export interface PackSpec {
  readonly cells: number;
  /** Amp-hours. */
  readonly capacity: number;
  /** Discharge rate as a multiple of capacity. 2.2 Ah at 45C is 99 A. */
  readonly cRating: number;
  /** Volts per cell: 3.7 for LiPo, 3.2 for LiFePO4. */
  readonly cellVolts: number;
}

/** A speed controller. Both ratings are hard limits and both are checked. */
export interface EscSpec {
  readonly maxCells: number;
  readonly maxAmps: number;
}

/** The receiver. How many independent things you can command. */
export interface ReceiverSpec {
  readonly channels: number;
}

/** A fuel tank. Mass that falls as the match runs. */
export interface TankSpec {
  readonly litres: number;
}


/**
 * A spinning weapon: a disc, a bar or a drum.
 *
 * Note what is *not* here — no torque, no spin rate, no damage. A spinner is a
 * lump of steel on a shaft, and what it does depends entirely on the motor and
 * gearbox behind it, exactly as a wheel does. That is the whole reason it is
 * modelled this way: under the old part model a "weapon" arrived with its
 * energy pre-decided, so the most interesting decision in the machine — how
 * hard to gear the thing that has to reach speed before contact — did not
 * exist.
 */
export interface SpinnerSpec {
  readonly kind: 'DISC' | 'BAR' | 'DRUM';
  /** Rotational inertia about its own axis, kg·m². Sets spin-up time. */
  readonly inertia: number;
  /** Radius of the striking edge, m. Sets tip speed and reach. */
  readonly reach: number;
  /** Striking edges per revolution. More bites, each carrying less. */
  readonly teeth: number;
}

/** A hammer or a flipper: an arm on a pivot, thrown by a gas ram. */
export interface ArmSpec {
  readonly kind: 'HAMMER' | 'FLIPPER';
  /** Pivot to head, m. The lever the ram works through. */
  readonly reach: number;
  /** Inertia about the pivot, kg·m². */
  readonly inertia: number;
  /** Ram force it is rated to take, N. More than this and the arm bends. */
  readonly forceRating: number;
}

/**
 * The pneumatic ram built into an arm.
 *
 * Force scales with the pressure it is fed, so the regulator setting is a real
 * decision: crank it up for a harder hit and the bottle empties faster.
 */
export interface RamSpec {
  /** Piston area, m². Force is this times pressure. */
  readonly bore: number;
  readonly stroke: number;
  /** Gas used per shot, litres at atmospheric. */
  readonly displacement: number;
}

/** A gas bottle. Shots, in the end. */
export interface GasSpec {
  /** Stored gas, litres at atmospheric pressure. */
  readonly litres: number;
  /** Bottle pressure, bar. */
  readonly bar: number;
}

/** A regulator. Steps bottle pressure down to something a ram survives. */
export interface RegulatorSpec {
  /** Output pressure, bar. */
  readonly bar: number;
}

// ── the component itself ───────────────────────────────────────────────────

export type ComponentCategory =
  | 'STRUCTURE'
  | 'ARMOUR'
  | 'POWER'
  | 'CONTROL'
  | 'DRIVE'
  | 'TRANSMISSION'
  | 'WHEEL'
  | 'WEAPON'
  | 'UTILITY';

/** Surface finish, as in the render material library. */
export type ComponentFinish =
  | 'steel'
  | 'alloy'
  | 'armour'
  | 'carbon'
  | 'rubber'
  | 'cell'
  | 'polymer'
  | 'copper'
  | 'hardened';

export interface ComponentVisual {
  readonly shape:
    | 'box'
    | 'cylinder'
    | 'wheel'
    | 'motor'
    | 'gearbox'
    | 'engine'
    | 'tank'
    | 'board'
    | 'disc'
    | 'blade'
    | 'hammer'
    | 'flipper';
  readonly colour: string;
  readonly finish?: ComponentFinish;
  readonly emissive?: string;
}

export interface ComponentDef {
  readonly id: string;
  readonly name: string;
  readonly category: ComponentCategory;
  readonly footprint: Footprint;
  /** Kilograms. The thing a weight class actually counts. */
  readonly mass: number;
  /** Impact energy it absorbs before its mount fails, joules. */
  readonly integrity: number;
  readonly cost: number;
  readonly blurb: string;
  /** The one thing this component exists to teach. */
  readonly lesson: string;
  readonly visual: ComponentVisual;

  readonly ports: readonly Port[];

  readonly motor?: MotorSpec;
  readonly engine?: EngineSpec;
  readonly clutch?: ClutchSpec;
  readonly gearbox?: GearboxSpec;
  readonly wheel?: WheelSpec;
  readonly pack?: PackSpec;
  readonly esc?: EscSpec;
  readonly receiver?: ReceiverSpec;
  readonly tank?: TankSpec;
  readonly spinner?: SpinnerSpec;
  readonly arm?: ArmSpec;
  readonly ram?: RamSpec;
  readonly gas?: GasSpec;
  readonly regulator?: RegulatorSpec;
  /** Pure mass, for trimming the centre of gravity. */
  readonly ballast?: boolean;
}

// ── port helpers ───────────────────────────────────────────────────────────

export const port = (id: string, kind: PortKind, direction: PortDirection, label: string): Port => ({
  id,
  kind,
  direction,
  label,
});

export function portsOf(component: ComponentDef, kind: PortKind, direction: PortDirection): readonly Port[] {
  return component.ports.filter((p) => p.kind === kind && p.direction === direction);
}

/** Two ports can be joined if they carry the same thing in opposite directions. */
export function compatible(a: Port, b: Port): boolean {
  return a.kind === b.kind && a.direction !== b.direction;
}

// ── the equations ──────────────────────────────────────────────────────────
//
// All of them from docs/11-machines.md. They live here rather than in the
// solver so that the builder, the simulation and the tests cannot drift into
// disagreeing about what a motor does.

const RPM_TO_RAD = (2 * Math.PI) / 60;

/** Torque constant, N·m per amp, from the Kv on the can. */
export function torqueConstant(motor: MotorSpec): number {
  return 60 / (2 * Math.PI * motor.kv);
}

/** Unloaded speed at a given supply voltage, rad/s. */
export function freeSpeed(motor: MotorSpec, volts: number): number {
  return motor.kv * volts * RPM_TO_RAD;
}

/** Current a stalled motor would pull if nothing limited it, amps. */
export function stallCurrent(motor: MotorSpec, volts: number): number {
  return volts / motor.resistance;
}

/**
 * Torque at zero speed, N·m.
 *
 * `limitAmps` is the controller's ceiling. A stalled motor would pull
 * `V / R` — the ESC is what stops it, and that limit is also what the pack has
 * to supply, so it belongs in the same calculation.
 */
export function stallTorque(motor: MotorSpec, volts: number, limitAmps = Infinity): number {
  const draw = Math.min(stallCurrent(motor, volts), limitAmps);
  return torqueConstant(motor) * Math.max(0, draw - motor.noLoadCurrent);
}

/** Engine torque at a given speed, N·m. Parabolic about its peak. */
export function engineTorque(engine: EngineSpec, rad: number): number {
  const peak = engine.peakRpm * RPM_TO_RAD;
  if (peak <= 0) return 0;
  const offset = (rad - peak) / peak;
  return Math.max(0, (engine.peakPower / peak) * (1 - offset * offset));
}

/** Gearbox efficiency, compounded per stage. */
export function gearboxEfficiency(gearbox: GearboxSpec): number {
  return 0.9 ** gearbox.stages;
}

/** Pack voltage and the current it can actually deliver. */
export function packVoltage(pack: PackSpec): number {
  return pack.cells * pack.cellVolts;
}

export function packCurrent(pack: PackSpec): number {
  return pack.capacity * pack.cRating;
}

export function packEnergy(pack: PackSpec): number {
  return packVoltage(pack) * pack.capacity;
}

/** Bar to pascals. Bottles and regulators are quoted in bar; force is in SI. */
const BAR_TO_PA = 100_000;

/** Ram force at a given regulated pressure, newtons. */
export function ramForce(ram: RamSpec, bar: number): number {
  return ram.bore * bar * BAR_TO_PA;
}

/**
 * Torque a ram develops about an arm's pivot, N·m.
 *
 * The ram pushes near the root of the arm, so it works through a short lever
 * and the head travels far. A quarter of the reach is the usual geometry and
 * is what the arm models here assume.
 */
export function armTorque(arm: ArmSpec, ram: RamSpec, bar: number): number {
  return ramForce(ram, bar) * arm.reach * 0.25;
}

/**
 * Shots in a bottle at a given regulated pressure.
 *
 * Gas is stored compressed and spent expanded, so what matters is volume at
 * pressure: a ram swallowing 0.2 litres per shot at 10 bar is really taking
 * two litres of atmospheric gas out of the bottle.
 */
export function shotsAvailable(gas: GasSpec, ram: RamSpec, bar: number): number {
  const perShot = ram.displacement * bar;
  return perShot > 0 ? Math.floor(gas.litres / perShot) : 0;
}

/**
 * Seconds for a spinner to reach a fraction of its free speed.
 *
 * A motor driving a flywheel approaches free speed exponentially, with a time
 * constant of inertia times free speed over stall torque. This is the number
 * that makes spinning up a decision made before contact rather than during it.
 */
export function spinUpTime(inertia: number, torque: number, free: number, fraction = 0.9): number {
  if (torque <= 0 || free <= 0) return Infinity;
  const tau = (inertia * free) / torque;
  return -tau * Math.log(1 - fraction);
}

/** Kinetic energy stored in a spinner at a given rate, joules. */
export function spinnerEnergy(inertia: number, rad: number): number {
  return 0.5 * inertia * rad * rad;
}
