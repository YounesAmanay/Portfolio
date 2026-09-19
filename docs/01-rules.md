# ARCFORGE — The Rulebook

Normative spec. The engine implements this document; where they disagree, this document
is the bug report. Every constant named here lives in exactly one place in code:
[`src/engine/tuning.ts`](../src/engine/tuning.ts). No magic numbers anywhere else.

---

## 1. Units and the tick

| Quantity | Unit | Symbol |
| --- | --- | --- |
| Distance | metres | m |
| Time | seconds | s |
| Mass | kilograms | kg |
| Structure / damage | structure points | sp |
| Power | power units | PU |
| Cycles | cycles | CY |
| Heat | heat units | hu |
| Energy | energy units | EN |

The simulation runs at a **fixed timestep of 20 Hz** (`TICK = 0.05 s`). There is no
variable delta anywhere in the engine; rendering interpolates, the sim never does.
A match is capped at **180 s = 3600 ticks** (`MATCH_LIMIT_TICKS`).

Doctrine is re-evaluated every **5 ticks (4 Hz, 250 ms)** — `DECISION_INTERVAL_TICKS`.
This is a deliberate reaction-latency budget: a robot cannot respond to a state change
faster than a quarter second, which is what makes predictive doctrine (acting on a
*trend*, not a *threshold*) actually valuable.

### 1.1 Determinism contract

A match is a pure function:

```
resolve(buildA, buildB, arenaId, seed) -> MatchResult
```

Guaranteed by five rules the engine never breaks:

1. All randomness comes from one seeded PRNG (`mulberry32`), threaded explicitly. No
   `Math.random()` exists in `src/engine`.
2. Fixed timestep only. No wall-clock time is read.
3. Iteration over entities is by stable sorted index, never by object/`Map` insertion
   accident or `Set` order.
4. No floating-point non-determinism: only `+ - * /`, `Math.sqrt`, `Math.min/max`,
   `Math.floor/abs`. **No** `Math.sin/cos/pow/exp/hypot` in damage-affecting paths —
   these are not bit-identical across engines. Angles use a precomputed lookup or
   vector maths instead.
5. The engine imports nothing from `src/ui` and touches no DOM, no `Date`, no I/O.
   Enforced by a test (`tests/engine/purity.test.ts`).

---

## 2. The frame: sockets

A **Build** is one *Chassis* plus parts plugged into the sockets that chassis exposes.
The chassis is the only non-socketed choice; it defines the socket layout, base
structure, and the mass limit everything else must fit inside.

| Socket | Count | What plugs in | Primary contribution |
| --- | --- | --- | --- |
| `CORE` | exactly 1 | Reactor | Power (PU), Cycles (CY), Energy cap + regen, base heat capacity |
| `ARM` | 0–2 | Weapons | Damage output |
| `SHOULDER` | 0–2 | Heavy weapons / launchers | Burst damage, usually mass-hungry |
| `LOCOMOTION` | exactly 1 | Legs / treads / hover | Speed, evasion, stagger resistance |
| `PLATING` | 1–3 | Armour layers | Armour (AR), structure, mass |
| `MODULE` | 1–4 | Utility systems | Shields, cooling, targeting, repair |
| `PROTOCOL` | 0–2 | Software | Passive rule modifiers — no mass, costs cycles |

`CORE` and `LOCOMOTION` are mandatory; a build missing either is invalid. `PLATING` and
`MODULE` have at least one socket on every chassis. Empty optional sockets are legal —
running a weapon slot empty to save mass and power is a real strategy.

**Protocols** are the deepest plugin layer: they carry zero mass, cost only cycles, and
modify the *rules* rather than the stats (e.g. `OVERDRIVE` converts surplus heat into
damage; `LAST_STAND` trades armour for damage below 25 % structure). See §11.

---

## 3. The four budgets

A build is legal only if it satisfies all four simultaneously. This is the central
optimisation problem of the game — four constraints that pull in different directions,
so there is no globally dominant part.

```
B1  MASS     Σ part.mass                    ≤  chassis.massLimit
B2  POWER    Σ part.powerDraw               ≤  core.powerOutput
B3  CYCLES   Σ part.cycleDraw + doctrineCost ≤  core.cycleOutput
B4  SOCKETS  every part in a socket it fits; CORE and LOCOMOTION filled
```

Where `doctrineCost = ruleCount × DOCTRINE_RULE_COST` (`DOCTRINE_RULE_COST = 2 CY`).

Budgets are **hard limits**, not soft penalties. An illegal build cannot be deployed.
The interesting pressure is that mass is *also* soft-penalised well below its limit:

### 3.1 Load and agility — the mass ratio

```
load             = totalMass / chassis.massLimit          ∈ [0, 1]
agilityMultiplier = AGILITY_BASE − AGILITY_SLOPE × load
                  = 1.25 − 0.50 × load                    ∈ [0.75, 1.25]
```

`agilityMultiplier` scales **speed** and **evasion**. Consequences, which are the whole
reason mass is interesting:

| Load | Agility × | Read |
| --- | --- | --- |
| 0.20 | 1.15 | Skirmisher. Fast and slippery, but you gave up armour and guns to get here. |
| 0.50 | 1.00 | Neutral. The baseline every part is tuned against. |
| 0.75 | 0.875 | Line fighter. Paying ~12 % mobility for real durability. |
| 1.00 | 0.75 | Fortress. Legal, but 25 % slower and easier to hit — must win the damage race. |

So mass is never "free until the cap". Every kilogram costs mobility linearly, and the
cap is just where it stops being *possible*. A build at 99 % load is legal and often bad.

---

## 4. Derived stats

Stats are **never stored** on a build — they are compiled from parts on demand by
`compileFrame()`. There is exactly one code path that turns parts into numbers, so a
part can never disagree with the UI about what it does.

Compilation order matters and is fixed:

```
1. seed from chassis base stats
2. add every part's flat contribution      (additive, order-independent)
3. apply every part's multiplicative mod   (sorted by part id for determinism)
4. apply load/agility scaling              (needs final mass -> must come after 2)
5. clamp to legal ranges
```

| Stat | Symbol | Formula |
| --- | --- | --- |
| Structure | `SP` | `chassis.structure + Σ plating.structure` |
| Armour | `AR` | `Σ plating.armour + Σ module.armour` |
| Mass | `kg` | `chassis.mass + Σ part.mass` |
| Heat capacity | `HC` | `core.heatCapacity + Σ part.heatCapacity` |
| Heat dissipation | `HS` | `(core.heatSink + Σ part.heatSink) × coolingMult` |
| Energy capacity | `EC` | `core.energyCapacity + Σ part.energyCapacity` |
| Energy regen | `ER` | `core.energyRegen + Σ part.energyRegen` |
| Shield capacity | `SH` | `Σ module.shieldCapacity` |
| Shield regen | `SR` | `Σ module.shieldRegen` |
| Speed | `m/s` | `locomotion.speed × agilityMultiplier × Σ speedMult` |
| Evasion | `EV` | `locomotion.evasion × agilityMultiplier + Σ evasionFlat` |
| Targeting | `TG` | `TARGETING_BASE(=100) + Σ part.targeting` |
| Crit chance | `CC` | `CRIT_BASE(=0.05) + Σ part.critChance` |
| Crit multiplier | `CM` | `CRIT_MULT_BASE(=1.75) + Σ part.critMult` |
| Stagger resist | `SR%` | `locomotion.staggerResist + Σ part.staggerResist` |

---

## 5. The damage pipeline

The single most important algorithm in the game. Damage passes through three layers in a
fixed order — **Shield → Armour → Structure** — and each of the three damage types
interacts with each layer differently. That 3×3 interaction *is* the combat triangle.

### 5.1 Step 1 — can we fire?

A weapon fires on tick `t` only if all hold:

```
cooldownRemaining ≤ 0
energy ≥ weapon.energyCost
ammo   > 0                    (if weapon.magazine is finite)
state  ≠ OVERLOADED  ∧  state ≠ VENTING
distance ≤ weapon.maxRange
```

### 5.2 Step 2 — range factor

Every weapon has a range profile `(minRange, optimalRange, maxRange, falloff)`:

```
d < minRange                 -> rangeFactor = POINT_BLANK_PENALTY (0.50)
minRange ≤ d ≤ optimalRange  -> rangeFactor = 1.00
optimal < d ≤ maxRange       -> rangeFactor = lerp(1.00, falloff, (d−optimal)/(max−optimal))
d > maxRange                 -> cannot fire
```

`falloff` is typically `0.55` for ballistics, `0.75` for beams (which lose less over
distance), `0.35` for shotguns. This is what makes positioning and locomotion matter
even though the player never steers.

### 5.3 Step 3 — hit chance

```
accScore  = weapon.accuracy × (TG / 100) × rangeFactor × heatAccPenalty × moveAccPenalty
hitChance = clamp( accScore / (accScore + target.EV), HIT_FLOOR, HIT_CEIL )
```

with `HIT_FLOOR = 0.05`, `HIT_CEIL = 0.95`.

The ratio form gives evasion **diminishing returns** — you can never become untouchable,
and stacking evasion past a point is wasted mass:

| accScore | EV = 0 | EV = 40 | EV = 80 | EV = 140 |
| --- | --- | --- | --- | --- |
| 100 | 0.95 | 0.71 | 0.56 | 0.42 |
| 140 | 0.95 | 0.78 | 0.64 | 0.50 |
| 70 | 0.95 | 0.64 | 0.47 | 0.33 |

`moveAccPenalty = 1.0` when stationary, `MOVING_ACC_PENALTY = 0.88` while moving,
`VENTING_ACC_PENALTY = 0.50` while venting.

### 5.4 Step 4 — raw damage

```
raw = weapon.damage × critMult × overdriveMult
critMult = CM if roll < CC else 1.0
```

### 5.5 Step 5 — the shield layer

```
shieldDamage = raw × SHIELD_MULT[type]
absorbed     = min(shield, shieldDamage)
shield      -= absorbed
carryOver    = (shieldDamage − absorbed) / SHIELD_MULT[type]   // un-scale the remainder
```

`SHIELD_MULT` — how hard each type hits a shield:

| Type | `SHIELD_MULT` | Why |
| --- | --- | --- |
| `KINETIC` | **1.30** | Mass drivers overwhelm field geometry. |
| `THERMAL` | **0.70** | Fields diffuse heat efficiently — beams are the *worst* shield-breaker. |
| `ION` | **1.60** | Shields are an electromagnetic construct; ion unmakes them. |

If the shield reaches 0 this tick it **breaks**: regen halts for `SHIELD_REBOOT_DELAY = 4.0 s`.
Any hit while shields are up also resets the regen delay to `SHIELD_HIT_DELAY = 1.2 s`.

### 5.6 Step 6 — the armour layer

```
effectiveAR = AR × ARMOR_FACTOR[type] × (1 − weapon.pierce)
mitigation  = min( effectiveAR / (effectiveAR + ARMOR_K), ARMOR_MAX_MITIGATION )
             with ARMOR_K = 120, ARMOR_MAX_MITIGATION = 0.85
postArmour  = carryOver × (1 − mitigation)
```

`ARMOR_FACTOR` — how well armour performs against each type:

| Type | `ARMOR_FACTOR` | Why |
| --- | --- | --- |
| `KINETIC` | **1.35** | Plating is literally designed to stop slugs. |
| `THERMAL` | **0.70** | Sustained beams melt through; armour is 30 % less effective. |
| `ION` | **1.00** | Ion ignores material properties — neutral. |

The hyperbolic curve `AR/(AR+120)` gives smooth diminishing returns with no cliff:

| AR | Mitigation | AR | Mitigation |
| --- | --- | --- | --- |
| 0 | 0 % | 200 | 62.5 % |
| 40 | 25.0 % | 280 | 70.0 % |
| 80 | 40.0 % | 400 | 76.9 % |
| 120 | 50.0 % | 680 | 85.0 % (cap) |

Reading the ratio: **every +120 AR halves incoming damage again.** That is the rule of
thumb the whole armour catalogue is tuned around, and it means armour is never a trap
stat but also never a win button.

### 5.7 Step 7 — ablation

Armour degrades. Each hit that reaches the armour layer strips:

```
AR -= postArmour × ABLATION_RATE[type]
AR  = max(AR, 0)
```

with `ABLATION_RATE`: `KINETIC 0.006`, `THERMAL 0.014`, `ION 0.002`.

This is why thermal is the *anti-armour* type twice over: it is mitigated less **and**
it strips armour 2.3× faster, so a fortress build degrades over a long fight. Ablated
armour does not regenerate (barring a repair module).

### 5.8 Step 8 — structure

```
structure -= postArmour × STRUCTURE_FACTOR[type]
```

| Type | `STRUCTURE_FACTOR` |
| --- | --- |
| `KINETIC` | **1.00** |
| `THERMAL` | **1.00** |
| `ION` | **0.45** |

Ion is *bad* at killing. Its payload is §5.9.

### 5.9 Step 9 — on-hit side effects

| Type | Side effect on target |
| --- | --- |
| `KINETIC` | `stagger += weapon.stagger` |
| `THERMAL` | `heat += raw × THERMAL_HEAT_TRANSFER (0.30)` — you cook them |
| `ION` | `energy −= raw × ION_ENERGY_DRAIN (0.55)`, `heat += raw × ION_HEAT_TRANSFER (0.22)` |

So an ion build wins not by destroying the enemy but by **pushing them into overload**
and leaving them unable to fire. Against a heavy thermal build with marginal cooling,
ion is devastating. Against a low-heat kinetic brawler with a big energy pool, it is
close to useless. That asymmetry is intended and is the reason all three types survive.

### 5.10 Stagger

```
stagger accumulates; decays at STAGGER_DECAY = 15 /s
on stagger ≥ STAGGER_THRESHOLD (100):
    stagger  = 0
    interrupt target for STAGGER_DURATION = 0.6 s   (cannot fire or move)
effective gain = weapon.stagger × (1 − target.staggerResist)
```

Stagger is kinetic's compensation for being the worst type against armour: it denies
*time*, which no other type can do.

### 5.11 Worked example

`MK-IV RAILSPIKE` (kinetic, 52 dmg, pierce 0.25, stagger 34) firing on a target
with `SH 150, AR 180, SP 900, staggerResist 0.20`, no crit, in optimal range.

Shots 1 and 2 are absorbed entirely by the shield:

```
shieldDamage = 52 x 1.30 = 67.6 each
shield: 150 -> 82.4 -> 14.8
carryOver = 0 both times   (nothing reaches armour)
stagger  += 34 x (1 - 0.20) = 27.2 each
```

Shot 3 breaks through:

```
shieldDamage = 67.6
absorbed     = min(14.8, 67.6)        = 14.8   -> shield 0, BREAKS, 4 s reboot
carryOver    = (67.6 - 14.8) / 1.30   = 40.6154
effectiveAR  = 180 x 1.35 x (1-0.25)  = 182.25
mitigation   = 182.25 / (182.25+120)  = 0.602978
postArmour   = 40.6154 x 0.397022     = 16.1252
structure   -= 16.1252 x 1.00         -> SP 900 -> 883.8748
AR          -= 16.1252 x 0.006        -> AR 180 -> 179.9032
stagger      = 81.6                   (staggers on the next hit, at 108.8)
```

Note how badly kinetic performs into armour once the shield is down: 52 raw
became 16.13 actual, an **effective mitigation of 69 %**.

A thermal weapon of identical raw damage, against the same armour:

```
effectiveAR  = 180 x 0.70 x (1-0.25)  = 94.5
mitigation   = 94.5 / (94.5+120)      = 0.440559
postArmour   = 40.6154 x 0.559441     = 22.7218   (+41% vs kinetic)
AR          -= 22.7218 x 0.014        = 0.3181    (3.3x the ablation)
```

**+41 % damage through the same plate, and it strips that plate 3.3x faster.**
Over a 45-second fight those two effects compound: thermal is the anti-armour
type twice over, which is what stops fortress builds from being unconditionally
correct. In exchange, kinetic took 135 points of shield off the target in the
time thermal would have taken 73 — and denied the target 0.6 s of action with
the stagger. This is the triangle doing its job.

## 6. Heat — the strategic resource

Heat accumulates across the *whole match* and never fully resets. It is the reason a
build cannot simply mount maximum firepower.

```
each tick:  heat += Σ generated
            heat −= HS × TICK × ventMultiplier
            heat  = clamp(heat, 0, HEAT_HARD_CAP = HC × 1.5)
heatRatio  = heat / HC
```

| Band | `heatRatio` | State | Effects |
| --- | --- | --- | --- |
| Nominal | `< 0.70` | `NOMINAL` | none |
| Strain | `0.70 – 0.90` | `STRAIN` | accuracy ×0.85, speed ×0.90, dissipation ×0.95 |
| Critical | `0.90 – 1.00` | `CRITICAL` | accuracy ×0.70, speed ×0.80, cooldowns ×1.25 |
| Overload | `≥ 1.00` | `OVERLOADED` | **shutdown** |

**Overload** is the fail state, and it is severe on purpose:

```
duration        : until heatRatio ≤ OVERLOAD_RECOVERY (0.40), min OVERLOAD_MIN_TICKS (3.0 s)
cannot fire, cannot move, cannot vent
evasion         × OVERLOAD_EVASION_MULT (0.25)   -> you get hit by almost everything
structure      −= SP_max × OVERLOAD_BURN (0.008) per second
dissipation     × OVERLOAD_COOLING_MULT (2.5)    -> emergency purge
```

An overload against a competent opponent is usually the match. This is the punishment
that makes cooling a real budget line rather than an afterthought.

**Venting** is the doctrine action that avoids it:

```
dissipation × VENT_MULTIPLIER (4.0)
speed       × VENT_SPEED_MULT (0.30)
accuracy    × VENTING_ACC_PENALTY (0.50)
max duration VENT_MAX_DURATION (2.0 s), cooldown VENT_COOLDOWN (3.0 s)
```

Venting is deliberately a *bad time* — you are slow and inaccurate. Choosing when to eat
that cost is one of the most consequential doctrine decisions in the game.

---

## 7. Energy — the tactical resource

```
each tick: energy += ER × TICK ; energy = clamp(energy, 0, EC)
firing:    energy −= weapon.energyCost   (refused if insufficient)
```

Energy regenerates in seconds, so it gates **burst rate**, not endurance. A build with
`EC 120, ER 22/s` firing a 40-EN beam sustains one shot every 1.8 s regardless of the
weapon's own cooldown. Reading that interaction correctly is a core Forge skill —
see [02-balance.md §4](./02-balance.md).

## 8. Ammunition

Kinetic weapons carry a finite magazine. When `ammo = 0` the weapon is dead for the rest
of the match; there is no reloading in the Lattice. Ammo is what stops HAVOC builds from
simply out-sustaining everyone: they have the best damage-per-heat in the game and the
only hard ceiling on total output.

`AMMO_MASS_PER_ROUND` is folded into each weapon's listed mass — a magazine upgrade
module trades mass for rounds at a fixed, documented exchange rate.

---

## 9. Movement and the arena

The arena is a flat rectangle, `120 m × 80 m`, with static obstacles (**pylons**) and
zones. Both frames spawn on the long axis, `ARENA_SPAWN_SEPARATION = 70 m` apart.

Movement is velocity-based with no momentum (frames are walkers, not vehicles):

```
desired  = unit(targetPoint − position) × speed
position = position + desired × TICK
```

collision: circle-vs-circle against pylons and the opponent, radius from chassis. On
collision the movement is projected along the surface tangent (slide, never stop).

### 9.1 Arena features

| Feature | Effect |
| --- | --- |
| **Pylon** | Blocks movement and line of sight. Weapons require LoS unless `arcing`. |
| **Coolant vent** | Standing in it: dissipation ×`VENT_ZONE_MULT (1.8)`. Contested ground. |
| **Ion storm** | Standing in it: `energy −= 6/s`. Punishes camping. |
| **Rubble** | Speed ×0.75, evasion +10. Trade mobility for survivability. |

Arena selection is part of the match seed, so an Architect cannot tune for one map only.

---

## 10. Doctrine — programming the mind

A Doctrine is an **ordered list of rules**, evaluated top-down every `DECISION_INTERVAL_TICKS`.
**The first rule whose condition is true wins**; evaluation stops there. This makes
doctrine authoring a priority-ordering problem, which is both easy to teach and deep to
master.

```
RULE := WHEN <condition> THEN <action>
```

### 10.1 Conditions

| Condition | Parameter | True when |
| --- | --- | --- |
| `ALWAYS` | — | always (the mandatory fallback, last rule) |
| `SELF_HEAT_ABOVE` | ratio | `heatRatio > p` |
| `SELF_HEAT_BELOW` | ratio | `heatRatio < p` |
| `SELF_STRUCTURE_BELOW` | ratio | `structure/max < p` |
| `SELF_SHIELD_DOWN` | — | `shield = 0` |
| `SELF_ENERGY_BELOW` | ratio | `energy/EC < p` |
| `ENEMY_WITHIN` | metres | `distance < p` |
| `ENEMY_BEYOND` | metres | `distance > p` |
| `ENEMY_STRUCTURE_BELOW` | ratio | enemy `structure/max < p` |
| `ENEMY_OVERLOADED` | — | enemy state is `OVERLOADED` |
| `ENEMY_SHIELD_UP` | — | enemy `shield > 0` |
| `TIME_AFTER` | seconds | `elapsed > p` |
| `AMMO_BELOW` | ratio | any kinetic weapon below `p` of magazine |

### 10.2 Actions

| Action | Behaviour |
| --- | --- |
| `ENGAGE` | Close to the *best* weapon's optimal range, fire everything in range. |
| `KITE` | Hold at max optimal range, back off if the enemy closes. Fire in range. |
| `CHARGE` | Close to minimum distance regardless of cost. Fire everything. |
| `RETREAT` | Move directly away. Fire only if a weapon is already in range. |
| `ORBIT` | Strafe at current range at `ORBIT_SPEED_FACTOR (0.85)`. Maximises evasion uptime. |
| `VENT` | Stop, purge heat (§6). Only legal if not overloaded. |
| `BRACE` | Stop moving. Evasion ×0.6 but armour ×`BRACE_ARMOR_MULT (1.30)` and accuracy ×1.15. |
| `SEEK_COOLANT` | Move to the nearest coolant vent zone, then vent. |
| `FOCUS` | `ENGAGE`, but only fire the weapon whose type the enemy is *weakest* to. |

### 10.3 Cost and limits

Each rule costs `DOCTRINE_RULE_COST = 2 CY` against budget B3. `MAX_DOCTRINE_RULES = 8`.
A doctrine must end with an `ALWAYS` rule; the compiler appends `WHEN ALWAYS THEN ENGAGE`
if the author omits it.

**This is the elegant part of the economy**: doctrine competes for cycles with modules.
A 7-rule doctrine costs 14 CY, which is a targeting computer you now cannot fit. Being
clever costs the same currency as being equipped, and choosing between them is the game.

### 10.4 A worked doctrine

```
1  WHEN SELF_HEAT_ABOVE 0.82        THEN SEEK_COOLANT
2  WHEN ENEMY_OVERLOADED            THEN CHARGE
3  WHEN SELF_STRUCTURE_BELOW 0.30   THEN KITE
4  WHEN ENEMY_WITHIN 18             THEN BRACE
5  WHEN ALWAYS                      THEN ENGAGE
```

Reads as: never overload; punish theirs; survive when low; brawl when cornered; else
fight normally. Cost: 10 CY.

---

## 11. Protocols

Protocols are passive rule-modifiers — the plugin layer that changes *mechanics*, not
numbers. Zero mass, cycles only. Maximum 2.

| Protocol | CY | Effect |
| --- | --- | --- |
| `OVERDRIVE` | 6 | While `heatRatio > 0.70`, damage ×1.20. Heat generation ×1.15. |
| `LAST_STAND` | 5 | Below 25 % structure: damage ×1.35, armour ×0.70. |
| `PHASE_SHIFT` | 8 | On shield break: +40 evasion for 3 s. |
| `HEAT_SINK_PURGE` | 4 | On reaching `CRITICAL`, one free instant purge of 35 % heat. Once per match. |
| `AMMO_DISCIPLINE` | 4 | Kinetic weapons hold fire beyond optimal range. Effective magazine +25 %. |
| `ADAPTIVE_PLATING` | 7 | After taking 400 damage of one type, +25 % `ARMOR_FACTOR` vs that type. |
| `TARGET_ANALYSIS` | 6 | Every 5 s of sustained fire on the enemy: +4 % damage, stacking to +20 %. |
| `KILL_PROTOCOL` | 5 | Enemy below 20 % structure: accuracy ×1.25, crit chance +10 %. |

---

## 12. Victory

A match ends when:

1. **Destruction** — a frame's structure reaches 0. The other wins.
2. **Timeout** — 180 s elapse. Decided on **damage ratio**:
   `scoreX = 1 − structureX/maxStructureX`; higher score wins.
3. **Double KO** — both reach 0 on the same tick. Draw.
4. **Stalemate** — if timeout scores are within `STALEMATE_EPSILON = 0.02`, draw.

### 12.1 Rating

Standard Elo, with a K-factor that decays as rating rises so the top of the ladder is
stable:

```
expected(A) = 1 / (1 + 10^((ratingB − ratingA) / 400))
K           = 32  if rating < 2000
              24  if 2000 ≤ rating < 2400
              16  if rating ≥ 2400
newRating   = round(rating + K × (score − expected))
```

`score` is 1 / 0.5 / 0 for win / draw / loss. Provisional Architects (fewer than 10
matches) use `K = 48` to converge quickly. Floor is 100; there is no ceiling.

### 12.2 Rewards

```
credits = BASE_REWARD(120) × (win ? 1.0 : 0.4)
        + damageDealtRatio × DAMAGE_BONUS(80)
        + (upset ? upsetBonus : 0)
upsetBonus  = max(0, (opponentRating − rating) / 10)
salvageRoll = win ∧ rng < SALVAGE_CHANCE(0.35)  -> one random part from the loser's build
```

Losing always pays something (40 %). A ladder that pays nothing for a close loss teaches
players to avoid hard matches, which is the opposite of what we want.
