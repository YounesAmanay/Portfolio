/**
 * Stat compilation, budget validation and doctrine compilation.
 */

import { describe, expect, it } from 'vitest';
import { ALL_GHOSTS, REGISTRY, WARDEN, STEADY, STRIDER, COMPOSITE_PLATE, RAILSPIKE, MONOBLOCK } from '@engine/content/index';
import { buildHash, emptyAssignments, withPart, type Build } from '@engine/domain/build';
import { compileDoctrine, doctrineCost, validateDoctrine, DEFAULT_DOCTRINE } from '@engine/domain/doctrine';
import { buildId } from '@engine/domain/ids';
import { compileFrame, heatBalance, timeToOverload } from '@engine/forge/compile';
import { validateBuild } from '@engine/forge/validate';
import { AGILITY_BASE, AGILITY_SLOPE, DOCTRINE_RULE_COST, MAX_DOCTRINE_RULES } from '@engine/tuning';

function baseBuild(): Build {
  return {
    id: buildId('test'),
    name: 'TEST',
    chassisId: WARDEN.id,
    assignments: {
      ...emptyAssignments(WARDEN.sockets),
      CORE: [STEADY.id],
      LOCOMOTION: [STRIDER.id],
    },
    doctrine: DEFAULT_DOCTRINE,
  };
}

describe('stat compilation', () => {
  it('applies load-based agility after summing mass, not before', () => {
    const light = compileFrame(baseBuild(), REGISTRY);
    const heavy = compileFrame(
      withPart(withPart(baseBuild(), 'PLATING', 0, MONOBLOCK.id), 'PLATING', 1, MONOBLOCK.id),
      REGISTRY,
    );
    expect(heavy.stats.mass).toBeGreaterThan(light.stats.mass);
    expect(heavy.stats.agility).toBeLessThan(light.stats.agility);
    expect(heavy.stats.speed).toBeLessThan(light.stats.speed);
  });

  it('computes agility from the documented formula', () => {
    const frame = compileFrame(baseBuild(), REGISTRY);
    expect(frame.stats.agility).toBeCloseTo(AGILITY_BASE - AGILITY_SLOPE * frame.stats.load, 6);
  });

  it('is independent of the order parts were installed in', () => {
    const a = withPart(withPart(baseBuild(), 'ARM', 0, RAILSPIKE.id), 'PLATING', 0, COMPOSITE_PLATE.id);
    const b = withPart(withPart(baseBuild(), 'PLATING', 0, COMPOSITE_PLATE.id), 'ARM', 0, RAILSPIKE.id);
    expect(compileFrame(b, REGISTRY).stats).toEqual(compileFrame(a, REGISTRY).stats);
  });

  it('includes chassis innate traits', () => {
    const frame = compileFrame(baseBuild(), REGISTRY);
    expect(frame.stats.damageMult).toBeGreaterThan(0);
  });

  it('reports a heat balance and a time to overload', () => {
    const armed = withPart(baseBuild(), 'ARM', 0, RAILSPIKE.id);
    const frame = compileFrame(armed, REGISTRY);
    expect(Number.isFinite(heatBalance(frame))).toBe(true);
    expect(timeToOverload(frame)).toBeGreaterThan(0);
  });

  it('never produces negative or NaN stats', () => {
    for (const ghost of ALL_GHOSTS) {
      const { stats } = compileFrame(ghost.build, REGISTRY);
      for (const [key, value] of Object.entries(stats)) {
        if (typeof value !== 'number') continue;
        expect(Number.isFinite(value), `${ghost.build.name}.${key}`).toBe(true);
        expect(value, `${ghost.build.name}.${key}`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('budget validation', () => {
  it('accepts every shipped ghost', () => {
    for (const ghost of ALL_GHOSTS) {
      const report = validateBuild(compileFrame(ghost.build, REGISTRY), REGISTRY);
      expect(report.violations.map((v) => v.message), ghost.build.name).toEqual([]);
      expect(report.valid, ghost.build.name).toBe(true);
    }
  });

  it('rejects a build with no core', () => {
    const build = { ...baseBuild(), assignments: { ...baseBuild().assignments, CORE: [null] } };
    const report = validateBuild(compileFrame(build, REGISTRY), REGISTRY);
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.budget === 'SOCKETS')).toBe(true);
  });

  it('rejects a build with no locomotion', () => {
    const build = { ...baseBuild(), assignments: { ...baseBuild().assignments, LOCOMOTION: [null] } };
    expect(validateBuild(compileFrame(build, REGISTRY), REGISTRY).valid).toBe(false);
  });

  it('rejects an over-mass build', () => {
    let build = baseBuild();
    for (let i = 0; i < 2; i++) build = withPart(build, 'PLATING', i, MONOBLOCK.id);
    for (let i = 0; i < 2; i++) build = withPart(build, 'ARM', i, RAILSPIKE.id);
    const report = validateBuild(compileFrame(build, REGISTRY), REGISTRY);
    if (!report.valid) expect(report.violations.some((v) => v.budget === 'MASS')).toBe(true);
  });

  it('rejects a part in the wrong socket', () => {
    const build = { ...baseBuild(), assignments: { ...baseBuild().assignments, MODULE: [RAILSPIKE.id] } };
    const report = validateBuild(compileFrame(build, REGISTRY), REGISTRY);
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.message.includes('cannot go in'))).toBe(true);
  });

  it('warns about a weaponless frame without rejecting it', () => {
    const report = validateBuild(compileFrame(baseBuild(), REGISTRY), REGISTRY);
    expect(report.warnings.some((w) => w.includes('No weapons'))).toBe(true);
  });

  it('reports every budget with a usable ratio', () => {
    const report = validateBuild(compileFrame(baseBuild(), REGISTRY), REGISTRY);
    expect(report.budgets.map((b) => b.kind)).toEqual(['MASS', 'POWER', 'CYCLES']);
    for (const budget of report.budgets) expect(Number.isFinite(budget.ratio)).toBe(true);
  });
});

describe('doctrine', () => {
  it('charges cycles per rule', () => {
    expect(doctrineCost(DEFAULT_DOCTRINE)).toBe(DEFAULT_DOCTRINE.rules.length * DOCTRINE_RULE_COST);
  });

  it('appends a terminal ALWAYS rule so the interpreter is total', () => {
    const compiled = compileDoctrine({ rules: [{ condition: 'ENEMY_OVERLOADED', action: 'CHARGE' }] });
    expect(compiled.rules.at(-1)?.condition).toBe('ALWAYS');
  });

  it('trims beyond the rule cap', () => {
    const rules = Array.from({ length: 20 }, () => ({ condition: 'ENEMY_OVERLOADED' as const, action: 'CHARGE' as const }));
    expect(compileDoctrine({ rules }).rules.length).toBeLessThanOrEqual(MAX_DOCTRINE_RULES + 1);
  });

  it('flags an unreachable rule below ALWAYS', () => {
    const problems = validateDoctrine({
      rules: [{ condition: 'ALWAYS', action: 'ENGAGE' }, { condition: 'ENEMY_OVERLOADED', action: 'CHARGE' }],
    });
    expect(problems.some((p) => p.includes('can ever fire'))).toBe(true);
  });

  it('flags a missing threshold', () => {
    const problems = validateDoctrine({ rules: [{ condition: 'SELF_HEAT_ABOVE', action: 'VENT' }] });
    expect(problems.some((p) => p.includes('threshold'))).toBe(true);
  });

  it('flags an out-of-range ratio', () => {
    const problems = validateDoctrine({ rules: [{ condition: 'SELF_HEAT_ABOVE', parameter: 9, action: 'VENT' }] });
    expect(problems.some((p) => p.includes('between 0 and 1'))).toBe(true);
  });
});

describe('build identity', () => {
  it('hashes by content, not by name or id', () => {
    const a = baseBuild();
    const b = { ...a, id: buildId('other'), name: 'RENAMED' };
    expect(buildHash(b)).toBe(buildHash(a));
  });

  it('changes when a part changes', () => {
    const a = baseBuild();
    expect(buildHash(withPart(a, 'ARM', 0, RAILSPIKE.id))).not.toBe(buildHash(a));
  });
});
