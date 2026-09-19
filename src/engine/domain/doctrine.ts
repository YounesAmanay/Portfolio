/**
 * Doctrine — the programmable mind of a frame.
 *
 * An ordered list of `WHEN <condition> THEN <action>` rules, evaluated
 * top-down every 250 ms. **The first matching rule wins and evaluation stops.**
 * That single decision makes doctrine authoring a priority-ordering problem:
 * trivial to explain, deep to master.
 *
 * Rules cost cycles, competing directly with modules for the same budget —
 * so being clever and being equipped are paid for in the same currency.
 *
 * @see docs/01-rules.md §10
 */

import { DOCTRINE_RULE_COST, MAX_DOCTRINE_RULES } from '../tuning';

export const CONDITIONS = [
  'ALWAYS',
  'SELF_HEAT_ABOVE',
  'SELF_HEAT_BELOW',
  'SELF_STRUCTURE_BELOW',
  'SELF_SHIELD_DOWN',
  'SELF_ENERGY_BELOW',
  'ENEMY_WITHIN',
  'ENEMY_BEYOND',
  'ENEMY_STRUCTURE_BELOW',
  'ENEMY_OVERLOADED',
  'ENEMY_SHIELD_UP',
  'TIME_AFTER',
  'AMMO_BELOW',
] as const;

export type ConditionKind = (typeof CONDITIONS)[number];

export const ACTIONS = [
  'ENGAGE',
  'KITE',
  'CHARGE',
  'RETREAT',
  'ORBIT',
  'VENT',
  'BRACE',
  'SEEK_COOLANT',
  'FOCUS',
] as const;

export type ActionKind = (typeof ACTIONS)[number];

export interface DoctrineRule {
  readonly condition: ConditionKind;
  /** Threshold for parameterised conditions. Undefined for predicates. */
  readonly parameter?: number;
  readonly action: ActionKind;
}

export interface Doctrine {
  readonly rules: readonly DoctrineRule[];
}

/** What kind of parameter a condition takes — drives the Doctrine editor UI. */
export type ParameterKind = 'none' | 'ratio' | 'metres' | 'seconds';

export interface ConditionDescriptor {
  readonly label: string;
  readonly parameter: ParameterKind;
  readonly blurb: string;
  readonly defaultValue?: number;
}

export const CONDITION_INFO: Readonly<Record<ConditionKind, ConditionDescriptor>> = {
  ALWAYS: { label: 'Always', parameter: 'none', blurb: 'The mandatory fallback. Matches unconditionally.' },
  SELF_HEAT_ABOVE: { label: 'My heat above', parameter: 'ratio', defaultValue: 0.8, blurb: 'Heat ratio exceeds the threshold.' },
  SELF_HEAT_BELOW: { label: 'My heat below', parameter: 'ratio', defaultValue: 0.4, blurb: 'Heat ratio is under the threshold. Useful for "safe to push".' },
  SELF_STRUCTURE_BELOW: { label: 'My structure below', parameter: 'ratio', defaultValue: 0.3, blurb: 'Own structure fraction is under the threshold.' },
  SELF_SHIELD_DOWN: { label: 'My shield down', parameter: 'none', blurb: 'Shield pool is empty.' },
  SELF_ENERGY_BELOW: { label: 'My energy below', parameter: 'ratio', defaultValue: 0.25, blurb: 'Energy fraction is under the threshold.' },
  ENEMY_WITHIN: { label: 'Enemy within', parameter: 'metres', defaultValue: 20, blurb: 'Distance to the enemy is under this range.' },
  ENEMY_BEYOND: { label: 'Enemy beyond', parameter: 'metres', defaultValue: 60, blurb: 'Distance to the enemy exceeds this range.' },
  ENEMY_STRUCTURE_BELOW: { label: 'Enemy structure below', parameter: 'ratio', defaultValue: 0.25, blurb: 'Enemy structure fraction is under the threshold.' },
  ENEMY_OVERLOADED: { label: 'Enemy overloaded', parameter: 'none', blurb: 'Enemy is in thermal shutdown. The best window in the game.' },
  ENEMY_SHIELD_UP: { label: 'Enemy shield up', parameter: 'none', blurb: 'Enemy still has shield. Favour kinetic and ion.' },
  TIME_AFTER: { label: 'After time', parameter: 'seconds', defaultValue: 60, blurb: 'Match has run longer than this.' },
  AMMO_BELOW: { label: 'My ammo below', parameter: 'ratio', defaultValue: 0.25, blurb: 'A kinetic weapon is running dry.' },
};

export interface ActionDescriptor {
  readonly label: string;
  readonly blurb: string;
}

export const ACTION_INFO: Readonly<Record<ActionKind, ActionDescriptor>> = {
  ENGAGE: { label: 'Engage', blurb: 'Close to your best weapon’s optimal range and fire everything in range.' },
  KITE: { label: 'Kite', blurb: 'Hold at maximum optimal range, back off if they close.' },
  CHARGE: { label: 'Charge', blurb: 'Close to point blank regardless of cost.' },
  RETREAT: { label: 'Retreat', blurb: 'Move directly away. Fire only what is already in range.' },
  ORBIT: { label: 'Orbit', blurb: 'Strafe at current range. Maximises evasion uptime.' },
  VENT: { label: 'Vent', blurb: 'Stop and purge heat at 4x. Slow and inaccurate while venting.' },
  BRACE: { label: 'Brace', blurb: 'Stop moving: +30% armour, +15% accuracy, but 40% less evasion.' },
  SEEK_COOLANT: { label: 'Seek coolant', blurb: 'Move to the nearest coolant vent, then purge.' },
  FOCUS: { label: 'Focus', blurb: 'Engage, but fire only the type the enemy is weakest to.' },
};

/** Cycle cost of a doctrine. Counted against build budget B3. */
export function doctrineCost(doctrine: Doctrine): number {
  return doctrine.rules.length * DOCTRINE_RULE_COST;
}

/**
 * Normalises a doctrine for execution: trims to the rule cap and guarantees a
 * terminal `ALWAYS` rule, so the interpreter is total and never has to handle
 * "no rule matched".
 */
export function compileDoctrine(doctrine: Doctrine): Doctrine {
  const rules = doctrine.rules.slice(0, MAX_DOCTRINE_RULES);
  const last = rules[rules.length - 1];
  if (last?.condition !== 'ALWAYS') {
    rules.push({ condition: 'ALWAYS', action: 'ENGAGE' });
  }
  return { rules };
}

/** A sane starting doctrine, granted to every new Architect. Cost: 8 CY. */
export const DEFAULT_DOCTRINE: Doctrine = {
  rules: [
    { condition: 'SELF_HEAT_ABOVE', parameter: 0.85, action: 'VENT' },
    { condition: 'ENEMY_OVERLOADED', action: 'CHARGE' },
    { condition: 'SELF_STRUCTURE_BELOW', parameter: 0.25, action: 'KITE' },
    { condition: 'ALWAYS', action: 'ENGAGE' },
  ],
};

/**
 * Structural validation. Returns human-readable problems, not exceptions —
 * the Doctrine editor shows these inline as the player types.
 */
export function validateDoctrine(doctrine: Doctrine): readonly string[] {
  const problems: string[] = [];
  if (doctrine.rules.length === 0) problems.push('Doctrine is empty.');
  if (doctrine.rules.length > MAX_DOCTRINE_RULES) {
    problems.push(`Doctrine has ${doctrine.rules.length} rules; the cortex holds ${MAX_DOCTRINE_RULES}.`);
  }
  doctrine.rules.forEach((rule, index) => {
    const info = CONDITION_INFO[rule.condition];
    if (info.parameter !== 'none' && rule.parameter === undefined) {
      problems.push(`Rule ${index + 1} (${info.label}) needs a threshold.`);
    }
    if (info.parameter === 'ratio' && rule.parameter !== undefined) {
      if (rule.parameter < 0 || rule.parameter > 1) {
        problems.push(`Rule ${index + 1}: ${info.label} takes a ratio between 0 and 1.`);
      }
    }
    if (rule.condition === 'ALWAYS' && index < doctrine.rules.length - 1) {
      problems.push(`Rule ${index + 1} is ALWAYS, so no rule below it can ever fire.`);
    }
  });
  return problems;
}
