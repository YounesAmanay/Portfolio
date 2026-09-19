/**
 * Tiny DOM helpers.
 *
 * `el()` is a hyperscript-style builder that keeps view code declarative
 * without pulling in a framework. It handles the three things that actually
 * come up: attributes, event handlers, and children.
 */

type Child = Node | string | number | null | undefined | false;

export interface ElementProps {
  readonly class?: string;
  readonly text?: string | number;
  readonly html?: string;
  readonly title?: string;
  readonly style?: string;
  readonly [key: string]: unknown;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;

    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key === 'style') node.setAttribute('style', String(value));
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'dataset' && typeof value === 'object') {
      Object.assign(node.dataset, value);
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }

  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

export function fragment(...children: Child[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  append(frag, children);
  return frag;
}

/** Replaces a container's children in one pass. */
export function render(container: Element, ...children: Child[]): void {
  container.replaceChildren();
  append(container, children);
}

/** Formats a number for display, respecting a precision and trimming noise. */
export function fmt(value: number, precision = 0): string {
  if (!Number.isFinite(value)) return '∞';
  return value.toFixed(precision);
}

/** Signed delta, e.g. "+42" / "-8". Empty string for no change. */
export function signed(value: number, precision = 0): string {
  if (Math.abs(value) < 10 ** -precision / 2) return '';
  return `${value > 0 ? '+' : ''}${value.toFixed(precision)}`;
}
