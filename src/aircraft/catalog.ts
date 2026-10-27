import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  MathUtils,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Shape,
  SphereGeometry,
  Vector3,
} from 'three';
import type { AircraftSpec } from '../physics/FlightModel';
import { NAV_LIGHTS, lightPoints } from '../world/lights';
import { AIRLINES, type Airline } from './airlines';

/**
 * Every plane the player can pick. Models are built from primitives (nose to -Z,
 * wheels or floats touching y = -spec.gearHeight), so no model files are needed.
 */

export interface AircraftModel {
  object: Group;
  propellers: Propeller[];
  gear: Group; // the wheels and their struts, folded away when retracted
  surfaces: ControlSurfaces;
}

/** A propeller: the blades spin around the group's Z axis; at speed a blurred disc shows instead. */
export interface Propeller {
  spinner: Group;
  blades: Object3D;
  disc: Mesh<BufferGeometry, MeshBasicMaterial>;
}

/**
 * The moving parts of the wings and tail. Each is a pivot on its hinge line, the surface trailing
 * behind it (+Z): turning the pivot about X tips the trailing edge up or down, about Y sideways.
 */
export interface ControlSurfaces {
  ailerons: { left: Object3D[]; right: Object3D[] };
  elevators: Object3D[];
  rudders: Object3D[];
  flaps: Object3D[];
}

export interface AircraftType {
  id: string;
  name: string;
  emoji: string;
  description: string;
  spec: AircraftSpec;
  engine: 'prop' | 'jet';
  // cockpit = pilot's eye, placed so the nose fills only the bottom of the FPV view
  camera: { distance: number; height: number; cockpit: [number, number, number] };
  liveries?: boolean; // wears an airline's colours (see airlines.ts)
  build(airline?: Airline): AircraftModel;
}

export const AIRCRAFT: AircraftType[] = [
  {
    id: 'trainer',
    name: 'Mali avion',
    emoji: '🛩️',
    description: 'Lagan i poslušan. Najbolji za početak!',
    engine: 'prop',
    camera: { distance: 13, height: 4, cockpit: [0, 1.15, -1.6] },
    spec: {
      maxThrust: 6,
      maxSpeed: 60,
      stallSpeed: 20,
      rotateSpeed: 24,
      pitchRate: 0.9,
      rollRate: 1.6,
      yawRate: 0.4,
      groundSteerRate: 0.8,
      turnRate: 0.9,
      gearHeight: 1.4,
      wingspan: 10,
      floats: false,
    },
    build: buildTrainer,
  },
  {
    id: 'jet',
    name: 'Mlažnjak',
    emoji: '⚡',
    description: 'Jako brz! Treba mu duga pista.',
    engine: 'jet',
    camera: { distance: 15, height: 4.5, cockpit: [0, 1.1, -3.6] },
    spec: {
      maxThrust: 14,
      maxSpeed: 120,
      stallSpeed: 38,
      rotateSpeed: 45,
      pitchRate: 1.2,
      rollRate: 2.4,
      yawRate: 0.5,
      groundSteerRate: 0.6,
      turnRate: 1.1,
      gearHeight: 1.5,
      wingspan: 10,
      floats: false,
      retractableGear: true,
      bellyHeight: 0.75,
    },
    build: buildJet,
  },
  {
    id: 'seaplane',
    name: 'Hidroavion',
    emoji: '🌊',
    description: 'Ima plovke: smije sletjeti na more!',
    engine: 'prop',
    camera: { distance: 13, height: 4.5, cockpit: [0, 1.0, -2.2] },
    spec: {
      maxThrust: 5,
      maxSpeed: 50,
      stallSpeed: 17,
      rotateSpeed: 20,
      pitchRate: 0.8,
      rollRate: 1.4,
      yawRate: 0.4,
      groundSteerRate: 0.7,
      turnRate: 0.8,
      gearHeight: 1.6,
      wingspan: 11,
      floats: true,
    },
    build: buildSeaplane,
  },
  {
    id: 'airliner',
    name: 'Putnički avion',
    emoji: '✈️',
    description: 'Velik i spor. Vozi putnike!',
    engine: 'jet',
    liveries: true,
    camera: { distance: 40, height: 11, cockpit: [0, 1.8, -12.6] },
    spec: {
      maxThrust: 5,
      maxSpeed: 85,
      stallSpeed: 32,
      rotateSpeed: 38,
      pitchRate: 0.5,
      rollRate: 0.8,
      yawRate: 0.25,
      groundSteerRate: 0.4,
      turnRate: 0.6,
      gearHeight: 3.2,
      wingspan: 28,
      floats: false,
      retractableGear: true,
      bellyHeight: 2.9, // it ends up resting on its engines
    },
    build: buildAirliner,
  },
];

class Parts implements AircraftModel {
  readonly object = new Group();
  readonly propellers: Propeller[] = [];
  readonly gear = new Group();
  readonly surfaces: ControlSurfaces = { ailerons: { left: [], right: [] }, elevators: [], rudders: [], flaps: [] };

  constructor() {
    this.object.add(this.gear);
  }

  add(geometry: BufferGeometry, material: Material, x = 0, y = 0, z = 0, parent: Object3D = this.object): Mesh {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /** A nose-pointing cylinder (radius `front` at the nose end, `back` at the tail end). */
  tube(front: number, back: number, length: number, material: Material, x = 0, y = 0, z = 0, sides = 10): Mesh {
    return this.add(new CylinderGeometry(front, back, length, sides).rotateX(-Math.PI / 2), material, x, y, z);
  }

  /** A cone whose tip points forward (-Z). */
  noseCone(radius: number, length: number, material: Material, x = 0, y = 0, z = 0): Mesh {
    return this.add(new ConeGeometry(radius, length, 10).rotateX(-Math.PI / 2), material, x, y, z);
  }

  /** A wheel centred at (x, y, z) with a strut of length `strut` going up from its axle. */
  wheel(radius: number, x: number, y: number, z: number, strut: number, material: Material): void {
    this.add(new CylinderGeometry(radius, radius, radius * 0.7, 12).rotateZ(Math.PI / 2), material, x, y, z, this.gear);
    this.add(new BoxGeometry(radius * 0.35, strut, radius * 0.35), material, x, y + strut / 2, z, this.gear);
  }

  /** Red light on the left wing tip, green on the right, white strobe on the tail (shown at night). */
  navLights(wingTip: [number, number, number], tail: [number, number, number]): void {
    const [x, y, z] = wingTip;
    this.object.add(
      lightPoints([new Vector3(-x, y, z)], NAV_LIGHTS.left),
      lightPoints([new Vector3(x, y, z)], NAV_LIGHTS.right),
      lightPoints([new Vector3(...tail)], NAV_LIGHTS.strobe),
    );
  }

  /**
   * A hinged surface `span` wide (along X) and `chord` deep, hanging behind its hinge at (x, y, z).
   * `vertical` makes it a rudder (span along Y). Returns the pivot to turn.
   */
  surface(span: number, chord: number, thickness: number, material: Material, x: number, y: number, z: number, parent: Object3D = this.object, vertical = false): Object3D {
    const pivot = new Group();
    pivot.position.set(x, y, z);
    parent.add(pivot);
    const size: [number, number, number] = vertical ? [thickness, span, chord] : [span, thickness, chord];
    this.add(new BoxGeometry(...size), material, 0, 0, chord / 2, pivot);
    return pivot;
  }

  /** An aileron on each wing and a flap inboard of it, mirrored left and right (`x` values are for the right wing). */
  wingSurfaces(aileron: { x: number; span: number }, flap: { x: number; span: number }, chord: number, thickness: number, material: Material, y: number, z: number): void {
    for (const side of [-1, 1]) {
      const a = this.surface(aileron.span, chord, thickness, material, side * aileron.x, y, z);
      (side < 0 ? this.surfaces.ailerons.left : this.surfaces.ailerons.right).push(a);
      this.surfaces.flaps.push(this.surface(flap.span, chord, thickness, material, side * flap.x, y, z));
    }
  }

  propeller(z: number, length: number, material: Material, x = 0, y = 0): void {
    const spinner = new Group();
    const blades = new Mesh(new BoxGeometry(0.16, length, 0.06), material);
    blades.castShadow = true;
    spinner.add(blades);
    const disc = new Mesh(
      new CircleGeometry(length / 2, 24),
      new MeshBasicMaterial({ color: 0x9aa5ad, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }),
    );
    disc.visible = false;
    spinner.add(disc);
    spinner.position.set(x, y, z);
    this.object.add(spinner);
    this.propellers.push({ spinner, blades, disc });
  }
}

function mat(color: number): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness: 0.6, flatShading: true });
}

const glass = () => new MeshStandardMaterial({ color: 0x8ecae6, metalness: 0.2, roughness: 0.1, flatShading: true });

function buildTrainer(): AircraftModel {
  const p = new Parts();
  const red = mat(0xe63946);
  const white = mat(0xf1faee);
  const yellow = mat(0xffc93c);
  const dark = mat(0x264653);

  p.tube(0.75, 0.35, 7, red);
  p.noseCone(0.4, 0.8, yellow, 0, 0, -3.9);
  p.add(new SphereGeometry(0.6, 10, 8).scale(1, 0.75, 1.8), glass(), 0, 0.55, -0.9);
  p.add(new BoxGeometry(10, 0.2, 1.3), white, 0, -0.15, -1);
  p.add(new BoxGeometry(1.2, 0.22, 1.72), red, 4.4, -0.15, -0.8);
  p.add(new BoxGeometry(1.2, 0.22, 1.72), red, -4.4, -0.15, -0.8);
  p.wingSurfaces({ x: 2.9, span: 1.8 }, { x: 1.4, span: 1.2 }, 0.4, 0.14, white, -0.15, -0.35);
  p.add(new BoxGeometry(3.6, 0.14, 0.55), white, 0, 0.15, 2.925);
  p.surfaces.elevators.push(p.surface(3.6, 0.35, 0.1, white, 0, 0.15, 3.2));
  p.add(new BoxGeometry(0.14, 1.5, 0.7), yellow, 0, 0.9, 2.95);
  p.surfaces.rudders.push(p.surface(1.5, 0.4, 0.1, yellow, 0, 0.9, 3.3, p.object, true));
  p.wheel(0.3, -1.2, -1.1, -0.6, 0.8, dark);
  p.wheel(0.3, 1.2, -1.1, -0.6, 0.8, dark);
  p.wheel(0.3, 0, -1.1, -2.8, 0.8, dark);
  p.propeller(-3.75, 2.6, dark);
  p.navLights([5, -0.15, -0.8], [0, 1.7, 3.7]);
  return p;
}

function buildJet(): AircraftModel {
  const p = new Parts();
  const blue = mat(0x1d70b8);
  const white = mat(0xf1faee);
  const dark = mat(0x264653);

  p.tube(0.7, 0.45, 9, blue);
  p.noseCone(0.7, 2.5, white, 0, 0, -5.75);
  p.add(new SphereGeometry(0.55, 10, 8).scale(1, 0.8, 2.6), glass(), 0, 0.55, -3);
  for (const side of [-1, 1]) {
    p.add(deltaWing(side), white, 0, -0.1, 0);
    const fin = p.add(new BoxGeometry(0.12, 1.8, 1), blue, side * 0.5, 1.1, 3.4);
    fin.rotation.z = side * -0.3;
    p.surfaces.rudders.push(p.surface(1.6, 0.4, 0.08, blue, 0, -0.05, 0.5, fin, true));
    // All-moving tail: the whole tailplane turns.
    const tailplane = p.surface(1.8, 1, 0.1, white, side * 1.3, 0, 3.6);
    p.surfaces.elevators.push(tailplane);
    p.wheel(0.3, side * 1.2, -1.2, 0.8, 0.9, dark);
  }
  p.wheel(0.3, 0, -1.2, -3.5, 0.9, dark);
  p.wingSurfaces({ x: 3.9, span: 1.8 }, { x: 1.9, span: 1.8 }, 0.4, 0.1, white, -0.1, 2.95);
  p.tube(0.42, 0.5, 0.8, dark, 0, 0, 4.8);
  const glow = p.add(new CircleGeometry(0.38, 12), new MeshBasicMaterial({ color: 0xffa94d }), 0, 0, 5.21);
  glow.castShadow = false;
  p.navLights([5, -0.1, 2.6], [0, 2.1, 4.2]);
  return p;
}

/** A swept triangular wing for one side (+1 = right). */
function deltaWing(side: number): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(side * 0.4, -1.8);
  shape.lineTo(side * 5, 2.2);
  shape.lineTo(side * 5, 2.9);
  shape.lineTo(side * 0.4, 3.2);
  shape.closePath();
  // The shape's Y becomes the plane's Z; centred on the wing's own thickness.
  return new ExtrudeGeometry(shape, { depth: 0.15, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, 0.075, 0);
}

function buildSeaplane(): AircraftModel {
  const p = new Parts();
  const yellow = mat(0xffc93c);
  const blue = mat(0x2a6fdb);
  const white = mat(0xf1faee);
  const dark = mat(0x264653);

  p.tube(0.7, 0.35, 6.5, yellow);
  p.noseCone(0.4, 0.8, blue, 0, 0, -3.65);
  p.add(new SphereGeometry(0.55, 10, 8).scale(1, 0.75, 1.6), glass(), 0, 0.45, -1.2);
  p.add(new BoxGeometry(11, 0.18, 1.2), white, 0, 0.85, -0.8);
  p.add(new BoxGeometry(1.1, 0.2, 1.62), blue, 5, 0.85, -0.6);
  p.add(new BoxGeometry(1.1, 0.2, 1.62), blue, -5, 0.85, -0.6);
  p.wingSurfaces({ x: 3.5, span: 1.85 }, { x: 1.7, span: 1.8 }, 0.4, 0.12, white, 0.85, -0.2);
  p.add(new BoxGeometry(3.4, 0.14, 0.55), white, 0, 0.15, 2.725);
  p.surfaces.elevators.push(p.surface(3.4, 0.35, 0.1, white, 0, 0.15, 3));
  p.add(new BoxGeometry(0.14, 1.4, 0.7), blue, 0, 0.85, 2.75);
  p.surfaces.rudders.push(p.surface(1.4, 0.4, 0.1, blue, 0, 0.85, 3.1, p.object, true));
  // Floats instead of wheels: their bottoms sit at y = -1.6.
  for (const side of [-1, 1]) {
    p.tube(0.3, 0.3, 5.2, white, side * 1.4, -1.3, -0.2, 8);
    p.noseCone(0.3, 0.8, blue, side * 1.4, -1.3, -3.2);
    for (const z of [-1.5, 0.9]) {
      p.add(new BoxGeometry(0.08, 0.9, 0.08), dark, side * 1.0, -0.75, z).rotation.z = side * 0.6;
    }
  }
  p.propeller(-3.95, 2.4, dark);
  p.navLights([5.5, 0.85, -0.6], [0, 1.6, 3.5]);
  return p;
}

function buildAirliner(airline: Airline = AIRLINES[0]): AircraftModel {
  const p = new Parts();
  const white = mat(0xf8f9fa);
  const tail = mat(airline.tail);
  const stripe = mat(airline.stripe);
  const grey = mat(0xadb5bd);
  const dark = mat(0x343a40);

  p.tube(1.7, 1.7, 24, white, 0, 0, 0, 14);
  p.add(new SphereGeometry(1.7, 14, 10).scale(1, 1, 1.6), white, 0, 0, -12);
  p.add(new ConeGeometry(1.7, 5, 14).rotateX(Math.PI / 2), white, 0, 0.3, 14.5);
  p.add(new BoxGeometry(3.45, 0.35, 19), dark, 0, 0.55, -1); // windows
  p.add(new BoxGeometry(3.44, 0.25, 21), stripe, 0, -0.25, -0.5); // cheat line
  p.add(new SphereGeometry(1.2, 10, 6).scale(1, 0.5, 1), dark, 0, 0.75, -13.6); // cockpit windows

  for (const side of [-1, 1]) {
    // A swept wing: the flap and aileron hinges follow its trailing edge.
    const wing = new Group();
    wing.position.set(side * 7.2, -0.9, 1.5);
    wing.rotation.y = side * -0.3;
    p.object.add(wing);
    p.add(new BoxGeometry(13, 0.4, 2.8), white, 0, 0, -0.35, wing);
    const aileron = p.surface(2.8, 0.7, 0.25, white, side * 4.9, 0, 1.05, wing);
    (side < 0 ? p.surfaces.ailerons.left : p.surfaces.ailerons.right).push(aileron);
    p.surfaces.flaps.push(p.surface(8, 0.7, 0.25, grey, side * -0.8, 0, 1.05, wing));
    p.tube(0.9, 0.8, 3.5, grey, side * 5.5, -2, -0.5, 12);
    p.add(new CircleGeometry(0.75, 12).rotateY(Math.PI), dark, side * 5.5, -2, -2.26);
    p.wheel(0.6, side * 2.5, -2.6, 2, 1.5, dark);
  }
  p.wheel(0.6, 0, -2.6, -9, 1.5, dark);

  const fin = new Group();
  fin.position.set(0, 4.2, 12.5);
  fin.rotation.x = 0.35;
  p.object.add(fin);
  p.add(new BoxGeometry(0.4, 6, 3), tail, 0, 0, -0.5, fin);
  p.surfaces.rudders.push(p.surface(5.6, 1, 0.3, tail, 0, -0.1, 1, fin, true));
  p.add(new BoxGeometry(10, 0.3, 1.8), white, 0, 0.8, 12.65);
  p.surfaces.elevators.push(p.surface(10, 0.7, 0.2, white, 0, 0.8, 13.55));

  // The airline's name on both sides of the fuselage, reading tail-to-nose on the right side.
  const logo = new MeshBasicMaterial({ map: textTexture(airline.name.toUpperCase(), airline.text), transparent: true, side: DoubleSide });
  for (const side of [-1, 1]) {
    const label = p.add(new PlaneGeometry(8, 1.3).rotateY((side * Math.PI) / 2), logo, side * 1.73, 1.25, -2);
    label.castShadow = false;
  }
  p.navLights([13.4, -0.9, 3.4], [0, 7.1, 14.4]);
  return p;
}

function textTexture(text: string, color: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 84;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.font = 'bold 64px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 44);
  return new CanvasTexture(canvas);
}

/** Spins the propellers at `rate` (radians per second); fast enough, the blades blur into a disc. */
export function spinPropellers(propellers: Propeller[], rate: number, dt: number): void {
  const blur = MathUtils.smoothstep(rate, 14, 30);
  for (const { spinner, blades, disc } of propellers) {
    spinner.rotation.z += rate * dt;
    blades.visible = blur < 0.9;
    disc.visible = blur > 0;
    disc.material.opacity = 0.3 * blur;
  }
}
