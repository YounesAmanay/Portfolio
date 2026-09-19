# ARCFORGE

> **Forge the frame. Write the doctrine. Enter the Lattice.**

A deterministic modular-robot autobattler. You never steer a robot — you
*engineer* one: bolt parts into sockets under four competing budgets, write a
short priority list of rules that becomes the machine's mind, then watch it
fight another Architect's machine with no human input at all.

A match is a pure function of `(buildA, buildB, arena, seed)`. Same inputs,
same result, every time, on every device.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 119 tests: invariants, determinism, purity, balance
npm run balance    # the archetype matchup matrix, verbose
```

---

## What it is

The brief was: *let people plug parts into a robot and fight other people's
robots.* Three consequences follow, and the whole design descends from them.

| Consequence | Answer |
| --- | --- |
| If parts are the game, parts must be a **plugin system**, not an `if` ladder. | Every part is one `Part` record. Adding content never edits engine code. |
| If you fight *other people's* robots, the fight must survive without both people present. | Matches are **asynchronous and deterministic**. A stored build is a complete opponent; a replay is four numbers. |
| If you don't control the robot in the fight, **the build must be the skill**. | Four simultaneous budgets plus a programmable Doctrine make loadout a real optimisation problem with no dominant solution. |

## The three houses

Damage types form a genuine triangle, not a flavour label. Each is strong
against one defensive layer and weak against another:

- **HAVOC** — kinetic. Shreds shields (×1.30) and staggers frames, but armour
  is built to stop slugs (×1.35) and magazines run dry.
- **CINDER** — thermal. Melts armour (×0.80) and strips it 2.3× faster than
  anything else, but shields diffuse it (×0.70) and it runs desperately hot.
- **NULLSET** — ion. Erases shields (×1.60), drains energy and forces overload
  — while dealing only 45 % of its damage to the frame itself.

A fortress with 190 armour is 1.5× tougher against kinetic than thermal, and
2.5× tougher against ion than either. **The spread is the game.**

## The four budgets

```
MASS     Σ part.mass      ≤ chassis.massLimit
POWER    Σ powerDraw      ≤ core output
CYCLES   Σ cycleDraw + doctrine ≤ core output
SOCKETS  every part in a socket it fits
```

Doctrine rules cost cycles from the same pool as modules — so a seven-rule
doctrine is a targeting computer you can no longer fit. Being clever and being
equipped are paid for in the same currency.

Mass is never free: `agility = 1.25 − 0.50 × load` scales speed *and* evasion
linearly, long before the cap makes a build illegal.

## Determinism is the product

It makes builds comparable, replays shareable, balance testable in CI, and
cheating structurally hard. Five rules the engine never breaks:

1. One seeded PRNG, threaded explicitly. `Math.random` does not exist in `src/engine`.
2. Fixed 20 Hz timestep. No wall clock is ever read.
3. Iteration by stable sorted index, never insertion order.
4. No `sin`/`cos`/`pow`/`exp` in damage-affecting paths — not bit-identical across engines.
5. No DOM, no I/O, no imports from the UI layer.

All five are **enforced by a test** that scans every engine source file.

## Balance is solved, not guessed

Every weapon's damage is derived from a threat/cost model that prices range,
heat pressure, energy pressure, magazine uptime, mass, power draw and armour
pierce — then normalised so the catalogue centres on 1.00. The suite re-derives
all sixteen and fails the build if any leaves `[0.88, 1.12]`, printing the
damage value that would fix it.

The archetype matrix plays every pair over 24 seeds × 3 arenas:

| Archetype | House | Wins by | Win rate |
| --- | --- | --- | --- |
| Lancer | CINDER | Melting armour at mid range | 57.5 % |
| Disruptor | NULLSET | Forcing overload, then killing | 54.0 % |
| Bastion | HAVOC | Effective HP and stagger lock | 49.8 % |
| Alpha | HAVOC/CINDER | One enormous volley | 47.8 % |
| Skirmisher | any | Evasion and range control | 46.5 % |

All five inside the 42–58 % design goal, median match 48.8 s, and no match
decided by the clock. The matrix also contains a closed five-way counter-cycle
— Skirmisher beats Alpha beats Disruptor beats Lancer beats Bastion beats
Skirmisher — where every edge has a mechanical cause rather than a tuning nudge.

Those numbers were only reachable because the suite caught what inspection did
not: armour pierce was entirely unpriced, range was charged a third of what it
is worth, and one arena's pylons sat on the spawn points so a quarter of all
matches ended 0–0 with neither frame ever firing. See
[`docs/02-balance.md`](docs/02-balance.md) §5.2.

## Layout

```
docs/                 the design record
  00-vision           what the game is and why it takes this shape
  01-rules            normative spec: every formula, every constant
  02-balance          the costing model that prices every part
  03-architecture     layering, the plugin contract, testing strategy
  04-authoring-parts  adding content without touching the engine

src/engine/           pure, deterministic, zero dependencies
  tuning.ts           every constant in the game, in one file
  domain/             the vocabulary — Part, Build, Doctrine, damage matrices
  forge/              build -> numbers: registry, stat compiler, validator
  sim/                numbers -> a match: combat, heat, movement, cortex
  meta/               Elo, economy
  content/            data only — 5 chassis, 45 parts, 3 arenas, 5 opponents

src/ui/               everything impure: DOM, canvas, storage, animation
tests/                engine invariants + balance regression
```

The engine imports nothing from the UI and touches no DOM. It could move to a
server tomorrow without a line changing.

## Stack

TypeScript, Vite, Vitest. **Zero runtime dependencies** — the shipped bundle is
~81 KB of JavaScript and ~17 KB of CSS, and the project will still build in
five years.

## Reading order

New to the project: [`docs/00-vision.md`](docs/00-vision.md) →
[`docs/03-architecture.md`](docs/03-architecture.md) →
[`src/engine/domain/part.ts`](src/engine/domain/part.ts).

Looking for the maths: [`docs/01-rules.md`](docs/01-rules.md) §5 (the damage
pipeline) and [`docs/02-balance.md`](docs/02-balance.md) §2 (weapon pricing).
