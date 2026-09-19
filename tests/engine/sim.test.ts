/**
 * Simulation invariants, arena sanity, and the doctrine interpreter.
 */

import { describe, expect, it } from 'vitest';
import { ALL_ARENAS, ALL_GHOSTS, REGISTRY } from '@engine/content/index';
import { compileFrame } from '@engine/forge/compile';
import { hasLineOfSight } from '@engine/sim/arena';
import { decide } from '@engine/sim/cortex';
import { classifyHeat, penaltiesFor } from '@engine/sim/heat';
import { spawnPositions } from '@engine/sim/movement';
import { createMatch, simulate, stepMatch } from '@engine/sim/simulate';
import { createRuntime } from '@engine/sim/state';
import {
  ARENA_SPAWN_SEPARATION,
  HEAT_CRITICAL_THRESHOLD,
  HEAT_OVERLOAD_THRESHOLD,
  HEAT_STRAIN_THRESHOLD,
  MATCH_LIMIT_TICKS,
  TICK,
} from '@engine/tuning';

const frames = ALL_GHOSTS.map((g) => compileFrame(g.build, REGISTRY));

describe('arenas', () => {
  it.each(ALL_ARENAS)('$name spawns with clear line of sight', (arena) => {
    // Regression guard. Pylons placed on the spawn points once caused 27% of
    // all matches to end 0-0 with neither frame ever firing a shot: they had
    // no line of sight from the opening tick and no reason to move.
    const [a, b] = spawnPositions(arena, ARENA_SPAWN_SEPARATION);
    expect(hasLineOfSight(arena, a, b), `${arena.name} opens with blocked LoS`).toBe(true);
  });

  it.each(ALL_ARENAS)('$name keeps spawns clear of pylons', (arena) => {
    const spawns = spawnPositions(arena, ARENA_SPAWN_SEPARATION);
    for (const spawn of spawns) {
      for (const pylon of arena.pylons) {
        const dx = spawn.x - pylon.position.x;
        const dy = spawn.y - pylon.position.y;
        expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThan(pylon.radius + 3);
      }
    }
  });

  it.each(ALL_ARENAS)('$name keeps every feature inside its bounds', (arena) => {
    for (const p of arena.pylons) {
      expect(p.position.x).toBeGreaterThanOrEqual(0);
      expect(p.position.x).toBeLessThanOrEqual(arena.width);
      expect(p.position.y).toBeLessThanOrEqual(arena.height);
    }
  });
});

describe('heat bands', () => {
  it('classifies each band at its documented threshold', () => {
    expect(classifyHeat(0)).toBe('NOMINAL');
    expect(classifyHeat(HEAT_STRAIN_THRESHOLD)).toBe('STRAIN');
    expect(classifyHeat(HEAT_CRITICAL_THRESHOLD)).toBe('CRITICAL');
    expect(classifyHeat(HEAT_OVERLOAD_THRESHOLD)).toBe('OVERLOADED');
  });

  it('penalties worsen monotonically', () => {
    const bands = ['NOMINAL', 'STRAIN', 'CRITICAL'] as const;
    for (let i = 1; i < bands.length; i++) {
      expect(penaltiesFor(bands[i]!).accuracy).toBeLessThan(penaltiesFor(bands[i - 1]!).accuracy);
      expect(penaltiesFor(bands[i]!).speed).toBeLessThanOrEqual(penaltiesFor(bands[i - 1]!).speed);
    }
  });

  it('an overloaded frame cannot act', () => {
    expect(penaltiesFor('OVERLOADED').accuracy).toBe(0);
    expect(penaltiesFor('OVERLOADED').speed).toBe(0);
  });
});

describe('doctrine interpreter', () => {
  const arena = ALL_ARENAS[0]!;
  const [spawnA, spawnB] = spawnPositions(arena, ARENA_SPAWN_SEPARATION);

  it('fires the first matching rule and reports which one', () => {
    const self = createRuntime(frames[0]!, 0, spawnA);
    const enemy = createRuntime(frames[1]!, 1, spawnB);
    const decision = decide(self, enemy, 0);
    expect(decision.reason).toMatch(/^rule \d+:/);
  });

  it('prefers an earlier rule over a later one that also matches', () => {
    const custom = compileFrame(
      {
        ...ALL_GHOSTS[0]!.build,
        doctrine: {
          rules: [
            { condition: 'ENEMY_BEYOND', parameter: 1, action: 'RETREAT' },
            { condition: 'ALWAYS', action: 'CHARGE' },
          ],
        },
      },
      REGISTRY,
    );
    const self = createRuntime(custom, 0, spawnA);
    const enemy = createRuntime(frames[1]!, 1, spawnB);
    expect(decide(self, enemy, 0).action).toBe('RETREAT');
  });

  it('degrades an illegal VENT rather than standing idle', () => {
    const custom = compileFrame(
      { ...ALL_GHOSTS[0]!.build, doctrine: { rules: [{ condition: 'ALWAYS', action: 'VENT' }] } },
      REGISTRY,
    );
    const self = createRuntime(custom, 0, spawnA);
    self.ventReadyAt = 9999; // vent on cooldown
    const enemy = createRuntime(frames[1]!, 1, spawnB);
    expect(decide(self, enemy, 0).action).not.toBe('VENT');
  });
});

describe('match invariants', () => {
  const arena = ALL_ARENAS[0]!;

  it('always terminates within the match limit', () => {
    for (let seed = 0; seed < 30; seed++) {
      const result = simulate(frames[seed % 5]!, frames[(seed + 2) % 5]!, arena, seed);
      expect(result.ticks).toBeLessThanOrEqual(MATCH_LIMIT_TICKS);
      expect(result.outcome).not.toBe('ONGOING');
    }
  });

  it('keeps both frames inside the arena at every tick', () => {
    const state = createMatch(frames[0]!, frames[2]!, arena, 4242);
    while (!state.finished && state.tick < MATCH_LIMIT_TICKS) {
      stepMatch(state);
      for (const frame of state.frames) {
        expect(frame.position.x).toBeGreaterThanOrEqual(0);
        expect(frame.position.x).toBeLessThanOrEqual(arena.width);
        expect(frame.position.y).toBeGreaterThanOrEqual(0);
        expect(frame.position.y).toBeLessThanOrEqual(arena.height);
      }
    }
  });

  it('never lets a resource escape its bounds', () => {
    const state = createMatch(frames[1]!, frames[3]!, arena, 77);
    while (!state.finished && state.tick < MATCH_LIMIT_TICKS) {
      stepMatch(state);
      for (const f of state.frames) {
        expect(f.energy).toBeGreaterThanOrEqual(0);
        expect(f.energy).toBeLessThanOrEqual(f.frame.stats.energyCapacity + 1e-6);
        expect(f.shield).toBeGreaterThanOrEqual(0);
        expect(f.shield).toBeLessThanOrEqual(f.frame.stats.shieldCapacity + 1e-6);
        expect(f.heat).toBeGreaterThanOrEqual(0);
        expect(f.armour).toBeGreaterThanOrEqual(0);
        for (const w of f.weapons) expect(w.ammo).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('declares a winner consistent with the surviving frame', () => {
    for (let seed = 0; seed < 40; seed++) {
      const r = simulate(frames[0]!, frames[3]!, arena, seed);
      if (r.outcome !== 'DESTRUCTION') continue;
      const loser = r.winner === 0 ? 1 : 0;
      expect(r.telemetry[loser]!.structureRemaining).toBe(0);
      expect(r.telemetry[r.winner!]!.structureRemaining).toBeGreaterThan(0);
    }
  });

  it('opens with a start event and closes with an end event', () => {
    const r = simulate(frames[0]!, frames[1]!, arena, 11);
    expect(r.events[0]?.kind).toBe('MATCH_START');
    expect(r.events.at(-1)?.kind).toBe('MATCH_END');
  });

  it('every frame actually engages — no 0-0 matches', () => {
    // The strongest single signal that movement and firing are wired up.
    for (const arenaEach of ALL_ARENAS) {
      for (let i = 0; i < frames.length; i++) {
        for (let j = 0; j < frames.length; j++) {
          if (i === j) continue;
          const r = simulate(frames[i]!, frames[j]!, arenaEach, i * 31 + j);
          const fired = r.telemetry[0]!.shotsFired + r.telemetry[1]!.shotsFired;
          expect(fired, `${r.telemetry[0]!.name} vs ${r.telemetry[1]!.name} @ ${arenaEach.name}`)
            .toBeGreaterThan(0);
        }
      }
    }
  });

  it('reports a duration consistent with its tick count', () => {
    const r = simulate(frames[2]!, frames[4]!, arena, 5);
    expect(r.duration).toBeCloseTo(r.ticks * TICK, 6);
  });
});
