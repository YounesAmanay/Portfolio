/**
 * The reflection environment.
 *
 * Physically-based metal is only convincing if there is something for it to
 * reflect. Without an environment map a brushed-aluminium chassis and a matte
 * plastic one render almost identically — which is exactly why the machines
 * read as flat pastel boxes.
 *
 * There is no HDRI to download here, so the environment is built: a dark box
 * with emissive panels arranged the way an arena's lighting rig would be, then
 * prefiltered into a mipmapped radiance map. Metal picks up bright overhead
 * strips, cyan side walls and a warm key from one corner, so rotating a part
 * sweeps highlights across it and the form becomes legible.
 *
 * Built once and shared. The source scene is thrown away immediately; only the
 * prefiltered texture is kept.
 */

import * as THREE from 'three';

/** Emissive panel: [x, y, z, width, height, depth, colour, intensity]. */
type Panel = readonly [number, number, number, number, number, number, string, number];

/**
 * The lighting rig, in the same arrangement as the arena's own.
 *
 * Overhead strips dominate, because that is what puts a moving highlight along
 * the top edge of a chassis. The cyan side panels are what make the machines
 * read as lit by the venue rather than by a studio, and the single warm corner
 * keeps the whole thing from going monochrome blue.
 */
const PANELS: readonly Panel[] = [
  // Overhead strips. Kept near photographic levels: an early version ran these
  // at 5.2 and any polished part became a white silhouette, because a mirror
  // finish reflects the rig almost unattenuated.
  [0, 9.6, -3.2, 14, 0.3, 1.6, '#ffffff', 2.1],
  [0, 9.6, 3.2, 14, 0.3, 1.6, '#ffffff', 2.1],
  [-3.2, 9.6, 0, 1.6, 0.3, 14, '#dceeff', 1.4],
  [3.2, 9.6, 0, 1.6, 0.3, 14, '#dceeff', 1.4],
  // Cyan wall wash, the arena's signature.
  [0, 3.4, -9.6, 16, 3.4, 0.3, '#2ea8d8', 0.75],
  [0, 3.4, 9.6, 16, 3.4, 0.3, '#2ea8d8', 0.75],
  [-9.6, 3.4, 0, 0.3, 3.4, 16, '#1d7fa8', 0.5],
  // One warm key so metal is not uniformly cold.
  [9.6, 4.2, -5.0, 0.3, 4.0, 7.0, '#ffb06a', 0.85],
  // A dim floor bounce; without it undersides go to pure black.
  [0, -0.4, 0, 16, 0.3, 16, '#16202c', 0.3],
];

function panelMesh([x, y, z, w, h, d, colour, intensity]: Panel): THREE.Mesh {
  const material = new THREE.MeshStandardMaterial({
    color: '#000000',
    emissive: new THREE.Color(colour),
    emissiveIntensity: intensity,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
}

/**
 * Prefilters the rig into a radiance map ready for `scene.environment`.
 *
 * The PMREM generator is the expensive part, so this runs once at startup and
 * the result is shared by every material in the game.
 */
export function buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const source = new THREE.Scene();

  // A shell, so reflections have a dark surround instead of blowing out to the
  // clear colour between the panels.
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(21, 21, 21),
    new THREE.MeshStandardMaterial({ color: '#05070d', side: THREE.BackSide, roughness: 1 }),
  );
  source.add(shell);
  for (const panel of PANELS) source.add(panelMesh(panel));

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const target = pmrem.fromScene(source, 0.04);

  // The source scene has done its job; only the prefiltered texture survives.
  source.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
  });
  pmrem.dispose();

  return target.texture;
}
