/**
 * The render stage: renderer, scene, lighting and environment.
 *
 * Art direction is "lit by its own machinery": a dark arena where almost all
 * colour comes from emissive accents and reflections, so metal reads as metal
 * and the neon means something. Physically-based materials do the work; there
 * are no baked textures and no asset pipeline.
 *
 * Quality adapts to the device rather than shipping one compromise to both —
 * a phone gets fewer shadow samples and no bloom, a desktop gets the lot.
 */

import * as THREE from 'three';

export interface StageQuality {
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  readonly pixelRatioCap: number;
  readonly bloom: boolean;
  readonly label: 'low' | 'medium' | 'high';
}

/** Picks a quality tier from what the device actually reports. */
export function detectQuality(): StageQuality {
  const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const small = Math.min(window.innerWidth, window.innerHeight) < 820;

  // A coarse pointer on a small screen is a phone, whatever it claims.
  if ((coarse && small) || memory <= 2 || cores <= 2) {
    return { shadows: true, shadowMapSize: 1024, pixelRatioCap: 1.5, bloom: false, label: 'low' };
  }
  if (memory <= 4 || cores <= 4) {
    return { shadows: true, shadowMapSize: 2048, pixelRatioCap: 1.75, bloom: true, label: 'medium' };
  }
  return { shadows: true, shadowMapSize: 4096, pixelRatioCap: 2, bloom: true, label: 'high' };
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly quality: StageQuality;
  readonly sun: THREE.DirectionalLight;

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
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05070d');
    this.scene.fog = new THREE.Fog('#05070d', 28, 95);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.05, 400);
    this.camera.position.set(6, 4, 8);

    // ── lighting ──────────────────────────────────────────────────────────
    // A cool sky / warm bounce pair gives metal somewhere to reflect from
    // without an HDRI download.
    const hemi = new THREE.HemisphereLight('#7fc9ff', '#241c14', 0.55);
    this.scene.add(hemi);

    this.sun = new THREE.DirectionalLight('#fff4e0', 2.2);
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
    const rim = new THREE.DirectionalLight('#4de2ff', 0.8);
    rim.position.set(-12, 8, -14);
    this.scene.add(rim);

    this.#attachResize(canvas);
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
    };
    apply();
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      this.#resizeObserver = new ResizeObserver(apply);
      this.#resizeObserver.observe(canvas.parentElement);
    }
    window.addEventListener('resize', apply);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** Keeps the shadow frustum centred on the action instead of the origin. */
  focusShadows(target: THREE.Vector3): void {
    this.sun.target.position.copy(target);
    this.sun.position.set(target.x + 14, target.y + 22, target.z + 10);
    this.sun.target.updateMatrixWorld();
  }

  dispose(): void {
    this.#resizeObserver?.disconnect();
    this.renderer.dispose();
  }
}
