/**
 * The Armoury — where credits become options.
 *
 * Progression in ARCFORGE buys *breadth*, never power: every tier obeys the
 * same efficiency band, so a Tier IV part is more specialised rather than
 * stronger. What you are purchasing here is a larger answer space, and the
 * copy says so plainly rather than implying an upgrade treadmill.
 *
 * @see docs/02-balance.md §6
 */

import {
  ALL_CHASSIS,
  REGISTRY,
  SOCKET_INFO,
  SOCKET_KINDS,
  TIER_UNLOCK_RATING,
  checkPurchase,
  ratingBand,
  type Chassis,
  type Part,
  type PartId,
  type SocketKind,
  type Tier,
} from '@engine/index';
import { el } from '../components/dom';
import { owns, type AppState, type Profile } from '../state/session';
import type { Store } from '../state/store';
import { panel } from './forge';

/** A chassis and a part are bought identically; this is the shared shape. */
interface Purchasable {
  readonly id: PartId;
  readonly name: string;
  readonly tier: Tier;
  readonly price: number;
  readonly house: string;
  readonly description: string;
  readonly kind: SocketKind | 'CHASSIS';
  readonly detail: string;
}

export function armouryView(store: Store<AppState>): HTMLElement {
  const state = store.get();
  const { profile } = state;
  const stock = catalogue();

  const groups: { label: string; items: Purchasable[] }[] = [
    { label: 'CHASSIS', items: stock.filter((item) => item.kind === 'CHASSIS') },
    ...SOCKET_KINDS.map((kind) => ({
      label: SOCKET_INFO[kind].label.toUpperCase(),
      items: stock.filter((item) => item.kind === kind),
    })),
  ].filter((group) => group.items.length > 0);

  const ownedCount = stock.filter((item) => owned(profile, item)).length;

  return el(
    'div',
    { class: 'stack' },
    panel(
      'ACQUISITION',
      el(
        'div',
        { class: 'stack' },
        el('p', {
          style: 'font-size:12px;line-height:1.6;color:var(--ink-dim);margin:0',
          text:
            'Credits buy options, not numbers. Every tier is priced against the same efficiency band, so a Relic part is not stronger than a starter one — it is sharper, narrower, and harder to fit. What you are buying is a wider set of answers.',
        }),
        el(
          'div',
          { class: 'statgrid' },
          tile('Credits', String(profile.credits), '', 'Earned from matches. Losing still pays 40%.'),
          tile('Rating', String(profile.rating), ratingBand(profile.rating), 'Tier unlocks are gated on rating, not spending.'),
          tile('Catalogue', `${ownedCount}/${stock.length}`, 'owned', 'Salvage from a win can grant a part you have not bought.'),
        ),
        unlockLadder(profile),
      ),
    ),
    ...groups.map((group) =>
      panel(
        group.label,
        el(
          'div',
          { class: 'catalogue catalogue--open' },
          ...group.items.map((item) => stockRow(store, profile, item)),
        ),
      ),
    ),
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function catalogue(): Purchasable[] {
  const chassis: Purchasable[] = ALL_CHASSIS.map((frame: Chassis) => ({
    id: frame.id,
    name: frame.name,
    tier: frame.tier,
    price: frame.price,
    house: frame.house,
    description: frame.description,
    kind: 'CHASSIS' as const,
    detail: `${frame.structure} sp · ${frame.massLimit} kg · ${socketSummary(frame)}`,
  }));

  const parts: Purchasable[] = REGISTRY.allParts().map((part: Part) => ({
    id: part.id,
    name: part.name,
    tier: part.tier,
    price: part.price,
    house: part.house,
    description: part.description,
    kind: part.socket,
    detail: partDetail(part),
  }));

  // Cheapest first inside each group: the next affordable thing should be the
  // easiest to find, not buried under aspirational stock.
  return [...chassis, ...parts].sort((a, b) => a.price - b.price || (a.name < b.name ? -1 : 1));
}

function socketSummary(frame: Chassis): string {
  return SOCKET_KINDS.filter((kind) => (frame.sockets[kind] ?? 0) > 0)
    .map((kind) => `${SOCKET_INFO[kind].label} ×${frame.sockets[kind]}`)
    .join(' · ');
}

function partDetail(part: Part): string {
  const bits = [`${part.cost.mass} kg`];
  if (part.cost.powerDraw) bits.push(`${part.cost.powerDraw} PU`);
  if (part.cost.cycleDraw) bits.push(`${part.cost.cycleDraw} CY`);
  if (part.weapon) {
    const w = part.weapon;
    bits.push(`${w.damage}×${w.shots} ${w.damageType.toLowerCase()}`);
    bits.push(`${w.range.optimalRange} m`);
  }
  return bits.join(' · ');
}

function owned(profile: Profile, item: Purchasable): boolean {
  return item.price === 0 || owns(profile, item.id);
}

// ─────────────────────────────────────────────────────────────────────────────

function stockRow(store: Store<AppState>, profile: Profile, item: Purchasable): HTMLElement {
  const isOwned = owned(profile, item);
  const check = checkPurchase(item.price, item.tier, profile.credits, profile.rating);
  const canBuy = !isOwned && check.affordable && check.unlocked;

  return el(
    'div',
    { class: `part-row part-row--static${isOwned ? '' : check.unlocked ? '' : ' part-row--locked'}` },
    el(
      'div',
      {},
      el('div', { class: 'part-row__name', text: item.name }),
      el('div', { class: 'part-row__desc', text: item.description }),
      el(
        'div',
        { class: 'part-row__meta' },
        el('span', { class: 'tag tag--tier', text: `T${item.tier}` }),
        el('span', { class: 'tag', text: item.house }),
        el('span', { class: 'tag', text: item.detail }),
      ),
    ),
    el(
      'div',
      { class: 'stock__action' },
      isOwned
        ? el('span', { class: 'stock__owned', text: item.price === 0 ? 'GRANTED' : 'OWNED' })
        : el(
            'button',
            {
              class: `btn btn--sm${canBuy ? ' btn--primary' : ''}`,
              disabled: !canBuy,
              title: check.reason ?? `Purchase ${item.name}`,
              text: `${item.price}c`,
              onclick: () => purchase(store, item),
            },
          ),
      !isOwned && check.reason
        ? el('span', { class: 'stock__reason', text: check.reason })
        : null,
    ),
  );
}

/**
 * Re-checks affordability at the moment of purchase rather than trusting the
 * button's disabled state — the store is the authority, and a stale render
 * must never be able to spend credits the Architect no longer has.
 */
function purchase(store: Store<AppState>, item: Purchasable): void {
  const { profile } = store.get();
  if (owns(profile, item.id)) return;

  const check = checkPurchase(item.price, item.tier, profile.credits, profile.rating);
  if (!check.affordable || !check.unlocked) return;

  store.set((state) => ({
    ...state,
    profile: {
      ...state.profile,
      credits: state.profile.credits - item.price,
      ownedParts: [...state.profile.ownedParts, item.id],
    },
  }));
}

// ─────────────────────────────────────────────────────────────────────────────

const ROMAN: Readonly<Record<Tier, string>> = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V' };

function unlockLadder(profile: Profile): HTMLElement {
  const tiers: Tier[] = [1, 2, 3, 4, 5];
  return el(
    'div',
    { class: 'ladder' },
    ...tiers.map((tier) => {
      const required = TIER_UNLOCK_RATING[tier] ?? 0;
      const open = profile.rating >= required;
      return el(
        'div',
        { class: `ladder__step${open ? ' ladder__step--open' : ''}` },
        el('span', { class: 'ladder__tier', text: `TIER ${ROMAN[tier]}` }),
        el('span', {
          class: 'ladder__gate',
          text: open ? 'UNLOCKED' : `RATING ${required}`,
        }),
      );
    }),
  );
}

function tile(label: string, value: string, unit: string, blurb: string): HTMLElement {
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
