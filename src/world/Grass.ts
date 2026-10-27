import {
  BufferGeometry,
  DoubleSide,
  Color,
  Float32BufferAttribute,
  InstancedMesh,
  MathUtils,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import { RUNWAY_WIDTH } from './Airport';
import { DRY_GRASS, MEADOW_GLSL, groundNoise } from './groundDetail';
import { mulberry32, noise2 } from './noise';
import type { Terrain } from './Terrain';

/**
 * Real tufts of grass around the camera when it is near the ground (taxiing, taking off, landing,
 * flying low), so the meadows have depth. They sit on a fixed grid in the world, so walking the patch
 * along with the camera never shuffles them, and take the colour of the ground they grow from.
 */

const DENSITY = { pretty: { spacing: 0.7, radius: 56 }, fast: { spacing: 1, radius: 42 } };
const SHOW_BELOW = 80; // m above the ground: higher up a tuft is smaller than a pixel
const MOVE_STEP = 12; // m the camera moves before the patch is laid out again
const BLADES = 12;

export class Grass {
  private readonly mesh: InstancedMesh;
  private spacing = DENSITY.pretty.spacing;
  private radius = DENSITY.pretty.radius;
  private readonly centre = new Vector3(Infinity, 0, Infinity);
  private readonly time = { value: 0 };

  constructor(
    scene: Scene,
    private readonly terrain: Terrain,
  ) {
    const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: DoubleSide });
    const time = this.time;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.groundNoise = { value: groundNoise() };
      shader.uniforms.dryGrass = { value: DRY_GRASS };
      shader.uniforms.time = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float time;\nvarying vec3 vTuftPos;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vTuftPos = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          // The breeze bends the blades, the tips the most.
          float sway = sin(time * 1.7 + vTuftPos.x * 0.21 + vTuftPos.z * 0.17) + 0.5 * sin(time * 3.1 + vTuftPos.x * 0.53);
          transformed.x += sway * 0.07 * position.y * position.y;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vTuftPos;\nuniform sampler2D groundNoise;\nuniform vec3 dryGrass;\n${MEADOW_GLSL}`)
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = meadow(diffuseColor.rgb, vTuftPos.xz, 1.0);')
        // Both sides of a blade lit alike, as if facing up (the back side would otherwise face down and go dark).
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
    };
    const capacity = Math.ceil((Math.PI * DENSITY.pretty.radius ** 2) / DENSITY.pretty.spacing ** 2);
    this.mesh = new InstancedMesh(tuftGeometry(), material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // it moves with the camera; its bounds would go stale
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }

  /** Fast: fewer tufts in a smaller patch. */
  setQuality(quality: 'fast' | 'pretty'): void {
    ({ spacing: this.spacing, radius: this.radius } = DENSITY[quality]);
    this.centre.set(Infinity, 0, Infinity); // lay it out again
  }

  update(camera: Vector3, dt: number): void {
    this.time.value += dt;
    const ground = this.terrain.heightAt(camera.x, camera.z);
    const low = camera.y - Math.max(ground, 0) < SHOW_BELOW;
    this.mesh.visible = low;
    if (!low || Math.hypot(camera.x - this.centre.x, camera.z - this.centre.z) < MOVE_STEP) return;
    this.centre.copy(camera);
    this.layOut();
  }

  private layOut(): void {
    const { spacing, radius, centre, terrain } = this;
    const m = new Matrix4();
    const position = new Vector3();
    const turn = new Quaternion();
    const scale = new Vector3();
    const up = new Vector3(0, 1, 0);
    const i0 = Math.floor((centre.x - radius) / spacing);
    const i1 = Math.ceil((centre.x + radius) / spacing);
    const j0 = Math.floor((centre.z - radius) / spacing);
    const j1 = Math.ceil((centre.z + radius) / spacing);
    let n = 0;
    for (let j = j0; j <= j1 && n < this.mesh.instanceMatrix.count; j++) {
      for (let i = i0; i <= i1 && n < this.mesh.instanceMatrix.count; i++) {
        const rand = mulberry32(i * 73856093 ^ j * 19349663);
        const x = (i + rand()) * spacing;
        const z = (j + rand()) * spacing;
        const d = Math.hypot(x - centre.x, z - centre.z);
        if (d > radius) continue;
        // Tufts grow in clumps, thinner in the dry patches.
        if (noise2(x / 9, z / 9, 5) + rand() * 0.9 < 0.05) continue;
        const h = terrain.heightAt(x, z);
        if (h < 2.8 || h > 300 || this.paved(x, z)) continue;
        const slope = Math.abs(terrain.heightAt(x + 2, z) - h) + Math.abs(terrain.heightAt(x, z + 2) - h);
        if (slope > 1.6) continue; // rock
        const size = (0.7 + rand() * 0.7) * (1 - MathUtils.smoothstep(d, radius * 0.7, radius));
        position.set(x, h - 0.08, z);
        turn.setFromAxisAngle(up, rand() * Math.PI * 2);
        scale.set(size, size * (0.7 + rand() * 0.7), size);
        this.mesh.setMatrixAt(n++, m.compose(position, turn, scale));
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Runways, aprons and the ground under the airport buildings. */
  private paved(x: number, z: number): boolean {
    for (const airport of this.terrain.airports) {
      const [along, across] = airport.toLocal(x, z);
      const half = airport.length / 2;
      if (Math.abs(along) > half + 120 || Math.abs(across) > 130) continue;
      if (Math.abs(across) < RUNWAY_WIDTH / 2 + 2 && Math.abs(along) < half + 3) return true;
      if (across > RUNWAY_WIDTH / 2 && across < RUNWAY_WIDTH / 2 + 115 && along > 95 - half && along < 325 - half) return true;
    }
    return false;
  }
}

/** A tuft: thin blades fanning out from one spot, dark at the root and lighter at the tip. */
function tuftGeometry(): BufferGeometry {
  const rand = mulberry32(7);
  const positions: number[] = [];
  const colors: number[] = [];
  const root = new Color(0x56762f);
  const tip = new Color(0x9db45f);
  for (let b = 0; b < BLADES; b++) {
    const angle = (b / BLADES) * Math.PI * 2 + rand() * 0.6;
    const lean = 0.1 + rand() * 0.35;
    const height = 0.18 + rand() * 0.3;
    const width = 0.018 + rand() * 0.014;
    const spread = 0.04 + rand() * 0.12;
    const ox = Math.cos(angle) * spread;
    const oz = Math.sin(angle) * spread;
    const sx = -Math.sin(angle) * width;
    const sz = Math.cos(angle) * width;
    const tx = ox + Math.cos(angle) * lean * height;
    const tz = oz + Math.sin(angle) * lean * height;
    positions.push(ox - sx, 0, oz - sz, ox + sx, 0, oz + sz, tx, height, tz);
    colors.push(...root.toArray(), ...root.toArray(), ...tip.toArray());
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  // Light the blades as if they faced up, like the meadow around them (thin blades lit edge-on look black).
  const normals = geometry.attributes.normal;
  for (let k = 0; k < normals.count; k++) normals.setXYZ(k, 0, 1, 0);
  return geometry;
}
