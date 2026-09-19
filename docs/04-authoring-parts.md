# Authoring Parts

Adding content to ARCFORGE never requires touching engine code. This is the
whole point of the plugin architecture, and this document is the proof.

## 1. The three levels

Pick the lowest one that does the job.

| Level | Mechanism | Covers |
| --- | --- | --- |
| **1. Stats** | `grants` — declarative numbers | ~90 % of the catalogue |
| **2. Weapon** | a `WeaponProfile` record | anything that fires |
| **3. Hooks** | pure functions over simulation events | protocols and exotica |

## 2. Level 1 — a stat part

```ts
export const COOLANT_LOOP: Part = {
  id: partId('mod.coolant_loop'),
  name: 'COOLANT LOOP',
  socket: 'MODULE',
  house: 'CINDER',
  tier: 2,
  cost: cost(95, 14, 4),           // mass kg, power PU, cycles CY
  grants: { heatSink: 6, heatCapacity: 70 },
  description: 'Capacity and dissipation together.',
  price: 650,
};
```

Export it from the file's `ALL_*` array and it appears in the Forge. That is
the entire process — no registration, no switch statement, no engine change.

Two things worth knowing about `grants`:

- Flat fields (`armour`, `heatSink`, `structure`, …) **sum**.
- `*Mult` fields (`speedMult`, `coolingMult`, `damageMult`, …) **multiply**.
- `evasion` is scaled by the frame's agility; `evasionFlat` is not. Use the
  latter for a module, the former for locomotion.

## 3. Level 2 — a weapon

Weapon damage is **not a free choice**. It is solved from the balance model so
the part lands inside the efficiency band; `tests/balance/weapons.test.ts` will
tell you the exact figure if you get it wrong:

```
MK-IV RAILSPIKE efficiency 1.340 is outside [0.88, 1.12].
Adjust its damage to 36 to re-centre it.
```

So the workflow is: decide the weapon's **character** first — range band, heat
pressure, energy cost, magazine, mass, power, pierce — then run the suite and
take the damage figure it gives you. You are choosing what the weapon *feels*
like; the model prices it.

```ts
export const BEAM_LANCE: Part = {
  id: partId('arm.beam_lance'),
  name: 'BEAM LANCE',
  socket: 'ARM',
  house: 'CINDER',
  tier: 2,
  cost: cost(160, 28),
  grants: {},
  weapon: weapon({
    damageType: 'THERMAL',
    damage: 60,                                  // solved, not chosen
    shots: 1,
    cooldown: 1.35,
    range: range(0, 50, 80, 0.75),               // min, optimal, max, falloff
    accuracy: 112,
    heatCost: 18,
    energyCost: 13,
    magazine: Infinity,                          // energy weapons never run dry
    pierce: 0.35,
  }),
  description: 'The anti-armour standard.',
  price: 800,
};
```

### Range bands the catalogue uses

| Band | Optimal | Falloff | Character |
| --- | --- | --- | --- |
| Point blank | 12–24 m | 0.35–0.50 | Huge burst, irrelevant past 30 m |
| Close | 30–40 m | 0.55–0.60 | The default brawling band |
| Mid | 48–60 m | 0.60–0.75 | Reliable; where most fights settle |
| Long | 70–85 m | 0.60–0.75 | Controls the opening, heavy and slow |

Range is expensive: `RANGE_SLOPE` is 0.85, so an 80 m weapon is charged nearly
twice what a 12 m one is. That was a deliberate correction — outranging an
opponent is worth far more than the model originally priced it at.

## 4. Level 3 — a hook

Hooks are pure: they read a context and return a description of what they want.
They never mutate. Only `sim/apply.ts` enacts an effect.

```ts
hooks: {
  modifyOutgoingDamage: ({ self }) =>
    self.heatRatio > 0.70 ? { damageMult: 1.20 } : {},

  onTick: ({ self }) =>
    self.heatRatio > 0.70 ? [{ kind: 'heatGenMult', value: 1.15 }] : [],
}
```

### Hook memory

A part that needs to remember something uses the `memory` object the simulation
hands it — one per part, per frame, per match:

```ts
onEvent: ({ event, self, memory }) => {
  if (event !== 'ENTERED_CRITICAL' || memory.used === 1) return [];
  memory.used = 1;
  return [{ kind: 'heat', delta: -self.heat * 0.35 }];
},
```

**Never close over module-level state to get memory.** A closure is shared by
every frame using the part and by every match in a balance run, which silently
destroys determinism — the bug is invisible until a replay stops reproducing.
The scratch space exists so you never have to.

### Available effects

`heat`, `heatGenMult`, `energy`, `structure`, `shield`, `armour`,
`evasionBonus`, `damageMult`, `log`. Adding a new one is a `case` in
`sim/apply.ts` plus a union member in `domain/part.ts`.

### Available events

`SHIELD_BROKEN`, `ENTERED_CRITICAL`, `ENTERED_OVERLOAD`, `DEALT_DAMAGE`,
`TOOK_DAMAGE`, `STAGGERED`. They are deduplicated per tick, so a frame hit four
times in one tick raises `TOOK_DAMAGE` once.

## 5. Adding a chassis

A chassis is not a part — it defines the shape of the problem. Its mass limit
is derived rather than felt:

```
massLimit = chassisMass x 1.2
          + 0.87 x SUM(socketCount x typicalPartMass[socket])
```

with `CORE 175, ARM 160, SHOULDER 250, LOCOMOTION 190, PLATING 175, MODULE 90`.
The `0.87` is what makes a chassis unable to fill every socket with a
mid-weight part, and that shortfall *is* the game.

Give every chassis an innate trait via `grants`. This is not decoration: without
it, "more sockets" simply meant "more of everything", and the fortress chassis
won 98 % of the archetype matrix. A chassis with more mounts must pay for them.

## 6. Adding an arena

Arenas are data plus two rules you must not break:

1. **Never place a pylon within its radius + ~3 m of a spawn point.** Spawns sit
   at `(width/2 ± 35, height/2)`. Violating this once caused 27 % of all matches
   to end 0–0 with neither frame ever firing a shot — they had no line of sight
   from the opening tick. `tests/engine/sim.test.ts` now asserts this for every
   arena, because the failure is silent.
2. Keep every feature inside the bounds.

## 7. The checklist

```
npm run typecheck   # types
npm test            # invariants, determinism, purity, balance
npm run balance     # the archetype matrix, verbose
```

The balance suites are the ones to watch. They will tell you, in seconds:

- whether your weapon is priced correctly, and what damage would fix it;
- whether you have just handed one archetype a dominant win rate;
- whether matches still resolve inside the pacing window.

A red balance suite is a design conversation, not a build break — but it is a
conversation you want to have before a player does.
