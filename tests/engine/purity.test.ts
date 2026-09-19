/**
 * The engine purity contract.
 *
 * This is the test that keeps every other guarantee honest. A single
 * `Math.random()` or `Date.now()` under `src/engine` would silently break
 * replays, balance regression, and any future server-side verification —
 * and it would do so without failing anything else.
 *
 * @see docs/01-rules.md §1.1
 * @see docs/03-architecture.md §1
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ENGINE_ROOT = new URL('../../src/engine', import.meta.url).pathname;

function engineFiles(dir = ENGINE_ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...engineFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Strips comments and string literals so prose about `Math.random` is fine. */
function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

const FORBIDDEN: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\bMath\s*\.\s*random\b/, why: 'unseeded randomness destroys determinism' },
  { pattern: /\bDate\s*\.\s*now\b/, why: 'wall-clock time makes matches unreproducible' },
  { pattern: /\bnew\s+Date\b/, why: 'wall-clock time makes matches unreproducible' },
  { pattern: /\bperformance\s*\.\s*now\b/, why: 'wall-clock time makes matches unreproducible' },
  { pattern: /\bdocument\b/, why: 'the engine must not touch the DOM' },
  { pattern: /\bwindow\b/, why: 'the engine must not touch the DOM' },
  { pattern: /\blocalStorage\b/, why: 'the engine must not perform I/O' },
  { pattern: /\bfetch\s*\(/, why: 'the engine must not perform I/O' },
  { pattern: /\bconsole\s*\./, why: 'the engine must not log; it returns data' },
  // Transcendental functions are not bit-identical across JS engines.
  { pattern: /\bMath\s*\.\s*(sin|cos|tan|atan2|pow|exp|log|hypot)\b/, why: 'not bit-identical across JS engines' },
];

describe('engine purity', () => {
  const files = engineFiles();

  it('finds the engine sources', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(FORBIDDEN)('never uses $pattern ($why)', ({ pattern }) => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripNonCode(readFileSync(file, 'utf8'));
      if (pattern.test(code)) offenders.push(relative(ENGINE_ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it('never imports from outside the engine', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
        const spec = match[1]!;
        if (spec.startsWith('@ui') || spec.includes('/ui/')) {
          offenders.push(`${relative(ENGINE_ROOT, file)} -> ${spec}`);
        }
        // Relative imports must not climb out of src/engine.
        if (spec.startsWith('.')) {
          const depth = (spec.match(/\.\.\//g) ?? []).length;
          const dirDepth = relative(ENGINE_ROOT, file).split('/').length - 1;
          if (depth > dirDepth) offenders.push(`${relative(ENGINE_ROOT, file)} -> ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has exactly one source of randomness', () => {
    const rngUsers = files.filter((file) => {
      const code = stripNonCode(readFileSync(file, 'utf8'));
      return /\bmulberry|0x6d2b79f5/.test(code);
    });
    expect(rngUsers.map((f) => relative(ENGINE_ROOT, f))).toEqual(['core/rng.ts']);
  });
});
