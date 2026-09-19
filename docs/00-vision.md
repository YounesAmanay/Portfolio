# ARCFORGE — Vision

> **Forge the frame. Write the doctrine. Enter the Lattice.**

## 1. The pitch in one paragraph

ARCFORGE is a **deterministic modular-robot autobattler**. You never steer a robot.
You *engineer* one: you bolt parts into sockets under four competing budgets, then you
write the **Doctrine** — a short priority list of rules that becomes the machine's mind.
Then you launch it into **the Lattice**, where it fights another Architect's machine with
no human input at all. The match is a pure function of `(buildA, buildB, arena, seed)`.
Same inputs, same result, every time, on every device. Victory is not reflex. Victory is
a better *argument about physics*.

## 2. Why this shape

The brief was: *let people plug parts into a robot and fight other people's robots.*
Three consequences follow, and every design decision here descends from them.

| Consequence | Design answer |
| --- | --- |
| If parts are the game, parts must be a **plugin system**, not an `if` ladder. | Every part is a data record implementing one `Part` contract, registered at load. Adding content never edits the engine. |
| If you fight *other people's* robots, the fight must survive without both people present. | Matches are **asynchronous and deterministic**. A stored build is a complete opponent. A replay is 3 numbers and 2 build hashes. |
| If you don't control the robot in the fight, **the build must be the skill**. | Four simultaneous budgets + a programmable Doctrine make loadout a genuine optimisation problem with no dominant solution. |

Determinism is not a nicety here, it is the product. It makes builds comparable, replays
shareable, balance testable in CI, and cheating structurally hard — anyone can re-run the
match and get the same frame-by-frame answer.

## 3. The world

The year is **2087**. Human reaction time stopped being competitive in 2061.

The **Lattice** is what remains of the old orbital compute grid — a substrate that renders
physical arenas out of reclaimed matter and runs them at a guaranteed tick rate. Nobody
pilots anything any more. You are an **Architect**: you scavenge modules, you plug them
into a frame, you compile a doctrine into its cortex, and you push it through the gate.
Then you *watch*, which is the hardest part, because you cannot help it.

What you're really doing is submitting a proof. The arena is the referee.
Your robot is the argument. The other Architect's robot is the counter-example.

Three houses grew out of that, and the whole part catalogue splits along their lines:

- **CINDER** — thermal doctrine. Lasers, plasma, heat as a weapon. Burns through armour.
  Fragile in long fights, because heat is also their own enemy.
- **HAVOC** — kinetic doctrine. Mass drivers, railguns, ammunition. Reliable, heavy,
  finite. Shreds shields and staggers frames, but it can run dry.
- **NULLSET** — ion doctrine. Disruptors, EMP, system attack. Barely scratches a chassis;
  instead it boils the enemy's heat, drains their energy, and turns their own build off.

None of the three wins alone. That is the point.

## 4. The aesthetic target

The brief asked for *the most futuristic thing the human race has seen*. That is a bar
about **restraint**, not about adding more neon. The rules we hold ourselves to:

1. **Void-first.** Near-black substrate (`#05070d`). Light is emitted, never painted on.
2. **Light is data.** Nothing glows for decoration. If it glows, it is reporting a value.
3. **Data density over chrome.** A real cockpit shows numbers. Every stat is legible and
   live; hovering any number explains the formula that produced it.
4. **Motion is physical.** Nothing pops. Things settle, charge, decay, and cool. UI
   transitions borrow the same curves the simulation uses.
5. **One accent per meaning.** Cyan = energy/nominal. Amber = heat/strain.
   Magenta = ion/disruption. Red = structural loss. Never mix the vocabulary.
6. **Monospace for truth, grotesque for voice.** Numbers are monospaced and tabular so
   they don't jitter when they change.

## 5. The loop

```
        ┌──────────────────────────────────────────────────┐
        │                                                  │
        ▼                                                  │
   ┌─────────┐    ┌──────────┐    ┌────────┐    ┌────────────────┐
   │  FORGE  │───▶│ DOCTRINE │───▶│ LATTICE│───▶│ SALVAGE / RANK │
   │ plug    │    │ program  │    │ resolve│    │ credits, parts │
   │ parts   │    │ the mind │    │ 180s   │    │ rating delta   │
   └─────────┘    └──────────┘    └────────┘    └────────────────┘
        ▲                                                  │
        └──────────────────────────────────────────────────┘
                     new parts change the maths
```

A run of the loop is 2–4 minutes. The fight itself is ~40–180 seconds. The interesting
time is spent in the Forge, which is exactly where we want it.

## 6. What is explicitly *not* in scope

Stated up front so the architecture doesn't pretend otherwise:

- **No real-time netcode.** Opponents are stored builds ("ghosts"). This is a deliberate
  design choice, not a limitation — see §2.
- **No 3D renderer.** The arena is top-down 2D canvas. The sim is 2D; drawing it in 3D
  would be lying about the model.
- **No server.** Progression persists to `localStorage`. The engine is server-ready
  (pure, deterministic, no I/O) so this can move without a rewrite.

## 7. Reading order

1. **[01-rules.md](./01-rules.md)** — the rulebook. Every formula, every constant.
2. **[02-balance.md](./02-balance.md)** — the ratios, the budget maths, the tuning tables.
3. **[03-architecture.md](./03-architecture.md)** — how the code is laid out and why.
4. **[04-authoring-parts.md](./04-authoring-parts.md)** — adding content without touching the engine.
