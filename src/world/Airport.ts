import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
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

    // Pulled slightly towards the camera so the flat ground under it can never show through.
    const runway = new Mesh(
      new BoxGeometry(RUNWAY_WIDTH, 0.12, this.length),
      new MeshStandardMaterial({ color: 0x4a4e57, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    );
    runway.position.y = 0.06;
    runway.receiveShadow = true;
    group.add(runway);

    const dashCount = Math.floor((this.length - 60) / 40);
    const marks = new InstancedMesh(
      new BoxGeometry(1, 0.02, 1),
      new MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
      dashCount + 16,
    );
    const m = new Matrix4();
    const scale = (sx: number, sz: number) => new Matrix4().makeScale(sx, 1, sz);
    for (let i = 0; i < dashCount; i++) {
      marks.setMatrixAt(i, m.makeTranslation(0, 0.13, half - 50 - i * 40).multiply(scale(1, 20)));
    }
    // Threshold "piano keys" at both ends.
    for (let i = 0; i < 8; i++) {
      const x = -RUNWAY_WIDTH / 2 + 3 + i * ((RUNWAY_WIDTH - 6) / 7);
      marks.setMatrixAt(dashCount + i, m.makeTranslation(x, 0.13, half - 15).multiply(scale(1.6, 20)));
      marks.setMatrixAt(dashCount + 8 + i, m.makeTranslation(x, 0.13, -half + 15).multiply(scale(1.6, 20)));
    }
    marks.receiveShadow = true;
    group.add(marks);

    const side = RUNWAY_WIDTH / 2;
    const apron = new Mesh(
      new BoxGeometry(60, 0.1, 160),
      new MeshStandardMaterial({ color: 0x9a9da3, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    );
    apron.position.set(side + 45, 0.05, half - 220);
    apron.receiveShadow = true;
    group.add(apron);

    const white = new MeshStandardMaterial({ color: 0xf1faee, flatShading: true });
    const glass = new MeshStandardMaterial({ color: 0x8ecae6, flatShading: true });
    const tower = new Mesh(new CylinderGeometry(2, 2.5, 14, 8), white);
    tower.position.set(side + 35, 7, half - 120);
    const cab = new Mesh(new CylinderGeometry(3.5, 3, 3.5, 8), glass);
    cab.position.set(side + 35, 15.5, half - 120);
    const hangar = new Mesh(
      new CylinderGeometry(12, 12, 30, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2),
      new MeshStandardMaterial({ color: 0xe76f51, flatShading: true }),
    );
    hangar.position.set(side + 60, 0, half - 230);

    // Windsock: the wide mouth at the pole, the narrow tail streaming downwind.
    const pole = new Mesh(new CylinderGeometry(0.15, 0.15, 6, 6), white);
    pole.position.set(-side - 20, 3, half - 80);
    const sock = new Mesh(
      new ConeGeometry(0.8, 3, 8, 1, true).rotateZ(-Math.PI / 2).translate(1.5, 0, 0),
      new MeshStandardMaterial({ color: 0xff7f11, flatShading: true, side: DoubleSide }),
    );
    sock.castShadow = true;
    this.windsock.position.set(-side - 20, 5.6, half - 80);
    this.windsock.add(sock);
    group.add(this.windsock);

    for (const mesh of [tower, cab, hangar, pole]) {
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}
