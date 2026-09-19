/**
 * Determinism.
 *
 * The product promise is that a match is a pure function of its inputs. If
 * this test fails, replays are worthless, balance runs are noise, and results
 * cannot be verified. Everything else in the design assumes it holds.
 */

import { describe, expect, it } from 'vitest';
import { ALL_ARENAS, ALL_GHOSTS, REGISTRY } from '@engine/content/index';
import { compileFrame } from '@engine/forge/compile';
import { digestEvents } from '@engine/sim/events';
import { simulate } from '@engine/sim/simulate';
import { createRng, next } from '@engine/core/rng';

const frames = ALL_GHOSTS.map((ghost) => compileFrame(ghost.build, REGISTRY));
const arena = ALL_ARENAS[0]!;

describe('determinism', () => {
  it('produces an identical event log across 100 runs of the same inputs', () => {
    const [a, b] = [frames[0]!, frames[1]!];
    const reference = digestEvents(simulate(a, b, arena, 20260919).events);
    for (let run = 0; run < 100; run++) {
      expect(digestEvents(simulate(a, b, arena, 20260919).events)).toBe(reference);
    }
  });

  it('produces identical telemetry, not just identical logs', () => {
    const [a, b] = [frames[2]!, frames[3]!];
    const first = simulate(a, b, arena, 7);
    const second = simulate(a, b, arena, 7);
    expect(second.telemetry).toEqual(first.telemetry);
    expect(second.ticks).toBe(first.ticks);
    expect(second.winner).toBe(first.winner);
  });

  it('gives different results for different seeds', () => {
    const [a, b] = [frames[0]!, frames[4]!];
    const digests = new Set<string>();
    for (let seed = 0; seed < 25; seed++) {
      digests.add(digestEvents(simulate(a, b, arena, seed).events));
    }
    // Not every seed must differ, but a seed that changes nothing would mean
    // the RNG is not actually threaded through the simulation.
    expect(digests.size).toBeGreaterThan(5);
  });

  it('is unaffected by the order matches are run in', () => {
    const pairs: [number, number][] = [[0, 1], [2, 3], [1, 4], [3, 0]];
    const forward = pairs.map(([i, j]) => digestEvents(simulate(frames[i]!, frames[j]!, arena, 99).events));
    const backward = [...pairs].reverse().map(([i, j]) =>
      digestEvents(simulate(frames[i]!, frames[j]!, arena, 99).events),
    );
    expect(backward.reverse()).toEqual(forward);
  });

  it('does not leak state between matches through stateful protocol hooks', () => {
    // HOLLOW carries TARGET_ANALYSIS and PHASE_SHIFT; ANVIL carries two
    // protocols of its own. Running the same match twice in a row must give
    // the same answer even though hooks keep per-match memory.
    const a = frames[3]!;
    const b = frames[2]!;
    const first = simulate(a, b, arena, 555);
    simulate(a, b, arena, 12345); // interleave an unrelated match
    const second = simulate(a, b, arena, 555);
    expect(digestEvents(second.events)).toBe(digestEvents(first.events));
  });

  it('threads every arena deterministically', () => {
    for (const each of ALL_ARENAS) {
      const one = digestEvents(simulate(frames[0]!, frames[2]!, each, 31337).events);
      const two = digestEvents(simulate(frames[0]!, frames[2]!, each, 31337).events);
      expect(two).toBe(one);
    }
  });
});

describe('rng', () => {
  it('is reproducible from a seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 1000; i++) expect(next(b)).toBe(next(a));
  });

  it('stays within [0, 1)', () => {
    const rng = createRng(1);
    for (let i = 0; i < 10000; i++) {
      const value = next(rng);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('is roughly uniform', () => {
    const rng = createRng(2024);
    const buckets = new Array<number>(10).fill(0);
    const samples = 100000;
    for (let i = 0; i < samples; i++) buckets[Math.floor(next(rng) * 10)]!++;
    for (const count of buckets) {
      expect(count).toBeGreaterThan(samples / 10 - samples / 100);
      expect(count).toBeLessThan(samples / 10 + samples / 100);
    }
  });
});
