/**
 * Elo rating.
 *
 * Standard Elo with a K-factor that decays as rating rises, so the top of the
 * ladder is stable while new Architects converge quickly. @see docs/01-rules.md §12.1
 */

import {
  ELO_ELITE_THRESHOLD,
  ELO_FLOOR,
  ELO_HIGH_THRESHOLD,
  ELO_K_DEFAULT,
  ELO_K_ELITE,
  ELO_K_HIGH,
  ELO_K_PROVISIONAL,
  ELO_PROVISIONAL_MATCHES,
} from '../tuning';

export type MatchScore = 0 | 0.5 | 1;

/** Probability that `rating` beats `opponentRating`. */
export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

/** K-factor. Provisional players move fast; elite players move slowly. */
export function kFactor(rating: number, matchesPlayed: number): number {
  if (matchesPlayed < ELO_PROVISIONAL_MATCHES) return ELO_K_PROVISIONAL;
  if (rating >= ELO_ELITE_THRESHOLD) return ELO_K_ELITE;
  if (rating >= ELO_HIGH_THRESHOLD) return ELO_K_HIGH;
  return ELO_K_DEFAULT;
}

export interface RatingChange {
  readonly before: number;
  readonly after: number;
  readonly delta: number;
  readonly expected: number;
}

export function updateRating(
  rating: number,
  opponentRating: number,
  score: MatchScore,
  matchesPlayed: number,
): RatingChange {
  const expected = expectedScore(rating, opponentRating);
  const k = kFactor(rating, matchesPlayed);
  const after = Math.max(ELO_FLOOR, Math.round(rating + k * (score - expected)));
  return { before: rating, after, delta: after - rating, expected };
}

/** Human-readable band, used for ladder display. */
export function ratingBand(rating: number): string {
  if (rating >= 2400) return 'ARCHON';
  if (rating >= 2000) return 'PRIME';
  if (rating >= 1700) return 'ASCENDANT';
  if (rating >= 1400) return 'ADEPT';
  if (rating >= 1150) return 'OPERATOR';
  return 'INITIATE';
}
