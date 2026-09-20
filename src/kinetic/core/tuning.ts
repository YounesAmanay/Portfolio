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

// ── damage ─────────────────────────────────────────────────────────────────

/**
 * Contact force, in newtons, above which an impact is counted as a hit.
 *
 * Low enough to catch a real strike, high enough to ignore a machine resting
 * its own weight against a wall.
 */
export const CONTACT_THRESHOLD = 260;
