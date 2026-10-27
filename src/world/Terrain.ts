import { BufferAttribute, Color, Group, MathUtils, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import { SEA_LEVEL, type Ground } from '../physics/FlightModel';
import { Airport } from './Airport';
import { ISLANDS, type IslandDef } from './islands';
import { fbm, noise2 } from './noise';

const SEA_FLOOR = -30;
const TARGET_CELL = 36; // m between terrain vertices
const MAX_SEGMENTS = 170;

const SAND = new Color(0xf2e3a0);
const WET_SAND = new Color(0xc9b77c);
const GRASS_LIGHT = new Color(0x8fd16a);
const GRASS_DARK = new Color(0x5a9e3c);
const FOREST = new Color(0x4f7d3a);
const ROCK = new Color(0x8d8a85);
const SNOW = new Color(0xffffff);
const LAVA_ROCK = new Color(0x5c4d45);

/** One island's heightmap on a square grid, plus its low-poly mesh. */
class IslandTerrain {
  readonly minX: number;
  readonly minZ: number;
  readonly segments: number;
  readonly cell: number;
  readonly heights: Float32Array;
  private readonly seed: number;

  constructor(
    readonly def: IslandDef,
    readonly airport: Airport | undefined,
    index: number,
  ) {
    this.seed = index * 13 + 1;
    const [along, across] = def.stretch ?? [1, 1];
    let half = def.radius * Math.max(along, across) * 1.4;
    if (airport) half = Math.max(half, Math.hypot(airport.center.x - def.x, airport.center.z - def.z) + airport.reach + 40);
    this.segments = Math.min(MAX_SEGMENTS, Math.ceil((half * 2) / TARGET_CELL));
    this.cell = (half * 2) / this.segments;
    this.minX = def.x - half;
    this.minZ = def.z - half;

    const n = this.segments + 1;
    this.heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        this.heights[j * n + i] = this.shape(this.minX + i * this.cell, this.minZ + j * this.cell);
      }
    }
  }

  /** The island's height at a point, from its outline, peak and a bit of noise. */
  private shape(x: number, z: number): number {
    const { def, seed } = this;
    const [along, across] = def.stretch ?? [1, 1];
    const rot = MathUtils.degToRad(def.rotation ?? 0);
    const dx = x - def.x;
    const dz = z - def.z;
    const u = (dx * Math.sin(rot) - dz * Math.cos(rot)) / along;
    const v = (dx * Math.cos(rot) + dz * Math.sin(rot)) / across;

    // A wobbly coastline: the radius varies smoothly with the angle around the island.
    const angle = Math.atan2(v, u);
    const coast = def.radius * (1 + 0.25 * noise2(Math.cos(angle) * 1.8 + 10, Math.sin(angle) * 1.8 + 10, seed));
    const t = 1 - Math.hypot(u, v) / coast; // 1 at the centre, 0 on the coast, < 0 at sea

    let h: number;
    if (t <= 0) {
      h = Math.max(SEA_FLOOR, t * 150);
    } else if (def.shape === 'cone') {
      h = def.peak * Math.pow(t, 1.4) + 8 * t;
      if (t > 0.9) h -= (t - 0.9) * def.peak * 1.5; // crater
    } else {
      const rolling = 0.7 + 0.3 * fbm(x / 700, z / 700, seed);
      const bumps = 0.18 * fbm(x / 350, z / 350, seed + 7);
      h = def.peak * (Math.pow(t, 0.9) * rolling + bumps * t) + 8 * t;
    }

    if (this.airport) {
      const w = this.airport.flattenWeight(x, z);
      h += (this.airport.center.y - h) * w;
      // Only ever lowers land (never fills in the sea), to keep the approaches clear.
      if (h > this.airport.center.y) h = Math.max(this.airport.center.y, Math.min(h, this.airport.approachCeiling(x, z)));
    }
    return h;
  }

  /** Bilinear height from the grid, or null outside this island's square. */
  heightAt(x: number, z: number): number | null {
    const fx = (x - this.minX) / this.cell;
    const fz = (z - this.minZ) / this.cell;
    if (fx < 0 || fz < 0 || fx > this.segments || fz > this.segments) return null;
    const i = Math.min(Math.floor(fx), this.segments - 1);
    const j = Math.min(Math.floor(fz), this.segments - 1);
    const tx = fx - i;
    const tz = fz - j;
    const n = this.segments + 1;
    const h = this.heights;
    const a = h[j * n + i];
    const b = h[j * n + i + 1];
    const c = h[(j + 1) * n + i];
    const d = h[(j + 1) * n + i + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }

  buildMesh(): Mesh {
    const size = this.segments * this.cell;
    const geometry = new PlaneGeometry(size, size, this.segments, this.segments).rotateX(-Math.PI / 2);
    geometry.translate(this.minX + size / 2, 0, this.minZ + size / 2);
    const pos = geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const n = this.segments + 1;
    const color = new Color();
    for (let k = 0; k < pos.count; k++) {
      const i = Math.round((pos.getX(k) - this.minX) / this.cell);
      const j = Math.round((pos.getZ(k) - this.minZ) / this.cell);
      const h = this.heights[j * n + i];
      pos.setY(k, h);
      const dhx = this.heights[j * n + Math.min(i + 1, n - 1)] - this.heights[j * n + Math.max(i - 1, 0)];
      const dhz = this.heights[Math.min(j + 1, n - 1) * n + i] - this.heights[Math.max(j - 1, 0) * n + i];
      const slope = Math.hypot(dhx, dhz) / (2 * this.cell);
      this.colorFor(h, slope, pos.getX(k), pos.getZ(k), color);
      color.toArray(colors, k * 3);
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const mesh = new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    mesh.receiveShadow = true;
    return mesh;
  }

  private colorFor(h: number, slope: number, x: number, z: number, out: Color): void {
    if (h < 0) out.copy(WET_SAND);
    else if (h < 2.5) out.copy(SAND);
    else if (h > (this.def.snowLine ?? 520)) out.copy(SNOW);
    else if (this.def.shape === 'cone' && h > 120) out.copy(LAVA_ROCK);
    else if (h > 330 || slope > 0.9) out.copy(ROCK);
    else {
      out.lerpColors(GRASS_LIGHT, GRASS_DARK, 0.5 + 0.5 * noise2(x / 250, z / 250, this.seed + 3));
      if (h > 160) out.lerp(FOREST, MathUtils.smoothstep(h, 160, 280));
    }
  }
}

/** All islands (the sea is in Sea.ts). Answers "how high is the ground here?" for the physics. */
export class Terrain implements Ground {
  readonly airports: Airport[] = [];
  readonly object = new Group();
  private readonly islands: IslandTerrain[] = [];

  constructor() {
    ISLANDS.forEach((def, index) => {
      const airport = def.airport ? new Airport(def, def.airport) : undefined;
      if (airport) this.airports.push(airport);
      const island = new IslandTerrain(def, airport, index);
      this.islands.push(island);
      this.object.add(island.buildMesh());
      if (airport) this.object.add(airport.build());
    });
  }

  /** Ground height in metres; below SEA_LEVEL means open water. */
  heightAt(x: number, z: number): number {
    let best = SEA_FLOOR;
    for (const island of this.islands) {
      const h = island.heightAt(x, z);
      if (h !== null && h > best) best = h;
    }
    return best;
  }

  islandDefs(): IslandDef[] {
    return this.islands.map((i) => i.def);
  }

  /** The island whose dry land is under (x, z), if any. */
  islandAt(x: number, z: number): IslandDef | undefined {
    for (const island of this.islands) {
      const h = island.heightAt(x, z);
      if (h !== null && h > SEA_LEVEL) return island.def;
    }
    return undefined;
  }

  /** The airport whose runway is under (x, z), if any. */
  runwayAt(x: number, z: number): Airport | undefined {
    return this.airports.find((a) => a.onRunway(x, z));
  }

  nearestAirport(x: number, z: number): { airport: Airport; distance: number } {
    let best = this.airports[0];
    let bestDistance = Infinity;
    for (const airport of this.airports) {
      const d = Math.hypot(airport.center.x - x, airport.center.z - z);
      if (d < bestDistance) {
        best = airport;
        bestDistance = d;
      }
    }
    return { airport: best, distance: bestDistance };
  }
}
