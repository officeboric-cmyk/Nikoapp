import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  type Texture,
} from 'three';
import { SEA_LEVEL } from '../physics/FlightModel';
import { MAP_HALF_SIZE } from './islands';
import { mulberry32 } from './noise';
import { SKY_GLSL, skyUniforms } from './Sky';
import type { Terrain } from './Terrain';

/**
 * The sea: ripples that drift (two layers of a tiling wave pattern sliding different ways),
 * the sky mirrored in it (more at a low angle, like real water), sun glints, turquoise shallows
 * and a band of foam along every coast.
 */

const SIZE = 90000; // m, reaches past the fog in every direction
const RIPPLE_TILE = 40; // m covered by one copy of the wave pattern
const RIPPLE_STRENGTH = 0.22;
const DEPTH_MAP = 1024; // texels across the map for "how deep is the water here?"
const DEPTH_RANGE = 30; // m, deepest depth the map tells apart
const DEEP = 0x1f8acb;
const SHALLOW = 0x48d1c4;

export class Sea {
  readonly mesh: Mesh;
  private readonly time = { value: 0 };

  constructor(terrain: Terrain) {
    const depth = depthTexture(terrain);
    const material = new MeshStandardMaterial({ color: DEEP, roughness: 0.18, metalness: 0 });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, skyUniforms, {
        seaTime: this.time,
        seaRipples: { value: rippleTexture() },
        seaDepth: { value: depth },
        seaShallow: { value: new Color(SHALLOW) },
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vSeaWorld;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeaWorld = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec2 vSeaWorld;
          uniform float seaTime;
          uniform sampler2D seaRipples;
          uniform sampler2D seaDepth;
          uniform vec3 seaShallow;
          float seaFoam;
          ${SKY_GLSL}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float waterDepth = texture2D(seaDepth, vSeaWorld / ${(MAP_HALF_SIZE * 2).toFixed(1)} + 0.5).r * ${DEPTH_RANGE.toFixed(1)};
          diffuseColor.rgb = mix(diffuseColor.rgb, seaShallow, 0.85 * (1.0 - smoothstep(0.0, 18.0, waterDepth)));
          // Foam lapping at the shore: bands that wash in and out.
          seaFoam = (1.0 - smoothstep(0.6, 4.5, waterDepth)) * (0.65 + 0.35 * sin(waterDepth * 4.0 - seaTime * 2.2));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), clamp(seaFoam, 0.0, 1.0) * 0.85);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `vec2 rippleUv = vSeaWorld / ${RIPPLE_TILE.toFixed(1)};
          vec2 slope = texture2D(seaRipples, rippleUv + seaTime * vec2(0.021, 0.013)).xy * 2.0 - 1.0;
          slope += texture2D(seaRipples, rippleUv * 0.63 + seaTime * vec2(-0.014, 0.018)).xy * 2.0 - 1.0;
          // Far away the ripples would only shimmer, so they calm down.
          slope *= ${RIPPLE_STRENGTH.toFixed(2)} * (1.0 - 0.7 * smoothstep(600.0, 4000.0, length(vViewPosition)));
          normal = normalize((viewMatrix * vec4(normalize(vec3(slope.x, 1.0, slope.y)), 0.0)).xyz);`,
        )
        .replace(
          '#include <opaque_fragment>',
          `{
            // The sky mirrored in the water, strongest when looking across it (Fresnel).
            vec3 toEye = normalize(vViewPosition);
            vec3 mirrored = inverseTransformDirection(reflect(-toEye, normal), viewMatrix);
            mirrored.y = abs(mirrored.y);
            float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(normal, toEye), 0.0), 5.0);
            outgoingLight = mix(outgoingLight, skyColor(mirrored), fresnel * 0.8 * (1.0 - clamp(seaFoam, 0.0, 1.0)));
          }
          #include <opaque_fragment>`,
        );
    };
    // Split into tiles so no triangle is huge; giant triangles cause depth glitches on some GPUs.
    this.mesh = new Mesh(new PlaneGeometry(SIZE, SIZE, 90, 90).rotateX(-Math.PI / 2), material);
    this.mesh.position.y = SEA_LEVEL;
    this.mesh.receiveShadow = true;
  }

  update(dt: number): void {
    this.time.value += dt;
  }
}

/** A tiling pattern of small waves, stored as the water surface's slope (x, z) in red and green. */
function rippleTexture(): Texture {
  const n = 256;
  const rand = mulberry32(7);
  // Whole numbers of waves across the tile, so the pattern repeats without seams.
  const waves = Array.from({ length: 14 }, () => {
    let kx = 0;
    let kz = 0;
    while (kx === 0 && kz === 0) {
      kx = Math.round((rand() * 2 - 1) * 7);
      kz = Math.round((rand() * 2 - 1) * 7);
    }
    return { kx, kz, amplitude: 1 / Math.hypot(kx, kz), phase: rand() * Math.PI * 2 };
  });
  const data = new Uint8Array(n * n * 4);
  const slopes = new Float32Array(n * n * 2);
  let biggest = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let sx = 0;
      let sz = 0;
      for (const w of waves) {
        const d = Math.cos(((w.kx * i + w.kz * j) / n) * Math.PI * 2 + w.phase) * w.amplitude;
        sx += d * w.kx;
        sz += d * w.kz;
      }
      slopes.set([sx, sz], (j * n + i) * 2);
      biggest = Math.max(biggest, Math.abs(sx), Math.abs(sz));
    }
  }
  for (let k = 0; k < n * n; k++) {
    data[k * 4] = Math.round((0.5 + (0.5 * slopes[k * 2]) / biggest) * 255);
    data[k * 4 + 1] = Math.round((0.5 + (0.5 * slopes[k * 2 + 1]) / biggest) * 255);
    data[k * 4 + 3] = 255;
  }
  const texture = new DataTexture(data, n, n);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** How deep the water is across the whole map (0 on land), for shallows and foam. */
function depthTexture(terrain: Terrain): Texture {
  const n = DEPTH_MAP;
  const data = new Uint8Array(n * n * 4);
  const cell = (MAP_HALF_SIZE * 2) / n;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const h = terrain.heightAt(-MAP_HALF_SIZE + (i + 0.5) * cell, -MAP_HALF_SIZE + (j + 0.5) * cell);
      const depth = Math.min(Math.max(SEA_LEVEL - h, 0), DEPTH_RANGE) / DEPTH_RANGE;
      data[(j * n + i) * 4] = Math.round(depth * 255);
      data[(j * n + i) * 4 + 3] = 255;
    }
  }
  const texture = new DataTexture(data, n, n);
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
