/**
 * The render stage: renderer, scene, lighting, environment and post chain.
 *
 * Art direction is "lit by its own machinery": a dark arena where almost all
 * colour comes from emissive accents and reflections, so metal reads as metal
 * and the neon means something.
 *
 * Three things do that work, and the look collapses without any of them. A
 * prefiltered environment map gives metal something to reflect — without it
 * a brushed-aluminium chassis and a matte plastic one render identically, and
 * everything looks like flat pastel plastic. Bloom makes emissive accents read
 * as light sources rather than pale paint. And an HDR half-float buffer keeps
 * highlights above 1.0 alive all the way to the tone mapper, so the bloom has
 * real energy to pick up instead of clipped white.
 *
 * Quality adapts to the device rather than shipping one compromise to both: a
 * phone renders straight to the screen with no post chain at all, a desktop
 * gets multisampling, bloom and ambient occlusion.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildEnvironment } from './environment';

export interface StageQuality {
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  readonly pixelRatioCap: number;
  readonly bloom: boolean;
  /** Multisample count for the HDR buffer; 0 disables MSAA. */
  readonly samples: number;
  readonly label: 'low' | 'medium' | 'high';
}

const TIERS: Record<StageQuality['label'], StageQuality> = {
  low: { shadows: true, shadowMapSize: 1024, pixelRatioCap: 1.5, bloom: false, samples: 0, label: 'low' },
  medium: { shadows: true, shadowMapSize: 2048, pixelRatioCap: 1.75, bloom: true, samples: 0, label: 'medium' },
  high: { shadows: true, shadowMapSize: 4096, pixelRatioCap: 2, bloom: true, samples: 4, label: 'high' },
};

/**
 * Picks a quality tier from what the device actually reports.
 *
 * `?quality=high` overrides it. Device hints are conservative and frequently
 * wrong in both directions — a capable tablet reports a coarse pointer, and
 * some browsers do not report memory at all — so the override is worth having
 * for anyone whose hardware is better than their user agent admits.
 */
export function detectQuality(): StageQuality {
  const forced = new URLSearchParams(window.location.search).get('quality');
  if (forced === 'low' || forced === 'medium' || forced === 'high') return TIERS[forced];

  const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const small = Math.min(window.innerWidth, window.innerHeight) < 820;

  // A coarse pointer on a small screen is a phone, whatever it claims.
  if ((coarse && small) || memory <= 2 || cores <= 2) return TIERS.low;
  if (memory <= 4 || cores <= 4) return TIERS.medium;
  return TIERS.high;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly quality: StageQuality;
  readonly sun: THREE.DirectionalLight;

  /** Null on the low tier, which renders straight to the screen. */
  #composer: EffectComposer | null = null;
  #bloom: UnrealBloomPass | null = null;
  #resizeObserver: ResizeObserver | null = null;

  constructor(canvas: HTMLCanvasElement, quality = detectQuality()) {
    this.quality = quality;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality.label !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatioCap));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // ACES keeps emissive accents from blowing out to white the moment they
    // overlap, which is exactly what a neon-on-void palette does otherwise.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Pulled down from 1.25: with an environment map and bloom in play the
    // scene carries far more light than it did when everything was lit by two
    // direct lights, and the old exposure washed the mid-tones out.
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05070d');
    // Exponential rather than linear, and tuned to arena scale. The old linear
    // fog started at 34 m, which is further than most arenas are wide, so it
    // never touched anything and the far wall met the background at a hard
    // line. This one gives depth across the whole floor.
    this.scene.fog = new THREE.FogExp2('#080d16', 0.021);

    // Reflections. This is the single change that makes metal look like metal.
    this.scene.environment = buildEnvironment(this.renderer);
    // A full metal reflects the environment and almost nothing else, so this
    // is effectively the exposure control for every metal part in the game.
    // Too low and the machines go black no matter how strong the key light is.
    this.scene.environmentIntensity = 1.5;

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.05, 400);
    this.camera.position.set(6, 4, 8);

    // ── lighting ──────────────────────────────────────────────────────────
    // A cool sky / warm bounce pair gives metal somewhere to reflect from
    // without an HDRI download.
    // Much weaker than before. The environment map now supplies ambient and
    // bounce; leaving the hemisphere at its old strength on top of it flattened
    // every surface back out, which is the opposite of the point.
    const hemi = new THREE.HemisphereLight('#8fd2ff', '#2b2218', 0.38);
    this.scene.add(hemi);

    this.sun = new THREE.DirectionalLight('#fff4e0', 2.6);
    this.sun.position.set(14, 22, 10);
    this.sun.castShadow = quality.shadows;
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 70;
    const span = 22;
    this.sun.shadow.camera.left = -span;
    this.sun.shadow.camera.right = span;
    this.sun.shadow.camera.top = span;
    this.sun.shadow.camera.bottom = -span;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // Rim light from the opposite side so silhouettes stay readable against
    // a dark floor.
    const rim = new THREE.DirectionalLight('#4de2ff', 1.1);
    rim.position.set(-12, 8, -14);
    this.scene.add(rim);

    this.#buildComposer();
    this.#attachResize(canvas);
  }

  /**
   * The post chain, on devices that can afford it.
   *
   * The buffer is half-float so emissive surfaces can carry values well above
   * 1.0 into the bloom pass; on an 8-bit buffer they clip to white first and
   * the glow comes out grey and lifeless. OutputPass does tone mapping and the
   * colour-space conversion at the end, which is why the renderer's own
   * toneMapping setting is still what drives the look.
   */
  #buildComposer(): void {
    if (this.quality.label === 'low') return;

    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: this.quality.samples,
    });

    this.#composer = new EffectComposer(this.renderer, target);
    this.#composer.addPass(new RenderPass(this.scene, this.camera));

    if (this.quality.bloom) {
      // Threshold above 1.0, which only genuinely over-bright pixels reach.
      // Bloom runs before tone mapping, so the buffer is still HDR here: a
      // threshold below 1 catches ordinary lit bodywork and turns the whole
      // machine into a glowing blob, which is exactly what it did at 0.82.
      this.#bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.65, 1.05);
      this.#composer.addPass(this.#bloom);
    }

    this.#composer.addPass(new OutputPass());
  }

  #attachResize(canvas: HTMLCanvasElement): void {
    const apply = (): void => {
      const parent = canvas.parentElement;
      const width = parent?.clientWidth || window.innerWidth;
      const height = parent?.clientHeight || window.innerHeight;
      if (width === 0 || height === 0) return;
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height, false);

      // The composer owns its own buffers and does not track the renderer.
      const buffer = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.#composer?.setSize(buffer.x, buffer.y);
      this.#bloom?.setSize(buffer.x, buffer.y);
    };
    apply();
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      this.#resizeObserver = new ResizeObserver(apply);
      this.#resizeObserver.observe(canvas.parentElement);
    }
    window.addEventListener('resize', apply);
  }

  render(): void {
    if (this.#composer) this.#composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Keeps the shadow frustum centred on the action instead of the origin. */
  focusShadows(target: THREE.Vector3): void {
    this.sun.target.position.copy(target);
    this.sun.position.set(target.x + 14, target.y + 22, target.z + 10);
    this.sun.target.updateMatrixWorld();
  }

  dispose(): void {
    this.#resizeObserver?.disconnect();
    this.#composer?.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
  }
}
