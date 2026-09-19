# ARCFORGE — working notes

A deterministic modular-robot autobattler. Read
[`docs/00-vision.md`](docs/00-vision.md) for what the game is and
[`docs/03-architecture.md`](docs/03-architecture.md) for how it is laid out.

## Commands

```bash
npm run dev         # Vite dev server
npm run typecheck   # tsc --noEmit
npm test            # everything
npm run balance     # the archetype matrix, verbose
npm run build       # typecheck + production build
```

## The rules that are easy to break

These are the invariants that are enforced by tests but not obvious from
reading a single file. Breaking any of them produces a silent failure.

### 1. The engine is pure

`src/engine` has no DOM, no `Date`, no `Math.random`, no I/O, and never imports
from `src/ui`. It also avoids `Math.sin/cos/pow/exp/hypot` in any path that can
affect a match, because those are not bit-identical across JS engines.

`tests/engine/purity.test.ts` scans every engine source file for violations.
This is what makes replays, balance regression and future server-side
verification possible — it is not stylistic.

### 2. Every constant lives in `tuning.ts`

If you find a magic number anywhere else under `src/engine`, it is a bug. The
point is that a designer can retune the game without reading the simulation.

### 3. Weapon damage is solved, not chosen

Do not pick a damage number. Decide the weapon's *character* — range band, heat
pressure, energy cost, magazine, mass, power, pierce — then run
`npm run balance`. The suite prints the exact damage that re-centres it:

```
MK-IV RAILSPIKE efficiency 1.340 is outside [0.88, 1.12].
Adjust its damage to 36 to re-centre it.
```

See [`docs/04-authoring-parts.md`](docs/04-authoring-parts.md).

### 4. Stateful parts use hook memory, never closures

A part that needs to remember something uses the `memory` object the simulation
hands it — one per part, per frame, per match. Closing over module-level state
shares it across every frame and every match in a balance run, which destroys
determinism invisibly: the bug only shows up when a replay stops reproducing.

### 5. Never put a pylon on a spawn point

Spawns sit at `(width/2 ± 35, height/2)`. A pylon within its radius + ~3 m of
one blocks line of sight from the opening tick, and the match runs the full
180 seconds with nobody firing. This actually happened and cost 27% of all
matches. `tests/engine/sim.test.ts` now asserts it for every arena.

### 6. Adding content never touches engine code

Write the part, export it from its file's `ALL_*` array, done. If you find
yourself editing `src/engine/sim` or `src/engine/forge` to add a part, the
plugin contract is not being used correctly — reach for `hooks` instead.

## Layering

```
src/engine/   pure, deterministic, zero dependencies
src/ui/       everything impure: DOM, canvas, storage, animation
```

The UI imports only from `@engine/index`. The engine does not know a screen
exists.

## Balance expectations

Archetype win rates must stay within `[0.40, 0.60]` (the design goal is
0.42–0.58) and the median match within 20–90 s, with under 25% non-decisive.
`tests/balance/matchups.test.ts` enforces this. If it goes red, that is a
design conversation — read the printed matrix before changing a constant.
