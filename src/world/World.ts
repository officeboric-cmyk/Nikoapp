import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
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
  PlaneGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AIRCRAFT } from '../aircraft/catalog';
import { planeRadius, type Obstacle } from '../game/collisions';
import { airportGlow, RUNWAY_WIDTH, type Airport } from './Airport';
import { houseTemplate } from './buildings';
import { Grass } from './Grass';
import { MAP_HALF_SIZE, type IslandDef } from './islands';
import { lightMaterial, lightPoints } from './lights';
import { mulberry32, noise2 } from './noise';
import { Sea } from './Sea';
import { Terrain } from './Terrain';
import { belfry, houseWall, roofTiles, stoneBlocks } from './textures';
import { speciesGeometry, woodsAt, type Detail, type Species } from './vegetation';

/** The trees and bushes of one kind in one square of the map, drawn in full detail or simpler. */
interface PlantCell {
  near: InstancedMesh;
  far: InstancedMesh;
  cx: number;
  cz: number;
  full: number;
  maxDistance: number;
}

/** A village: its middle, its island (index) and where its houses stand. */
export interface Village {
  x: number;
  z: number;
  island: number;
  houses: { x: number; z: number }[];
}

/** Sky, light, the islands with their trees and villages, clouds and island name labels. */

export const SKY_COLOR = 0x87ceeb;
const SHADOW_RANGE = 80; // m around the plane covered by the sun's shadow map
const PALM_COUNT = 700;
const FAST_PLANTS = 0.55; // share of the trees and bushes drawn on the fast setting
const PLANT_CELL = 1500; // m: trees and bushes are drawn in squares this big
const NEAR_PLANTS = 900; // m from a square within which its plants are drawn in full detail
const BUSH_DISTANCE = 3000; // m beyond which scrub is too small to see
const WALL_PIECE = 4; // m, dry-stone walls are laid in pieces this long
const WALL_DISTANCE = 2500; // m beyond which the walls are too thin to see
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
  /** Everything else that lights up at night with the windows: the terminals' glass, apron floodlights. */
  readonly nightGlow = airportGlow();
  /** The planes parked on the aprons, which can be bumped into while taxiing. */
  readonly parked: Obstacle[] = [];
  /** One village per island. */
  readonly villages: Village[];
  private readonly grass: Grass;
  /** Every drawing of trees and bushes, with how many it holds (fast quality draws only some). */
  private readonly plants: PlantCell[] = [];
  /** Each village's dry-stone walls, hidden from far away (they are thin). */
  private readonly stoneWalls: { mesh: InstancedMesh; x: number; z: number }[] = [];
  private readonly beams: Object3D[] = [];
  private readonly labels: Sprite[] = [];

  constructor(private readonly scene: Scene) {
    scene.background = new Color(SKY_COLOR);
    scene.fog = new Fog(SKY_COLOR, 2500, 12000);

    this.sky = new HemisphereLight(0xdff6ff, 0x5a8f3c, 1.4);
    scene.add(this.sky);
    this.sun = new DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = true;
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
    this.grass = new Grass(scene, this.terrain);
    this.villages = this.addVillages(rand);
    this.addStoneWalls(rand, this.villages);
    this.addVegetation(rand, this.villages);
    this.addPalms(rand);
    this.addLighthouses();
    this.addRunwayLights();
    for (const airport of this.terrain.airports) {
      this.addRunwayNumbers(airport);
      this.addParkedPlanes(airport);
    }
    this.addClouds(rand);
    this.addLabels();
    for (const object of this.nightOnly) object.visible = false;
  }

  /**
   * Keeps the shadow-casting sun centred on the plane, grows grass around the camera, fades labels that
   * are too close, turns the lighthouse beams and moves the waves.
   */
  update(focus: Vector3, camera: Vector3, dt: number): void {
    this.grass.update(camera, dt);
    // Trees near the camera in full detail, the rest simpler; far-off scrub not at all.
    for (const plant of this.plants) {
      const d = Math.hypot(Math.max(0, Math.abs(camera.x - plant.cx) - PLANT_CELL / 2), Math.max(0, Math.abs(camera.z - plant.cz) - PLANT_CELL / 2));
      plant.near.visible = d < NEAR_PLANTS;
      plant.far.visible = d >= NEAR_PLANTS && d < plant.maxDistance;
    }
    for (const walls of this.stoneWalls) walls.mesh.visible = Math.hypot(camera.x - walls.x, camera.z - walls.z) < WALL_DISTANCE;
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

  /** Fast: less grass and fewer trees. */
  setQuality(quality: 'fast' | 'pretty'): void {
    this.grass.setQuality(quality);
    for (const plant of this.plants) plant.near.count = plant.far.count = quality === 'fast' ? Math.ceil(plant.full * FAST_PLANTS) : plant.full;
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

  /**
   * The islands' plants: Aleppo pine woods in patches, holm oaks at their edges, scrub everywhere it can
   * grow, cypresses around the villages and olive groves in rows beside them. One drawing per kind of
   * plant and island, so islands out of view are skipped.
   */
  private addVegetation(rand: () => number, villages: Village[]): void {
    const islands = this.terrain.islandDefs();
    const weights = islands.map((i) => i.radius * i.radius * (i.stretch ? i.stretch[0] * i.stretch[1] : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    const groups = new Map<string, { species: Species; cx: number; cz: number; matrices: Matrix4[]; colors: Color[] }>();
    const m = new Matrix4();
    const add = (species: Species, x: number, z: number, y: number, size: number, stretch = 1) => {
      const ci = Math.floor(x / PLANT_CELL);
      const cj = Math.floor(z / PLANT_CELL);
      const key = `${species}:${ci}:${cj}`;
      let group = groups.get(key);
      if (!group) groups.set(key, (group = { species, cx: (ci + 0.5) * PLANT_CELL, cz: (cj + 0.5) * PLANT_CELL, matrices: [], colors: [] }));
      group.matrices.push(m.compose(new Vector3(x, y, z), yRotation(rand() * Math.PI * 2), new Vector3(size, size * stretch, size)).clone());
      const k = 0.85 + rand() * 0.27;
      group.colors.push(new Color(k * (0.95 + rand() * 0.1), k, k * (0.92 + rand() * 0.12)));
    };
    const nearHouse = (x: number, z: number, gap: number) =>
      villages.some((v) => Math.hypot(v.x - x, v.z - z) < 450 && v.houses.some((h) => Math.hypot(h.x - x, h.z - z) < gap));
    /** Ground a plant can grow on: not beach, bare rock, snow, lava, airport or a house. */
    const growable = (island: IslandDef, x: number, z: number, h: number, maxSlope: number) =>
      h >= 3 &&
      h < (island.snowLine ?? 520) - 40 &&
      !(island.shape === 'cone' && h > 110) &&
      this.slopeAt(x, z) < maxSlope &&
      !this.nearAirport(x, z) &&
      !nearHouse(x, z, 8);

    const counts: [Species, number][] = [
      ['pine', 9000],
      ['oak', 3200],
      ['bush', 9000],
    ];
    for (const [species, wanted] of counts) {
      let placed = 0;
      for (let attempt = 0; attempt < wanted * 25 && placed < wanted; attempt++) {
        // Pick an island in proportion to its size, then a spot on it.
        let pick = rand() * total;
        let index = 0;
        while (index < islands.length - 1 && (pick -= weights[index]) > 0) index++;
        const island = islands[index];
        const [x, z] = this.pointOn(island, rand);
        const h = this.terrain.heightAt(x, z);
        const woods = woodsAt(x, z); // woods grow in patches
        const fits =
          species === 'pine'
            ? woods > 0.2 && h > 6 && h < 340 && growable(island, x, z, h, 0.6)
            : species === 'oak'
              ? woods > -0.3 && woods < 0.45 && h < 240 && rand() < 0.7 && growable(island, x, z, h, 0.5)
              : woods > -0.55 + rand() * 0.6 && growable(island, x, z, h, 0.85); // thicker towards the woods
        if (!fits) continue;
        const size = species === 'pine' ? 0.95 + rand() * 0.6 : species === 'oak' ? 0.7 + rand() * 0.5 : 0.6 + rand() * 0.9;
        add(species, x, z, h - 0.3, size, species === 'bush' ? 0.7 + rand() * 0.5 : 1);
        placed++;
      }
    }

    for (const village of villages) {
      // Cypresses dotted around the houses.
      for (let k = 0; k < 14; k++) {
        const a = rand() * Math.PI * 2;
        const r = 40 + rand() * 180;
        const x = village.x + Math.cos(a) * r;
        const z = village.z + Math.sin(a) * r;
        const h = this.terrain.heightAt(x, z);
        if (growable(islands[village.island], x, z, h, 0.5)) add('cypress', x, z, h - 0.2, 0.8 + rand() * 0.5);
      }
      // Olive groves: trees in neat rows on the gentle slopes beside the village.
      for (let grove = 0; grove < 2; grove++) {
        const a = rand() * Math.PI * 2;
        const cx = village.x + Math.cos(a) * (140 + rand() * 120);
        const cz = village.z + Math.sin(a) * (140 + rand() * 120);
        const turn = rand() * Math.PI;
        const [dx, dz] = [Math.cos(turn), Math.sin(turn)];
        for (let i = -5; i <= 5; i++) {
          for (let j = -4; j <= 4; j++) {
            const x = cx + (i * dx - j * dz) * 8 + (rand() - 0.5);
            const z = cz + (i * dz + j * dx) * 8 + (rand() - 0.5);
            const h = this.terrain.heightAt(x, z);
            if (growable(islands[village.island], x, z, h, 0.35)) add('olive', x, z, h - 0.2, 0.8 + rand() * 0.3);
          }
        }
      }
    }

    const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    const shapes = new Map<string, BufferGeometry>();
    const shape = (species: Species, detail: Detail) => {
      const key = `${species}:${detail}`;
      if (!shapes.has(key)) shapes.set(key, speciesGeometry(species, detail));
      return shapes.get(key)!;
    };
    for (const { species, cx, cz, matrices, colors } of groups.values()) {
      const [near, far] = (['near', 'far'] as const).map((detail) => {
        const mesh = new InstancedMesh(shape(species, detail), material, matrices.length);
        matrices.forEach((matrix, i) => {
          mesh.setMatrixAt(i, matrix);
          mesh.setColorAt(i, colors[i]);
        });
        mesh.computeBoundingSphere();
        mesh.receiveShadow = detail === 'near';
        this.scene.add(mesh);
        return mesh;
      });
      this.plants.push({ near, far, cx, cz, full: matrices.length, maxDistance: species === 'bush' ? BUSH_DISTANCE : Infinity });
    }
  }

  /** Palm trees along the sandy beaches, leaning a little this way and that. */
  private addPalms(rand: () => number): void {
    const trunkHeight = 7;
    const fronds = mergeGeometries(
      Array.from({ length: 6 }, (_, k) =>
        new BoxGeometry(4.5, 0.12, 1.1)
          .translate(2.25, 0, 0)
          .rotateZ(-0.4) // drooping
          .rotateY((k / 6) * Math.PI * 2)
          .translate(0, trunkHeight, 0),
      ),
    );
    const trunks = new InstancedMesh(
      new CylinderGeometry(0.22, 0.35, trunkHeight, 5).translate(0, trunkHeight / 2, 0),
      new MeshStandardMaterial({ color: 0x9c6b3e, flatShading: true }),
      PALM_COUNT,
    );
    const crowns = new InstancedMesh(fronds, new MeshStandardMaterial({ color: 0xffffff, flatShading: true }), PALM_COUNT);
    const islands = this.terrain.islandDefs();
    const m = new Matrix4();
    const color = new Color();
    const tilt = new Quaternion();
    let placed = 0;
    for (let attempt = 0; attempt < PALM_COUNT * 60 && placed < PALM_COUNT; attempt++) {
      const [x, z] = this.pointOn(islands[Math.floor(rand() * islands.length)], rand);
      const h = this.terrain.heightAt(x, z);
      if (h < 0.6 || h > 4 || this.slopeAt(x, z) > 0.3 || this.nearAirport(x, z)) continue;
      const s = 0.8 + rand() * 0.5;
      tilt.setFromAxisAngle(new Vector3(rand() - 0.5, 0, rand() - 0.5).normalize(), rand() * 0.25).multiply(yRotation(rand() * Math.PI * 2));
      m.compose(new Vector3(x, h - 0.2, z), tilt, new Vector3(s, s, s));
      trunks.setMatrixAt(placed, m);
      crowns.setMatrixAt(placed, m);
      crowns.setColorAt(placed, color.setHSL(0.3 + rand() * 0.05, 0.55, 0.32 + rand() * 0.1));
      placed++;
    }
    trunks.count = crowns.count = placed;
    this.scene.add(trunks, crowns);
  }

  /** The runway's number (its compass heading in tens of degrees) painted at each end. */
  private addRunwayNumbers(airport: Airport): void {
    const ends = [
      { text: airport.runwayNumber(), along: -(airport.length / 2 - 45), turn: 0 },
      { text: airport.runwayNumber(true), along: airport.length / 2 - 45, turn: Math.PI },
    ];
    for (const end of ends) {
      const paint = new Mesh(
        new PlaneGeometry(10, 15).rotateX(-Math.PI / 2),
        new MeshStandardMaterial({
          map: numberTexture(end.text),
          transparent: true,
          roughness: 0.8,
          polygonOffset: true,
          polygonOffsetFactor: -3,
          polygonOffsetUnits: -6,
        }),
      );
      paint.position.copy(airport.pointAt(end.along, 0)).setY(airport.center.y + 0.14);
      paint.rotation.y = airport.heading + end.turn; // the top of the digits points along the runway
      paint.receiveShadow = true;
      this.scene.add(paint);
    }
  }

  /** A couple of small planes waiting on the apron, noses towards the runway. */
  private addParkedPlanes(airport: Airport): void {
    const half = airport.length / 2;
    const spots = [
      { id: 'trainer', along: 165 - half, across: RUNWAY_WIDTH / 2 + 28 },
      { id: 'jet', along: 285 - half, across: RUNWAY_WIDTH / 2 + 30 },
    ];
    for (const spot of spots) {
      const type = AIRCRAFT.find((t) => t.id === spot.id)!;
      const plane = type.build(undefined, true).object;
      plane.position.copy(airport.pointAt(spot.along, spot.across));
      plane.position.y += type.spec.gearHeight + 0.1;
      plane.rotation.y = airport.heading + Math.PI / 2;
      this.scene.add(plane);
      this.parked.push({ position: plane.position.clone(), radius: planeRadius(type.spec.wingspan), velocity: new Vector3() });
    }
  }

  /**
   * One village per island on its lower slopes: stone houses of three sizes on a loose grid, all turned
   * about the same way like houses along streets, and a bell tower in the bigger ones.
   */
  private addVillages(rand: () => number): Village[] {
    const templates = [houseTemplate(7, 5.5, 3.6), houseTemplate(8.5, 7, 6.8), houseTemplate(14, 7.5, 6.8, false)];
    const placed = templates.map(() => ({ matrices: [] as Matrix4[], walls: [] as Color[], roofs: [] as Color[] }));
    const plaster = [0xf4f1ea, 0xefe3c8, 0xe9dcc0, 0xf1e6d2, 0xe3d7c2, 0xf3e9cf, 0xeadbd0];
    const tiles = [0xb5532e, 0xc0643a, 0xa84a2a, 0xc87146, 0x9e4a2e, 0xb8603c];
    const villages: Village[] = [];
    const islands = this.terrain.islandDefs();
    islands.forEach((island, index) => {
      const wanted = island.airport ? 26 : island.radius > 600 ? 14 : 5;
      let cx = island.x;
      let cz = island.z;
      for (let tries = 0; tries < 60; tries++) {
        const [x, z] = this.pointOn(island, rand, 0.6);
        const h = this.terrain.heightAt(x, z);
        if (h > 4 && h < 120 && this.slopeAt(x, z) < 0.2 && !this.nearAirport(x, z)) {
          cx = x;
          cz = z;
          break;
        }
      }
      const village: Village = { x: cx, z: cz, island: index, houses: [] };
      villages.push(village);
      const streets = rand() * Math.PI;
      for (let tries = 0; tries < 400 && village.houses.length < wanted; tries++) {
        const along = (rand() + rand() + rand() - 1.5) * 120;
        const across = (rand() + rand() + rand() - 1.5) * 90;
        const x = cx + along * Math.cos(streets) - across * Math.sin(streets);
        const z = cz + along * Math.sin(streets) + across * Math.cos(streets);
        if (village.houses.some((h) => Math.hypot(h.x - x, h.z - z) < 13)) continue;
        const kind = rand() < 0.3 ? 0 : rand() < 0.75 ? 1 : 2;
        const t = templates[kind];
        const turn = streets + (rand() < 0.5 ? 0 : Math.PI / 2) + (rand() - 0.5) * 0.12;
        // The lowest corner sets the floor, so on a slope the house is dug in rather than floating.
        const corners = [-1, 1].flatMap((sx) =>
          [-1, 1].map((sz) => this.terrain.heightAt(x + (sx * t.width * Math.cos(turn) + sz * t.depth * Math.sin(turn)) / 2, z + (-sx * t.width * Math.sin(turn) + sz * t.depth * Math.cos(turn)) / 2)),
        );
        const low = Math.min(...corners);
        if (low < 2.5 || Math.max(...corners) - low > 2.5 || this.nearAirport(x, z)) continue;
        placed[kind].matrices.push(new Matrix4().compose(new Vector3(x, low - 0.15, z), yRotation(turn), new Vector3(1, 1, 1)));
        placed[kind].walls.push(new Color(plaster[Math.floor(rand() * plaster.length)]));
        placed[kind].roofs.push(new Color(tiles[Math.floor(rand() * tiles.length)]));
        village.houses.push({ x, z });
      }
      if (village.houses.length >= 12) this.addBellTower(village, rand);
    });

    // The walls' material is the world's window material: its glow (lit windows) is turned up at night.
    const wall = houseWall();
    Object.assign(this.windowsMaterial, { map: wall.map, emissiveMap: wall.glow, flatShading: false, roughness: 0.92 });
    this.windowsMaterial.needsUpdate = true;
    const roof = new MeshStandardMaterial({ map: roofTiles(), roughness: 0.85, side: DoubleSide });
    templates.forEach((template, kind) => {
      const { matrices, walls, roofs } = placed[kind];
      const wallMesh = new InstancedMesh(template.walls, this.windowsMaterial, matrices.length);
      const roofMesh = new InstancedMesh(template.roof, roof, matrices.length);
      matrices.forEach((matrix, i) => {
        wallMesh.setMatrixAt(i, matrix);
        roofMesh.setMatrixAt(i, matrix);
        wallMesh.setColorAt(i, walls[i]);
        roofMesh.setColorAt(i, roofs[i]);
      });
      for (const mesh of [wallMesh, roofMesh]) {
        mesh.castShadow = mesh.receiveShadow = true;
        this.scene.add(mesh);
      }
    });
    return villages;
  }

  /**
   * Dry-stone walls (suhozidi) around the fields outside each village: lines of piled stone on a loose
   * grid turned the same way as the village, with gaps here and there.
   */
  private addStoneWalls(rand: () => number, villages: Village[]): void {
    const m = new Matrix4();
    const stone = stoneBlocks();
    stone.repeat.set(2, 0.5);
    const material = new MeshStandardMaterial({ map: stone, color: 0x8f877c, roughness: 1 });
    const piece = new BoxGeometry(WALL_PIECE + 0.2, 1, 0.7).translate(0, 0.5, 0);
    for (const village of villages) {
      if (village.houses.length < 5) continue;
      const pieces: Matrix4[] = [];
      const turn = rand() * Math.PI;
      const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
      const reach = village.houses.length > 12 ? 420 : 260;
      for (const along of [true, false]) {
        for (let line = -reach; line <= reach; line += 45 + rand() * 25) {
          for (let t = -reach; t <= reach; t += WALL_PIECE) {
            const u = along ? t : line;
            const v = along ? line : t;
            const r = Math.hypot(u, v);
            // Fields ring the village (not inside it), fading out irregularly; runs of wall have gaps.
            if (r < 110 || r > reach * (0.75 + 0.25 * noise2(u / 90, v / 90, 61))) continue;
            if (noise2((along ? t : line) / 35, (along ? line : t) / 35 + (along ? 0 : 50), 62) < -0.35) continue;
            const x = village.x + u * cos - v * sin;
            const z = village.z + u * sin + v * cos;
            const h = this.terrain.heightAt(x, z);
            if (h < 3 || this.slopeAt(x, z) > 0.35 || this.nearAirport(x, z)) continue;
            if (village.houses.some((house) => Math.hypot(house.x - x, house.z - z) < 9)) continue;
            m.compose(new Vector3(x, h - 0.1, z), yRotation(-turn + (along ? 0 : Math.PI / 2)), new Vector3(1, 0.8 + rand() * 0.4, 1));
            pieces.push(m.clone());
          }
        }
      }
      const mesh = new InstancedMesh(piece, material, pieces.length);
      pieces.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.computeBoundingSphere();
      mesh.receiveShadow = true;
      this.stoneWalls.push({ mesh, x: village.x, z: village.z });
      this.scene.add(mesh);
    }
  }

  /** A Dalmatian campanile: a tall stone tower with arched openings for the bells and a pyramid roof. */
  private addBellTower(village: Village, rand: () => number): void {
    for (let tries = 0; tries < 40; tries++) {
      const x = village.x + (rand() - 0.5) * 60;
      const z = village.z + (rand() - 0.5) * 60;
      if (village.houses.some((h) => Math.hypot(h.x - x, h.z - z) < 9)) continue;
      const y = this.terrain.heightAt(x, z) - 0.3;
      const stone = stoneBlocks();
      stone.repeat.set(1, 4);
      const tower = new Group();
      const shaft = new Mesh(new BoxGeometry(3.6, 17, 3.6).translate(0, 8.5, 0), new MeshStandardMaterial({ map: stone, roughness: 0.9 }));
      const bells = new Mesh(new BoxGeometry(3.9, 3.6, 3.9).translate(0, 18.8, 0), new MeshStandardMaterial({ map: belfry(), roughness: 0.9 }));
      const roof = new Mesh(
        new ConeGeometry(3.2, 3.6, 4).rotateY(Math.PI / 4).translate(0, 22.4, 0),
        new MeshStandardMaterial({ color: 0xb0583a, roughness: 0.85, flatShading: true }),
      );
      tower.add(shaft, bells, roof);
      tower.position.set(x, y, z);
      tower.rotation.y = rand() * Math.PI;
      tower.traverse((o) => (o.castShadow = o.receiveShadow = true));
      village.houses.push({ x, z });
      this.scene.add(tower);
      return;
    }
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

function numberTexture(text: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 150px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.save();
  ctx.scale(0.55, 1); // tall and narrow, like painted runway digits
  ctx.fillText(text, 64 / 0.55, 100);
  ctx.restore();
  const texture = new CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

const yAxis = new Vector3(0, 1, 0);
function yRotation(angle: number): Quaternion {
  return new Quaternion().setFromAxisAngle(yAxis, angle);
}
