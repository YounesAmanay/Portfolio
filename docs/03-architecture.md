# ARCFORGE — Architecture

## 1. The one rule

```
src/engine/  ──  pure, deterministic, dependency-free.  Never imports from ui.
src/ui/      ──  everything impure: DOM, canvas, storage, time, animation.
```

The engine does not know a screen exists. It has no `Date`, no `Math.random`, no `window`,
no `fetch`, no `console`. It is a library that takes data and returns data. This is
enforced mechanically by `tests/engine/purity.test.ts`, which scans every file under
`src/engine` for forbidden identifiers and for imports that escape the directory.

Everything good about this project descends from that rule: the sim is testable without
a browser, balance runs in CI, replays are portable, and the whole thing could move to a
server tomorrow without touching a line of engine code.

## 2. Layout

```
src/engine/
├── tuning.ts           ★ every constant in the game. Single source of truth.
├── index.ts              public API barrel — the only thing ui imports
├── core/
│   ├── rng.ts            mulberry32 + explicit Rng handle
│   ├── vec.ts            2D vector maths (determinism-safe subset)
│   └── num.ts            clamp, lerp, roundTo, approach
├── domain/               the vocabulary. Types + pure helpers, no behaviour.
│   ├── ids.ts            branded string ids (PartId, BuildId, …)
│   ├── sockets.ts        SocketKind, layouts
│   ├── damage.ts         DamageType, the 3×3 interaction matrices
│   ├── stats.ts          FrameStats + stat algebra
│   ├── part.ts           ★ the Part contract — the plugin interface
│   ├── build.ts          Build = chassis + socket assignments
│   └── doctrine.ts       Condition / Action / Rule types
├── forge/                build -> numbers
│   ├── registry.ts       PartRegistry — the plugin host
│   ├── compile.ts        compileFrame(): Build -> CompiledFrame
│   └── validate.ts       the four budgets
├── sim/                  numbers -> a match
│   ├── arena.ts          arena definitions + spatial queries
│   ├── state.ts          MatchState, FrameRuntime
│   ├── heat.ts           heat bands, venting, overload
│   ├── combat.ts         ★ the damage pipeline (rulebook §5)
│   ├── movement.ts       steering, collision, line of sight
│   ├── doctrine.ts       the doctrine interpreter
│   ├── events.ts         the combat log (also the replay format)
│   └── simulate.ts       ★ the fixed-timestep match loop
├── meta/
│   ├── rating.ts         Elo
│   └── economy.ts        rewards, salvage, shop
└── content/              data only. Adding content never edits the engine.
    ├── chassis.ts  cores.ts  weapons.ts  plating.ts
    ├── locomotion.ts  modules.ts  protocols.ts
    ├── arenas.ts  ghosts.ts
    └── index.ts          registers everything into a PartRegistry
```

## 3. The Part contract — how the plugin system works

Every part in the game — a leg, a laser, a line of software — is one object satisfying
one interface. The engine knows *only* this interface; it has no idea what a "railgun" is.

```ts
interface Part {
  readonly id: PartId;
  readonly name: string;
  readonly socket: SocketKind;      // where it plugs in
  readonly house: House;
  readonly tier: Tier;
  readonly cost: ResourceCost;      // mass, powerDraw, cycleDraw
  readonly grants: StatGrant;       // flat + multiplicative stat contributions
  readonly weapon?: WeaponProfile;  // present iff this part can shoot
  readonly hooks?: PartHooks;       // optional simulation hooks
}
```

Three escalating levels of power, so simple content stays simple:

| Level | Mechanism | Use for |
| --- | --- | --- |
| **1. Stats** | `grants` — declarative numbers | 90 % of parts. Plating, cores, legs. |
| **2. Weapon** | `weapon` — a `WeaponProfile` record | Anything that fires. |
| **3. Hooks** | `hooks` — pure functions on sim events | Protocols and exotic modules. |

The hook interface is small and every hook is pure — it receives state and returns
*modifications*, it never mutates:

```ts
interface PartHooks {
  modifyOutgoingDamage?(ctx: DamageContext): DamageModifier;
  modifyIncomingDamage?(ctx: DamageContext): DamageModifier;
  onTick?(ctx: TickContext): readonly SimEffect[];
  onEvent?(ctx: EventContext): readonly SimEffect[];
}
```

`SimEffect` is a discriminated union (`{kind:'heat', delta}`, `{kind:'evasion', …}`).
The simulation collects effects from every hook, sorts them by part id for determinism,
then applies them in one pass. **Nothing outside `sim/apply.ts` mutates match state.**

This is why `OVERDRIVE` is nine lines of data and required zero engine changes:

```ts
export const OVERDRIVE: Part = {
  id: partId('proto.overdrive'), name: 'OVERDRIVE', socket: 'PROTOCOL',
  house: 'CINDER', tier: 3, cost: { mass: 0, powerDraw: 0, cycleDraw: 6 },
  grants: {},
  hooks: {
    modifyOutgoingDamage: ({ self }) =>
      self.heatRatio > 0.70 ? { damageMult: 1.20 } : {},
    onTick: ({ self }) =>
      self.heatRatio > 0.70 ? [{ kind: 'heatGenMult', value: 1.15 }] : [],
  },
};
```

## 4. Data flow

```
   Build (what the player plugged in)
     │  forge/validate.ts  ── four budgets ──▶ ValidationReport
     ▼
   compileFrame()          ── one place where parts become numbers
     │
     ▼
   CompiledFrame (immutable: stats, weapons, hooks, doctrine)
     │
     │  simulate(frameA, frameB, arena, seed)
     ▼
   MatchResult { winner, ticks, events[], telemetry }
     │
     ├──▶ meta/rating.ts   ── Elo delta
     ├──▶ meta/economy.ts  ── credits, salvage
     └──▶ ui/render        ── playback at 60 fps, interpolating between 20 Hz ticks
```

`CompiledFrame` is frozen. The simulation never writes to it; per-match mutable state
lives in `FrameRuntime`. The separation means one compiled frame can fight a thousand
matches in a balance test without being reset, which is how the matchup matrix runs fast.

## 5. Why the UI has no framework

The UI is ~1 500 lines of TypeScript against the DOM, with one small reactive store
(`ui/state/store.ts`, ~60 lines: subscribe, `setState`, structural-equality bail-out).

That is a deliberate choice, not a shortcut:

- The interesting complexity is in the engine. A framework would add a build-time
  dependency and a mental tax to solve a problem this app does not have.
- The arena is a `<canvas>` render loop. No virtual DOM helps there.
- Zero runtime dependencies means the bundle is small and the project still builds in
  five years.

The store pattern is conventional enough that swapping in React later is mechanical:
views are already pure `(state) => element` functions.

## 6. Replays

A replay is not a video. It is:

```ts
type Replay = { buildA: BuildSnapshot; buildB: BuildSnapshot; arenaId: string; seed: number };
```

Four fields. Re-running `simulate()` reproduces the match tick-for-tick, which
means replays cost a few hundred bytes, can be diffed, can be shared as a URL,
and can be *verified* — a submitted result that doesn't reproduce is a forged
result. Determinism pays for itself here.

`meta/codec.ts` implements this. Parts encode as indices into the registry's
id-sorted list, which is what keeps a whole frame under ~70 characters:

```
ARC1:<fingerprint>:<chassis>:<sockets>:<doctrine>:<name>
```

Indices are only meaningful against the catalogue that produced them, so every
code carries a fingerprint of that catalogue and decoding *refuses* rather than
guesses. The failure mode worth engineering against is not rejection — it is a
code silently resolving to a different but valid build, which would make shared
frames and verifiable replays worthless.

Decoding never throws. It takes user input, so it returns a
`DecodeResult<T>` discriminated union and the UI renders the reason.

## 7. Testing strategy

| Suite | Asserts |
| --- | --- |
| `tests/engine/purity.test.ts` | no DOM/`Date`/`Math.random`/cross-layer imports in engine |
| `tests/engine/determinism.test.ts` | same seed → byte-identical event log, 100 runs |
| `tests/engine/damage.test.ts` | the rulebook's worked examples, to 4 decimal places |
| `tests/engine/compile.test.ts` | stat compilation order, load/agility maths |
| `tests/engine/validate.test.ts` | each of the four budgets rejects correctly |
| `tests/engine/doctrine.test.ts` | first-match-wins ordering, fallback injection |
| `tests/balance/weapons.test.ts` | every weapon's efficiency ∈ [0.88, 1.12] |
| `tests/balance/matchups.test.ts` | no archetype above 58 % across the matrix |

The balance suites are the unusual ones and the most valuable: they turn game design
into something CI can regress-test. Change a constant in `tuning.ts` and the suite tells
you, in seconds, exactly which parts and which archetypes you just broke.
