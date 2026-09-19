/**
 * Build transfer — sharing a frame, and importing someone else's.
 *
 * This is what makes the game competitive without a server: a build code is a
 * complete opponent, so Architects can trade frames and fight them offline.
 * The code is also the reason matches are verifiable — re-running a replay
 * that does not reproduce means the result was forged.
 */

import { REGISTRY, compileFrame, decodeBuild, encodeBuild, validateBuild } from '@engine/index';
import { announce } from '../components/announce';
import { copyText, flash } from '../components/clipboard';
import { el } from '../components/dom';
import type { AppState } from '../state/session';
import type { Store } from '../state/store';
import { panel } from './forge';

export function transferPanel(store: Store<AppState>, rerender: () => void): HTMLElement {
  const state = store.get();
  const code = encodeBuild(state.build, REGISTRY);

  const status = el('div', { class: 'transfer__status' });

  const codeField = el('input', {
    class: 'transfer__code mono',
    type: 'text',
    readonly: true,
    value: code,
    'aria-label': 'Your build code',
    onclick: (event: Event) => (event.target as HTMLInputElement).select(),
  });

  const copyButton = el('button', {
    class: 'btn btn--sm btn--primary',
    text: 'COPY',
    onclick: async (event: Event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const ok = await copyText(code);
      flash(button, ok ? 'COPIED' : 'PRESS CTRL+C');
      if (!ok) codeField.select();
    },
  });

  const linkButton = el('button', {
    class: 'btn btn--sm',
    text: 'COPY LINK',
    title: 'A URL that opens the Forge with this frame loaded',
    onclick: async (event: Event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const url = `${location.origin}${location.pathname}#build=${encodeURIComponent(code)}`;
      const ok = await copyText(url);
      flash(button, ok ? 'COPIED' : 'FAILED');
    },
  });

  const importField = el('input', {
    class: 'transfer__code mono',
    type: 'text',
    placeholder: 'Paste a build code to load it…',
    'aria-label': 'Import a build code',
  });

  const importButton = el('button', {
    class: 'btn btn--sm',
    text: 'IMPORT',
    onclick: () => {
      const result = importBuild(store, importField.value);
      if (result.ok) {
        // A successful import repaints the Forge, which discards this panel
        // and its status line with it — so the confirmation goes to the
        // body-level banner instead.
        importField.value = '';
        announce(result.message);
        rerender();
        return;
      }
      status.className = 'transfer__status transfer__status--error';
      status.textContent = result.message;
    },
  });

  return panel(
    'TRANSFER',
    el(
      'div',
      { class: 'stack' },
      el('p', {
        class: 'transfer__blurb',
        text:
          'A build code is a complete frame. Share one and another Architect can fight it exactly as you built it — the simulation is deterministic, so their result and yours agree.',
      }),
      el('div', { class: 'transfer__row' }, codeField, copyButton, linkButton),
      el('div', { class: 'transfer__row' }, importField, importButton),
      status,
    ),
  );
}

export interface ImportOutcome {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * Imports a pasted code. A decoded build is checked against the budgets before
 * it is accepted: a code can encode a frame that is structurally valid but
 * illegal (built on a chassis the sender owned different parts for), and
 * loading that silently would strand the player in the Forge with an
 * undeployable frame and no explanation.
 */
export function importBuild(store: Store<AppState>, raw: string): ImportOutcome {
  const text = raw.trim();
  if (text === '') return { ok: false, message: 'Paste a build code first.' };

  const decoded = decodeBuild(text, REGISTRY);
  if (!decoded.ok) return { ok: false, message: decoded.error };

  const report = validateBuild(compileFrame(decoded.value, REGISTRY), REGISTRY);
  const note = report.valid
    ? ''
    : ` Loaded, but it is not currently legal: ${report.violations[0]?.message ?? ''}`;

  store.set((state) => ({
    ...state,
    activeSlot: null,
    build: { ...decoded.value, id: state.build.id },
  }));

  return { ok: true, message: `Loaded ${decoded.value.name}.${note}` };
}

/**
 * Reads a `#build=` fragment on first load, so a shared link opens straight
 * into the Forge with that frame. The fragment is cleared afterwards to keep a
 * refresh from re-importing over the player's later edits.
 */
export function importFromUrl(store: Store<AppState>): ImportOutcome | null {
  const match = /#build=([^&]+)/.exec(location.hash);
  if (!match?.[1]) return null;

  // Clear the fragment first, so a malformed code cannot re-trigger on every
  // subsequent hashchange or survive into a refresh.
  history.replaceState(null, '', location.pathname + location.search);

  let code: string;
  try {
    code = decodeURIComponent(match[1]);
  } catch {
    return { ok: false, message: 'That share link is malformed.' };
  }

  return importBuild(store, code);
}
