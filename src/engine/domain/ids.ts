/**
 * Branded identifier types.
 *
 * A `PartId` and a `BuildId` are both strings at runtime, but the brand makes
 * them incompatible at compile time. This has already caught real mistakes
 * (passing a chassis id where a part id was expected) at zero runtime cost.
 */

declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

export type PartId = Brand<string, 'PartId'>;
export type BuildId = Brand<string, 'BuildId'>;
export type ArenaId = Brand<string, 'ArenaId'>;
export type GhostId = Brand<string, 'GhostId'>;

export const partId = (value: string): PartId => value as PartId;
export const buildId = (value: string): BuildId => value as BuildId;
export const arenaId = (value: string): ArenaId => value as ArenaId;
export const ghostId = (value: string): GhostId => value as GhostId;
