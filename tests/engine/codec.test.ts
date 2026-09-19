/**
 * Build and replay codes.
 *
 * The property that matters most is not "it round-trips" but "it never
 * silently decodes to a different build". A code that fails loudly is a minor
 * annoyance; a code that quietly resolves to somebody else's loadout would
 * make shared builds and verifiable replays worthless.
 */

import { describe, expect, it } from 'vitest';
import { ALL_ARENAS, ALL_GHOSTS, REGISTRY } from '@engine/content/index';
import { installedPartIds, buildHash } from '@engine/domain/build';
import { arenaId } from '@engine/domain/ids';
import { compileFrame } from '@engine/forge/compile';
import { validateBuild } from '@engine/forge/validate';
import {
  catalogueFingerprint,
  decodeBuild,
  decodeReplay,
  encodeBuild,
  encodeReplay,
} from '@engine/meta/codec';
import { digestEvents } from '@engine/sim/events';
import { simulate } from '@engine/sim/simulate';
import { PartRegistry } from '@engine/forge/registry';

const builds = ALL_GHOSTS.map((ghost) => ghost.build);

describe('build codes', () => {
  it.each(builds.map((b) => [b.name, b] as const))('%s round-trips exactly', (_name, build) => {
    const decoded = decodeBuild(encodeBuild(build, REGISTRY), REGISTRY);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    // buildHash covers chassis, every slot in order, and every doctrine rule.
    expect(buildHash(decoded.value)).toBe(buildHash(build));
    expect(installedPartIds(decoded.value)).toEqual(installedPartIds(build));
    expect(decoded.value.name).toBe(build.name);
  });

  it.each(builds.map((b) => [b.name, b] as const))('%s compiles identically after a round trip', (_n, build) => {
    const decoded = decodeBuild(encodeBuild(build, REGISTRY), REGISTRY);
    if (!decoded.ok) throw new Error(decoded.error);
    expect(compileFrame(decoded.value, REGISTRY).stats).toEqual(compileFrame(build, REGISTRY).stats);
  });

  it('stays short enough to paste into a URL', () => {
    for (const build of builds) {
      expect(encodeBuild(build, REGISTRY).length, build.name).toBeLessThan(220);
    }
  });

  it('preserves deliberately empty slots', () => {
    // Running a weapon mount empty to save mass is a real strategy, so it has
    // to survive encoding rather than being collapsed away.
    const anvil = builds.find((b) => b.name === 'ANVIL')!;
    const decoded = decodeBuild(encodeBuild(anvil, REGISTRY), REGISTRY);
    if (!decoded.ok) throw new Error(decoded.error);
    expect(decoded.value.assignments.PLATING).toEqual(anvil.assignments.PLATING);
  });

  it('preserves doctrine thresholds through the x100 encoding', () => {
    const build = {
      ...builds[0]!,
      doctrine: {
        rules: [
          { condition: 'SELF_HEAT_ABOVE' as const, parameter: 0.85, action: 'VENT' as const },
          { condition: 'ENEMY_WITHIN' as const, parameter: 18, action: 'BRACE' as const },
          { condition: 'ENEMY_OVERLOADED' as const, action: 'CHARGE' as const },
          { condition: 'ALWAYS' as const, action: 'ENGAGE' as const },
        ],
      },
    };
    const decoded = decodeBuild(encodeBuild(build, REGISTRY), REGISTRY);
    if (!decoded.ok) throw new Error(decoded.error);
    expect(decoded.value.doctrine.rules).toEqual(build.doctrine.rules);
  });

  it('produces a build that still passes validation', () => {
    for (const build of builds) {
      const decoded = decodeBuild(encodeBuild(build, REGISTRY), REGISTRY);
      if (!decoded.ok) throw new Error(decoded.error);
      const report = validateBuild(compileFrame(decoded.value, REGISTRY), REGISTRY);
      expect(report.violations, build.name).toEqual([]);
    }
  });
});

describe('build code rejection', () => {
  it('rejects a foreign string', () => {
    const result = decodeBuild('hello', REGISTRY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/ARCFORGE build code/);
  });

  it('rejects a truncated code', () => {
    const code = encodeBuild(builds[0]!, REGISTRY).split(':').slice(0, 3).join(':');
    expect(decodeBuild(code, REGISTRY).ok).toBe(false);
  });

  it('refuses a code from a different catalogue rather than guessing', () => {
    // The important failure mode: indices are only meaningful against the
    // catalogue that produced them.
    const code = encodeBuild(builds[0]!, REGISTRY);
    const smaller = new PartRegistry()
      .addChassis(...REGISTRY.allChassis().slice(0, 2))
      .addParts(...REGISTRY.allParts().slice(0, 10))
      .freeze();

    const result = decodeBuild(code, smaller);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/different part catalogue/);
  });

  it('changes fingerprint when the catalogue changes', () => {
    const smaller = new PartRegistry()
      .addChassis(...REGISTRY.allChassis())
      .addParts(...REGISTRY.allParts().slice(0, -1))
      .freeze();
    expect(catalogueFingerprint(smaller)).not.toBe(catalogueFingerprint(REGISTRY));
  });

  it('never throws on arbitrary input', () => {
    const junk = ['', ':::::', 'ARC1:::::', 'ARC1:x:y:z:w:v', '\u0000', 'ARC1:'.repeat(50)];
    for (const input of junk) {
      expect(() => decodeBuild(input, REGISTRY)).not.toThrow();
    }
  });
});

describe('replay codes', () => {
  it('reproduces a match byte for byte from its code alone', () => {
    // The whole promise of determinism: the code *is* the match.
    const a = builds[1]!;
    const b = builds[2]!;
    const arena = ALL_ARENAS[1]!;
    const seed = 20260919;

    const original = simulate(compileFrame(a, REGISTRY), compileFrame(b, REGISTRY), arena, seed);

    const code = encodeReplay({ buildA: a, buildB: b, arenaId: arena.id, seed }, REGISTRY);
    const decoded = decodeReplay(code, REGISTRY);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    const restored = ALL_ARENAS.find((x) => x.id === decoded.value.arenaId)!;
    const replayed = simulate(
      compileFrame(decoded.value.buildA, REGISTRY),
      compileFrame(decoded.value.buildB, REGISTRY),
      restored,
      decoded.value.seed,
    );

    expect(digestEvents(replayed.events)).toBe(digestEvents(original.events));
    expect(replayed.winner).toBe(original.winner);
    expect(replayed.ticks).toBe(original.ticks);
  });

  it('survives a large unsigned seed', () => {
    const seed = 4294967295;
    const code = encodeReplay(
      { buildA: builds[0]!, buildB: builds[1]!, arenaId: arenaId('arena.proving_floor'), seed },
      REGISTRY,
    );
    const decoded = decodeReplay(code, REGISTRY);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value.seed).toBe(seed);
  });

  it('rejects junk without throwing', () => {
    for (const input of ['', 'nope', 'ARCR1~', 'ARCR1~~~~']) {
      expect(() => decodeReplay(input, REGISTRY)).not.toThrow();
      expect(decodeReplay(input, REGISTRY).ok).toBe(false);
    }
  });
});
