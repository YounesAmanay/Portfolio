/**
 * The plugin host.
 *
 * Content registers itself into a `PartRegistry`; the engine only ever asks the
 * registry for parts by id. Nothing in `sim/` or `forge/` imports a content
 * file, which is why adding a weapon is a data change rather than a code change.
 *
 * The registry is built once at startup and then frozen. Lookups are O(1) and
 * iteration is always in sorted-id order so that anything derived from "all
 * parts" is deterministic.
 */

import type { Chassis, Part } from '../domain/part';
import type { PartId } from '../domain/ids';
import type { SocketKind } from '../domain/sockets';

export class PartRegistry {
  readonly #parts = new Map<PartId, Part>();
  readonly #chassis = new Map<PartId, Chassis>();
  #frozen = false;

  /** Registers parts. Throws on duplicate ids — a silent overwrite would be a nightmare to debug. */
  addParts(...parts: readonly Part[]): this {
    this.#assertMutable();
    for (const part of parts) {
      if (this.#parts.has(part.id)) {
        throw new Error(`Duplicate part id: ${part.id}`);
      }
      this.#parts.set(part.id, part);
    }
    return this;
  }

  addChassis(...frames: readonly Chassis[]): this {
    this.#assertMutable();
    for (const frame of frames) {
      if (this.#chassis.has(frame.id)) {
        throw new Error(`Duplicate chassis id: ${frame.id}`);
      }
      this.#chassis.set(frame.id, frame);
    }
    return this;
  }

  /** Seals the registry. Called once after all content modules have loaded. */
  freeze(): this {
    this.#frozen = true;
    return this;
  }

  part(id: PartId): Part | undefined {
    return this.#parts.get(id);
  }

  /** Throwing lookup for paths where a missing part means corrupt data. */
  requirePart(id: PartId): Part {
    const part = this.#parts.get(id);
    if (!part) throw new Error(`Unknown part: ${id}`);
    return part;
  }

  chassis(id: PartId): Chassis | undefined {
    return this.#chassis.get(id);
  }

  requireChassis(id: PartId): Chassis {
    const frame = this.#chassis.get(id);
    if (!frame) throw new Error(`Unknown chassis: ${id}`);
    return frame;
  }

  /** All parts, sorted by id. Sorted because determinism beats insertion order. */
  allParts(): readonly Part[] {
    return [...this.#parts.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  allChassis(): readonly Chassis[] {
    return [...this.#chassis.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** Parts that fit a given socket. The Forge's primary query. */
  partsForSocket(kind: SocketKind): readonly Part[] {
    return this.allParts().filter((part) => part.socket === kind);
  }

  get size(): number {
    return this.#parts.size + this.#chassis.size;
  }

  #assertMutable(): void {
    if (this.#frozen) throw new Error('PartRegistry is frozen; register content before freeze().');
  }
}
