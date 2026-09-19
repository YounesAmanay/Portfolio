/**
 * Credits, rewards and salvage.
 *
 * The one design commitment worth calling out: **losing always pays**. A
 * ladder that pays nothing for a close loss teaches players to dodge hard
 * matches, which is the opposite of what a build-centric game needs.
 *
 * @see docs/01-rules.md §12.2
 */

import { chance, pick, type Rng } from '../core/rng';
import type { PartId } from '../domain/ids';
import { BASE_REWARD, DAMAGE_BONUS, LOSS_REWARD_RATIO, SALVAGE_CHANCE } from '../tuning';

export interface RewardInput {
  readonly won: boolean;
  /** Fraction of the opponent's structure destroyed, 0–1. */
  readonly damageRatio: number;
  readonly rating: number;
  readonly opponentRating: number;
  /** Parts the opponent had installed — the salvage pool. */
  readonly opponentParts: readonly PartId[];
  /** Parts already owned; salvage never duplicates. */
  readonly ownedParts: readonly PartId[];
}

export interface Reward {
  readonly credits: number;
  readonly baseCredits: number;
  readonly damageCredits: number;
  readonly upsetBonus: number;
  readonly salvage: PartId | null;
}

export function computeReward(input: RewardInput, rng: Rng): Reward {
  const baseCredits = Math.round(BASE_REWARD * (input.won ? 1 : LOSS_REWARD_RATIO));
  const damageCredits = Math.round(clamp01(input.damageRatio) * DAMAGE_BONUS);
  const upsetBonus = input.won
    ? Math.max(0, Math.round((input.opponentRating - input.rating) / 10))
    : 0;

  const salvage = rollSalvage(input, rng);

  return {
    credits: baseCredits + damageCredits + upsetBonus,
    baseCredits,
    damageCredits,
    upsetBonus,
    salvage,
  };
}

/** Salvage only on a win, only parts you do not already own. */
function rollSalvage(input: RewardInput, rng: Rng): PartId | null {
  if (!input.won) return null;
  if (!chance(rng, SALVAGE_CHANCE)) return null;
  const owned = new Set(input.ownedParts);
  const pool = input.opponentParts.filter((id) => !owned.has(id));
  return pool.length === 0 ? null : (pick(rng, pool) ?? null);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Can this Architect afford and unlock a part? */
export interface PurchaseCheck {
  readonly affordable: boolean;
  readonly unlocked: boolean;
  readonly reason: string | null;
}

const TIER_UNLOCK_RATING: Readonly<Record<number, number>> = {
  1: 0,
  2: 1000,
  3: 1250,
  4: 1500,
  5: 1800,
};

export function checkPurchase(
  price: number,
  tier: number,
  credits: number,
  rating: number,
): PurchaseCheck {
  const required = TIER_UNLOCK_RATING[tier] ?? 0;
  const unlocked = rating >= required;
  const affordable = credits >= price;
  if (!unlocked) return { affordable, unlocked, reason: `Requires rating ${required}.` };
  if (!affordable) return { affordable, unlocked, reason: `Need ${price - credits} more credits.` };
  return { affordable, unlocked, reason: null };
}

export { TIER_UNLOCK_RATING };
