/**
 * A transient banner for outcomes that happen outside any one view.
 *
 * It attaches to `document.body` rather than the app root deliberately: the
 * root is replaced wholesale on every re-render, so a message parented there
 * would vanish the moment the state change that caused it repainted the view.
 */

import { el } from './dom';

const VISIBLE_MS = 5000;
let current: HTMLElement | null = null;

export function announce(message: string, tone: 'info' | 'error' = 'info'): void {
  current?.remove();

  const banner = el('div', {
    class: `announce${tone === 'error' ? ' announce--error' : ''}`,
    role: 'status',
    'aria-live': 'polite',
    text: message,
  });

  document.body.appendChild(banner);
  current = banner;

  window.setTimeout(() => {
    if (current === banner) current = null;
    banner.remove();
  }, VISIBLE_MS);
}
