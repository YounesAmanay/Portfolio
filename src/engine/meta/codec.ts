/**
 * Build and replay codes.
 *
 * A replay is not a video. Because a match is a pure function of
 * `(buildA, buildB, arena, seed)`, the entire thing round-trips through a
 * string short enough to paste into a URL — and re-running it reproduces the
 * match tick for tick. That also makes a submitted result *verifiable*: one
 * that does not reproduce is a forged one.
 *
 * ## Why parts are encoded as indices
 *
 * Part ids are long ('shoulder.thermal_array'), so codes encode each part as
 * its index into the registry's id-sorted list. That is compact, but it means
 * a code is only meaningful against the catalogue that produced it — insert a
 * part and every index after it shifts.
 *
 * The danger is not failure, it is *silent* success: a code decoding to a
 * different-but-valid build. So every code carries a fingerprint of the
 * catalogue it was written against, and decoding refuses rather than guesses.
 *
 * @see docs/03-architecture.md §6
 */

import type { Build, SocketAssignments } from '../domain/build';
import { CONDITIONS, ACTIONS, type ActionKind, type ConditionKind, type DoctrineRule } from '../domain/doctrine';
import { buildId, type ArenaId, type PartId } from '../domain/ids';
import { SOCKET_KINDS, type SocketKind } from '../domain/sockets';
import type { PartRegistry } from '../forge/registry';

const VERSION = 'ARC1';
const FIELD = ':';
const SLOT = '.';
const EMPTY = '_';
const RULE = ',';

/** Decoding takes user input, so it reports failure rather than throwing. */
export type DecodeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export interface Replay {
  readonly buildA: Build;
  readonly buildB: Build;
  readonly arenaId: ArenaId;
  readonly seed: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fingerprint
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Identifies the catalogue a code was written against. Changes whenever a part
 * or chassis is added, removed or renamed — which is exactly when indices stop
 * meaning what they meant.
 */
export function catalogueFingerprint(registry: PartRegistry): string {
  const payload = [
    ...registry.allChassis().map((c) => c.id),
    ...registry.allParts().map((p) => p.id),
  ].join('|');

  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0).toString(36);
}

// ─────────────────────────────────────────────────────────────────────────────
// Build codes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `ARC1:<fingerprint>:<chassis>:<sockets>:<doctrine>:<name>`
 *
 * Everything is base-36 so the result stays short and URL-safe without needing
 * base64 padding rules.
 */
export function encodeBuild(build: Build, registry: PartRegistry): string {
  const chassisIndex = registry.allChassis().findIndex((c) => c.id === build.chassisId);
  if (chassisIndex < 0) throw new Error(`Cannot encode unknown chassis: ${build.chassisId}`);

  const parts = registry.allParts();
  const partIndex = new Map(parts.map((part, index) => [part.id, index]));

  const sockets = SOCKET_KINDS.map((kind) => {
    const slots = build.assignments[kind] ?? [];
    return slots
      .map((id) => {
        if (id === null) return EMPTY;
        const index = partIndex.get(id);
        return index === undefined ? EMPTY : index.toString(36);
      })
      .join(SLOT);
  }).join('|');

  const doctrine = build.doctrine.rules
    .map((rule) => {
      const condition = CONDITIONS.indexOf(rule.condition);
      const action = ACTIONS.indexOf(rule.action);
      // Thresholds are stored x100 so ratio steps of 0.05 survive the round trip.
      const parameter = Math.round((rule.parameter ?? 0) * 100);
      return `${condition.toString(36)}${SLOT}${parameter.toString(36)}${SLOT}${action.toString(36)}`;
    })
    .join(RULE);

  return [
    VERSION,
    catalogueFingerprint(registry),
    chassisIndex.toString(36),
    sockets,
    doctrine,
    encodeURIComponent(build.name),
  ].join(FIELD);
}

export function decodeBuild(code: string, registry: PartRegistry): DecodeResult<Build> {
  const trimmed = code.trim();
  const fields = trimmed.split(FIELD);

  if (fields[0] !== VERSION) {
    return { ok: false, error: `Not an ARCFORGE build code (expected ${VERSION}).` };
  }
  if (fields.length < 5) return { ok: false, error: 'Build code is truncated.' };

  const [, fingerprint, chassisField, socketField, doctrineField, nameField] = fields;

  if (fingerprint !== catalogueFingerprint(registry)) {
    return {
      ok: false,
      error: 'This code was written against a different part catalogue and can no longer be read.',
    };
  }

  const chassisList = registry.allChassis();
  const chassis = chassisList[Number.parseInt(chassisField ?? '', 36)];
  if (!chassis) return { ok: false, error: 'Build code names a chassis that does not exist.' };

  const parts = registry.allParts();
  const assignments: Partial<Record<SocketKind, (PartId | null)[]>> = {};
  const socketGroups = (socketField ?? '').split('|');

  for (let i = 0; i < SOCKET_KINDS.length; i++) {
    const kind = SOCKET_KINDS[i]!;
    const group = socketGroups[i] ?? '';
    if (group === '') continue;

    const slots = group.split(SLOT).map((token) => {
      if (token === EMPTY) return null;
      return parts[Number.parseInt(token, 36)]?.id ?? null;
    });

    const capacity = chassis.sockets[kind] ?? 0;
    if (capacity === 0) continue;
    // Trim or pad to the chassis layout so a code can never produce a build
    // with more slots than the frame physically has.
    const sized = slots.slice(0, capacity);
    while (sized.length < capacity) sized.push(null);
    assignments[kind] = sized;
  }

  const rules = decodeDoctrine(doctrineField ?? '');
  if (!rules.ok) return rules;

  return {
    ok: true,
    value: {
      id: buildId('imported'),
      name: safeName(nameField),
      chassisId: chassis.id,
      assignments: assignments as SocketAssignments,
      doctrine: { rules: rules.value },
    },
  };
}

function decodeDoctrine(field: string): DecodeResult<DoctrineRule[]> {
  if (field === '') return { ok: true, value: [] };

  const rules: DoctrineRule[] = [];
  for (const token of field.split(RULE)) {
    const [c, p, a] = token.split(SLOT);
    const condition = CONDITIONS[Number.parseInt(c ?? '', 36)];
    const action = ACTIONS[Number.parseInt(a ?? '', 36)];
    if (!condition || !action) return { ok: false, error: 'Build code contains an unknown doctrine rule.' };

    const parameter = Number.parseInt(p ?? '0', 36) / 100;
    rules.push(makeRule(condition, action, parameter));
  }
  return { ok: true, value: rules };
}

/** `exactOptionalPropertyTypes` means an absent threshold must be absent, not undefined. */
function makeRule(condition: ConditionKind, action: ActionKind, parameter: number): DoctrineRule {
  return parameter === 0 ? { condition, action } : { condition, action, parameter };
}

function safeName(raw: string | undefined): string {
  if (!raw) return 'IMPORTED FRAME';
  try {
    const decoded = decodeURIComponent(raw).trim();
    return decoded === '' ? 'IMPORTED FRAME' : decoded.slice(0, 32);
  } catch {
    return 'IMPORTED FRAME';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Replay codes
// ─────────────────────────────────────────────────────────────────────────────

/** `ARCR1~<seed>~<arenaId>~<buildA>~<buildB>` */
export function encodeReplay(replay: Replay, registry: PartRegistry): string {
  return [
    'ARCR1',
    (replay.seed >>> 0).toString(36),
    replay.arenaId,
    encodeBuild(replay.buildA, registry),
    encodeBuild(replay.buildB, registry),
  ].join('~');
}

export function decodeReplay(code: string, registry: PartRegistry): DecodeResult<Replay> {
  const fields = code.trim().split('~');
  if (fields[0] !== 'ARCR1') return { ok: false, error: 'Not an ARCFORGE replay code.' };
  if (fields.length < 5) return { ok: false, error: 'Replay code is truncated.' };

  const seed = Number.parseInt(fields[1] ?? '', 36);
  if (!Number.isFinite(seed)) return { ok: false, error: 'Replay code has an unreadable seed.' };

  const a = decodeBuild(fields[3] ?? '', registry);
  if (!a.ok) return a;
  const b = decodeBuild(fields[4] ?? '', registry);
  if (!b.ok) return b;

  return {
    ok: true,
    value: { buildA: a.value, buildB: b.value, arenaId: fields[2] as ArenaId, seed: seed >>> 0 },
  };
}
