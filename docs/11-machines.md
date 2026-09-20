# The machine model

This replaces the part model in [`10-kinetic.md`](10-kinetic.md), where a single
lattice cell held an entire drivetrain. "Sprint Pod 5:1" was a motor, a gearbox,
a shaft, a hub, a tyre and a speed controller pretending to be one object, and
parts connected to each other by *touching*. You picked one of three sealed
bundles and the gear ratio — the single most consequential decision in a combat
robot — was made for you before you started.

A machine is now assembled from components the way a real one is, along two
chains that have to be completed before anything turns.

```
POWER    battery ──▶ fuse ──▶ ESC ──▶ motor
                               ▲
                            receiver

DRIVE    motor ──▶ gearbox ──▶ axle ──▶ wheel
```

Or, for a machine that burns fuel:

```
POWER    tank ──▶ engine
DRIVE    engine ──▶ clutch ──▶ gearbox ──▶ axle ──▶ wheel
```

## What is modelled, and what is refused

The rule is: **keep anything with a decision attached, cut anything that is
bookkeeping.** Realism that produces no choice is just admin, and admin is what
kills a building game.

Modelled, because each one is a decision:

| Thing | The decision it forces |
| --- | --- |
| Gear ratio | Torque against speed. The defining choice. |
| Motor Kv and winding resistance | Fast and weak, or slow and strong, at a given voltage. |
| Battery cells (S) | Voltage sets top speed; every motor and ESC has a ceiling. |
| Battery capacity and C rating | How many amps you can draw before the pack sags. |
| ESC voltage and current rating | The cheap part that dies first if you get it wrong. |
| Wheel diameter | Multiplies speed, divides torque, and changes ground clearance. |
| Tyre compound | Grip against mass, and how well it scrubs when you turn. |
| Where the mass sits | Tip angle, weight over the drive wheels. |

Refused, because none of it is a choice:

Wire gauge · connector types · solder joints · screw sizes · bearing part
numbers · battery chemistry beyond its electrical behaviour.

## Units

SI throughout, as in `10-kinetic.md`. Volts, amps, ohms, newton-metres,
radians per second. Motor Kv is quoted in the industry's own unit — **rpm per
volt** — because that is what is printed on the can, and converted on use.

## Electric motors

A brushed or brushless motor is defined by four numbers that a real datasheet
gives you: `kv` (rpm/V), `resistance` (Ω), `noLoadCurrent` (A) and a maximum
continuous current. Everything else is derived, which is the point — the
builder can show you the torque curve because it computed it.

Torque constant, from Kv:

```
Kt = 60 / (2π · kv)                       N·m per amp
```

Free speed and stall torque at the pack voltage actually supplied:

```
ω_free  = kv · V · 2π / 60                rad/s
I_stall = V / resistance                  A
τ_stall = Kt · (I_stall − noLoadCurrent)  N·m
```

And the torque available at any speed is the straight line between them, which
is the same DC curve the simulation already integrates:

```
τ(ω) = τ_stall · (1 − ω / ω_free)
I(τ) = τ / Kt + noLoadCurrent
```

Two consequences fall straight out, and both are lessons:

- **Voltage buys speed, not torque.** Doubling the cell count doubles `ω_free`
  and doubles `I_stall`, so it doubles stall torque *and* doubles the current
  the pack has to find. A 6S machine is not a 3S machine that goes faster; it
  is a machine with twice the electrical problem.
- **Stalling is what kills motors.** At zero speed the motor draws `I_stall`
  and converts all of it to heat. The thermal model already in the simulation
  is driven from this current, not from a throttle percentage.

## Internal combustion

A petrol engine is a genuinely different machine, not a reskin, and the
differences are all constraints:

- Torque is quoted at a peak rpm and falls away either side of it, so there is
  a **useful band** rather than a curve that starts at maximum.
- It **cannot reverse**. A petrol machine needs either a reversing gearbox or a
  driving style built around never needing to back up.
- It **cannot idle at zero**. Below its idle speed it stops, so it needs a
  **clutch** between engine and gearbox.
- It burns **fuel**, so a tank is mass that falls as the match runs, and it can
  run out.

Modelled as peak power `P_peak` at `rpm_peak`, an idle speed, and a parabolic
fall-off:

```
ω_peak = rpm_peak · 2π / 60
τ_peak = P_peak / ω_peak
τ(ω)   = τ_peak · (1 − ((ω − ω_peak) / ω_peak)²)     clamped at zero
```

The trade it offers is power density: an engine delivers far more sustained
power per kilogram than a pack-and-motor of the same mass, which is why the
nastiest spinners ever built ran on petrol. It costs you reverse, a clutch, a
tank and a narrow band you have to keep the engine inside.

## Gearboxes

```
ω_out = ω_in / ratio
τ_out = τ_in · ratio · efficiency
```

Efficiency is 0.90 for a single spur stage and compounds per stage, so a 40:1
three-stage box loses about a quarter of what goes in. Every gearbox carries a
**torque rating**: feed it more than that and it strips, which the builder
refuses rather than simulating.

## Batteries, controllers and the loom

A pack is cells in series (`S`), capacity in amp-hours, and a C rating:

```
V_nominal  = 3.7 · S        (LiPo)   |  3.2 · S  (LiFePO₄)
I_max      = C · capacity
E          = V_nominal · capacity     W·h
```

An ESC has a maximum cell count and a maximum continuous current. Both are hard
limits and both are checked, because in reality both fail immediately and
expensively.

The controller is also what bounds the current a motor can actually pull, which
matters for the sag check. A stalled motor would draw `V / resistance` if
nothing stopped it; the ESC does stop it. So the peak the pack has to find is

```
I_peak = Σ min(I_stall, esc.maxAmps)                over every motor
sag    = min(1, pack.I_max / I_peak)
```

and that sag scales every actuator on the machine, which is why an
under-specified pack feels sluggish rather than simply failing.

Wiring itself is **not** placed. The loom is assumed, and the only thing it
contributes is the rule that a component must be *linked* to be powered. What
the game checks is the topology and the ratings, which is where the decisions
live — not where you routed the red wire.

## A worked example

The same motor — Kv 1100, 1.8 Ω, 0.3 A no-load — on a 140 mm wheel, showing
what the two decisions actually buy. Every figure here is computed from the
equations above, not chosen.

| Pack | Ratio | Wheel torque | Top speed | Stall current |
| --- | --- | --- | --- | --- |
| 3S | 8:1 | 0.33 N·m | 11.2 m/s | 6.2 A |
| 3S | 20:1 | 0.83 N·m | 4.5 m/s | 6.2 A |
| 3S | 40:1 | 1.49 N·m | 2.2 m/s | 6.2 A |
| 6S | 8:1 | 0.68 N·m | 22.4 m/s | 12.3 A |
| 6S | 20:1 | 1.69 N·m | 9.0 m/s | 12.3 A |
| 6S | 40:1 | 3.05 N·m | 4.5 m/s | 12.3 A |

For scale: a 5.4 kg machine on grip-1.1 tyres can put down about **1.0 N·m per
wheel** before it simply spins them. So the top two rows are traction-starved
machines that cannot use what they have, the bottom rows are over-torqued
crawlers that will climb anything and never catch anyone, and the interesting
builds live in the middle. That band is the game.

Note the 3S-to-6S rows: doubling the pack doubles the torque *and* doubles the
speed *and* doubles the current. Voltage is not a free upgrade, it is a
different machine with twice the electrical problem.

## Connections

Components carry **ports**, and the difference between the two chains is
deliberate and mirrors reality:

- **Mechanical connections are spatial.** A motor has to physically line up
  with its gearbox, which has to line up with the axle it drives. Layout is
  constrained by what has to touch what, and that is the puzzle that makes a
  chassis a chassis.
- **Electrical connections are topological.** You do not route wires by hand,
  least of all on a phone. You link motor to ESC to pack, and a **schematic
  view** beside the model shows the circuit live — which is exactly how a real
  builder works, with CAD in one window and a wiring diagram in the other.

Both granularities stay available. A **drive module** can be dropped as one
unit and then opened up and modified, because real builders buy gearmotors off
the shelf as well as building custom drives, and nobody should have to assemble
six components to make one wheel turn on their first machine.

## Validation

The builder refuses what would not work, and says why in the terms the mistake
was made in:

| Condition | What it says |
| --- | --- |
| Motor with no ESC | The left front motor is not wired to anything. |
| ESC cell limit exceeded | ESC is rated 4S, the pack is 6S. |
| Peak draw > pack `I_max` | Peak draw 142 A, pack delivers 99 A — it will sag to 70% under load. |
| Motor stall torque > gearbox rating | Motor stalls at 14 N·m, the gearbox is rated 8. It will strip. |
| Gearbox output not reaching a wheel | This gearbox drives nothing. |
| Engine with no clutch | An engine cannot start against load. |
| Engine with no tank | Nothing to burn. |
| Over the weight limit | 6.1 kg in a 5.4 kg class. |

## Weight classes

The constraint the whole hobby is organised around, and the reason any of the
above is a trade-off rather than a shopping list. Without a limit the best
machine is simply "all of it".

| Class | Limit | Roughly |
| --- | --- | --- |
| Beetleweight | 1.5 kg | A machine you could carry in one hand. |
| Hobbyweight | 5.4 kg | Where the reference machines sit today. |
| Featherweight | 13.6 kg | Tracks, real armour, a serious spinner. |
| Middleweight | 27 kg | Everything, and still not enough. |

These are the real classes, and the machines already in the game land inside
them without adjustment: SCOUT weighs 5.9 kg, BULWARK 13.3 kg.

## What this changes downstream

The arena, the physics and the damage model are unaffected. What changes is
where the simulation's drive numbers come from: instead of reading
`wheelTorque` and `freeSpeed` off a part, a solver walks each drive chain and
produces them, and the analysis reports the same figures the solver derived. If
the two ever disagree, the builder is lying again, and that is the one failure
this whole design exists to prevent.
