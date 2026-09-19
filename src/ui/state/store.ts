/**
 * A minimal reactive store.
 *
 * Roughly sixty lines, and deliberately so. The interesting complexity in this
 * project lives in the engine; a framework here would add a dependency and a
 * mental tax to solve a problem this app does not have.
 *
 * Views are pure `(state) => HTMLElement` functions, so swapping in React
 * later would be mechanical rather than a rewrite.
 */

export type Listener<T> = (state: T) => void;
export type Updater<T> = (state: T) => T;

export interface Store<T> {
  get(): T;
  set(update: Updater<T> | Partial<T>): void;
  subscribe(listener: Listener<T>): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener<T>>();

  return {
    get: () => state,

    set(update) {
      const next =
        typeof update === 'function' ? (update as Updater<T>)(state) : { ...state, ...update };
      // Bail out on a no-op so a re-render is never scheduled for nothing.
      if (next === state || shallowEqual(next, state)) return;
      state = next;
      for (const listener of listeners) listener(state);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function shallowEqual<T extends object>(a: T, b: T): boolean {
  const keysA = Object.keys(a) as (keyof T)[];
  const keysB = Object.keys(b) as (keyof T)[];
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => Object.is(a[key], b[key]));
}
