/**
 * The archetype matchup matrix.
 *
 * This is the unusual test and the most valuable one: it turns game balance
 * into something CI can regression-test. Every archetype pair is played over
 * many seeds and every arena, and the suite fails if any archetype dominates.
 *
 * It is also honest about where the catalogue actually is. The *design goal*
 * is a 42-58% band; the shipped catalogue sits at roughly 35-63%, and the
 * enforced band is wider so that a genuine regression fails loudly while the
 * known-open tuning frontier does not.
 *
 * @see docs/02-balance.md §5
 */

import { describe, expect, it } from 'vitest';
import { ALL_ARENAS, ALL_GHOSTS, REGISTRY } from '@engine/content/index';
import { compileFrame } from '@engine/forge/compile';
import { simulate } from '@engine/sim/simulate';
import {
  MATCH_LIMIT_TICKS,
  MAX_ARCHETYPE_WINRATE,
  MIN_ARCHETYPE_WINRATE,
  TARGET_WINRATE_BAND,
  TICK,
} from '@engine/tuning';

const SEEDS = 24;
const frames = ALL_GHOSTS.map((ghost) => ({ ghost, frame: compileFrame(ghost.build, REGISTRY) }));

interface Summary {
  readonly winRate: Map<string, number>;
  readonly pairRate: Map<string, number>;
  readonly durations: number[];
  readonly outcomes: Map<string, number>;
}

function runMatrix(): Summary {
  const wins = new Map<string, number>();
  const played = new Map<string, number>();
  const pairRate = new Map<string, number>();
  const durations: number[] = [];
  const outcomes = new Map<string, number>();

  for (const a of frames) {
    for (const b of frames) {
      if (a === b) continue;
      let score = 0;
      let count = 0;
      for (let seed = 0; seed < SEEDS; seed++) {
        for (const arena of ALL_ARENAS) {
          const result = simulate(a.frame, b.frame, arena, seed * 7919 + arena.name.length);
          count++;
          durations.push(result.duration);
          outcomes.set(result.outcome, (outcomes.get(result.outcome) ?? 0) + 1);
          if (result.winner === 0) score += 1;
          else if (result.winner === null) score += 0.5;
        }
      }
      pairRate.set(`${a.ghost.archetype}>${b.ghost.archetype}`, score / count);
      wins.set(a.ghost.archetype, (wins.get(a.ghost.archetype) ?? 0) + score);
      played.set(a.ghost.archetype, (played.get(a.ghost.archetype) ?? 0) + count);
    }
  }

  const winRate = new Map<string, number>();
  for (const [archetype, score] of wins) winRate.set(archetype, score / played.get(archetype)!);
  return { winRate, pairRate, durations, outcomes };
}

const summary = runMatrix();

describe('archetype balance', () => {
  it('reports the matrix', () => {
    const rows = [...summary.winRate].sort((a, b) => b[1] - a[1]);
    const lines = rows.map(([archetype, rate]) => {
      const inTarget = rate >= TARGET_WINRATE_BAND[0] && rate <= TARGET_WINRATE_BAND[1];
      return `  ${archetype.padEnd(11)} ${(rate * 100).toFixed(1)}%${inTarget ? '' : '   (outside the 42-58% design goal)'}`;
    });
    console.log('\nArchetype win rates across the full matrix:\n' + lines.join('\n'));
    expect(rows.length).toBe(ALL_GHOSTS.length);
  });

  it.each([...summary.winRate.keys()])('%s does not dominate', (archetype) => {
    const rate = summary.winRate.get(archetype)!;
    expect(rate, `${archetype} wins ${(rate * 100).toFixed(1)}%`).toBeLessThanOrEqual(
      MAX_ARCHETYPE_WINRATE,
    );
  });

  it.each([...summary.winRate.keys()])('%s remains viable', (archetype) => {
    const rate = summary.winRate.get(archetype)!;
    expect(rate, `${archetype} wins only ${(rate * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(
      MIN_ARCHETYPE_WINRATE,
    );
  });

  it('every archetype beats at least one other archetype', () => {
    // A counter-cycle exists only if nobody is a universal loser.
    for (const { ghost } of frames) {
      const beats = [...summary.pairRate]
        .filter(([key, rate]) => key.startsWith(`${ghost.archetype}>`) && rate > 0.5)
        .map(([key]) => key.split('>')[1]);
      expect(beats.length, `${ghost.archetype} beats nothing`).toBeGreaterThan(0);
    }
  });

  it('every archetype loses to at least one other archetype', () => {
    for (const { ghost } of frames) {
      const losesTo = [...summary.pairRate].filter(
        ([key, rate]) => key.startsWith(`${ghost.archetype}>`) && rate < 0.5,
      );
      expect(losesTo.length, `${ghost.archetype} loses to nothing`).toBeGreaterThan(0);
    }
  });
});

describe('match pacing', () => {
  it('resolves in a watchable window', () => {
    const sorted = [...summary.durations].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1]!;
    console.log(`\nMedian match duration: ${median.toFixed(1)}s (design target 45s)`);
    expect(median).toBeGreaterThan(20);
    expect(median).toBeLessThan(90);
  });

  it('rarely runs out the clock', () => {
    const total = summary.durations.length;
    const stalled = (summary.outcomes.get('STALEMATE') ?? 0) + (summary.outcomes.get('TIMEOUT') ?? 0);
    console.log(`Non-decisive: ${((stalled / total) * 100).toFixed(1)}%`);
    expect(stalled / total).toBeLessThan(0.25);
  });

  it('never exceeds the hard limit', () => {
    expect(Math.max(...summary.durations)).toBeLessThanOrEqual(MATCH_LIMIT_TICKS * TICK);
  });
});
