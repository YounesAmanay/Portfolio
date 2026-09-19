/**
 * The Lattice — opponent selection, live match playback, and the after-action
 * report.
 *
 * Playback drives the engine one tick at a time rather than simulating the
 * whole match up front, so the HUD can read true state at every instant and
 * the renderer can interpolate between ticks. The match is deterministic
 * either way; stepping it live is purely so the player can *watch*.
 */

import {
  ALL_GHOSTS,
  REGISTRY,
  TICK,
  arenaForSeed,
  compileFrame,
  computeReward,
  createMatch,
  createRng,
  encodeReplay,
  describeEvent,
  energyRatio,
  heatRatio,
  installedPartIds,
  stepMatch,
  structureRatio,
  updateRating,
  validateBuild,
  type CompiledFrame,
  type FrameRuntime,
  type Ghost,
  type MatchState,
  type SimEvent,
} from '@engine/index';
import { copyText, flash } from '../components/clipboard';
import { el, fmt } from '../components/dom';
import { ArenaRenderer } from '../render/arena-renderer';
import { save, type AppState, type Profile } from '../state/session';
import type { Store } from '../state/store';
import { panel } from './forge';

/** Playback lives outside the store: it is 60 fps churn, not application state. */
interface Playback {
  state: MatchState;
  renderer: ArenaRenderer;
  ghost: Ghost;
  playerFrame: CompiledFrame;
  speed: number;
  running: boolean;
  finished: boolean;
  accumulator: number;
  lastFrameTime: number;
  rafId: number;
  settled: boolean;
  /** Index of the next event not yet written to the log. */
  logged: number;
  logHost: HTMLElement | null;
}

let playback: Playback | null = null;

export function disposeLattice(): void {
  if (playback) cancelAnimationFrame(playback.rafId);
  playback = null;
}

export function latticeView(store: Store<AppState>, rerender: () => void): HTMLElement {
  const state = store.get();
  const frame = compileFrame(state.build, REGISTRY);
  const report = validateBuild(frame, REGISTRY);

  if (playback) return matchStage(store, rerender);

  return el(
    'div',
    { class: 'lattice' },
    !report.valid
      ? panel(
          'GATE LOCKED',
          el(
            'div',
            { class: 'notes' },
            ...report.violations.map((v) =>
              el('div', { class: 'note note--error' },
                el('span', { class: 'note__mark', text: '!!' }),
                el('span', { text: v.message })),
            ),
          ),
        )
      : null,
    panel(
      'SELECT OPPONENT',
      el(
        'div',
        { class: 'opponents' },
        ...ALL_GHOSTS.map((ghost) =>
          el(
            'button',
            {
              class: 'ghost-card',
              'aria-pressed': String(state.opponentId === ghost.build.id),
              onclick: () => store.set((s) => ({ ...s, opponentId: ghost.build.id })),
            },
            el(
              'div',
              { class: 'ghost-card__top' },
              el('span', { class: 'ghost-card__name', text: ghost.build.name }),
              el('span', { class: 'ghost-card__rating', text: String(ghost.rating) }),
            ),
            el('div', { class: 'ghost-card__arch', text: `${ghost.archetype} · ${ghost.architect}` }),
            el('div', { class: 'ghost-card__blurb', text: ghost.blurb }),
          ),
        ),
      ),
    ),
    el(
      'div',
      { class: 'row' },
      el('button', {
        class: 'btn btn--primary',
        text: 'ENTER THE LATTICE',
        disabled: !report.valid || !state.opponentId,
        onclick: () => {
          const ghost = ALL_GHOSTS.find((g) => g.build.id === state.opponentId);
          if (!ghost || !report.valid) return;
          startMatch(store, ghost, rerender);
        },
      }),
      el('span', {
        class: 'transport__status',
        text: report.valid
          ? 'FRAME LEGAL · DETERMINISTIC RESOLUTION'
          : 'FRAME ILLEGAL — RESOLVE VIOLATIONS IN THE FORGE',
      }),
    ),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Match lifecycle
// ─────────────────────────────────────────────────────────────────────────────

function startMatch(store: Store<AppState>, ghost: Ghost, rerender: () => void): void {
  const state = store.get();
  const playerFrame = compileFrame(state.build, REGISTRY);
  const ghostFrame = compileFrame(ghost.build, REGISTRY);

  // The seed selects the arena too, so nobody can tune for one map.
  const seed = (Date.now() ^ (state.profile.matches * 2654435761)) >>> 0;
  const arena = arenaForSeed(seed);

  const canvas = document.createElement('canvas');
  const renderer = new ArenaRenderer(canvas);

  playback = {
    state: createMatch(playerFrame, ghostFrame, arena, seed),
    renderer,
    ghost,
    playerFrame,
    speed: 1,
    running: true,
    finished: false,
    accumulator: 0,
    lastFrameTime: performance.now(),
    rafId: 0,
    settled: false,
    logged: 0,
    logHost: null,
  };

  rerender();
  loop(store, rerender);
}

/**
 * Fixed-timestep accumulator. The simulation only ever advances in whole
 * 50 ms ticks; the renderer interpolates the remainder. This is the standard
 * decoupling, and it is what lets playback run at 0.5x or 4x without changing
 * a single simulation result.
 */
function loop(store: Store<AppState>, rerender: () => void): void {
  if (!playback) return;
  const pb = playback;

  const step = (now: number): void => {
    if (!playback) return;
    const dt = Math.min(0.1, (now - pb.lastFrameTime) / 1000);
    pb.lastFrameTime = now;

    if (pb.running && !pb.finished) {
      pb.accumulator += dt * pb.speed;
      while (pb.accumulator >= TICK) {
        pb.accumulator -= TICK;
        const before = pb.state.events.length;
        pb.renderer.snapshot(pb.state);
        stepMatch(pb.state);
        pb.renderer.ingest(pb.state.events.slice(before));
        if (pb.state.finished) {
          pb.finished = true;
          pb.running = false;
          break;
        }
      }
    }

    pb.renderer.draw(pb.state, Math.min(1, pb.accumulator / TICK), dt);
    updateHud(pb);
    appendLog(pb);

    if (pb.finished && !pb.settled) {
      pb.settled = true;
      settleMatch(store, pb);
      rerender();
      return;
    }

    pb.rafId = requestAnimationFrame(step);
  };

  pb.rafId = requestAnimationFrame(step);
}

/** Applies rating, credits and salvage once, when the match ends. */
function settleMatch(store: Store<AppState>, pb: Playback): void {
  const state = store.get();
  const profile = state.profile;
  const won = pb.state.winner === 0;
  const drew = pb.state.winner === null;

  const rating = updateRating(
    profile.rating,
    pb.ghost.rating,
    drew ? 0.5 : won ? 1 : 0,
    profile.matches,
  );

  const opponentTelemetry = pb.state.frames[1]!;
  const damageRatio = 1 - Math.max(0, structureRatio(opponentTelemetry));

  const reward = computeReward(
    {
      won,
      damageRatio,
      rating: profile.rating,
      opponentRating: pb.ghost.rating,
      opponentParts: installedPartIds(pb.ghost.build),
      ownedParts: profile.ownedParts,
    },
    createRng(pb.state.seed ^ 0x5bf03635),
  );

  const next: Profile = {
    ...profile,
    credits: profile.credits + reward.credits,
    rating: rating.after,
    matches: profile.matches + 1,
    wins: profile.wins + (won ? 1 : 0),
    losses: profile.losses + (!won && !drew ? 1 : 0),
    draws: profile.draws + (drew ? 1 : 0),
    ownedParts: reward.salvage
      ? [...profile.ownedParts, reward.salvage]
      : profile.ownedParts,
  };

  lastSettlement = { reward, rating, won, drew };
  store.set((s) => ({ ...s, profile: next }));
  save(store.get());
}

let lastSettlement: {
  reward: ReturnType<typeof computeReward>;
  rating: ReturnType<typeof updateRating>;
  won: boolean;
  drew: boolean;
} | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Stage
// ─────────────────────────────────────────────────────────────────────────────

function matchStage(store: Store<AppState>, rerender: () => void): HTMLElement {
  const pb = playback!;
  const stage = el('div', { class: 'stage' });
  const hud = buildHud(pb);
  stage.appendChild(hud);

  const canvasHost = el('div', {});
  stage.appendChild(canvasHost);

  const transport = el(
    'div',
    { class: 'transport' },
    el('button', {
      class: 'btn btn--sm',
      text: pb.running ? 'PAUSE' : pb.finished ? 'ENDED' : 'RESUME',
      disabled: pb.finished,
      onclick: () => {
        pb.running = !pb.running;
        pb.lastFrameTime = performance.now();
        rerender();
      },
    }),
    ...[0.5, 1, 2, 4].map((speed) =>
      el('button', {
        class: `btn btn--sm${pb.speed === speed ? ' btn--primary' : ''}`,
        text: `${speed}×`,
        onclick: () => {
          pb.speed = speed;
          rerender();
        },
      }),
    ),
    el('span', { class: 'transport__spacer' }),
    el('span', { class: 'transport__status', text: pb.state.arena.name }),
  );
  stage.appendChild(transport);

  const log = el('div', { class: 'log' });
  stage.appendChild(log);
  // Re-attaching the host on each render means a view rebuild (e.g. changing
  // playback speed) replays the log from the top rather than losing it.
  pb.logHost = log;
  pb.logged = 0;
  appendLog(pb);

  // Mount the live canvas and size it to its container. Deferred because the
  // host has no width until the stage is actually in the document.
  queueMicrotask(() => {
    if (!playback) return;
    canvasHost.appendChild(pb.renderer.canvas);
    fitCanvas(pb, canvasHost);
    // Keep the arena sized to its container as the window changes.
    const observer = new ResizeObserver(() => {
      if (playback === pb) fitCanvas(pb, canvasHost);
    });
    observer.observe(canvasHost);
  });

  return el(
    'div',
    { class: 'lattice' },
    stage,
    pb.finished ? afterAction(store, pb, rerender) : null,
  );
}

/**
 * Sizes the arena to its container, bounded so the transport and combat log
 * stay above the fold. An arena that fills the viewport looks impressive and
 * is useless: you cannot read the fight and its log at the same time.
 */
function fitCanvas(pb: Playback, host: HTMLElement): void {
  const available = host.clientWidth || 900;
  const byHeight = ((window.innerHeight - 340) * pb.state.arena.width) / pb.state.arena.height;
  const width = Math.max(420, Math.min(available, ARENA_MAX_WIDTH, byHeight));
  pb.renderer.resize(pb.state.arena, width);
}

const ARENA_MAX_WIDTH = 960;

function buildHud(pb: Playback): HTMLElement {
  const [a, b] = pb.state.frames;
  return el(
    'div',
    { class: 'hud' },
    frameHud(a, 'left'),
    el('div', { class: 'hud__clock', id: 'hud-clock', text: '0.0s' }),
    frameHud(b, 'right'),
  );
}

function frameHud(runtime: FrameRuntime, side: 'left' | 'right'): HTMLElement {
  const id = runtime.index;
  return el(
    'div',
    { class: `hud__side${side === 'right' ? ' hud__side--right' : ''}` },
    el('div', { class: 'hud__name', text: runtime.frame.build.name }),
    el(
      'div',
      { class: 'hud__bars' },
      bar('SP', `hud-sp-${id}`, 'sp'),
      bar('SH', `hud-sh-${id}`, 'sh'),
      bar('HT', `hud-ht-${id}`, 'heat'),
      bar('EN', `hud-en-${id}`, 'en'),
    ),
  );
}

function bar(label: string, id: string, kind: string): HTMLElement {
  return el(
    'div',
    { class: 'bar' },
    el('span', { class: 'bar__label', text: label }),
    el('div', { class: 'bar__track' }, el('div', { class: `bar__fill bar__fill--${kind}`, id })),
  );
}

/**
 * Writes live values straight to the DOM rather than re-rendering the view.
 * At 60 fps a full re-render would be wasteful and would fight the CSS
 * transitions that make the bars read as physical.
 */
function updateHud(pb: Playback): void {
  const clock = document.getElementById('hud-clock');
  if (clock) clock.textContent = `${(pb.state.tick * TICK).toFixed(1)}s`;

  for (const runtime of pb.state.frames) {
    const id = runtime.index;
    setWidth(`hud-sp-${id}`, structureRatio(runtime));
    setWidth(`hud-sh-${id}`, runtime.frame.stats.shieldCapacity > 0
      ? runtime.shield / runtime.frame.stats.shieldCapacity
      : 0);
    const heat = heatRatio(runtime);
    const heatBar = document.getElementById(`hud-ht-${id}`);
    if (heatBar) {
      heatBar.style.width = `${Math.min(100, heat * 100)}%`;
      heatBar.classList.toggle('is-critical', heat >= 0.9);
    }
    setWidth(`hud-en-${id}`, energyRatio(runtime));
  }
}

function setWidth(id: string, fraction: number): void {
  const node = document.getElementById(id);
  if (node) node.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
}

/**
 * Appends only the events written since the last frame.
 *
 * Re-rendering the whole log every frame would be sixty DOM rebuilds a second
 * for a list that only ever grows at one end. Ordinary shots are filtered out;
 * a line per bullet is noise, and the telemetry table already has the totals.
 */
function appendLog(pb: Playback): void {
  const container = pb.logHost;
  if (!container) return;

  const events = pb.state.events;
  if (pb.logged >= events.length) return;

  const names: [string, string] = [
    pb.state.frames[0]!.frame.build.name,
    pb.state.frames[1]!.frame.build.name,
  ];

  const lines: HTMLElement[] = [];
  for (let i = pb.logged; i < events.length; i++) {
    const event = events[i]!;
    if (event.kind === 'SHOT' && !event.crit) continue;
    lines.push(
      el(
        'div',
        { class: `log__line log__line--${severityOf(event)}` },
        el('span', { class: 'log__t', text: `${(event.tick * TICK).toFixed(1)}s` }),
        describeEvent(event, names),
      ),
    );
  }
  pb.logged = events.length;
  if (lines.length === 0) return;

  container.append(...lines);
  // Bound the DOM: a long match can produce hundreds of notable lines.
  while (container.childElementCount > 120) container.firstElementChild?.remove();
  container.scrollTop = container.scrollHeight;
}

function severityOf(event: SimEvent): string {
  switch (event.kind) {
    case 'MATCH_END':
      return 'end';
    case 'OVERLOAD':
    case 'DESTROYED':
      return 'bad';
    case 'SHIELD_BROKEN':
    case 'STAGGERED':
    case 'AMMO_OUT':
      return 'big';
    default:
      return 'hit';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// After action
// ─────────────────────────────────────────────────────────────────────────────

function afterAction(store: Store<AppState>, pb: Playback, rerender: () => void): HTMLElement {
  const settlement = lastSettlement;
  const won = pb.state.winner === 0;
  const drew = pb.state.winner === null;
  const verdict = drew ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT';
  const tone = drew ? 'draw' : won ? 'win' : 'loss';

  const [a, b] = pb.state.frames;

  return el(
    'div',
    { class: 'result' },
    el(
      'div',
      { class: `result__banner result__banner--${tone}` },
      el('div', { class: 'result__verdict', text: verdict }),
      el('div', {
        class: 'result__detail',
        text: `${pb.state.outcome.replace('_', ' ').toLowerCase()} after ${(pb.state.tick * TICK).toFixed(1)}s on ${pb.state.arena.name}`,
      }),
      settlement
        ? el(
            'div',
            { class: 'result__rewards' },
            reward('CREDITS', `+${settlement.reward.credits}`, 'var(--amber)'),
            reward(
              'RATING',
              `${settlement.rating.delta >= 0 ? '+' : ''}${settlement.rating.delta}`,
              settlement.rating.delta >= 0 ? 'var(--green)' : 'var(--red)',
            ),
            reward('NEW RATING', String(settlement.rating.after), 'var(--cyan)'),
            settlement.reward.salvage
              ? reward(
                  'SALVAGE',
                  REGISTRY.part(settlement.reward.salvage)?.name ?? 'UNKNOWN',
                  'var(--magenta)',
                )
              : null,
          )
        : null,
    ),
    panel(
      'AFTER ACTION',
      el(
        'div',
        { class: 'telemetry' },
        telemetryColumn(a),
        telemetryColumn(b),
      ),
    ),
    el(
      'div',
      { class: 'row' },
      el('button', {
        class: 'btn btn--primary',
        text: 'RETURN TO FORGE',
        onclick: () => {
          disposeLattice();
          store.set((s) => ({ ...s, view: 'FORGE' }));
          rerender();
        },
      }),
      el('button', {
        class: 'btn',
        text: 'COPY REPLAY CODE',
        title: 'Four fields that reproduce this match exactly, on any device',
        onclick: async (event: Event) => {
          const button = event.currentTarget as HTMLButtonElement;
          const code = encodeReplay(
            {
              buildA: pb.state.frames[0]!.frame.build,
              buildB: pb.ghost.build,
              arenaId: pb.state.arena.id,
              seed: pb.state.seed,
            },
            REGISTRY,
          );
          flash(button, (await copyText(code)) ? 'COPIED' : 'FAILED');
        },
      }),
      el('button', {
        class: 'btn',
        text: 'FIGHT AGAIN',
        onclick: () => {
          const ghost = pb.ghost;
          disposeLattice();
          startMatch(store, ghost, rerender);
        },
      }),
    ),
  );
}

function reward(label: string, value: string, colour: string): HTMLElement {
  return el(
    'div',
    { class: 'reward' },
    el('span', { class: 'reward__label', text: label }),
    el('span', { class: 'reward__value', style: `color:${colour}`, text: value }),
  );
}

function telemetryColumn(runtime: FrameRuntime): HTMLElement {
  const weapons = runtime.weapons;
  const shots = weapons.reduce((sum, w) => sum + w.shotsFired, 0);
  const hits = weapons.reduce((sum, w) => sum + w.shotsHit, 0);

  return el(
    'div',
    { class: 'telemetry__col' },
    el('div', { class: 'section-title', text: runtime.frame.build.name }),
    row('Structure left', `${fmt(Math.max(0, runtime.structure), 0)} sp`),
    row('Damage dealt', `${fmt(runtime.damageDealt, 0)} sp`),
    row('Shield stripped', `${fmt(runtime.shieldDamageDealt, 0)}`),
    row('Accuracy', shots > 0 ? `${fmt((hits / shots) * 100, 0)}%` : '—'),
    row('Shots fired', String(shots)),
    row('Peak heat', `${fmt(runtime.peakHeatRatio * 100, 0)}%`),
    row('Overloads', String(runtime.overloadCount)),
    row('Armour left', fmt(runtime.armour, 0)),
    ...weapons.map((weapon) =>
      row(
        `  ${weapon.def.name}`,
        `${weapon.shotsHit}/${weapon.shotsFired} · ${fmt(weapon.damageDealt, 0)} sp${
          Number.isFinite(weapon.ammo) ? ` · ${weapon.ammo} left` : ''
        }`,
      ),
    ),
  );
}

function row(label: string, value: string): HTMLElement {
  return el('div', { class: 'telemetry__row' }, el('span', { text: label }), el('span', { text: value }));
}
