/**
 * What the mesh builder needs to know about a thing, and nothing more.
 *
 * The renderer used to take a `PartDef` and reach into its behaviour blocks —
 * `part.drive?.radius`, `part.weapon?.kind`, `part.battery !== undefined` —
 * which quietly made the geometry a function of the part model. It is not: a
 * wheel is a radius and a width and a tyre finish, whoever describes it.
 *
 * Both models adapt into this, so a machine assembled from components renders
 * through exactly the same path as one built from parts.
 *
 * It lives under `kinetic` rather than `render` deliberately. It is pure data
 * mapping with no Three.js in it, and the machine plan needs it — putting it
 * in the render layer would drag a WebGL renderer into the physics.
 */

import type { ComponentDef } from './machine/components';
import type { PartDef, PartFinish } from './parts/types';

/** The shapes the mesh builder knows how to draw. */
export type MeshShape =
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
  | 'flipper'
  | 'pod'
  | 'rotor'
  | 'duct'
  | 'dome'
  | 'vent';

export interface MeshPart {
  /** Stable key for geometry and material caches. */
  readonly id: string;
  readonly shape: MeshShape;
  readonly colour: string;
  /** Surface substance. Resolved by the adapter, never guessed here. */
  readonly finish: PartFinish;
  /** Accent colour for lamps and stripes. Never applied to the whole body. */
  readonly emissive?: string;
  /** Tyre geometry, when this thing rolls. */
  readonly wheel?: { readonly radius: number; readonly width: number; readonly driven: boolean };
  /** A saw carries more teeth than a disc. */
  readonly toothy?: boolean;
  /**
   * Striking radius of a spinner, metres.
   *
   * Geometry follows the physics, as everywhere else here: a disc is drawn at
   * the reach the solver swings it through, not at whatever fills its lattice
   * box. A weapon that looks bigger than it hits is the builder lying.
   */
  readonly reach?: number;
  /** How opaque this is, 0..1. Absent means solid. */
  readonly opacity?: number;
  /**
   * Whether this housing has something live inside it.
   *
   * Powered housings get louvres and an indicator; dumb structure does not. A
   * ballast weight with cooling vents in it would be a lie.
   */
  readonly powered?: boolean;
}

const CATEGORY_FINISH: Record<string, PartFinish> = {
  ARMOUR: 'armour',
  STRUCTURE: 'steel',
  POWER: 'cell',
  CONTROL: 'polymer',
  TRANSMISSION: 'alloy',
  DRIVE: 'alloy',
  WHEEL: 'rubber',
  WEAPON: 'hardened',
};

/** The part model's view. Preserves exactly what `finishFor` used to decide. */
export function meshPartOfPart(part: PartDef): MeshPart {
  const rolling = part.drive ?? part.roller;
  const finish: PartFinish =
    part.visual.finish ??
    (part.battery
      ? 'cell'
      : part.weapon
        ? 'hardened'
        : rolling
          ? 'rubber'
          : part.controller
            ? 'polymer'
            : part.thruster
              ? 'alloy'
              : (CATEGORY_FINISH[part.category] ?? 'alloy'));

  return {
    id: part.id,
    shape: part.visual.shape as MeshShape,
    colour: part.visual.colour,
    finish,
    ...(part.visual.emissive !== undefined ? { emissive: part.visual.emissive } : {}),
    ...(rolling
      ? { wheel: { radius: rolling.radius, width: rolling.width, driven: part.drive !== undefined } }
      : {}),
    ...(part.weapon?.kind === 'SAW' ? { toothy: true } : {}),
    ...(part.battery !== undefined || part.controller !== undefined ? { powered: true } : {}),
  };
}

/**
 * The component model's view.
 *
 * A component says what it is made of outright — there is no guessing from a
 * behaviour block, because `finish` is a field on every entry in the
 * catalogue. Whether a wheel is driven is not a property of the wheel, so it
 * is passed in from the solve.
 */
export function meshPartOfComponent(component: ComponentDef, driven = false): MeshPart {
  const finish: PartFinish =
    (component.visual.finish as PartFinish | undefined) ??
    (CATEGORY_FINISH[component.category] ?? 'alloy');

  return {
    id: component.id,
    shape: component.visual.shape as MeshShape,
    colour: component.visual.colour,
    finish,
    ...(component.visual.emissive !== undefined ? { emissive: component.visual.emissive } : {}),
    ...(component.wheel
      ? { wheel: { radius: component.wheel.diameter / 2, width: component.wheel.width, driven } }
      : {}),
    ...(component.pack || component.esc || component.receiver ? { powered: true } : {}),
    ...(component.spinner ? { reach: component.spinner.reach } : {}),
    ...(component.visual.opacity !== undefined ? { opacity: component.visual.opacity } : {}),
  };
}
