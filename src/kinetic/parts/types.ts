/**
 * The part contract.
 *
 * A part is a physical object: it has a size in lattice cells, a mass, and an
 * integrity in joules. What it *does* is expressed by one optional behaviour
 * block — a part is a motor, or a battery, or a weapon, never a bag of stats.
 *
 * The simulation reads the behaviour blocks; it never asks what kind of robot
 * this is. That is what lets a quadcopter, a tank and a monowheel come out of
 * the same system with no special cases.
 */

export type PartCategory =
  | 'STRUCTURE'
  | 'ARMOUR'
  | 'POWER'
  | 'DRIVE'
  | 'WHEEL'
  | 'THRUST'
  | 'WEAPON'
  | 'CONTROL'
  | 'UTILITY';

/** Size in lattice cells. */
export interface Footprint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Which control channel an actuator listens to. */
export type Channel = 'DRIVE' | 'STEER' | 'LIFT' | 'WEAPON' | 'AUX1' | 'AUX2';

/**
 * A powered wheel: motor, gearbox and tyre as one pod, which is how real
 * combat and competition robots are actually built.
 */
export interface DriveSpec {
  /** Torque delivered at the wheel after gearing, N·m. */
  readonly wheelTorque: number;
  /** Free-running wheel speed after gearing, rad/s. */
  readonly freeSpeed: number;
  /** Wheel radius, m. */
  readonly radius: number;
  /** Wheel width, m. */
  readonly width: number;
  /** Tyre friction coefficient against the arena floor. */
  readonly grip: number;
  /** Lateral grip as a fraction of forward grip. Omni wheels slide sideways. */
  readonly lateralGrip: number;
  /** Peak electrical draw at stall, W. */
  readonly peakWatts: number;
  /** Continuous torque before the motor starts heating, as a fraction of peak. */
  readonly thermalLimit: number;
  readonly channel: Channel;
}

/** A free-spinning wheel or caster: support without drive. */
export interface RollerSpec {
  readonly radius: number;
  readonly width: number;
  readonly grip: number;
  readonly steerable: boolean;
}

export interface BatterySpec {
  /** Usable energy, W·h. */
  readonly capacity: number;
  /** Peak sustained output before voltage sag, W. */
  readonly peakWatts: number;
}

export interface ThrusterSpec {
  /** Maximum thrust, N. */
  readonly thrust: number;
  readonly peakWatts: number;
  readonly channel: Channel;
}

export type WeaponKind = 'SPINNER' | 'FLIPPER' | 'HAMMER' | 'SAW';

export interface WeaponSpec {
  readonly kind: WeaponKind;
  /** Moment of inertia of the spinning mass, kg·m^2. Spinners only. */
  readonly inertia?: number;
  /** Maximum angular velocity, rad/s. Spinners only. */
  readonly maxSpin?: number;
  /** Spin-up torque, N·m, or impulse in N·s for flippers and hammers. */
  readonly drive: number;
  readonly peakWatts: number;
  /** Reach beyond the part's own bounds, m. */
  readonly reach: number;
  readonly channel: Channel;
}

export interface ControllerSpec {
  /** How many independent channels this design can command. */
  readonly channels: number;
  /** Active stabilisation strength, 0 for none. */
  readonly stabilisation: number;
}

/** How the part is drawn. Geometry is procedural — no asset pipeline. */
/**
 * What a component is made of.
 *
 * The finish owns the surface entirely — its maps, its metalness and its
 * roughness — so those are not repeated per part. A part says what it is made
 * of and what colour it is painted; how aluminium behaves under light is a
 * property of aluminium, not of this particular bracket.
 */
export type PartFinish =
  | 'steel'
  | 'alloy'
  | 'armour'
  | 'carbon'
  | 'rubber'
  | 'cell'
  | 'polymer'
  | 'copper'
  | 'hardened';

export interface VisualSpec {
  readonly shape:
    | 'box'
    | 'cylinder'
    | 'wheel'
    | 'disc'
    | 'rotor'
    | 'dome'
    | 'blade'
    | 'hammer'
    | 'flipper'
    | 'duct';
  /** Tints the finish's albedo. */
  readonly colour: string;
  /** Defaults from the part's category and fittings when omitted. */
  readonly finish?: PartFinish;
  /** Emissive accent, for powered parts. */
  readonly emissive?: string;
}

export interface PartDef {
  readonly id: string;
  readonly name: string;
  readonly category: PartCategory;
  readonly footprint: Footprint;
  /** kg. */
  readonly mass: number;
  /** Impact energy this part absorbs before failing, J. */
  readonly integrity: number;
  readonly cost: number;
  readonly blurb: string;
  /** The single line a player should take away. */
  readonly lesson: string;
  readonly visual: VisualSpec;

  readonly drive?: DriveSpec;
  readonly roller?: RollerSpec;
  readonly battery?: BatterySpec;
  readonly thruster?: ThrusterSpec;
  readonly weapon?: WeaponSpec;
  readonly controller?: ControllerSpec;
  /** Pure mass for trimming centre of gravity. */
  readonly ballast?: boolean;
}

/** Volume in cells, used for density and packing readouts. */
export function cellVolume(part: PartDef): number {
  return part.footprint.x * part.footprint.y * part.footprint.z;
}

export function isActuator(part: PartDef): boolean {
  return Boolean(part.drive || part.thruster || part.weapon);
}
