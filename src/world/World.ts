import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { RUNWAY_WIDTH } from './Airport';
import { MAP_HALF_SIZE, type IslandDef } from './islands';
import { lightMaterial, lightPoints } from './lights';
import { mulberry32, noise2 } from './noise';
import { Sea } from './Sea';
import { Terrain } from './Terrain';

/** Sky, light, the islands with their trees and villages, clouds and island name labels. */

export const SKY_COLOR = 0x87ceeb;
const SHADOW_RANGE = 80; // m around the plane covered by the sun's shadow map
const TREE_COUNT = 6000;
const LABEL_HIDE_NEAR = 700; // m, labels fade out when you get this close
const LABEL_SHOW_FAR = 1600; // m, fully visible from here on

export class World {
  readonly terrain = new Terrain();
  readonly sea: Sea;
  readonly sun: DirectionalLight;
  readonly sky: HemisphereLight;
  /** Where the sun sits relative to the plane; the time of day moves it. */
  readonly sunOffset = new Vector3(80, 150, 60);
  /** Things that only show at night: runway lights, the lighthouse beam. */
  readonly nightOnly: Object3D[] = [];
  readonly cloudMaterial = new MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 1, flatShading: true });
  readonly windowsMaterial = new MeshStandardMaterial({ flatShading: true });
  private readonly beams: Object3D[] = [];
  private readonly labels: Sprite[] = [];

  constructor(
    private readonly scene: Scene,
    shadowMapSize = 2048,
  ) {
    scene.background = new Color(SKY_COLOR);
    scene.fog = new Fog(SKY_COLOR, 2500, 12000);

    this.sky = new HemisphereLight(0xdff6ff, 0x5a8f3c, 1.4);
    scene.add(this.sky);
    this.sun = new DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -SHADOW_RANGE;
    cam.right = cam.top = SHADOW_RANGE;
    cam.near = 1;
    cam.far = 600;
    scene.add(this.sun, this.sun.target);

    scene.add(this.terrain.object);
    this.sea = new Sea(this.terrain);
    scene.add(this.sea.mesh);
    const rand = mulberry32(42);
    this.addTrees(rand);
    this.addHouses(rand);
    this.addLighthouses();
    this.addRunwayLights();
    this.addClouds(rand);
    this.addLabels();
    for (const object of this.nightOnly) object.visible = false;
  }

  /** Keeps the shadow-casting sun centred on the plane, fades labels that are too close, turns the lighthouse beams and moves the waves. */
  update(focus: Vector3, dt: number): void {
    for (const beam of this.beams) beam.rotation.y += dt * 0.8;
    this.sea.update(dt);
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).add(this.sunOffset);
    for (const label of this.labels) {
      const distance = label.position.distanceTo(focus);
      label.material.opacity = MathUtils.smoothstep(distance, LABEL_HIDE_NEAR, LABEL_SHOW_FAR);
      label.visible = label.material.opacity > 0;
    }
  }

  private slopeAt(x: number, z: number): number {
    const t = this.terrain;
    return Math.hypot(t.heightAt(x + 5, z) - t.heightAt(x - 5, z), t.heightAt(x, z + 5) - t.heightAt(x, z - 5)) / 10;
  }

  private nearAirport(x: number, z: number): boolean {
    return this.terrain.airports.some((a) => a.flattenWeight(x, z) > 0.05);
  }

  /** A random point somewhere over the given island (may be in the sea). */
  private pointOn(island: IslandDef, rand: () => number, spread = 1.25): [number, number] {
    const [along, across] = island.stretch ?? [1, 1];
    const r = island.radius * spread * Math.max(along, across);
    return [island.x + (rand() * 2 - 1) * r, island.z + (rand() * 2 - 1) * r];
  }

  private addTrees(rand: () => number): void {
    const islands = this.terrain.islandDefs();
    const weights = islands.map((i) => i.radius * i.radius * (i.stretch ? i.stretch[0] * i.stretch[1] : 1));
    const total = weights.reduce((a, b) => a + b, 0);

    const trunks = new InstancedMesh(
      new CylinderGeometry(0.4, 0.6, 3, 6).translate(0, 1.5, 0),
      new MeshStandardMaterial({ color: 0x8b5a2b, flatShading: true }),
      TREE_COUNT,
    );
    const crowns = new InstancedMesh(
      new ConeGeometry(3, 8, 7).translate(0, 7, 0),
      new MeshStandardMaterial({ color: 0x2d6a4f, flatShading: true }),
      TREE_COUNT,
    );
    const m = new Matrix4();
    const color = new Color();
    let placed = 0;
    for (let attempt = 0; attempt < TREE_COUNT * 20 && placed < TREE_COUNT; attempt++) {
      // Pick an island in proportion to its size, then a spot on it.
      let pick = rand() * total;
      let island = islands[0];
      for (let k = 0; k < islands.length; k++) {
        pick -= weights[k];
        if (pick <= 0) {
          island = islands[k];
          break;
        }
      }
      const [x, z] = this.pointOn(island, rand);
      const h = this.terrain.heightAt(x, z);
      const woods = noise2(x / 400, z / 400, 99); // trees grow in patches
      if (h < 3 || h > 330 || woods < -0.15 || this.slopeAt(x, z) > 0.5 || this.nearAirport(x, z)) continue;
      const s = 0.7 + rand() * 0.8;
      m.compose(new Vector3(x, h - 0.3, z), yRotation(rand() * Math.PI * 2), new Vector3(s, s, s));
      trunks.setMatrixAt(placed, m);
      crowns.setMatrixAt(placed, m);
      crowns.setColorAt(placed, color.setHSL(0.3 + rand() * 0.08, 0.55, 0.25 + rand() * 0.12));
      placed++;
    }
    trunks.count = crowns.count = placed;
    this.scene.add(trunks, crowns);
  }

  private addHouses(rand: () => number): void {
    const wallColors = [0xfff3b0, 0xf1faee, 0xffd6a5, 0xcaf0f8, 0xffadad];
    const spots: { x: number; z: number; y: number; w: number; h: number; turn: number }[] = [];
    for (const island of this.terrain.islandDefs()) {
      const wanted = island.airport ? 18 : island.radius > 600 ? 8 : 3;
      // One village per island, somewhere on the lower slopes.
      let cx = island.x;
      let cz = island.z;
      for (let tries = 0; tries < 50; tries++) {
        const [x, z] = this.pointOn(island, rand, 0.6);
        const h = this.terrain.heightAt(x, z);
        if (h > 4 && h < 120 && !this.nearAirport(x, z)) {
          cx = x;
          cz = z;
          break;
        }
      }
      let built = 0;
      for (let tries = 0; tries < 200 && built < wanted; tries++) {
        const x = cx + (rand() - 0.5) * 300;
        const z = cz + (rand() - 0.5) * 300;
        const y = this.terrain.heightAt(x, z);
        if (y < 2.5 || y > 150 || this.slopeAt(x, z) > 0.3 || this.nearAirport(x, z)) continue;
        spots.push({ x, z, y, w: 8 + rand() * 6, h: 6 + rand() * 5, turn: Math.floor(rand() * 4) * (Math.PI / 2) });
        built++;
      }
    }

    // The walls' material gets a warm glow at night, like lit windows.
    const walls = new InstancedMesh(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), this.windowsMaterial, spots.length);
    const roofs = new InstancedMesh(
      new ConeGeometry(0.75, 0.6, 4).rotateY(Math.PI / 4).translate(0, 1.3, 0),
      new MeshStandardMaterial({ color: 0xc0392b, flatShading: true }),
      spots.length,
    );
    const m = new Matrix4();
    const color = new Color();
    spots.forEach((s, i) => {
      // Sunk a little so houses on gentle slopes don't float.
      m.compose(new Vector3(s.x, s.y - 1, s.z), yRotation(s.turn), new Vector3(s.w, s.h, s.w));
      walls.setMatrixAt(i, m);
      roofs.setMatrixAt(i, m);
      walls.setColorAt(i, color.setHex(wallColors[i % wallColors.length]));
    });
    this.scene.add(walls, roofs);
  }

  private addLighthouses(): void {
    const red = new MeshStandardMaterial({ color: 0xe63946, flatShading: true });
    const white = new MeshStandardMaterial({ color: 0xf8f9fa, flatShading: true });
    const lamp = new MeshStandardMaterial({ color: 0xffe066, emissive: 0xffd43b, emissiveIntensity: 1.5 });
    for (const island of this.terrain.islandDefs().filter((i) => i.lighthouse)) {
      const base = this.terrain.heightAt(island.x, island.z);
      for (let i = 0; i < 6; i++) {
        const r = 3.2 - i * 0.3;
        const ring = new Mesh(new CylinderGeometry(r - 0.3, r, 5, 12), i % 2 ? white : red);
        ring.position.set(island.x, base + 2.5 + i * 5, island.z);
        ring.castShadow = true;
        this.scene.add(ring);
      }
      const light = new Mesh(new CylinderGeometry(1.6, 1.6, 3, 10), lamp);
      light.position.set(island.x, base + 31.5, island.z);
      const cap = new Mesh(new ConeGeometry(2.2, 2.5, 10), red);
      cap.position.set(island.x, base + 34.2, island.z);
      this.scene.add(light, cap);

      // At night: a glowing lamp and two long beams sweeping round.
      const lampTop = new Vector3(island.x, base + 31.5, island.z);
      const glow = lightPoints([lampTop], lightMaterial(0xfff3b0, 26));
      const beams = new Group();
      beams.position.copy(lampTop);
      const beamMaterial = new MeshBasicMaterial({
        color: 0xfff3b0,
        transparent: true,
        opacity: 0.18,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
      });
      for (const side of [-1, 1]) {
        // A cone lying on its side, its tip at the lamp.
        const beam = new Mesh(new ConeGeometry(40, 600, 16, 1, true).translate(0, -300, 0).rotateZ((side * Math.PI) / 2), beamMaterial);
        beams.add(beam);
      }
      this.beams.push(beams);
      this.nightOnly.push(glow, beams);
      this.scene.add(glow, beams);
    }
  }

  /** White lights along both runway edges, green at the start, red at the far end (shown at night). */
  private addRunwayLights(): void {
    const edge = lightMaterial(0xfff1c1, 7);
    const green = lightMaterial(0x3dff6e, 9);
    const red = lightMaterial(0xff3b3b, 9);
    for (const airport of this.terrain.airports) {
      const half = airport.length / 2;
      const across = RUNWAY_WIDTH / 2 + 1;
      const edges: Vector3[] = [];
      for (let along = -half; along <= half; along += 50) {
        edges.push(airport.pointAt(along, -across), airport.pointAt(along, across));
      }
      const ends = (along: number) => [-1, -0.5, 0, 0.5, 1].map((f) => airport.pointAt(along, f * across));
      const lights = [lightPoints(edges, edge), lightPoints(ends(-half), green), lightPoints(ends(half), red)];
      for (const points of lights) points.position.y = 0.5;
      this.nightOnly.push(...lights);
      this.scene.add(...lights);
    }
  }

  private addClouds(rand: () => number): void {
    const puffsPerCloud = 5;
    const clouds = 220;
    const puffs = new InstancedMesh(new IcosahedronGeometry(1, 1), this.cloudMaterial, clouds * puffsPerCloud);
    const m = new Matrix4();
    const noRotation = new Quaternion();
    let i = 0;
    for (let c = 0; c < clouds; c++) {
      const cx = (rand() * 2 - 1) * MAP_HALF_SIZE * 1.1;
      const cy = 300 + rand() * 500;
      const cz = (rand() * 2 - 1) * MAP_HALF_SIZE * 1.1;
      for (let p = 0; p < puffsPerCloud; p++, i++) {
        const r = 20 + rand() * 25;
        const pos = new Vector3(cx + (p - 2) * 25 + rand() * 10, cy + rand() * 12, cz + (rand() - 0.5) * 30);
        m.compose(pos, noRotation, new Vector3(r * 1.3, r * 0.8, r));
        puffs.setMatrixAt(i, m);
      }
    }
    this.scene.add(puffs);
  }

  /** Each island's name floats above it, so kids can find their way to it from afar. */
  private addLabels(): void {
    for (const island of this.terrain.islandDefs()) {
      const text = island.airport ? `${island.name} ✈` : island.name;
      const label = new Sprite(new SpriteMaterial({ map: labelTexture(text), transparent: true, depthWrite: false }));
      label.position.set(island.x, island.peak + 150, island.z);
      label.scale.set(560, 140, 1);
      this.labels.push(label);
      this.scene.add(label);
    }
  }
}

function labelTexture(text: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 56px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(29, 53, 87, 0.85)';
  ctx.strokeText(text, 256, 64);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 256, 64);
  return new CanvasTexture(canvas);
}

const yAxis = new Vector3(0, 1, 0);
function yRotation(angle: number): Quaternion {
  return new Quaternion().setFromAxisAngle(yAxis, angle);
}
