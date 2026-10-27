import { Color, DataTexture, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, type MeshStandardMaterial } from 'three';

/**
 * Detail for the ground, so grass reads as a real meadow rather than flat paint: a tileable noise
 * texture sampled at three sizes (dry and lush patches hundreds of metres across, clumps of tens of
 * metres, fine grain up close), all keyed to the world position, so no tiling shows from the air.
 */

const SIZE = 256;

let noise: DataTexture | null = null;

/** Four independent tileable noise layers (R, G, B, A), each stretched to the full 0..1 range. */
export function groundNoise(): DataTexture {
  if (noise) return noise;
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let channel = 0; channel < 4; channel++) {
    const values = new Float32Array(SIZE * SIZE);
    let min = Infinity;
    let max = -Infinity;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        let sum = 0;
        let amp = 1;
        for (let period = 4; period <= 64; period *= 2) {
          sum += tileNoise((x / SIZE) * period, (y / SIZE) * period, period, channel * 31 + period) * amp;
          amp *= 0.55;
        }
        values[y * SIZE + x] = sum;
        min = Math.min(min, sum);
        max = Math.max(max, sum);
      }
    }
    for (let i = 0; i < values.length; i++) data[i * 4 + channel] = Math.round(((values[i] - min) / (max - min)) * 255);
  }
  noise = new DataTexture(data, SIZE, SIZE, RGBAFormat);
  noise.wrapS = noise.wrapT = RepeatWrapping;
  noise.minFilter = LinearMipmapLinearFilter;
  noise.generateMipmaps = true;
  noise.anisotropy = 8;
  noise.needsUpdate = true;
  return noise;
}

/** Smooth value noise that repeats every `period` lattice cells. */
function tileNoise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const tx = fx * fx * (3 - 2 * fx);
  const ty = fy * fy * (3 - 2 * fy);
  const h = (i: number, j: number) => hash(((i % period) + period) % period, ((j % period) + period) % period, seed);
  const a = h(ix, iy);
  const b = h(ix + 1, iy);
  const c = h(ix, iy + 1);
  const d = h(ix + 1, iy + 1);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Sun-dried grass, for the dry patches in the meadows. */
export const DRY_GRASS = new Color(0xb3a45f);

/**
 * GLSL: `meadow(base, xz, grass)` gives a ground colour its dry and lush patches and clumps, keyed to the
 * world position. `grass` (0..1) is how much of it is grass; sand and rock only get the light and shade.
 * Needs `uniform sampler2D groundNoise; uniform vec3 dryGrass;`.
 */
export const MEADOW_GLSL = `
vec3 meadow(vec3 base, vec2 gp, float grass) {
  vec4 fine = texture2D(groundNoise, gp / 7.0);
  vec4 mid = texture2D(groundNoise, gp / 53.0 + vec2(0.31, 0.17));
  vec4 big = texture2D(groundNoise, gp / 390.0 + vec2(0.63, 0.41));
  float dry = smoothstep(0.5, 0.78, big.r * 0.75 + mid.g * 0.25);
  float brightness = clamp(dot(base, vec3(0.3, 0.59, 0.11)) / 0.3, 0.4, 1.6);
  base = mix(base, dryGrass * (0.8 + 0.35 * mid.b) * brightness, dry * 0.6 * grass);
  float lush = smoothstep(0.55, 0.85, big.g * 0.7 + mid.a * 0.3);
  base *= mix(vec3(1.0), vec3(0.72, 0.84, 0.68), lush * 0.7 * grass);
  return base * (0.74 + 0.52 * (fine.r * 0.45 + mid.r * 0.35 + big.b * 0.2));
}
`;

/** Adds the meadow detail to a vertex-coloured ground material. */
export function addGroundDetail(material: MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.groundNoise = { value: groundNoise() };
    shader.uniforms.dryGrass = { value: DRY_GRASS };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vGroundPos;\nuniform sampler2D groundNoise;\nuniform vec3 dryGrass;\n${MEADOW_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 gp = vGroundPos.xz;
          vec3 base = diffuseColor.rgb;
          // How much of this is grass (green above red and blue).
          float grass = clamp((base.g - max(base.r, base.b)) * 8.0, 0.0, 1.0);
          base = meadow(base, gp, grass);
          // Up close, a fine grain of grass blades and bare earth.
          float near = 1.0 - smoothstep(30.0, 200.0, distance(vGroundPos, cameraPosition));
          float grain = texture2D(groundNoise, gp / 1.3).g * 0.6 + texture2D(groundNoise, gp / 0.45).b * 0.4;
          diffuseColor.rgb = base * mix(1.0, 0.78 + 0.44 * grain, near);
        }`,
      );
  };
}
