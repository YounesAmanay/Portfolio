/**
 * Session state: the Architect's profile, their build, and persistence.
 *
 * The engine is pure and stateless, so everything that survives a reload lives
 * here. Storage is best-effort by design — a corrupted or absent save must
 * degrade to a fresh profile rather than a blank screen.
 */

import {
  ALL_CHASSIS,
  ALL_GHOSTS,
  DEFAULT_DOCTRINE,
  REGISTRY,
  type Build,
  type Doctrine,
  type PartId,
  buildId,
  emptyAssignments,
  partId,
  ELO_START,
} from '@engine/index';
import { createStore, type Store } from './store';

const STORAGE_KEY = 'arcforge.session.v1';

export type ViewName = 'FORGE' | 'DOCTRINE' | 'LATTICE';

export interface Profile {
  readonly callsign: string;
  readonly credits: number;
  readonly rating: number;
  readonly matches: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly ownedParts: readonly PartId[];
}

export interface AppState {
  readonly view: ViewName;
  readonly build: Build;
  readonly profile: Profile;
  /** Which socket the Forge's catalogue is currently filling. */
  readonly activeSlot: { kind: string; index: number } | null;
  readonly opponentId: string | null;
  /** Bumped to force a re-render when a match advances. */
  readonly tick: number;
}

/**
 * Tier I parts are granted, so a new Architect can always field something
 * legal. Everything above Tier I is bought or salvaged.
 */
function starterParts(): PartId[] {
  return REGISTRY.allParts()
    .filter((part) => part.tier === 1)
    .map((part) => part.id);
}

export function starterBuild(): Build {
  const chassis = ALL_CHASSIS.find((c) => c.name === 'WARDEN') ?? ALL_CHASSIS[0]!;
  const assignments = { ...emptyAssignments(chassis.sockets) } as Record<string, (PartId | null)[]>;
  // A legal, unremarkable opening frame: core, legs, one rifle, one plate.
  assignments.CORE = [partId('core.ember')];
  assignments.LOCOMOTION = [partId('loco.strider')];
  assignments.ARM = [partId('arm.slug_thrower'), partId('arm.pulse_laser')];
  assignments.PLATING = [partId('plate.composite'), partId('plate.ablative_weave')];
  assignments.MODULE = [partId('mod.heat_sink'), partId('mod.targeting')];
  return {
    id: buildId('player.primary'),
    name: 'FIRST LIGHT',
    chassisId: chassis.id,
    assignments: assignments as Build['assignments'],
    doctrine: DEFAULT_DOCTRINE,
  };
}

function freshProfile(): Profile {
  return {
    callsign: 'ARCHITECT',
    credits: 400,
    rating: ELO_START,
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    ownedParts: starterParts(),
  };
}

export function createSession(): Store<AppState> {
  const restored = load();
  return createStore<AppState>({
    view: 'FORGE',
    build: restored?.build ?? starterBuild(),
    profile: restored?.profile ?? freshProfile(),
    activeSlot: null,
    opponentId: ALL_GHOSTS[0]?.build.id ?? null,
    tick: 0,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence — best effort, never fatal
// ─────────────────────────────────────────────────────────────────────────────

interface Persisted {
  readonly build: Build;
  readonly profile: Profile;
}

export function save(state: AppState): void {
  try {
    const payload: Persisted = { build: state.build, profile: state.profile };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Private browsing, blocked storage, quota. Losing progress is bad; losing
    // the running session because saving failed would be worse.
  }
}

function load(): Persisted | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Persisted;
    if (!parsed?.build?.chassisId || !parsed?.profile) return null;
    // Guard against a save written by an older catalogue.
    if (!REGISTRY.chassis(parsed.build.chassisId)) return null;
    return {
      build: { ...parsed.build, doctrine: parsed.build.doctrine ?? DEFAULT_DOCTRINE },
      profile: { ...freshProfile(), ...parsed.profile },
    };
  } catch {
    return null;
  }
}

export function resetSession(store: Store<AppState>): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  store.set({ build: starterBuild(), profile: freshProfile(), activeSlot: null, tick: 0 });
}

export function owns(profile: Profile, id: PartId): boolean {
  return profile.ownedParts.includes(id);
}

export function withDoctrine(build: Build, doctrine: Doctrine): Build {
  return { ...build, doctrine };
}
