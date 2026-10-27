import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  type Texture,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise';
import { asphalt, concrete, corrugated, glassFacade, hangarDoors, nameSign, officeWall, towerGlass } from './textures';
import type { AirportDef, IslandDef } from './islands';

export const RUNWAY_WIDTH = 30; // m
const FLAT_ALONG = 60; // m of flat ground beyond each runway end
const FLAT_ACROSS = 110; // m of flat ground beside the runway (room for the buildings)
const FLAT_BLEND = 220; // m over which the flattened ground blends back into the hills
// Like real airports: beyond each runway end a corridor where the ground may rise only gently,
// so planes coming in to land (or climbing out) never meet a hill.
const APPROACH_LENGTH = 1500; // m from the runway end
const APPROACH_HALF_WIDTH = 150; // m either side of the runway's centre line
const APPROACH_GRADE = 0.05; // the ground may rise 5 m per 100 m away from the runway
const APPROACH_SIDES = 0.6; // how steeply the corridor's sides rise back to the hills

/**
 * One runway plus its buildings. "Along" (u) runs in the take-off direction,
 * "across" (v) is positive to the right of it.
 */
export class Airport {
  readonly name: string;
  readonly center: Vector3; // middle of the runway, at ground level
  readonly heading: number; // radians, FlightModel convention (0 = -Z, + = towards -X)
  readonly length: number;
  /** Turns to show the wind (see pointWindsock). */
  readonly windsock = new Group();
  private readonly dirX: number;
  private readonly dirZ: number;

  constructor(island: IslandDef, def: AirportDef) {
    const [ox, oz] = def.offset ?? [0, 0];
    this.name = island.name;
    this.center = new Vector3(island.x + ox, def.elevation, island.z + oz);
    this.length = def.length;
    const compass = MathUtils.degToRad(def.heading);
    this.dirX = Math.sin(compass);
    this.dirZ = -Math.cos(compass);
    this.heading = -compass;
  }

  /** Converts a world point to [along, across] runway coordinates. */
  toLocal(x: number, z: number): [number, number] {
    const dx = x - this.center.x;
    const dz = z - this.center.z;
    return [dx * this.dirX + dz * this.dirZ, -dx * this.dirZ + dz * this.dirX];
  }

  onRunway(x: number, z: number): boolean {
    const [u, v] = this.toLocal(x, z);
    return Math.abs(u) <= this.length / 2 && Math.abs(v) <= RUNWAY_WIDTH / 2;
  }

  /** 1 where the ground must be perfectly flat for the airport, fading to 0 around it. */
  flattenWeight(x: number, z: number): number {
    const [u, v] = this.toLocal(x, z);
    const du = Math.max(0, Math.abs(u) - this.length / 2 - FLAT_ALONG);
    const dv = Math.max(0, Math.abs(v) - RUNWAY_WIDTH / 2 - FLAT_ACROSS);
    return 1 - MathUtils.smoothstep(Math.hypot(du, dv), 0, FLAT_BLEND);
  }

  /** The highest the ground may be at (x, z) to keep the approach corridors clear (Infinity elsewhere). */
  approachCeiling(x: number, z: number): number {
    const [u, v] = this.toLocal(x, z);
    const beyondEnd = Math.abs(u) - this.length / 2 - FLAT_ALONG;
    if (beyondEnd < 0 || beyondEnd > APPROACH_LENGTH) return Infinity;
    const outside = Math.max(0, Math.abs(v) - APPROACH_HALF_WIDTH);
    return this.center.y + beyondEnd * APPROACH_GRADE + outside * APPROACH_SIDES;
  }

  /** How far the flattened area and approach corridors can reach from the runway centre. */
  get reach(): number {
    return this.length / 2 + FLAT_ALONG + APPROACH_LENGTH;
  }

  /** The world point `along` metres down the runway from its middle and `across` metres to its right, at ground level. */
  pointAt(along: number, across: number): Vector3 {
    return new Vector3(
      this.center.x + this.dirX * along - this.dirZ * across,
      this.center.y,
      this.center.z + this.dirZ * along + this.dirX * across,
    );
  }

  /**
   * The runway's number as painted on it: its compass heading in tens of degrees ("09").
   * `reverse` for the other end (landing or taking off the opposite way, "27").
   */
  runwayNumber(reverse = false): string {
    const compass = MathUtils.euclideanModulo(MathUtils.radToDeg(-this.heading), 360);
    const number = Math.round(compass / 10) || 36;
    return String(reverse ? ((number + 17) % 36) + 1 : number).padStart(2, '0');
  }

  /** Turns the windsock's tail to point where the wind blows to. */
  pointWindsock(windX: number, windZ: number): void {
    // The sock's tail points along its local +X; the whole airport is turned by `heading`.
    this.windsock.rotation.y = Math.atan2(-windZ, windX) - this.heading;
  }

  /** Where a plane lines up for take-off: near the start of the runway, facing along it. */
  spawnPoint(): Vector3 {
    const back = this.length / 2 - 30;
    return new Vector3(this.center.x - this.dirX * back, this.center.y, this.center.z - this.dirZ * back);
  }

  build(): Group {
    // Built in a local frame (runway along -Z, buildings on the +X side), then turned into place.
    const group = new Group();
    group.position.copy(this.center);
    group.rotation.y = this.heading;
    const half = this.length / 2;
    const side = RUNWAY_WIDTH / 2;
    const look = materials();
    const add = (mesh: Mesh, x: number, y: number, z: number, shadows = true) => {
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = shadows;
      group.add(mesh);
      return mesh;
    };

    // Pulled slightly towards the camera so the flat ground under it can never show through.
    const asphalt = look.asphalt.clone();
    asphalt.repeat.set(1, this.length / 120);
    const runway = new Mesh(new BoxGeometry(RUNWAY_WIDTH, 0.12, this.length), paved(asphalt, 0x8f9197, -1));
    add(runway, 0, 0.06, 0).castShadow = false;
    group.add(this.markings());

    // The apron reaches right to the runway's edge, so planes can roll straight on and off.
    const slabs = look.concrete.clone();
    slabs.repeat.set(7.5, 16);
    const apron = new Mesh(new BoxGeometry(75, 0.1, 160), paved(slabs, 0xffffff, -1));
    add(apron, side + 37.5, 0.05, half - 220).castShadow = false;
    group.add(this.taxiLines(side, half));

    // Control tower: a slim shaft, a cab of tinted glass leaning outwards, a roof with an aerial.
    const tx = side + 36;
    const tz = half - 118;
    add(new Mesh(new BoxGeometry(9, 4.5, 7), look.office), tx + 3, 2.25, tz);
    add(new Mesh(new CylinderGeometry(1.9, 2.3, 15, 8), look.concreteWall), tx, 7.5, tz);
    add(new Mesh(new CylinderGeometry(3.9, 3.3, 0.6, 8), look.white), tx, 15.2, tz);
    add(new Mesh(new CylinderGeometry(4.1, 3.5, 3.2, 8, 1, true), look.towerGlass), tx, 17.1, tz);
    add(new Mesh(new CylinderGeometry(4.5, 4.2, 0.6, 8), look.white), tx, 19, tz);
    add(new Mesh(new CylinderGeometry(0.07, 0.1, 5, 4), look.white), tx, 21.8, tz);
    add(new Mesh(new SphereGeometry(0.25, 8, 6), look.redLamp), tx, 24.4, tz, false);

    // Hangar: corrugated walls, a curved roof and big sliding doors facing the runway.
    const hx = side + 60;
    const hz = half - 232;
    const corrugatedWalls = look.corrugated.clone();
    corrugatedWalls.repeat.set(5, 1);
    const metal = new MeshStandardMaterial({ map: corrugatedWalls, color: 0xdfe6ec, roughness: 0.6, metalness: 0.1 });
    // Box faces: +X, -X (the doors), top, bottom, +Z, -Z.
    add(new Mesh(new BoxGeometry(30, 8, 26), [metal, look.hangarDoors, metal, metal, metal, metal]), hx, 4, hz);
    const roofSheet = look.corrugated.clone();
    roofSheet.repeat.set(1, 6);
    roofSheet.rotation = Math.PI / 2;
    const roof = new Mesh(
      new CylinderGeometry(13.2, 13.2, 30.6, 20, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.32, 1),
      new MeshStandardMaterial({ map: roofSheet, color: 0xc4ced6, roughness: 0.55, metalness: 0.1 }),
    );
    add(roof, hx, 8, hz);

    // Terminal: a glass front to the apron, a white back with windows, a flat roof with its parapet,
    // the island's name on top and a canopy over the entrance on the far side.
    const px = side + 97;
    const pz = half - 220;
    add(new Mesh(new BoxGeometry(16, 8, 70), [look.office, look.glass, look.white, look.white, look.office, look.office]), px, 4, pz);
    add(new Mesh(new BoxGeometry(17, 0.9, 71), look.white), px, 8.45, pz);
    add(new Mesh(new BoxGeometry(5, 1.6, 4), look.grey), px + 2, 9.7, pz + 12);
    add(new Mesh(new BoxGeometry(3, 1.2, 3), look.grey), px + 3, 9.5, pz - 18);
    add(new Mesh(new BoxGeometry(5, 0.3, 26), look.white), px + 10, 4.2, pz);
    for (const z of [-11, 0, 11]) add(new Mesh(new CylinderGeometry(0.15, 0.15, 4.2, 6), look.grey), px + 12, 2.1, pz + z);
    const sign = new Mesh(
      new PlaneGeometry(36, 4.5),
      new MeshBasicMaterial({ map: nameSign(this.name), transparent: true, side: DoubleSide, toneMapped: false }),
    );
    sign.position.set(px - 8.6, 10.5, pz);
    sign.rotation.y = -Math.PI / 2;
    group.add(sign);

    // Fuel: two tanks beside the apron and a tanker truck.
    for (const z of [-6, 2]) add(new Mesh(new CylinderGeometry(2.6, 2.6, 5, 16), look.white), side + 88, 2.5, half - 318 + z);
    add(new Mesh(new BoxGeometry(2.4, 2.4, 2.2), look.truckCab), side + 70, 1.5, half - 312);
    add(new Mesh(new CylinderGeometry(1.1, 1.1, 5.5, 12).rotateX(Math.PI / 2), look.white), side + 70, 1.7, half - 316.2);
    add(new Mesh(new BoxGeometry(2.2, 0.6, 8.2), look.grey), side + 70, 0.6, half - 314.6);

    // Floodlights around the apron, lit at night.
    for (const [x, z] of [[side + 16, half - 142], [side + 16, half - 298], [side + 74, half - 142], [side + 74, half - 298]]) {
      add(new Mesh(new CylinderGeometry(0.15, 0.22, 16, 6), look.grey), x, 8, z);
      add(new Mesh(new BoxGeometry(1.6, 0.5, 1.2), look.lamp), x, 16.2, z, false);
    }

    // Car park behind the terminal.
    add(new Mesh(new BoxGeometry(24, 0.08, 60), paved(asphalt, 0xffffff, -1)), px + 26, 0.04, pz).castShadow = false;
    const cars = new InstancedMesh(carGeometry(), new MeshStandardMaterial({ roughness: 0.4, metalness: 0.4 }), 18);
    const rand = mulberry32(Math.round(this.center.x + this.center.z));
    const colours = [0xd9d9d9, 0x2b2d42, 0xb23a48, 0x3a6ea5, 0xf1f1f1, 0x6c757d, 0x8d99ae, 0x1b4332];
    const m = new Matrix4();
    for (let i = 0; i < 18; i++) {
      const row = i % 2;
      m.makeTranslation(px + 19 + row * 14, 0, pz - 26 + Math.floor(i / 2) * 6.2);
      if (row) m.multiply(new Matrix4().makeRotationY(Math.PI));
      cars.setMatrixAt(i, m);
      cars.setColorAt(i, new Color(colours[Math.floor(rand() * colours.length)]));
    }
    cars.castShadow = cars.receiveShadow = true;
    group.add(cars);

    // Windsock: the wide mouth at the pole, the narrow tail streaming downwind.
    add(new Mesh(new CylinderGeometry(0.1, 0.15, 6, 6), look.white), -side - 20, 3, half - 80);
    const sock = new Mesh(
      new ConeGeometry(0.8, 3, 12, 1, true).rotateZ(-Math.PI / 2).translate(1.5, 0, 0),
      new MeshStandardMaterial({ color: 0xff7f11, side: DoubleSide }),
    );
    sock.castShadow = true;
    this.windsock.position.set(-side - 20, 5.6, half - 80);
    this.windsock.add(sock);
    group.add(this.windsock);
    return group;
  }

  /**
   * White runway paint: the dashed centre line, edge lines, the "piano keys" at both thresholds,
   * touchdown zone bars and the two big aiming point blocks where a plane should touch down.
   */
  private markings(): InstancedMesh {
    const half = this.length / 2;
    const bars: [number, number, number, number][] = []; // x, z, width, length
    for (let z = half - 80; z > -half + 80; z -= 40) bars.push([0, z, 0.9, 20]);
    for (const x of [-1, 1]) bars.push([x * (RUNWAY_WIDTH / 2 - 1.2), 0, 0.9, this.length - 4]);
    for (const end of [-1, 1]) {
      for (let i = 0; i < 8; i++) bars.push([-RUNWAY_WIDTH / 2 + 3 + i * ((RUNWAY_WIDTH - 6) / 7), end * (half - 15), 1.6, 20]);
      for (const x of [-1, 1]) {
        bars.push([x * 7.5, end * (half - 300), 4, 45]); // aiming point
        for (const k of [0, 1, 2]) bars.push([x * (4.5 + k * 2.5), end * (half - 150), 1.5, 22]); // touchdown zone
      }
    }
    const marks = new InstancedMesh(new BoxGeometry(1, 0.02, 1), paint(0xe9e9e6, -2), bars.length);
    const m = new Matrix4();
    bars.forEach(([x, z, w, l], i) => marks.setMatrixAt(i, m.makeTranslation(x, 0.13, z).multiply(new Matrix4().makeScale(w, 1, l))));
    marks.receiveShadow = true;
    return marks;
  }

  /** Yellow lines on the apron: the taxi lane along it and a lead-in line to each parking spot. */
  private taxiLines(side: number, half: number): InstancedMesh {
    const lines: [number, number, number, number][] = [
      [side + 12, half - 220, 0.35, 156],
      [side + 18, half - 165, 12, 0.35],
      [side + 18, half - 285, 12, 0.35],
      [side + 13.5, half - 148, 3, 0.35],
      [side + 13.5, half - 292, 3, 0.35],
    ];
    const marks = new InstancedMesh(new BoxGeometry(1, 0.02, 1), paint(0xf2c230, -2), lines.length);
    const m = new Matrix4();
    lines.forEach(([x, z, w, l], i) => marks.setMatrixAt(i, m.makeTranslation(x, 0.11, z).multiply(new Matrix4().makeScale(w, 1, l))));
    marks.receiveShadow = true;
    return marks;
  }
}

/** Flat paint on the ground, pulled towards the camera so it never flickers into the surface below. */
function paint(color: number, offset: number): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset * 2 });
}

function paved(map: Texture, color: number, offset: number): MeshStandardMaterial {
  return new MeshStandardMaterial({ map, color, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset * 2 });
}

/** A small car: body and cabin. */
function carGeometry(): BufferGeometry {
  return mergeGeometries([new BoxGeometry(1.8, 0.75, 4.2).translate(0, 0.55, 0), new BoxGeometry(1.6, 0.6, 2.2).translate(0, 1.2, -0.2)])!;
}

let shared: ReturnType<typeof makeMaterials> | null = null;

/** Materials every airport shares (made once). Glass and lamps glow at night (see `glowing`). */
function materials(): ReturnType<typeof makeMaterials> {
  return (shared ??= makeMaterials());
}

function makeMaterials() {
  const glass = glassFacade();
  glass.map.repeat.set(9, 1);
  glass.glow.repeat.set(9, 1);
  const office = officeWall();
  office.repeat.set(4, 2);
  const cab = towerGlass();
  cab.repeat.set(2, 1);
  const concreteWall = concrete();
  concreteWall.repeat.set(1, 3);
  return {
    asphalt: asphalt(),
    concrete: concrete(),
    corrugated: corrugated(),
    white: new MeshStandardMaterial({ color: 0xf1f2f0, roughness: 0.8 }),
    grey: new MeshStandardMaterial({ color: 0x8d949a, roughness: 0.7 }),
    concreteWall: new MeshStandardMaterial({ map: concreteWall, color: 0xf4f4f2, roughness: 0.85 }),
    office: new MeshStandardMaterial({ map: office, roughness: 0.8, emissive: 0x000000 }),
    glass: new MeshStandardMaterial({ map: glass.map, emissiveMap: glass.glow, emissive: 0x9c8762, roughness: 0.25, metalness: 0.3 }),
    towerGlass: new MeshStandardMaterial({ map: cab, roughness: 0.2, metalness: 0.4, side: DoubleSide }),
    hangarDoors: new MeshStandardMaterial({ map: hangarDoors(), roughness: 0.6, metalness: 0.1 }),
    truckCab: new MeshStandardMaterial({ color: 0xe63946, roughness: 0.5 }),
    lamp: new MeshStandardMaterial({ color: 0xdddddd, emissive: 0xfff1c1, emissiveIntensity: 0 }),
    redLamp: new MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff2020, emissiveIntensity: 1.5 }),
  };
}

/** The airport materials that light up at night (the terminal's glass and the floodlights). */
export function airportGlow(): MeshStandardMaterial[] {
  const look = materials();
  return [look.glass, look.lamp];
}
