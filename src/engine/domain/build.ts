/**
 * A Build is the player's authored artefact: a chassis, the parts plugged into
 * its sockets, and the doctrine compiled into its cortex.
 *
 * Builds are plain serialisable data — no functions, no references to Part
 * objects, only ids. That is what lets a build be stored, shared as a URL,
 * used as an asynchronous opponent, and embedded in a 1 KB replay.
 *
 * @see docs/01-rules.md §2
 */

import type { Doctrine } from './doctrine';
import type { BuildId, PartId } from './ids';
import { SOCKET_KINDS, type SocketKind, type SocketLayout } from './sockets';

/**
 * Parts installed per socket kind, positionally. A `null` entry is a
 * deliberately empty slot — running a weapon mount empty to save mass and
 * power is a real strategy, so it must be representable.
 */
export type SocketAssignments = Readonly<Partial<Record<SocketKind, readonly (PartId | null)[]>>>;

export interface Build {
  readonly id: BuildId;
  readonly name: string;
  readonly chassisId: PartId;
  readonly assignments: SocketAssignments;
  readonly doctrine: Doctrine;
}

/** Every installed part id, in deterministic socket order. */
export function installedPartIds(build: Build): readonly PartId[] {
  const ids: PartId[] = [];
  for (const kind of SOCKET_KINDS) {
    for (const id of build.assignments[kind] ?? []) {
      if (id !== null) ids.push(id);
    }
  }
  return ids;
}

/** Creates an assignment map sized to a chassis layout, with all slots empty. */
export function emptyAssignments(layout: SocketLayout): SocketAssignments {
  const result: Partial<Record<SocketKind, readonly (PartId | null)[]>> = {};
  for (const kind of SOCKET_KINDS) {
    const count = layout[kind] ?? 0;
    if (count > 0) result[kind] = new Array<PartId | null>(count).fill(null);
  }
  return result;
}

/**
 * Returns a new Build with one slot changed. Builds are immutable so that the
 * Forge UI can diff "before" against "after" and show live stat deltas without
 * any bookkeeping.
 */
export function withPart(
  build: Build,
  kind: SocketKind,
  index: number,
  partId: PartId | null,
): Build {
  const current = build.assignments[kind] ?? [];
  if (index < 0 || index >= current.length) return build;
  const next = current.slice();
  next[index] = partId;
  return { ...build, assignments: { ...build.assignments, [kind]: next } };
}

/** Removes every instance of a part — used when a part is sold or lost. */
export function withoutPart(build: Build, partId: PartId): Build {
  const assignments: Partial<Record<SocketKind, readonly (PartId | null)[]>> = {};
  for (const kind of SOCKET_KINDS) {
    const slots = build.assignments[kind];
    if (slots) assignments[kind] = slots.map((id) => (id === partId ? null : id));
  }
  return { ...build, assignments };
}

/**
 * A stable content hash. Two builds with the same parts in the same slots and
 * the same doctrine produce the same hash regardless of name or id, which is
 * what makes replays verifiable.
 */
export function buildHash(build: Build): string {
  const parts: string[] = [build.chassisId];
  for (const kind of SOCKET_KINDS) {
    const slots = build.assignments[kind] ?? [];
    parts.push(`${kind}:${slots.map((id) => id ?? '-').join(',')}`);
  }
  for (const rule of build.doctrine.rules) {
    parts.push(`${rule.condition}/${rule.parameter ?? ''}/${rule.action}`);
  }
  const payload = parts.join('|');
  // FNV-1a, 32-bit. Short, stable, and adequate for identity (not security).
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
