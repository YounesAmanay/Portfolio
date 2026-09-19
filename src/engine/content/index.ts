/**
 * Content registration.
 *
 * This is the only file that knows what exists in the game. The engine asks a
 * `PartRegistry` for parts by id and is otherwise entirely ignorant of the
 * catalogue — which is the whole point of the plugin architecture.
 *
 * To add content: write the part in the appropriate file, export it from that
 * file's `ALL_*` array, and it appears in the Forge. No engine change, no
 * registration boilerplate, no switch statement anywhere.
 */

import { PartRegistry } from '../forge/registry';
import { ALL_ARENAS } from './arenas';
import { ALL_CHASSIS } from './chassis';
import { ALL_CORES } from './cores';
import { ALL_LOCOMOTION } from './locomotion';
import { ALL_MODULES } from './modules';
import { ALL_PLATING } from './plating';
import { ALL_PROTOCOLS } from './protocols';
import { ALL_WEAPONS } from './weapons';

/**
 * Builds a fresh registry. Called once by the app; balance tests call it per
 * suite. Parts are immutable data, so sharing one registry across matches is
 * safe — the per-match state that used to make that risky now lives in
 * `FrameRuntime.hookMemory`.
 */
export function createRegistry(): PartRegistry {
  return new PartRegistry()
    .addChassis(...ALL_CHASSIS)
    .addParts(
      ...ALL_CORES,
      ...ALL_LOCOMOTION,
      ...ALL_PLATING,
      ...ALL_WEAPONS,
      ...ALL_MODULES,
      ...ALL_PROTOCOLS,
    )
    .freeze();
}

/** The shared registry for the running app. */
export const REGISTRY = createRegistry();

export { ALL_ARENAS };
export * from './arenas';
export * from './chassis';
export * from './cores';
export * from './locomotion';
export * from './modules';
export * from './plating';
export * from './protocols';
export * from './weapons';
export * from './ghosts';
