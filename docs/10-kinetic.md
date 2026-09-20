# ARCFORGE // KINETIC — the physical model

v1 was a 2D autobattler where armour was a number and mass was a budget line.
This is a different machine: **mass has a position, torque is real, and a
battery mounted too high will tip your robot over on the first hard turn.**

The design goal is stated plainly because it drives every decision below: a
player who spends an hour here should leave with working intuition about
centre of mass, gear ratios, traction limits and power budgets — the same
intuition they would need to actually build one of these.

So no stat is invented where a real one exists. Motors have stall torque and
no-load speed. Batteries have watt-hours and a peak discharge. Wheels have a
friction coefficient. If a number in this game has a unit, that unit is real.

---

## 1. Units

| Quantity | Unit |
| --- | --- |
| Mass | kg |
| Length | m |
| Force | N |
| Torque | N·m |
| Energy | J (parts), W·h (batteries) |
| Power | W |
| Angular velocity | rad/s (displayed as RPM) |

Simulation runs at a **fixed 120 Hz** physics step with rendering interpolated.
Rapier is stepped deterministically; nothing reads a wall clock.

---

## 2. The lattice — "the motherboard"

A chassis is a **frame with an attachment lattice**: a 3D grid of
`CELL = 0.08 m` cells. Every part occupies an integer box of cells and snaps to
the grid with one of 24 axis-aligned orientations.

This is what makes the builder feel like populating a board rather than posing
a model, and it is what lets a two-wheeled balancer, a four-wheel brawler, a
tracked pusher and a quadcopter all come out of the same system without any of
them being a special case.

```
part.footprint = { x: 2, y: 1, z: 3 }   // in cells
part.anchor    = the cell it is pinned at
part.rotation  = 0..23 (axis-aligned)
```

Two parts may not occupy the same cell. Everything else is legal — including
designs that cannot possibly work, because finding that out is the lesson.

---

## 3. Mass and centre of mass

The single most important number in the builder.

```
M    = Σ mᵢ
CoM  = Σ (mᵢ · pᵢ) / M
```

The builder draws the CoM as a marker and projects it onto the ground plane
against the **support polygon** (the convex hull of the ground-contact points).
Two derived readouts follow, and both are shown live:

```
stabilityMargin = shortest distance from CoM-ground-projection
                  to the edge of the support polygon      (m)

tipAngle        = atan( stabilityMargin / comHeight )     (degrees)
```

A robot tips when lateral acceleration exceeds `g · tan(tipAngle)`. So the
builder can tell you, honestly: *"tips at 0.61 g — a hard turn will roll it."*
Raising the battery by two cells visibly drops that number. That is the whole
teaching mechanism, and it costs one line of arithmetic.

---

## 4. Motors — a real torque/speed curve

DC motors are not constant-torque. Torque falls linearly as speed rises:

```
τ(ω) = τ_stall · (1 − ω / ω_free)
```

A gearbox of ratio `G` with efficiency `η` trades one for the other:

```
τ_out = τ_stall · G · η
ω_out = ω_free / G
```

This is why the builder shows **both** a top-speed estimate and a climb-grade
estimate, and why they move in opposite directions when you change gearing:

```
topSpeed   = ω_out · r_wheel                                  (m/s)
tractive   = τ_out / r_wheel          per driven wheel        (N)
maxGrade   = asin( Σtractive / (M · g) )                      (degrees)
```

Electrical draw follows mechanical output:

```
P_mech = τ · ω
P_elec = P_mech / η_motor + P_idle
```

---

## 5. Traction — the limit players forget

Torque at the wheel is not force at the ground. The contact can only transmit:

```
F_max = μ · N
```

where `N` is the normal load carried by that wheel and `μ` is the tyre's
friction coefficient. Demand more and the wheel spins.

**This is not modelled with a formula — it is left to the physics solver.**
Wheels are real revolute joints driven by motor torque, and Rapier's friction
constraint decides whether the contact holds. Wheelspin, torque steer, and a
front-heavy robot lifting its rear drive wheel all emerge for free, because
they are consequences of the same contact solver rather than special cases.

Consequences a player will discover, all real:

- Rear-heavy robots accelerate better; front-heavy ones brake and climb better.
- A narrow wheelbase with a high battery understeers, then rolls.
- Four small wheels out-grip two large ones at equal mass, then lose top speed.

---

## 6. Power — batteries sag

Batteries carry capacity and a peak discharge, both real:

```
capacity  (W·h)      how long you last
peakPower (W)        how hard you can pull before voltage sags
```

Each step:

```
demand = Σ actuator P_elec
sag    = clamp(peakPower / demand, 0, 1)        // >1 means no sag
output  scaled by sag                            // torque and thrust both drop
energy -= (demand · sag) · dt / 3600
```

Over-specifying motors on an under-specified pack therefore does not fail
loudly — it just makes the robot sluggish under load, exactly as it does in
reality. The HUD shows draw against peak so the cause is visible.

At zero energy the robot is dead weight. It does not explode; it coasts to a
stop, which is both more honest and more humiliating.

---

## 7. Damage — impact energy, not hit points

There is no damage stat. There is kinetic energy.

```
E = ½ · m_eff · v_rel²          (J, at the contact)
```

Every part carries an **integrity** in joules — how much impact energy it
absorbs before failing. When a part's integrity reaches zero:

```
its attachment joint is destroyed
the part becomes a free rigid body and is thrown clear
anything it was carrying loses that connection too
```

A robot is destroyed when its controller or battery is torn off, or when its
frame is severed from its drive.

This is why spinning weapons are devastating, and the maths says so directly:

```
E_spinner = ½ · I · ω²         I = moment of inertia of the disc
```

A 2.4 kg disc at 6000 RPM stores roughly **4.7 kJ** — genuinely more than a
small-calibre rifle round, which is exactly why real combat-robot spinners
throw opponents across the arena. The player does not have to be told this;
they can read it off the part and then watch it happen.

Ramming damage falls out of the same equation, so a heavy fast robot is a
weapon even with nothing mounted on it.

---

## 8. Thermal

Motor heating is resistive, so it scales with the square of torque:

```
Q̇ = k · (τ / τ_stall)²  ·  P_rated
T  += (Q̇ − cooling · (T − T_ambient)) · dt / thermalMass
```

Above `T_derate` the motor's available torque is scaled down linearly to zero
at `T_max`. Stalling a motor against a wall will cook it — which is the single
most common way people destroy real hardware, and is worth learning here
instead of there.

---

## 9. Control

Actuators expose **channels**. The controller part provides a fixed number of
them, which is what stops a design from having unlimited independent functions.

| Channel | Bound to |
| --- | --- |
| `DRIVE` | forward/back — signed motor target |
| `STEER` | left/right — differential or steered axle |
| `LIFT` | thrusters / vertical |
| `WEAPON` | spinner spin-up, flipper fire |
| `AUX1/2` | servos, arms |

Input comes from keyboard, touch, or an autonomous doctrine — the actuator does
not know or care which, so a design can be driven manually and then handed to
the AI without modification.

---

## 10. What this buys

Everything above is mechanism rather than content, and that is the point: none
of it enumerates robot types. A quadcopter is four thrusters and a gyro. A
tank is two tread units. A self-balancing monowheel is one wheel, a gyro and a
control loop. A flipper bot is a pneumatic ram and a good centre of mass.

The system never needs to know those names.
