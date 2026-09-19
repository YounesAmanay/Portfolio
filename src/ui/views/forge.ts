/**
 * The Forge — where the game is actually played.
 *
 * Three things happen here and they must stay visible at once: the socket
 * layout, the part catalogue for the selected socket, and the live consequences
 * of the current loadout. Hiding any of the three behind a tab would turn an
 * optimisation problem into a memory test.
 *
 * Every part row shows a *delta* against the current build rather than an
 * absolute value, because "what does this change" is the only question a
 * builder is ever asking.
 */

import {
  ALL_CHASSIS,
  REGISTRY,
  SOCKET_INFO,
  SOCKET_KINDS,
  STAT_INFO,
  TIER_UNLOCK_RATING,
  compileFrame,
  effectiveHp,
  emptyAssignments,
  heatBalance,
  timeToOverload,
  validateBuild,
  withPart,
  type Build,
  type CompiledFrame,
  type DisplayStatKey,
  type Part,
  type PartId,
  type SocketKind,
} from '@engine/index';
import { el, fmt, signed } from '../components/dom';
import { transferPanel } from './transfer';
import { owns, type AppState, type Profile } from '../state/session';
import type { Store } from '../state/store';

export function forgeView(store: Store<AppState>, rerender: () => void): HTMLElement {
  const state = store.get();
  const frame = compileFrame(state.build, REGISTRY);
  const report = validateBuild(frame, REGISTRY);

  return el(
    'div',
    { class: 'forge' },
    el(
      'div',
      { class: 'stack' },
      chassisPanel(store, state),
      socketPanel(store, state, frame),
      cataloguePanel(store, state, frame),
    ),
    el('div', { class: 'stack' }, readoutPanel(frame, report), transferPanel(store, rerender)),
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function chassisPanel(store: Store<AppState>, state: AppState): HTMLElement {
  const current = REGISTRY.requireChassis(state.build.chassisId);

  return panel(
    'CHASSIS',
    el(
      'div',
      { class: 'chassis-row' },
      ...ALL_CHASSIS.map((chassis) => {
        const locked = chassis.price > 0 && !owns(state.profile, chassis.id);
        const sockets = SOCKET_KINDS.filter((k) => (chassis.sockets[k] ?? 0) > 0)
          .map((k) => `${SOCKET_INFO[k].label} x${chassis.sockets[k]}`)
          .join(' · ');

        return el(
          'button',
          {
            class: `chassis-card${locked ? ' part-row--locked' : ''}`,
            'aria-pressed': String(chassis.id === current.id),
            title: `${chassis.description}\n\n${sockets}`,
            onclick: () => {
              if (locked) return;
              // Switching chassis resets the sockets: a layout change makes the
              // old assignment meaningless, and silently dropping parts into
              // wrong slots would be worse than an explicit reset.
              store.set((s) => ({
                ...s,
                activeSlot: null,
                build: {
                  ...s.build,
                  chassisId: chassis.id,
                  assignments: emptyAssignments(chassis.sockets),
                } as Build,
              }));
            },
          },
          el('div', { class: 'chassis-card__name', text: chassis.name }),
          el(
            'div',
            { class: 'chassis-card__meta' },
            el('span', { class: 'tag tag--tier', text: `T${chassis.tier}` }),
            el('span', { class: 'tag', text: chassis.house }),
            locked ? el('span', { class: 'tag', text: `${chassis.price}c` }) : null,
          ),
          el(
            'div',
            { class: 'chassis-card__stats' },
            el('span', { text: `${chassis.structure} sp` }),
            el('span', { text: `${chassis.massLimit} kg` }),
          ),
        );
      }),
    ),
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function socketPanel(store: Store<AppState>, state: AppState, frame: CompiledFrame): HTMLElement {
  const chassis = frame.chassis;
  const active = state.activeSlot;

  const groups = SOCKET_KINDS.filter((kind) => (chassis.sockets[kind] ?? 0) > 0).map((kind) => {
    const count = chassis.sockets[kind] ?? 0;
    const assigned = state.build.assignments[kind] ?? [];

    const slots = Array.from({ length: count }, (_, index) => {
      const id = assigned[index] ?? null;
      const part = id ? REGISTRY.part(id) : undefined;
      const isActive = active?.kind === kind && active.index === index;

      return el(
        'button',
        {
          class: `slot${part ? ' slot--filled' : ''}${isActive ? ' slot--active' : ''}`,
          'aria-pressed': String(isActive),
          title: part?.description ?? `Empty ${SOCKET_INFO[kind].label} socket`,
          onclick: () =>
            store.set((s) => ({
              ...s,
              activeSlot: isActive ? null : { kind, index },
            })),
        },
        part
          ? el('div', { class: 'slot__name', text: part.name })
          : el('div', { class: 'slot__empty', text: '+ EMPTY' }),
        part
          ? el('div', {
              class: 'slot__line',
              text: `${part.cost.mass}kg · ${part.cost.powerDraw}PU${part.cost.cycleDraw ? ` · ${part.cost.cycleDraw}CY` : ''}`,
            })
          : null,
        part
          ? el(
              'div',
              { class: 'slot__tags' },
              part.weapon ? el('span', { class: `tag tag--${part.weapon.damageType}`, text: part.weapon.damageType }) : null,
              el('span', { class: 'tag tag--tier', text: `T${part.tier}` }),
            )
          : null,
      );
    });

    return el(
      'div',
      { class: 'socket-group' },
      el(
        'div',
        { class: 'socket-group__head' },
        el('span', { class: 'socket-group__name', text: SOCKET_INFO[kind].label.toUpperCase() }),
        el('span', { class: 'socket-group__blurb', text: SOCKET_INFO[kind].blurb }),
      ),
      el('div', { class: 'socket-group__slots' }, ...slots),
    );
  });

  return panel('SOCKETS', el('div', { class: 'sockets' }, ...groups));
}

// ─────────────────────────────────────────────────────────────────────────────

function cataloguePanel(store: Store<AppState>, state: AppState, frame: CompiledFrame): HTMLElement {
  const active = state.activeSlot;

  if (!active) {
    return panel(
      'CATALOGUE',
      el('div', { class: 'empty', text: 'Select a socket above to see what fits in it.' }),
    );
  }

  const kind = active.kind as SocketKind;
  const installed = (state.build.assignments[kind] ?? [])[active.index] ?? null;
  const options = REGISTRY.partsForSocket(kind);

  const rows = options.map((part) => partRow(store, state, frame, part, kind, active.index, installed));

  return panel(
    `${SOCKET_INFO[kind].label.toUpperCase()} — SLOT ${active.index + 1}`,
    el(
      'div',
      { class: 'stack' },
      installed
        ? el(
            'button',
            {
              class: 'btn btn--ghost btn--sm',
              onclick: () => setSlot(store, kind, active.index, null),
              text: 'REMOVE INSTALLED PART',
            },
          )
        : null,
      el('div', { class: 'catalogue' }, ...rows),
    ),
  );
}

function partRow(
  store: Store<AppState>,
  state: AppState,
  frame: CompiledFrame,
  part: Part,
  kind: SocketKind,
  index: number,
  installed: PartId | null,
): HTMLElement {
  const locked = !owns(state.profile, part.id);
  const isInstalled = installed === part.id;

  // The delta is the whole point of this row: what changes if I fit this?
  const preview = compileFrame(withPart(state.build, kind, index, part.id), REGISTRY);
  const deltas = previewDeltas(frame, preview);

  return el(
    'button',
    {
      class: `part-row${locked ? ' part-row--locked' : ''}`,
      'aria-pressed': String(isInstalled),
      title: locked ? lockReason(part, state.profile) : part.description,
      onclick: () => {
        if (locked) return;
        setSlot(store, kind, index, isInstalled ? null : part.id);
      },
    },
    el(
      'div',
      {},
      el('div', { class: 'part-row__name', text: part.name }),
      el('div', { class: 'part-row__desc', text: part.description }),
      el(
        'div',
        { class: 'part-row__meta' },
        el('span', { class: 'tag tag--tier', text: `T${part.tier}` }),
        part.weapon
          ? el('span', { class: `tag tag--${part.weapon.damageType}`, text: part.weapon.damageType })
          : null,
        el('span', { class: 'tag', text: `${part.cost.mass}kg` }),
        part.cost.powerDraw ? el('span', { class: 'tag', text: `${part.cost.powerDraw}PU` }) : null,
        part.cost.cycleDraw ? el('span', { class: 'tag', text: `${part.cost.cycleDraw}CY` }) : null,
        locked ? el('span', { class: 'tag', text: `LOCKED · ${part.price}c` }) : null,
      ),
    ),
    el('div', { class: 'part-row__delta' }, ...deltas),
  );
}

/** The two or three stat changes that matter most for this swap. */
function previewDeltas(before: CompiledFrame, after: CompiledFrame): HTMLElement[] {
  const rows: HTMLElement[] = [];
  const candidates: [string, number, number][] = [
    ['DPS', sumDps(before), sumDps(after)],
    ['eHP', effectiveHp(before.stats, 'KINETIC'), effectiveHp(after.stats, 'KINETIC')],
    ['HEAT', heatBalance(before), heatBalance(after)],
  ];

  for (const [label, from, to] of candidates) {
    const delta = to - from;
    if (Math.abs(delta) < 0.05) continue;
    // Heat balance is the one stat where *lower* is better.
    const good = label === 'HEAT' ? delta < 0 : delta > 0;
    rows.push(
      el(
        'div',
        { class: good ? 'delta--up' : 'delta--down' },
        `${label} ${signed(delta, label === 'HEAT' ? 1 : 0)}`,
      ),
    );
  }
  return rows.length > 0 ? rows : [el('div', { text: '—' })];
}

function sumDps(frame: CompiledFrame): number {
  return frame.weapons.reduce((sum, weapon) => sum + weapon.sustainedDps, 0);
}

function lockReason(part: Part, profile: Profile): string {
  const required = TIER_UNLOCK_RATING[part.tier] ?? 0;
  if (profile.rating < required) return `Locked — requires rating ${required}.`;
  return `Locked — costs ${part.price} credits. Win matches to buy or salvage it.`;
}

function setSlot(store: Store<AppState>, kind: SocketKind, index: number, id: PartId | null): void {
  store.set((s) => ({ ...s, build: withPart(s.build, kind, index, id) }));
}

// ─────────────────────────────────────────────────────────────────────────────

function readoutPanel(
  frame: CompiledFrame,
  report: ReturnType<typeof validateBuild>,
): HTMLElement {
  const { stats } = frame;
  const dps = sumDps(frame);
  const balance = heatBalance(frame);
  const overload = timeToOverload(frame);

  const statKeys: DisplayStatKey[] = [
    'structure', 'armour', 'shieldCapacity', 'speed', 'evasion', 'targeting',
    'heatCapacity', 'heatSink', 'energyCapacity', 'energyRegen', 'agility', 'staggerResist',
  ];

  return el(
    'div',
    { class: 'stack' },
    panel(
      'BUDGETS',
      el(
        'div',
        { class: 'budgets' },
        ...report.budgets.map((budget) => {
          const pct = Math.min(100, budget.ratio * 100);
          const cls = !budget.ok ? ' budget__fill--over' : budget.ratio > 0.9 ? ' budget__fill--warn' : '';
          return el(
            'div',
            {},
            el(
              'div',
              { class: 'budget__head' },
              el('span', { class: 'budget__label', text: budget.label.toUpperCase() }),
              el('span', {
                class: 'budget__value',
                text: `${fmt(budget.used, 0)} / ${fmt(budget.limit, 0)} ${budget.unit}`,
              }),
            ),
            el(
              'div',
              { class: 'budget__track' },
              el('div', { class: `budget__fill${cls}`, style: `width:${pct}%` }),
            ),
          );
        }),
      ),
    ),

    panel(
      'COMBAT PROFILE',
      el(
        'div',
        { class: 'stack' },
        el(
          'div',
          { class: 'statgrid' },
          statTile('Sustained DPS', fmt(dps, 0), 'sp/s', 'Raw output before hit chance. ~83 raw is the floor for a decisive match.'),
          statTile(
            'Heat balance',
            signed(balance, 1) || '0.0',
            'hu/s',
            balance > 0
              ? `Positive: you overload after ${fmt(overload, 0)}s of sustained fire.`
              : 'Negative: your cooling outpaces your guns. Fire freely.',
          ),
          statTile('eHP vs kinetic', fmt(effectiveHp(stats, 'KINETIC'), 0), 'sp', 'Raw damage needed to kill you with kinetic weapons.'),
          statTile('eHP vs thermal', fmt(effectiveHp(stats, 'THERMAL'), 0), 'sp', 'Thermal ignores more armour and strips it faster.'),
          statTile('eHP vs ion', fmt(effectiveHp(stats, 'ION'), 0), 'sp', 'Ion barely harms the frame — it drains and overheats instead.'),
        ),
      ),
    ),

    panel(
      'FRAME STATS',
      el(
        'div',
        { class: 'statgrid' },
        ...statKeys.map((key) => {
          const info = STAT_INFO[key];
          const raw = stats[key as keyof typeof stats] as number;
          const value =
            key === 'staggerResist' ? raw * 100 : key === 'critChance' ? raw * 100 : raw;
          return statTile(info.label, fmt(value, info.precision), info.unit, info.blurb);
        }),
      ),
    ),

    report.violations.length > 0 || report.warnings.length > 0
      ? panel(
          'ANALYSIS',
          el(
            'div',
            { class: 'notes' },
            ...report.violations.map((v) =>
              el('div', { class: 'note note--error' },
                el('span', { class: 'note__mark', text: '!!' }),
                el('span', { text: v.message })),
            ),
            ...report.warnings.map((w) =>
              el('div', { class: 'note note--warn' },
                el('span', { class: 'note__mark', text: '~' }),
                el('span', { text: w })),
            ),
          ),
        )
      : panel(
          'ANALYSIS',
          el('div', { class: 'empty', text: 'Frame is legal and has no outstanding warnings.' }),
        ),
  );
}

function statTile(label: string, value: string, unit: string, blurb: string): HTMLElement {
  return el(
    'div',
    { class: 'stat', title: blurb },
    el('span', { class: 'stat__label', text: label }),
    el(
      'span',
      { class: 'stat__value' },
      value,
      unit ? el('span', { class: 'stat__unit', text: unit }) : null,
    ),
  );
}

export function panel(title: string, body: HTMLElement, ...actions: HTMLElement[]): HTMLElement {
  return el(
    'section',
    { class: 'panel' },
    el(
      'header',
      { class: 'panel__head' },
      el('span', { class: 'panel__title', text: title }),
      ...actions,
    ),
    el('div', { class: 'panel__body' }, body),
  );
}
