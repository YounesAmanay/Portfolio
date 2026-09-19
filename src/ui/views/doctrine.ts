/**
 * The Doctrine editor.
 *
 * Rules are evaluated top-down and the first match wins, so the editor is
 * built around *ordering*: move up, move down, and a live cycle cost that
 * shows doctrine competing with modules for the same budget.
 */

import {
  ACTIONS,
  ACTION_INFO,
  CONDITIONS,
  CONDITION_INFO,
  DOCTRINE_RULE_COST,
  MAX_DOCTRINE_RULES,
  REGISTRY,
  compileFrame,
  doctrineCost,
  validateDoctrine,
  type ActionKind,
  type ConditionKind,
  type Doctrine,
  type DoctrineRule,
} from '@engine/index';
import { el } from '../components/dom';
import { withDoctrine, type AppState } from '../state/session';
import type { Store } from '../state/store';
import { panel } from './forge';

export function doctrineView(store: Store<AppState>): HTMLElement {
  const state = store.get();
  const doctrine = state.build.doctrine;
  const frame = compileFrame(state.build, REGISTRY);
  const problems = validateDoctrine(doctrine);
  const cost = doctrineCost(doctrine);

  const update = (next: Doctrine): void =>
    store.set((s) => ({ ...s, build: withDoctrine(s.build, next) }));

  const setRule = (index: number, patch: Partial<DoctrineRule>): void => {
    const rules = doctrine.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule));
    update({ rules });
  };

  const move = (index: number, by: number): void => {
    const target = index + by;
    if (target < 0 || target >= doctrine.rules.length) return;
    const rules = doctrine.rules.slice();
    const [moved] = rules.splice(index, 1);
    rules.splice(target, 0, moved!);
    update({ rules });
  };

  const remove = (index: number): void =>
    update({ rules: doctrine.rules.filter((_, i) => i !== index) });

  const add = (): void => {
    if (doctrine.rules.length >= MAX_DOCTRINE_RULES) return;
    // Insert above the terminal ALWAYS rule, which is almost always what the
    // author means: a new rule below it could never fire.
    const rules = doctrine.rules.slice();
    const terminal = rules.findIndex((rule) => rule.condition === 'ALWAYS');
    const fresh: DoctrineRule = { condition: 'SELF_HEAT_ABOVE', parameter: 0.8, action: 'VENT' };
    if (terminal === -1) rules.push(fresh);
    else rules.splice(terminal, 0, fresh);
    update({ rules });
  };

  return el(
    'div',
    { class: 'doctrine' },
    el(
      'div',
      { class: 'stack' },
      panel(
        `RULES — ${cost} / ${frame.cycleSupply} CY`,
        el(
          'div',
          { class: 'stack' },
          el(
            'div',
            { class: 'rules' },
            ...doctrine.rules.map((rule, index) =>
              ruleRow(rule, index, doctrine.rules.length, setRule, move, remove),
            ),
          ),
          el(
            'div',
            { class: 'row' },
            el('button', {
              class: 'btn',
              text: '+ ADD RULE',
              disabled: doctrine.rules.length >= MAX_DOCTRINE_RULES,
              onclick: add,
            }),
            el('span', {
              class: 'transport__status',
              text: `${doctrine.rules.length} / ${MAX_DOCTRINE_RULES} RULES · ${DOCTRINE_RULE_COST} CY EACH`,
            }),
          ),
          problems.length > 0
            ? el(
                'div',
                { class: 'notes' },
                ...problems.map((problem) =>
                  el('div', { class: 'note note--warn' },
                    el('span', { class: 'note__mark', text: '~' }),
                    el('span', { text: problem })),
                ),
              )
            : null,
        ),
      ),
    ),
    el('div', { class: 'stack' }, explainerPanel()),
  );
}

function ruleRow(
  rule: DoctrineRule,
  index: number,
  total: number,
  setRule: (index: number, patch: Partial<DoctrineRule>) => void,
  move: (index: number, by: number) => void,
  remove: (index: number) => void,
): HTMLElement {
  const info = CONDITION_INFO[rule.condition];

  const conditionSelect = el(
    'select',
    {
      title: info.blurb,
      onchange: (event: Event) => {
        const next = (event.target as HTMLSelectElement).value as ConditionKind;
        const nextInfo = CONDITION_INFO[next];
        // A predicate condition takes no threshold, so the key is omitted
        // entirely rather than set to undefined.
        setRule(
          index,
          nextInfo.parameter === 'none'
            ? { condition: next, parameter: 0 }
            : { condition: next, parameter: nextInfo.defaultValue ?? 0 },
        );
      },
    },
    ...CONDITIONS.map((condition) =>
      el('option', {
        value: condition,
        selected: condition === rule.condition,
        text: CONDITION_INFO[condition].label,
      }),
    ),
  );

  const parameterInput =
    info.parameter === 'none'
      ? null
      : el('input', {
          type: 'number',
          value: String(rule.parameter ?? 0),
          step: info.parameter === 'ratio' ? '0.05' : '1',
          min: '0',
          max: info.parameter === 'ratio' ? '1' : '180',
          title: info.parameter === 'ratio' ? 'A fraction between 0 and 1' : info.parameter,
          oninput: (event: Event) =>
            setRule(index, { parameter: Number((event.target as HTMLInputElement).value) }),
        });

  const actionSelect = el(
    'select',
    {
      title: ACTION_INFO[rule.action].blurb,
      onchange: (event: Event) =>
        setRule(index, { action: (event.target as HTMLSelectElement).value as ActionKind }),
    },
    ...ACTIONS.map((action) =>
      el('option', {
        value: action,
        selected: action === rule.action,
        text: ACTION_INFO[action].label,
      }),
    ),
  );

  return el(
    'div',
    { class: 'rule' },
    el('span', { class: 'rule__index', text: String(index + 1) }),
    el(
      'div',
      { class: 'rule__body' },
      el('span', { class: 'rule__kw', text: 'WHEN' }),
      conditionSelect,
      parameterInput,
      el('span', { class: 'rule__kw', text: 'THEN' }),
      actionSelect,
    ),
    el(
      'div',
      { class: 'rule__actions' },
      el('button', {
        class: 'icon-btn', text: '↑', title: 'Move up',
        disabled: index === 0, onclick: () => move(index, -1),
      }),
      el('button', {
        class: 'icon-btn', text: '↓', title: 'Move down',
        disabled: index === total - 1, onclick: () => move(index, 1),
      }),
      el('button', {
        class: 'icon-btn', text: '×', title: 'Delete rule',
        disabled: total <= 1, onclick: () => remove(index),
      }),
    ),
  );
}

function explainerPanel(): HTMLElement {
  return el(
    'div',
    { class: 'stack' },
    panel(
      'HOW THE CORTEX READS THIS',
      el(
        'div',
        { class: 'stack' },
        el('p', {
          style: 'font-size:12px;line-height:1.6;color:var(--ink-dim)',
          text:
            'Every 250 ms the cortex walks this list from the top and runs the first rule whose condition is true. Nothing below that rule is considered. Ordering is the whole craft: a broad rule near the top silences everything under it.',
        }),
        el('p', {
          style: 'font-size:12px;line-height:1.6;color:var(--ink-dim)',
          text:
            'Rules cost cycles, and they come out of the same budget as your modules. A seven-rule doctrine is a targeting computer you can no longer fit. Being clever and being equipped are paid for in the same currency.',
        }),
      ),
    ),
    panel(
      'ACTIONS',
      el(
        'div',
        { class: 'stack' },
        ...ACTIONS.map((action) =>
          el(
            'div',
            { style: 'display:grid;gap:2px' },
            el('span', {
              class: 'mono',
              style: 'font-size:11px;color:var(--cyan);letter-spacing:0.1em',
              text: ACTION_INFO[action].label.toUpperCase(),
            }),
            el('span', {
              style: 'font-size:11px;color:var(--ink-faint);line-height:1.45',
              text: ACTION_INFO[action].blurb,
            }),
          ),
        ),
      ),
    ),
  );
}
