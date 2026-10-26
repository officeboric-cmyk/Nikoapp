import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Scene,
  Vector3,
} from 'three';

/**
 * Phase 1 world: a big flat meadow with a runway, trees, a few villages and clouds,
 * mostly so the player can feel speed and height. Proper terrain comes in phase 2.
 */

export const SKY_COLOR = 0x87ceeb;
export const WORLD_SIZE = 30000; // m, edge length of the ground plane
export const RUNWAY = { width: 30, length: 800, startZ: 50 }; // runs from startZ towards -Z

const SHADOW_RANGE = 60; // m around the plane covered by the sun's shadow map

export class World {
  private readonly sun: DirectionalLight;
  private readonly sunOffset = new Vector3(80, 150, 60);

  constructor(private readonly scene: Scene) {
    scene.background = new Color(SKY_COLOR);
    scene.fog = new Fog(SKY_COLOR, 600, 5000);

    scene.add(new HemisphereLight(0xdff6ff, 0x5a8f3c, 1.4));
    this.sun = new DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -SHADOW_RANGE;
    cam.right = cam.top = SHADOW_RANGE;
    cam.near = 1;
    cam.far = 600;
    scene.add(this.sun, this.sun.target);

    const rand = mulberry32(42);
    this.addGround(rand);
    this.addRunway();
    this.addTrees(rand);
    this.addVillages(rand);
    this.addClouds(rand);
  }

  /** Keeps the shadow-casting sun centred on the plane. */
  update(focus: Vector3): void {
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).add(this.sunOffset);
  }

  private addGround(rand: () => number): void {
    const ground = new Mesh(
      new PlaneGeometry(WORLD_SIZE, WORLD_SIZE).rotateX(-Math.PI / 2),
      new MeshStandardMaterial({ color: 0x7cc35a, roughness: 1 }),
    );
    ground.receiveShadow = true;
    groundLayer(ground, -3);
    this.scene.add(ground);

    // Patchwork fields make it much easier to see how fast you are moving.
    const fieldColors = [0x9bd770, 0x6aab45, 0xe9d985, 0xb5e48c, 0x8fbf5a];
    const fields = new InstancedMesh(
      new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new MeshStandardMaterial({ roughness: 1 }),
      600,
    );
    const m = new Matrix4();
    const color = new Color();
    for (let i = 0; i < fields.count; i++) {
      let x: number, z: number;
      do {
        x = (rand() - 0.5) * 12000;
        z = (rand() - 0.5) * 12000;
      } while (nearRunway(x, z, 120));
      const w = 80 + rand() * 300;
      const d = 80 + rand() * 300;
      m.compose(new Vector3(x, 0, z), yRotation(rand() * Math.PI), new Vector3(w, 1, d));
      fields.setMatrixAt(i, m);
      fields.setColorAt(i, color.setHex(fieldColors[i % fieldColors.length]));
    }
    fields.receiveShadow = true;
    groundLayer(fields, -2);
    this.scene.add(fields);
  }

  private addRunway(): void {
    const { width, length, startZ } = RUNWAY;
    const centerZ = startZ - length / 2;
    const runway = new Mesh(new BoxGeometry(width, 0.04, length), new MeshStandardMaterial({ color: 0x4a4e57, roughness: 0.9 }));
    runway.position.set(0, 0.02, centerZ);
    runway.receiveShadow = true;
    groundLayer(runway, -1);
    this.scene.add(runway);

    const white = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    const dashCount = Math.floor(length / 40);
    const dashes = new InstancedMesh(new BoxGeometry(1, 0.02, 20), white, dashCount + 16);
    const m = new Matrix4();
    for (let i = 0; i < dashCount; i++) {
      dashes.setMatrixAt(i, m.makeTranslation(0, 0.05, startZ - 30 - i * 40));
    }
    // Threshold "piano keys" at both ends.
    for (let i = 0; i < 8; i++) {
      const x = -width / 2 + 3 + i * ((width - 6) / 7);
      dashes.setMatrixAt(dashCount + i, m.makeTranslation(x, 0.05, startZ - 15));
      dashes.setMatrixAt(dashCount + 8 + i, m.makeTranslation(x, 0.05, startZ - length + 15));
    }
    dashes.receiveShadow = true;
    this.scene.add(dashes);

    // A small tower and hangar next to the runway.
    const tower = new Mesh(new CylinderGeometry(2, 2.5, 14, 8), new MeshStandardMaterial({ color: 0xf1faee, flatShading: true }));
    tower.position.set(45, 7, startZ - 120);
    const cab = new Mesh(new CylinderGeometry(3.5, 3, 3.5, 8), new MeshStandardMaterial({ color: 0x8ecae6, flatShading: true }));
    cab.position.set(45, 15.5, startZ - 120);
    const hangar = new Mesh(
      new CylinderGeometry(12, 12, 30, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2),
      new MeshStandardMaterial({ color: 0xe76f51, flatShading: true }),
    );
    hangar.position.set(50, 0, startZ - 220);
    for (const mesh of [tower, cab, hangar]) {
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
  }

  private addTrees(rand: () => number): void {
    const count = 2500;
    const trunks = new InstancedMesh(
      new CylinderGeometry(0.4, 0.6, 3, 6).translate(0, 1.5, 0),
      new MeshStandardMaterial({ color: 0x8b5a2b, flatShading: true }),
      count,
    );
    const crowns = new InstancedMesh(
      new ConeGeometry(3, 8, 7).translate(0, 7, 0),
      new MeshStandardMaterial({ color: 0x2d6a4f, flatShading: true }),
      count,
    );
    const m = new Matrix4();
    const color = new Color();
    for (let i = 0; i < count; i++) {
      let x: number, z: number;
      do {
        // Clustered into little woods around random centres.
        const cx = (rand() - 0.5) * 10000;
        const cz = (rand() - 0.5) * 10000;
        x = cx + (rand() - 0.5) * 300;
        z = cz + (rand() - 0.5) * 300;
      } while (nearRunway(x, z, 150));
      const s = 0.7 + rand() * 0.8;
      m.compose(new Vector3(x, 0, z), yRotation(rand() * Math.PI * 2), new Vector3(s, s, s));
      trunks.setMatrixAt(i, m);
      crowns.setMatrixAt(i, m);
      crowns.setColorAt(i, color.setHSL(0.3 + rand() * 0.08, 0.55, 0.25 + rand() * 0.12));
    }
    this.scene.add(trunks, crowns);
  }

  private addVillages(rand: () => number): void {
    const perVillage = 25;
    const centres = [
      [900, -1200],
      [-1500, -600],
      [400, 1800],
      [-800, -3000],
      [2500, -400],
    ];
    const count = centres.length * perVillage;
    const walls = new InstancedMesh(
      new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      new MeshStandardMaterial({ flatShading: true }),
      count,
    );
    const roofs = new InstancedMesh(
      new ConeGeometry(0.75, 0.6, 4).rotateY(Math.PI / 4).translate(0, 1.3, 0),
      new MeshStandardMaterial({ color: 0xc0392b, flatShading: true }),
      count,
    );
    const wallColors = [0xfff3b0, 0xf1faee, 0xffd6a5, 0xcaf0f8, 0xffadad];
    const m = new Matrix4();
    const color = new Color();
    let i = 0;
    for (const [cx, cz] of centres) {
      for (let h = 0; h < perVillage; h++, i++) {
        const x = cx + (rand() - 0.5) * 250;
        const z = cz + (rand() - 0.5) * 250;
        const w = 8 + rand() * 6;
        const height = 6 + rand() * 5;
        m.compose(new Vector3(x, 0, z), yRotation(Math.floor(rand() * 4) * (Math.PI / 2)), new Vector3(w, height, w));
        walls.setMatrixAt(i, m);
        roofs.setMatrixAt(i, m);
        walls.setColorAt(i, color.setHex(wallColors[i % wallColors.length]));
      }
    }
    this.scene.add(walls, roofs);
  }

  private addClouds(rand: () => number): void {
    const puffsPerCloud = 5;
    const clouds = 120;
    const puffs = new InstancedMesh(
      new IcosahedronGeometry(1, 1),
      new MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 1, flatShading: true }),
      clouds * puffsPerCloud,
    );
    const m = new Matrix4();
    const noRotation = new Quaternion();
    let i = 0;
    for (let c = 0; c < clouds; c++) {
      const cx = (rand() - 0.5) * 12000;
      const cy = 180 + rand() * 300;
      const cz = (rand() - 0.5) * 12000;
      for (let p = 0; p < puffsPerCloud; p++, i++) {
        const r = 20 + rand() * 25;
        const pos = new Vector3(cx + (p - 2) * 25 + rand() * 10, cy + rand() * 12, cz + (rand() - 0.5) * 30);
        m.compose(pos, noRotation, new Vector3(r * 1.3, r * 0.8, r));
        puffs.setMatrixAt(i, m);
      }
    }
    this.scene.add(puffs);
  }
}

/**
 * Flat layers lying on the ground (grass, fields, runway) skip the depth buffer and are
 * drawn bottom-up in `order`, so they can never z-fight or hide one another. The huge
 * ground plane otherwise covered the runway on some GPUs.
 */
function groundLayer(mesh: Mesh, order: number): void {
  mesh.renderOrder = order;
  (mesh.material as Material).depthWrite = false;
}

function nearRunway(x: number, z: number, margin: number): boolean {
  const { width, length, startZ } = RUNWAY;
  return Math.abs(x) < width / 2 + margin && z < startZ + margin && z > startZ - length - margin;
}

const yAxis = new Vector3(0, 1, 0);
function yRotation(angle: number): Quaternion {
  return new Quaternion().setFromAxisAngle(yAxis, angle);
}

/** Small seeded RNG so the world looks the same every time. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
