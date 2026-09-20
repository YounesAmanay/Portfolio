/**
 * Drawing the wiring diagram.
 *
 * SVG rather than canvas, because every node has to be clickable and every
 * edge has to be legible at any zoom — and because the whole thing is a few
 * hundred elements, not a few hundred thousand.
 *
 * The layout is already decided by `schematicOf`; this only turns ranks and
 * rows into coordinates and picks the colours. Keeping those apart is what
 * lets the topology be tested without a browser.
 */

import type { PortKind } from '../kinetic/machine/components';
import type { NodeRole, Schematic, SchematicNode } from '../kinetic/machine/schematic';

const SVG_NS = 'http://www.w3.org/2000/svg';

const COLUMN = 176;
const ROW = 80;
const NODE_W = 146;
const NODE_H = 58;
const PAD = 22;

/** What each kind of link carries, and therefore what colour it is. */
/** A hue dark enough to read as 9px text on a white card. */
function inkFor(colour: string): string {
  const shade: Record<string, string> = {
    '#ffb648': '#a06400',
    '#37d6a0': '#127a55',
    '#c8a04a': '#8a6a1c',
    '#9aa6b5': '#5a6879',
    '#4de2ff': '#0a7d8a',
    '#5d646d': '#4a5058',
    '#ff5c6a': '#c02434',
  };
  return shade[colour] ?? colour;
}

const KIND_COLOUR: Record<PortKind, string> = {
  power: '#ffb648',
  signal: '#37d6a0',
  shaft: '#9aa6b5',
  gas: '#4de2ff',
  fuel: '#ff8c42',
};

const ROLE_COLOUR: Record<NodeRole, string> = {
  SOURCE: '#ffb648',
  CONTROL: '#37d6a0',
  CONVERTER: '#c8a04a',
  TRANSMISSION: '#9aa6b5',
  OUTPUT: '#4de2ff',
  PASSIVE: '#5d646d',
};

function svg<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

const nodeX = (n: SchematicNode): number => PAD + n.rank * COLUMN;
const nodeY = (n: SchematicNode): number => PAD + n.row * ROW;

export interface SchematicViewEvents {
  onSelect(uid: string): void;
}

/**
 * Renders the diagram into a host element.
 *
 * Rebuilt wholesale on every change rather than diffed. A machine's circuit is
 * a few dozen nodes, and a diagram that is always freshly derived cannot drift
 * out of step with the build — which is the entire reason it is worth drawing.
 */
export function renderSchematic(
  host: HTMLElement,
  schematic: Schematic,
  selected: string | null,
  events: SchematicViewEvents,
): void {
  host.replaceChildren();

  if (schematic.nodes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'schematic__empty';
    empty.textContent = 'Nothing wired yet. Place a battery, a controller and a motor, then link them.';
    host.appendChild(empty);
    return;
  }

  const width = PAD * 2 + Math.max(1, schematic.columns) * COLUMN - (COLUMN - NODE_W);
  const height = PAD * 2 + Math.max(1, schematic.rows) * ROW - (ROW - NODE_H);

  const root = svg('svg', {
    class: 'schematic',
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    role: 'img',
    'aria-label': 'Wiring diagram',
  });

  const byUid = new Map(schematic.nodes.map((n) => [n.uid, n]));

  // ── edges first, so nodes sit on top of them ───────────────────────────
  const wires = svg('g', { class: 'schematic__wires' });
  for (const edge of schematic.edges) {
    const from = byUid.get(edge.from);
    const to = byUid.get(edge.to);
    if (!from || !to) continue;

    const x1 = nodeX(from) + NODE_W;
    const y1 = nodeY(from) + NODE_H / 2;
    const x2 = nodeX(to);
    const y2 = nodeY(to) + NODE_H / 2;
    // A cubic with horizontal handles: wires leave a component sideways and
    // arrive sideways, the way a loom actually runs, and two links between
    // the same pair of columns stay distinguishable.
    const bend = Math.max(24, Math.abs(x2 - x1) * 0.45);
    const colour = KIND_COLOUR[edge.kind];

    wires.appendChild(
      svg('path', {
        d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
        fill: 'none',
        stroke: colour,
        'stroke-width': edge.kind === 'shaft' ? 3 : 2,
        'stroke-opacity': 0.75,
        'stroke-dasharray': edge.kind === 'signal' ? '5 4' : '',
        class: `wire wire--${edge.kind}`,
      }),
    );
    wires.appendChild(svg('circle', { cx: x2, cy: y2, r: 2.6, fill: colour }));
  }
  root.appendChild(wires);

  // ── nodes ───────────────────────────────────────────────────────────────
  for (const node of schematic.nodes) {
    const x = nodeX(node);
    const y = nodeY(node);
    const accent = node.faulted ? '#ff5c6a' : ROLE_COLOUR[node.role];

    const group = svg('g', {
      class: `schematic__node${node.faulted ? ' is-faulted' : ''}${node.uid === selected ? ' is-selected' : ''}`,
      tabindex: 0,
      role: 'button',
      'aria-label': `${node.label}, ${node.detail}`,
      transform: `translate(${x} ${y})`,
    });

    group.appendChild(
      svg('rect', {
        width: NODE_W,
        height: NODE_H,
        rx: 8,
        fill: node.uid === selected ? '#e7f0ff' : '#f6f9fd',
        stroke: node.uid === selected ? '#2f6fe4' : '#c3d2e6',
        'stroke-width': 2,
      }),
    );
    // The role stripe: what this thing is for, readable before the label is.
    group.appendChild(svg('rect', { width: 4, height: NODE_H, rx: 2, fill: accent }));

    const label = svg('text', { x: 14, y: 23, class: 'schematic__label', fill: '#16243a' });
    label.textContent = node.label;
    group.appendChild(label);

    // Darkened against a light card: the role hues are chosen to read on the
    // model, where they sit against a bright set, and several of them (yellow,
    // cyan) are invisible as small text on white.
    const detail = svg('text', { x: 14, y: 41, class: 'schematic__detail', fill: inkFor(accent) });
    detail.textContent = node.detail;
    group.appendChild(detail);

    const select = (): void => events.onSelect(node.uid);
    group.addEventListener('click', select);
    group.addEventListener('keydown', (event) => {
      if (event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        select();
      }
    });
    root.appendChild(group);
  }

  host.appendChild(root);
  host.appendChild(legend());
}

function legend(): HTMLElement {
  const box = document.createElement('div');
  box.className = 'schematic__legend';
  for (const [kind, colour] of Object.entries(KIND_COLOUR) as [PortKind, string][]) {
    const item = document.createElement('span');
    item.className = 'schematic__key';
    const swatch = document.createElement('i');
    swatch.style.background = colour;
    item.appendChild(swatch);
    item.appendChild(document.createTextNode(kind));
    box.appendChild(item);
  }
  return box;
}
