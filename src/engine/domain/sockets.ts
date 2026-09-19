/**
 * Sockets — the physical plugin points on a frame.
 * @see docs/01-rules.md §2
 */

export const SOCKET_KINDS = [
  'CORE',
  'ARM',
  'SHOULDER',
  'LOCOMOTION',
  'PLATING',
  'MODULE',
  'PROTOCOL',
] as const;

export type SocketKind = (typeof SOCKET_KINDS)[number];

/** How many sockets of each kind a chassis exposes. Absent = zero. */
export type SocketLayout = Readonly<Partial<Record<SocketKind, number>>>;

/** Sockets that must be filled for a build to be deployable. */
export const REQUIRED_SOCKETS: readonly SocketKind[] = ['CORE', 'LOCOMOTION'];

/** Human-facing labels and one-line explanations, used by the Forge UI. */
export const SOCKET_INFO: Readonly<Record<SocketKind, { label: string; blurb: string }>> = {
  CORE: { label: 'Core', blurb: 'Reactor. Supplies power, cycles, energy and base heat capacity.' },
  ARM: { label: 'Arm', blurb: 'Primary weapon mounts. Your sustained damage lives here.' },
  SHOULDER: { label: 'Shoulder', blurb: 'Heavy hardpoints. Burst damage, at a mass premium.' },
  LOCOMOTION: { label: 'Locomotion', blurb: 'Speed, evasion and stagger resistance.' },
  PLATING: { label: 'Plating', blurb: 'Armour and structure. Heavy, and it ablates under thermal fire.' },
  MODULE: { label: 'Module', blurb: 'Shields, cooling, targeting, repair. Costs cycles.' },
  PROTOCOL: { label: 'Protocol', blurb: 'Software. No mass — changes the rules, not the numbers.' },
};

export function socketCount(layout: SocketLayout, kind: SocketKind): number {
  return layout[kind] ?? 0;
}

/** Total physical slots, used by the UI to lay the Forge out. */
export function totalSockets(layout: SocketLayout): number {
  let total = 0;
  for (const kind of SOCKET_KINDS) total += socketCount(layout, kind);
  return total;
}
