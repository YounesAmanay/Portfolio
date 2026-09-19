# ARCFORGE — Balance Model

The catalogue is not tuned by feel. Every part is priced by a formula, and the formula
is enforced by a test suite (`tests/balance/`) that fails CI when a part drifts out of
band. This document is that formula.

---

## 1. The reference frame

All balance is expressed relative to one fictional baseline, the **Reference Frame**.
It is not a real build; it is the ruler.

| Property | Reference value | Rationale |
| --- | --- | --- |
| Structure | `900 sp` | Mid chassis + mid plating |
| Armour | `140 AR` | ≈ 54 % mitigation — "half your damage gets through" |
| Shield | `120 SH` | One good burst |
| Effective HP vs kinetic | `~2 100 sp` | see §1.1 |
| Load | `0.50` | agility ×1.00 |
| Speed | `8.0 m/s` | crosses the 120 m arena in 15 s |
| Evasion | `55 EV` | vs accScore 100 → 64.5 % hit rate |
| Heat capacity | `220 hu` | |
| Heat dissipation | `18 hu/s` | |
| Energy | `140 EC, 24 ER` | |
| **Target TTK** | **`45 s`** | The single most important number in the game |

### 1.1 Effective HP

Raw structure understates durability because armour multiplies it. The honest measure:

```
eHP(type) = SH / SHIELD_MULT[type]
          + SP / ((1 − mitigation(AR, type)) × STRUCTURE_FACTOR[type])
```

For the Reference Frame (`SH 120, AR 140, SP 900`):

| Incoming type | mitigation | eHP | Read |
| --- | --- | --- | --- |
| `KINETIC` | `189/(189+120) = 61.2 %` | `92 + 2 320 = 2 412` | armour shines |
| `THERMAL` | `98/(98+120) = 45.0 %` | `171 + 1 636 = 1 807` | armour struggles |
| `ION` | `140/(140+120) = 53.8 %` | `75 + 4 329 = 4 404` | ion can't kill |

**The spread is the game.** The same frame is 1.33× tougher against kinetic than thermal
and 2.4× tougher against ion. No single damage type is correct against every build, so
the Forge always has a real question in it.

### 1.2 Why TTK = 45 s

Match limit is 180 s. A 45 s target TTK means:

- A clean matchup resolves in ~45 s — long enough for heat and ammo to matter, short
  enough to watch without drifting off.
- A *bad* matchup (2.4× eHP, e.g. pure ion into a brawler) runs ~108 s and still
  resolves before timeout — so hard counters win, but slowly, and the loser has a real
  window to turn it around with doctrine.
- A *mirror* of two maximum-durability fortresses hits timeout and is decided on damage
  ratio. This is intended: turtling is a valid strategy that cannot *win*, only draw.

Working backwards, the required sustained damage output is:

```
requiredDPS = eHP_reference(kinetic ≈ 2 412) / 45 s ≈ 54 sp/s
```

**Every legal build must reach roughly 54 effective DPS.** This is the anchor the whole
weapon catalogue is priced against.

---

## 2. Weapon pricing — the WPR/WCR model

### 2.1 Threat (what it gives you)

```
cycleTime     = cooldown + (shots − 1) × burstDelay
sustainedDPS  = damage × shots × EXPECTED_HIT_RATE / cycleTime      EXPECTED_HIT_RATE = 0.65
rangeScore    = RANGE_BASE + RANGE_SLOPE × (optimalRange / RANGE_REF)
              = 0.80 + 0.40 × (optimalRange / 60)
uptimeFactor  = min(1, magazineDuration / REFERENCE_FIGHT)          REFERENCE_FIGHT = 60 s
                magazineDuration = (magazine / shots) × cycleTime, ∞ for energy weapons

WPR = sustainedDPS × rangeScore × uptimeFactor
```

`uptimeFactor` is how ammo is paid for: a mass driver that empties in 40 s is allowed to
be 1.5× stronger per shot than an equivalent beam, because for the last two thirds of a
long match it is a paperweight.

### 2.2 Cost (what it takes from you)

```
heatPressure = heatCost   × shots / cycleTime     (hu/s)
enPressure   = energyCost × shots / cycleTime     (EN/s)

WCR = mass         × MASS_WEIGHT   (0.045)
    + powerDraw    × POWER_WEIGHT  (0.180)
    + heatPressure × HEAT_WEIGHT   (0.550)
    + enPressure   × EN_WEIGHT     (0.300)
```

The weights encode a design opinion, and each is derived, not guessed:

- **`HEAT_WEIGHT` is the largest** because heat is the only cost that compounds. 1 hu/s
  of pressure against the reference 18 hu/s dissipation consumes 5.6 % of your entire
  thermal budget, permanently, for the whole match.
- **`POWER_WEIGHT`** — a reference core supplies ~130 PU, so 1 PU ≈ 0.77 % of total power.
- **`MASS_WEIGHT`** — a reference chassis allows ~1 200 kg, so 10 kg ≈ 0.83 % of the
  mass budget, and via §3.1 also ≈ 0.42 % of agility.
- **`EN_WEIGHT`** is lowest because energy regenerates — it throttles burst, not totals.

### 2.3 The balance invariant

```
efficiency(part) = WPR / WCR        must fall in [0.88, 1.12]
```

Enforced by `tests/balance/weapons.test.ts`. A part outside the band is a balance bug,
and the test prints the exact figure so the fix is mechanical rather than a debate.

Deliberate placement *inside* the band is how a part gets a personality: an efficiency
of 0.90 with an enormous magazine is a "reliable but unexciting" gun, and 1.10 with
crippling heat is a "glass cannon". The band keeps both playable.

### 2.4 Worked pricing — `MK-IV RAILSPIKE`

The catalogue's reference kinetic rifle, as actually shipped:

```
damage 52, shots 1, cooldown 1.45 s, optimal 55 m, magazine 52
mass 165 kg, power 22 PU, heat 10 hu, energy 5 EN

cycleTime        = 1.45
sustainedDPS     = 52 x 1 x 0.65 / 1.45          = 23.310
rangeScore       = 0.80 + 0.40 x (55/60)         = 1.16667
magazineDuration = 52 x 1.45                     = 75.4 s
uptimeFactor     = min(1, 75.4/60)               = 1.000
WPR              = 23.310 x 1.16667 x 1.000      = 27.195

heatPressure     = 10 / 1.45                     = 6.897 hu/s
enPressure       = 5  / 1.45                     = 3.448 EN/s
WCR = 165x0.045 + 22x0.180 + 6.897x0.550 + 3.448x0.300
    = 7.425 + 3.960 + 3.793 + 1.034             = 16.212

WPR / WCR        = 27.195 / 16.212               = 1.6775
```

`WPR` and `WCR` are on different scales, so the raw ratio is not yet a grade.
Dividing by the catalogue-wide reference constant normalises it:

```
EFFICIENCY_NORM = 1.664
efficiency = 1.6775 / 1.664 = 1.008   ✓ in band
```

`EFFICIENCY_NORM` is a single number in `tuning.ts`, derived as the geometric
mean of the catalogue's raw ratios. Re-calibrating every part at once is a
one-line change, and the balance suite immediately reports which parts fell
out of band as a result.

### 2.5 The shipped catalogue

Every weapon, priced by the model above. All sixteen sit inside
`[0.88, 1.12]`; the suite fails the build if any leaves it.

| Weapon | Type | Dmg x shots | Cycle | Optimal | hu/s | EN/s | Uptime | Eff |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Slug Thrower | K | 20 x 1 | 0.70 | 30 m | 5.71 | 2.86 | 1.00 | 1.005 |
| MK-IV Railspike | K | 52 x 1 | 1.45 | 55 m | 6.90 | 3.45 | 1.00 | 1.008 |
| Scattergun | K | 18 x 5 | 1.76 | 12 m | 8.52 | 4.26 | 0.88 | 1.021 |
| Autocannon | K | 24 x 3 | 1.54 | 38 m | 11.69 | 4.87 | 1.00 | 0.982 |
| Missile Pod | K | 34 x 4 | 3.05 | 60 m | 9.18 | 4.59 | 0.91 | 1.000 |
| Siege Mortar | K | 126 x 1 | 3.20 | 75 m | 4.38 | 1.88 | 1.00 | 1.001 |
| Gauss Battery | K | 124 x 1 | 2.80 | 80 m | 5.71 | 3.21 | 1.00 | 1.003 |
| Pulse Laser | T | 25 x 2 | 0.93 | 40 m | 17.20 | 12.90 | 1.00 | 1.003 |
| Beam Lance | T | 68 x 1 | 1.35 | 50 m | 13.33 | 9.63 | 1.00 | 0.993 |
| Plasma Thrower | T | 45 x 2 | 1.20 | 22 m | 23.33 | 13.33 | 1.00 | 0.994 |
| Thermal Array | T | 73 x 2 | 2.12 | 55 m | 18.87 | 12.26 | 1.00 | 1.006 |
| Nova Lance | T | 143 x 1 | 2.40 | 70 m | 16.67 | 11.67 | 1.00 | 0.998 |
| Disruptor | I | 21 x 2 | 1.03 | 32 m | 7.77 | 13.59 | 1.00 | 0.989 |
| Static Web | I | 23 x 3 | 1.34 | 24 m | 8.96 | 15.67 | 1.00 | 1.005 |
| Ion Lance | I | 62 x 1 | 1.50 | 48 m | 4.67 | 11.33 | 1.00 | 0.998 |
| EMP Charge | I | 119 x 1 | 2.80 | 40 m | 2.14 | 7.14 | 1.00 | 0.999 |

Two readings worth drawing out, because they are the model earning its keep:

- **Ion carries enormous raw damage numbers** (EMP Charge at 119) precisely
  because `STRUCTURE_FACTOR.ION = 0.45` means only 45 % of it reaches the
  frame. That 119 lands as ~54 sp of structural damage, 65 EN of drain and
  26 hu of heat. High raw, low kill speed, brutal disruption — which is
  exactly the design brief for the type.
- **Plasma Thrower's 23.3 hu/s** exceeds most cooling in the catalogue by
  itself. That is not a mistake: it is a 22 m weapon with the highest DPS in
  the game, and its heat is the price. The Forge warns about it explicitly.

## 3. Defensive pricing

Armour and structure are priced against the damage they neutralise over the reference
fight, so a defensive part can be compared to a weapon on the same axis.

```
marginalEHP(ΔAR) = SP × [ 1/(1 − mit(AR+ΔAR)) − 1/(1 − mit(AR)) ]     (per type, averaged)
DPR (defence rating) = (ΔSP + marginalEHP) / REFERENCE_FIGHT
DCR (defence cost)   = mass × MASS_WEIGHT + powerDraw × POWER_WEIGHT
                     + agilityLoss × AGILITY_WEIGHT (1.40)
```

`agilityLoss = (mass / chassis.massLimit) × AGILITY_SLOPE` — the mobility a plate costs
via §3.1 of the rulebook, priced explicitly so heavy armour is honestly expensive.

### 3.1 The armour stacking table

Because mitigation is hyperbolic, each plate is worth *more* eHP than the last in
absolute terms, while costing the same mass. That looks broken but is not, because
agility loss is linear and the accuracy it costs you compounds elsewhere:

| AR | mitigation | eHP multiplier | Marginal eHP per +40 AR |
| --- | --- | --- | --- |
| 0 | 0 % | ×1.00 | — |
| 40 | 25.0 % | ×1.33 | +333 sp (on 1 000 SP) |
| 80 | 40.0 % | ×1.67 | +333 sp |
| 120 | 50.0 % | ×2.00 | +333 sp |
| 200 | 62.5 % | ×2.67 | +333 sp per 40 |
| 280 | 70.0 % | ×3.33 | +333 sp per 40 |

**The `AR/(AR+K)` curve makes marginal eHP exactly linear** — `+40 AR` is always worth
`+SP/3` effective HP, at every point on the curve. This is the single most elegant
property of the model: armour is never a trap and never a runaway, so we can price
plating at a flat rate per point and it stays correct at every tier.

Proof: `eHP = SP/(1−AR/(AR+K)) = SP × (AR+K)/K = SP + SP×AR/K`. Linear in `AR`, slope
`SP/K`. With `K = 120` and `SP = 1000`, each `+40 AR` yields `+333 sp`. ∎

What stops infinite stacking is therefore *not* the damage formula — it is mass
(budget B1), socket count (B4), and ablation (§5.7): thermal weapons strip armour, and
the eHP you paid mass for erodes over the match.

---

## 4. The heat economy

The build question every player must answer:

```
heatBalance = Σ weapon.heatPressure − dissipation
```

| `heatBalance` | Meaning |
| --- | --- |
| `< 0` | Sustainable. Fire forever. Usually under-gunned. |
| `0 to +4 hu/s` | **The sweet spot.** Alpha strikes, then a lull. Doctrine matters. |
| `+4 to +10` | Aggressive. Needs `VENT` or `SEEK_COOLANT` in doctrine or you overload. |
| `> +10` | Reckless. You overload in `HC / heatBalance` seconds. Sometimes correct. |

**Time to overload** from cold: `t_overload = HC / heatBalance`. With `HC 220` and
`heatBalance +8`, you have 27.5 seconds of unrestricted fire — well short of the 45 s
TTK. That build *must* solve heat with doctrine, and that is the intended pressure.

### 4.1 Energy throttling

A weapon's *real* rate of fire is the slower of its cooldown and what energy allows:

```
effectiveCycle = max(cycleTime, (energyCost × shots) / ER)
```

A 40-EN beam on a 1.2 s cooldown with `ER 24/s` actually cycles every 1.67 s — a
**28 % damage loss** the part tooltip would never reveal. The Forge UI shows
`effectiveCycle` next to `cycleTime` and flags the gap in amber, because a hidden
throttle is a bad-feeling loss.

---

## 5. Archetypes

Five viable archetypes the catalogue must support. Each is defined by which budget it
saturates — a build that saturates none is under-committed, and one that saturates all
four is infeasible.

| Archetype | House | Saturates | Wins by | Loses to |
| --- | --- | --- | --- | --- |
| **Lancer** | CINDER | Heat | Melting armour fast at mid range | Ion drain, kiting |
| **Bastion** | HAVOC | Mass | eHP + stagger lock, out-lasting | Thermal ablation, timeout |
| **Skirmisher** | any | Sockets | Evasion + range, never being hit | Burst alpha, arena corners |
| **Disruptor** | NULLSET | Cycles | Forcing enemy overload, then killing | Low-heat kinetic, big energy pools |
| **Alpha** | HAVOC/CINDER | Power | One enormous volley | Anything that survives it |

### 5.1 The shipped matrix

Every archetype pair, 24 seeds x 3 arenas. Read a cell as "row beats column".

```
            SKIRM LANCE BASTI DISRU ALPHA
SKIRMISHER    -    0.17  0.44  0.50  0.75
LANCER       0.74   -    0.90  0.24  0.42
BASTION      0.66  0.06   -    0.51  0.76
DISRUPTOR    0.46  0.79  0.78   -    0.13
ALPHA        0.22  0.60  0.28  0.81   -
```

| Archetype | Win rate |
| --- | --- |
| Lancer | 57.5 % |
| Disruptor | 54.0 % |
| Bastion | 49.8 % |
| Alpha | 47.8 % |
| Skirmisher | 46.5 % |

All five sit inside the 42–58 % design goal. Median match is 48.8 s against a
45 s target, and **no match is decided by the clock** — every pairing in the
matrix resolves by destruction.

### 5.1.1 The counter-cycle closes

The matrix contains a genuine five-way cycle, and every edge has a mechanical
reason rather than a tuning nudge:

```
   SKIRMISHER ──0.75──▶ ALPHA ──0.81──▶ DISRUPTOR ──0.79──▶ LANCER
        ▲                                                      │
        │                                                     0.90
        └──────────── 0.66 ──────────── BASTION ◀──────────────┘
```

- **Skirmisher beats Alpha** (0.75) — an alpha build's guns cycle every 2.4–2.8 s.
  Against 104 evasion, most of those volleys miss, and a miss on a 2.8 s cooldown
  is most of a fight.
- **Alpha beats Disruptor** (0.81) — ion frames are paper. Burst kills them
  before the drain accumulates.
- **Disruptor beats Lancer** (0.79) — a thermal build already runs hot; ion adds
  0.22 heat per point of damage and drains the energy its beams need. It
  overloads a Lancer rather than out-damaging it.
- **Lancer beats Bastion** (0.90) — thermal is the anti-armour type twice over:
  mitigated less (`ARMOR_FACTOR` 0.80 vs 1.35) and ablating 2.3× faster.
- **Bastion beats Skirmisher** (0.66) — the cycle closes. 2 400 effective HP
  simply outlasts a frame with 1 700 and two weapon mounts.

The 0.90 in `LANCER > BASTION` is the most extreme cell in the table, and it is
intentional rather than tolerated: a pure fortress with no thermal answer should
lose that matchup decisively. The counter-play exists in the catalogue —
`CERAMIC ABLATOR` makes every point of armour 45 % more effective against
thermal — and a Bastion that fits one is a different fight.

### 5.2 What the suite caught

The matrix is worth its runtime because three of these were invisible to
inspection and all three were found by the test, not the eye:

1. **`pierce` was unpriced.** The three weapons dominating the matrix were
   exactly the three highest-pierce ones (Nova Lance 45 %, Gauss Battery 40 %,
   Beam Lance 35 %) — the model charged them nothing for ignoring the defensive
   stat the entire catalogue is priced around.
2. **Range was underpriced.** `RANGE_SLOPE` began at 0.40. Outranging an
   opponent is worth far more than a 33 % premium, and long guns dominated
   until it was raised to 0.85.
3. **Chassis needed innate traits.** Without them, "more sockets" simply meant
   "more of everything", and the fortress chassis won 98 % of the matrix while
   also carrying the highest damage output.

A fourth was a bug rather than a mispricing: STATIC FIELD's pylons sat on the
spawn points, so 27 % of all matches ended 0–0 with neither frame ever firing.
The matrix showed it as a suspicious stalemate rate; the fix was both an arena
correction and a movement rule that makes regaining line of sight override
every other intent.

## 6. Progression pacing

| Tier | Parts | Credit cost range | Unlock at rating |
| --- | --- | --- | --- |
| I | Starter | 0 (granted) | — |
| II | Common | 300 – 700 | 1 000 |
| III | Refined | 900 – 1 800 | 1 250 |
| IV | Prototype | 2 200 – 4 000 | 1 500 |
| V | Relic | salvage only | 1 800 |

Tier does **not** mean stronger — every tier obeys the same efficiency band in §2.3.
Higher tiers are *more specialised*: sharper trade-offs, narrower windows, higher
ceilings. A Tier I `SLUG THROWER` remains competitive forever; a Tier IV `NOVA LANCE`
is better only in the hands of a build that has solved its heat.

This is the one balance decision most likely to be argued with, so to state it plainly:
**ARCFORGE has no power creep by construction.** Progression buys *options*, not
*numbers*. The efficiency band in §2.3 is what makes that claim enforceable rather than
aspirational.

Expected pacing: ~120 credits per match average → Tier II in ~4 matches, Tier III in
~12, Tier IV in ~30. A full catalogue is ~60 matches, or roughly four hours.
