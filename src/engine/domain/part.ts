/**
 * THE PART CONTRACT — the plugin interface the whole game is built on.
 *
 * The engine knows only this interface. It has no idea what a "railgun" is;
 * it knows there is a part whose `weapon` profile says it deals 82 KINETIC at
 * 55m. Adding content therefore never requires editing engine code.
 *
 * Three escalating levels of expressiveness, so simple parts stay simple:
 *
 *   1. `grants`  — declarative stat contributions.     ~90% of the catalogue.
 *   2. `weapon`  — a WeaponProfile record.             Anything that fires.
 *   3. `hooks`   — pure functions over sim events.     Protocols and exotica.
 *
 * @see docs/03-architecture.md §3
 * @see docs/04-authoring-parts.md
 */

import type { DamageType, House } from './damage';
import type { PartId } from './ids';
import type { SocketKind } from './sockets';
import type { StatGrant } from './stats';

export type Tier = 1 | 2 | 3 | 4 | 5;

/** What a part takes from the three build budgets. Always non-negative. */
export interface ResourceCost {
  readonly mass: number;
  readonly powerDraw: number;
  readonly cycleDraw: number;
}

/**
 * What a part *provides* to the budgets. Cores are the usual source, but this
 * is deliberately open: an auxiliary generator module that supplies power at a
 * mass cost is a legal and interesting part, and needs no new engine concept.
 */
export interface ResourceSupply {
  readonly power: number;
  readonly cycles: number;
}

/** Range behaviour. @see docs/01-rules.md §5.2 */
export interface RangeProfile {
  readonly minRange: number;
  readonly optimalRange: number;
  readonly maxRange: number;
  /** Accuracy multiplier at maxRange. Beams ~0.75, ballistics ~0.55, shotguns ~0.35. */
  readonly falloff: number;
}

/** Everything the combat pipeline needs to resolve one weapon. */
export interface WeaponProfile {
  readonly damageType: DamageType;
  readonly damage: number;
  /** Projectiles per volley. */
  readonly shots: number;
  /** Seconds between volleys. */
  readonly cooldown: number;
  /** Seconds between shots within a volley. */
  readonly burstDelay: number;
  readonly range: RangeProfile;
  /** Base accuracy score before targeting and range scaling. */
  readonly accuracy: number;
  readonly heatCost: number;
  readonly energyCost: number;
  /** Fraction of target armour ignored, 0–1. */
  readonly pierce: number;
  /** Kinetic stagger contribution per shot. */
  readonly stagger: number;
  /** Rounds carried. `Infinity` for energy weapons. */
  readonly magazine: number;
  /** Can fire without line of sight (mortars, missiles). */
  readonly arcing: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks — level 3
// ─────────────────────────────────────────────────────────────────────────────

/** A read-only snapshot of one frame, as hooks see it. */
export interface FrameView {
  readonly structure: number;
  readonly maxStructure: number;
  readonly structureRatio: number;
  readonly shield: number;
  readonly maxShield: number;
  readonly heat: number;
  readonly heatRatio: number;
  readonly energy: number;
  readonly energyRatio: number;
  readonly armour: number;
  readonly overloaded: boolean;
  readonly elapsed: number;
}

/**
 * Per-match, per-part scratch space.
 *
 * A few parts need memory (a once-per-match purge, a damage counter that
 * adapts armour). Closing over module-level state would share it between every
 * frame and every match, which would silently destroy determinism. Instead the
 * simulation owns one of these per part per frame, creates it at match start,
 * and discards it at the end.
 */
export type HookMemory = Record<string, number>;

export interface DamageContext {
  readonly self: FrameView;
  readonly opponent: FrameView;
  readonly damageType: DamageType;
  readonly raw: number;
  readonly distance: number;
  readonly memory: HookMemory;
}

/** Multiplicative adjustments a hook may request. Absent = no change. */
export interface DamageModifier {
  readonly damageMult?: number;
  readonly pierceBonus?: number;
  readonly critChanceBonus?: number;
  readonly accuracyMult?: number;
  readonly armourMult?: number;
}

export interface TickContext {
  readonly self: FrameView;
  readonly opponent: FrameView;
  readonly tick: number;
  readonly distance: number;
  readonly memory: HookMemory;
}

/**
 * A requested change to match state. Hooks return these; only `sim/apply.ts`
 * enacts them. Collected effects are sorted by part id before application so
 * the result is independent of hook evaluation order.
 */
export type SimEffect =
  | { readonly kind: 'heat'; readonly delta: number }
  | { readonly kind: 'heatGenMult'; readonly value: number }
  | { readonly kind: 'energy'; readonly delta: number }
  | { readonly kind: 'structure'; readonly delta: number }
  | { readonly kind: 'shield'; readonly delta: number }
  | { readonly kind: 'armour'; readonly delta: number }
  | { readonly kind: 'evasionBonus'; readonly value: number; readonly duration: number }
  | { readonly kind: 'damageMult'; readonly value: number }
  | { readonly kind: 'log'; readonly message: string };

export interface EventContext extends TickContext {
  readonly event: PartEventKind;
}

export type PartEventKind =
  | 'SHIELD_BROKEN'
  | 'ENTERED_CRITICAL'
  | 'ENTERED_OVERLOAD'
  | 'DEALT_DAMAGE'
  | 'TOOK_DAMAGE'
  | 'STAGGERED';

/**
 * Optional simulation hooks. Every hook is pure: it reads a context and
 * returns a description of what it wants, never mutating anything.
 */
export interface PartHooks {
  readonly modifyOutgoingDamage?: (ctx: DamageContext) => DamageModifier;
  readonly modifyIncomingDamage?: (ctx: DamageContext) => DamageModifier;
  readonly onTick?: (ctx: TickContext) => readonly SimEffect[];
  readonly onEvent?: (ctx: EventContext) => readonly SimEffect[];
}

// ─────────────────────────────────────────────────────────────────────────────
// The part itself
// ─────────────────────────────────────────────────────────────────────────────

export interface Part {
  readonly id: PartId;
  readonly name: string;
  readonly socket: SocketKind;
  readonly house: House;
  readonly tier: Tier;
  readonly cost: ResourceCost;
  /** Budget contribution. Absent means this part supplies nothing. */
  readonly supply?: ResourceSupply;
  readonly grants: StatGrant;
  readonly weapon?: WeaponProfile;
  readonly hooks?: PartHooks;
  /** Flavour text. Shown in the Forge. */
  readonly description: string;
  /** Credit price. Tier I parts are 0 (granted at start). */
  readonly price: number;
}

/**
 * A chassis is not a part — it is the frame parts plug *into*. It is the only
 * choice that defines the shape of the problem rather than solving part of it.
 */
export interface Chassis {
  readonly id: PartId;
  readonly name: string;
  readonly house: House;
  readonly tier: Tier;
  readonly mass: number;
  readonly massLimit: number;
  readonly structure: number;
  /** Collision radius in metres. Bigger frames are easier to corner. */
  readonly radius: number;
  readonly sockets: Readonly<Partial<Record<SocketKind, number>>>;
  /**
   * Innate frame traits. This is what stops socket count from being the whole
   * story: a chassis with more mounts pays for them here. Without it, "more
   * sockets" was simply "more of everything", and the fortress dominated.
   */
  readonly grants?: StatGrant;
  readonly description: string;
  readonly price: number;
}

/** Narrowing helper: a part that can shoot. */
export interface WeaponPart extends Part {
  readonly weapon: WeaponProfile;
}

export function isWeapon(part: Part): part is WeaponPart {
  return part.weapon !== undefined;
}

/** Convenience for content files: most parts draw nothing from most budgets. */
export function cost(mass: number, powerDraw = 0, cycleDraw = 0): ResourceCost {
  return { mass, powerDraw, cycleDraw };
}

/** Convenience for cores and generators. */
export function supply(power: number, cycles: number): ResourceSupply {
  return { power, cycles };
}
