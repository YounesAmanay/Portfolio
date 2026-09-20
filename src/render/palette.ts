/**
 * The art direction.
 *
 * The reference is the toy-plastic language mobile battle-bot games use, and
 * it is a deliberate move away from where this started. The machines were
 * rendered as brushed aluminium with procedural wear and scratches, lit by a
 * dark arena rig — physically careful, and almost unreadable. At the size a
 * machine actually occupies on screen, grit reads as noise: four dark grey
 * boxes on a dark grey deck in a dark grey room.
 *
 * So the rules changed:
 *
 * **Saturated flat plastic, not metal.** A part is one strong colour with a
 * soft highlight. Colour is what separates a motor from a gearbox at a glance,
 * and a wear map cannot do that job.
 *
 * **Colour carries meaning.** Every category has a hue, and it is the same hue
 * in the catalogue list, on the model, in the schematic and on the part card.
 * Learning that orange is drive is worth more than any amount of surface
 * detail.
 *
 * **Bright set, dark parts.** The workshop is a white studio, so a machine
 * reads as a silhouette against it. The arena is dark, so the same machine
 * reads as a lit object against that. The parts do not change; the room does.
 *
 * The geometry stays exactly as detailed as it was — stator gaps, bolt
 * circles, pin headers. Detail in the silhouette survives being shrunk;
 * detail in the texture does not.
 */

/** Category hues. The machine's own vocabulary, used everywhere. */
export const HUE = {
  structure: '#3a7bd5',
  armour: '#eef3f8',
  armourHeavy: '#7d8ca3',
  drive: '#ff8a1e',
  transmission: '#9aa8bd',
  wheel: '#23272f',
  power: '#31c46a',
  control: '#14b8c4',
  weapon: '#e8452e',
  weaponEdge: '#ffc220',
  utility: '#a566e8',
  fuel: '#c9d3e0',
} as const;

/**
 * How each finish behaves as moulded plastic.
 *
 * Metalness stays low almost everywhere on purpose. A metal surface takes its
 * colour from what it reflects, so a chassis at metalness 1 is whatever colour
 * the room is — which is exactly how a catalogue of nine distinct hues turned
 * into nine identical grey boxes.
 */
export interface ToySpec {
  readonly metalness: number;
  readonly roughness: number;
}

export const TOY_FINISH: Record<string, ToySpec> = {
  steel: { metalness: 0.22, roughness: 0.38 },
  alloy: { metalness: 0.18, roughness: 0.34 },
  armour: { metalness: 0.04, roughness: 0.46 },
  carbon: { metalness: 0.1, roughness: 0.44 },
  rubber: { metalness: 0.0, roughness: 0.74 },
  cell: { metalness: 0.05, roughness: 0.42 },
  polymer: { metalness: 0.0, roughness: 0.48 },
  copper: { metalness: 0.42, roughness: 0.28 },
  hardened: { metalness: 0.34, roughness: 0.26 },
};

/**
 * The outline that makes it a toy.
 *
 * A dark edge round every part is the single strongest tell of this style, and
 * it does real work: on a machine that is a dozen components bolted together,
 * an outline is what stops the motor, the gearbox and the wheel behind it
 * merging into one shape.
 *
 * Drawn as an inverted hull — the same mesh, scaled along its normals, with
 * front faces culled — because it costs one extra draw call per part and needs
 * no post-processing pass at all.
 */
export const OUTLINE_COLOUR = '#0d1117';
/**
 * Shell thickness in metres. A lattice cell is 80 mm, so this is ~4 mm.
 *
 * Set at 1.5 mm first and it was invisible: at the distance you inspect a
 * machine from, that is under a pixel. An outline either reads or it is not
 * there, and there is no point paying for a draw call in between.
 */
export const OUTLINE_WIDTH = 0.004;

/** The workshop set: a white cyclorama, the way a product shot is lit. */
export const STUDIO = {
  /**
   * Not white.
   *
   * A near-white set with a bright key washed every colour out — a royal blue
   * chassis came back pale grey-blue and the whole machine read as ghostly.
   * The set has to sit a clear step below the parts in value for them to read
   * against it, so it is a light blue-grey and the parts keep their hue.
   */
  background: '#cdd9e9',
  floor: '#dde6f2',
  podium: '#eef3f9',
  podiumRim: '#a9bbd2',
  fog: '#dfe7f1',
} as const;
