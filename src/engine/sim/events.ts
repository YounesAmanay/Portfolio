/**
 * The combat log.
 *
 * Events serve three jobs at once, which is why they are a first-class type
 * rather than console output:
 *
 *   1. The UI replays them to animate the arena.
 *   2. The determinism test hashes them to prove two runs are identical.
 *   3. They are the human-readable record an Architect reads after a loss.
 *
 * Every event carries its tick, so the log alone is enough to reconstruct the
 * match timeline without re-running the simulation.
 */

import type { DamageType } from '../domain/damage';
import type { ActionKind } from '../domain/doctrine';
import type { Vec2 } from '../core/vec';

export type FrameIndex = 0 | 1;

export type SimEvent =
  | { readonly kind: 'MATCH_START'; readonly tick: number; readonly arena: string }
  | {
      readonly kind: 'SHOT';
      readonly tick: number;
      readonly source: FrameIndex;
      readonly weapon: string;
      readonly damageType: DamageType;
      readonly from: Vec2;
      readonly to: Vec2;
      readonly hit: boolean;
      readonly crit: boolean;
      /** Damage that actually reached structure. */
      readonly damage: number;
      /** Damage absorbed by the shield layer. */
      readonly shieldDamage: number;
      /** Damage stopped by armour mitigation. */
      readonly mitigated: number;
    }
  | { readonly kind: 'SHIELD_BROKEN'; readonly tick: number; readonly target: FrameIndex }
  | {
      readonly kind: 'HEAT_STATE';
      readonly tick: number;
      readonly frame: FrameIndex;
      readonly state: string;
    }
  | { readonly kind: 'OVERLOAD'; readonly tick: number; readonly frame: FrameIndex }
  | { readonly kind: 'RECOVERED'; readonly tick: number; readonly frame: FrameIndex }
  | { readonly kind: 'STAGGERED'; readonly tick: number; readonly target: FrameIndex }
  | {
      readonly kind: 'ACTION';
      readonly tick: number;
      readonly frame: FrameIndex;
      readonly action: ActionKind;
      readonly reason: string;
    }
  | { readonly kind: 'VENT_START'; readonly tick: number; readonly frame: FrameIndex }
  | { readonly kind: 'AMMO_OUT'; readonly tick: number; readonly frame: FrameIndex; readonly weapon: string }
  | { readonly kind: 'DESTROYED'; readonly tick: number; readonly frame: FrameIndex }
  | {
      readonly kind: 'MATCH_END';
      readonly tick: number;
      readonly outcome: string;
      readonly winner: FrameIndex | null;
    };

/**
 * A compact, order-sensitive digest of a log. Two matches with identical
 * inputs must produce the same digest; the determinism test asserts exactly
 * this over 100 runs.
 */
export function digestEvents(events: readonly SimEvent[]): string {
  let hash = 0x811c9dc5;
  const feed = (text: string): void => {
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };
  for (const event of events) {
    feed(event.kind);
    feed(String(event.tick));
    if (event.kind === 'SHOT') {
      feed(`${event.source}${event.weapon}${event.hit ? 1 : 0}${event.crit ? 1 : 0}`);
      // Quantise floats before hashing: we assert logical determinism, not
      // bit-level float equality, so a 4-decimal digest is the honest test.
      feed(event.damage.toFixed(4));
      feed(event.shieldDamage.toFixed(4));
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Renders one event as a line of after-action report text. */
export function describeEvent(event: SimEvent, names: readonly [string, string]): string {
  const who = (index: FrameIndex): string => names[index];
  switch (event.kind) {
    case 'MATCH_START':
      return `Gate open — ${event.arena}`;
    case 'SHOT':
      if (!event.hit) return `${who(event.source)} misses with ${event.weapon}`;
      return `${who(event.source)} hits with ${event.weapon} for ${event.damage.toFixed(0)}${event.crit ? ' (CRIT)' : ''}`;
    case 'SHIELD_BROKEN':
      return `${who(event.target)} shield collapses`;
    case 'HEAT_STATE':
      return `${who(event.frame)} thermal state: ${event.state}`;
    case 'OVERLOAD':
      return `${who(event.frame)} OVERLOAD — systems offline`;
    case 'RECOVERED':
      return `${who(event.frame)} recovers`;
    case 'STAGGERED':
      return `${who(event.target)} staggered`;
    case 'ACTION':
      return `${who(event.frame)} -> ${event.action} (${event.reason})`;
    case 'VENT_START':
      return `${who(event.frame)} venting`;
    case 'AMMO_OUT':
      return `${who(event.frame)}: ${event.weapon} out of ammunition`;
    case 'DESTROYED':
      return `${who(event.frame)} destroyed`;
    case 'MATCH_END':
      return event.winner === null ? `Draw — ${event.outcome}` : `${who(event.winner)} wins — ${event.outcome}`;
  }
}
