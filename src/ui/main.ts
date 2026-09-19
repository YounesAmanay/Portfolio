/**
 * ARCFORGE — application entry point.
 *
 * Wires the session store to three views and re-renders on change. The whole
 * app is a `(state) => HTMLElement` tree plus one subscription; there is no
 * router, no framework, and no virtual DOM, because the interesting complexity
 * in this project lives entirely in the engine.
 */

import { ratingBand } from '@engine/index';
import { el, render } from './components/dom';
import { disposeLattice, latticeView } from './views/lattice';
import { armouryView } from './views/armoury';
import { doctrineView } from './views/doctrine';
import { forgeView } from './views/forge';
import { createSession, resetSession, save, type AppState, type ViewName } from './state/session';

const VIEWS: readonly { id: ViewName; label: string }[] = [
  { id: 'FORGE', label: 'FORGE' },
  { id: 'DOCTRINE', label: 'DOCTRINE' },
  { id: 'ARMOURY', label: 'ARMOURY' },
  { id: 'LATTICE', label: 'LATTICE' },
];

function boot(): void {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app not found');

  const store = createSession();
  let frameRequest = 0;

  /** Coalesces bursts of state changes into one paint. */
  const rerender = (): void => {
    if (frameRequest) return;
    frameRequest = requestAnimationFrame(() => {
      frameRequest = 0;
      paint();
    });
  };

  const paint = (): void => {
    const state = store.get();
    root.setAttribute('aria-busy', 'false');
    render(
      root,
      el(
        'div',
        { class: 'shell' },
        topbar(state, store, rerender),
        el('main', { class: 'view' }, viewFor(state, store, rerender)),
      ),
    );
  };

  store.subscribe(() => {
    save(store.get());
    rerender();
  });

  paint();
}

function viewFor(
  state: AppState,
  store: ReturnType<typeof createSession>,
  rerender: () => void,
): HTMLElement {
  switch (state.view) {
    case 'DOCTRINE':
      return doctrineView(store);
    case 'ARMOURY':
      return armouryView(store);
    case 'LATTICE':
      return latticeView(store, rerender);
    case 'FORGE':
    default:
      return forgeView(store);
  }
}

function topbar(
  state: AppState,
  store: ReturnType<typeof createSession>,
  rerender: () => void,
): HTMLElement {
  const { profile } = state;
  const record = `${profile.wins}W ${profile.losses}L${profile.draws ? ` ${profile.draws}D` : ''}`;

  return el(
    'header',
    { class: 'topbar' },
    el(
      'div',
      { class: 'brand' },
      el('div', { class: 'brand__mark', 'aria-hidden': 'true' }),
      el('span', { class: 'brand__name', text: 'ARCFORGE' }),
    ),
    el(
      'nav',
      { class: 'nav', 'aria-label': 'Sections' },
      ...VIEWS.map((view) =>
        el('button', {
          class: 'nav__tab',
          'aria-current': String(state.view === view.id),
          text: view.label,
          onclick: () => {
            // Leaving the Lattice must stop the playback loop, or it keeps
            // running against a canvas that is no longer in the document.
            if (state.view === 'LATTICE' && view.id !== 'LATTICE') disposeLattice();
            store.set((s) => ({ ...s, view: view.id }));
          },
        }),
      ),
    ),
    el(
      'div',
      { class: 'readout' },
      readout('CREDITS', String(profile.credits), 'credits'),
      readout('RATING', `${profile.rating}`, 'rating'),
      readout('BAND', ratingBand(profile.rating), ''),
      readout('RECORD', record, ''),
      el('button', {
        class: 'btn btn--ghost btn--sm btn--danger',
        text: 'RESET',
        title: 'Wipe this Architect and start over',
        onclick: () => {
          if (!confirm('Wipe this Architect? Credits, rating and salvaged parts are lost.')) return;
          disposeLattice();
          resetSession(store);
          rerender();
        },
      }),
    ),
  );
}

function readout(label: string, value: string, variant: string): HTMLElement {
  return el(
    'div',
    { class: 'readout__item' },
    el('span', { class: 'readout__label', text: label }),
    el('span', {
      class: `readout__value${variant ? ` readout__value--${variant}` : ''}`,
      text: value,
    }),
  );
}

boot();
