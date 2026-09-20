/**
 * Gameplay constants.
 *
 * `units.ts` holds the physical constants — gravity, the timestep, the size of
 * a lattice cell. This file holds the ones that are design decisions: how far a
 * hammer swings, how long a flipper takes to reset, how hard a motor is allowed
 * to push. They are separated so that retuning the game never means reading the
 * simulation, and so that a number is never invented halfway down a function
 * where nobody will find it again.
 *
 * Everything here has a unit and a reason.
 */

// ── weapon actuation ───────────────────────────────────────────────────────

/**
 * Rest and strike angles for an overhead hammer, radians about its pivot.
 *
 * Negative is cocked back and up, positive is driven down and forward. The
 * swing is deliberately more than a right angle: the head has to arrive
 * travelling downward, not sideways, or it shoves rather than hits.
 */
export const HAMMER_REST = -1.15;
export const HAMMER_STRIKE = 0.55;

/** Seconds the head stays down before it is hauled back up. */
export const HAMMER_DWELL = 0.18;

/** Seconds from the end of a swing until the hammer can be fired again. */
export const HAMMER_RELOAD = 0.9;

/**
 * Flipper travel, radians. A flipper is a shove, not a swing — past about a
 * radian the plate is pushing backwards and the target slides off it.
 */
export const FLIPPER_REST = 0;
export const FLIPPER_STRIKE = 1.05;

/** A flipper is pneumatic: it fires fast and takes a long time to recharge. */
export const FLIPPER_DWELL = 0.12;
export const FLIPPER_RELOAD = 2.4;

/**
 * Damping for an arm's joint motor, as a fraction of critical.
 *
 * The stiffness is not a constant: it is the part's rated torque divided by its
 * swing range, so an arm develops exactly its rated torque at full deflection
 * and a stronger actuator really is stronger. Damping is then set relative to
 * critical for the arm's own inertia, which is what stops a heavy head ringing
 * around its target angle instead of stopping on it.
 */
export const ARM_DAMPING_RATIO = 0.55;

/**
 * Spinner motor gain, and its torque ceiling in N·m per N·m of rating.
 *
 * Rapier's joint motors in this version expose no force limit, so the gain is
 * clamped per step to keep the applied torque at or below the part's rating.
 * That ceiling is the honest part: a 0.028 kg·m² disc rated at 2.2 N·m takes a
 * genuine eight seconds to reach 6000 rpm, which is why spinning up is a
 * decision made before contact rather than during it.
 */
export const SPINNER_GAIN = 40;
export const SPINNER_TORQUE_CEILING = 1;

// ── steering ───────────────────────────────────────────────────────────────

/**
 * Yaw rate, rad/s, that full steering lock asks for.
 *
 * Steering is closed loop on yaw rate rather than an open differential, and
 * that is not a driver aid bolted on top — it is what the controller board in
 * the machine is for. An open differential asks both tracks for full opposite
 * lock, which is kinematically correct and completely undrivable: measured,
 * a tap of steering spun SCOUT at 890 deg/s, two and a half revolutions per
 * second, and the lighter TIPPER was not far behind. Worse, every machine span
 * at a different rate, so nothing you learned driving one transferred.
 *
 * 2.8 rad/s is about 160 deg/s — a full turn in a little over two seconds.
 */
export const MAX_YAW_RATE = 2.8;

/** Differential per rad/s of yaw error. High enough to track, low enough to settle. */
export const YAW_GAIN = 1.4;

/**
 * How far the differential may exceed full throttle.
 *
 * At 1.0 the inner wheels can only ever coast, never drive backwards, so a
 * machine at full throttle could not turn tighter than about an eight-metre
 * arc no matter how hard the stick was pushed. Allowing the differential past
 * the throttle lets the controller brake the inside — which is exactly how a
 * tracked machine turns at speed — while each wheel still clamps to its own
 * full-scale command.
 */
export const MAX_DIFFERENTIAL = 1.3;

// ── tyres ──────────────────────────────────────────────────────────────────

/**
 * Slip speed, m/s, at which a tyre reaches its full longitudinal grip.
 *
 * The collider carries only the tyre's *lateral* friction, because a rigid-body
 * solver takes one coefficient and a tyre has two: it grips along its roll and
 * scrubs across it. The difference is applied along the rolling direction each
 * step, and this is the slip it takes to develop it — a real tyre's force rises
 * with slip rather than appearing all at once.
 *
 * The number matters more than it looks. At an effectively infinite stiffness
 * the correction saturates within a hundredth of a metre per second, which
 * makes it a bang-bang controller: the tiniest difference between the left and
 * right tyres becomes the full force difference, and a machine asked to drive
 * straight veered off by 62 degrees in three seconds. Spread over a realistic
 * slip band it simply holds the machine straight.
 */
export const TYRE_SLIP_REFERENCE = 0.6;

// ── damage ─────────────────────────────────────────────────────────────────

/**
 * Contact force, in newtons, above which an impact is counted as a hit.
 *
 * Low enough to catch a real strike, high enough to ignore a machine resting
 * its own weight against a wall.
 */
export const CONTACT_THRESHOLD = 260;
