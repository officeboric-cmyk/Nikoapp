import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
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
  propellers: Object3D[]; // spun around their local Z axis
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
      floats: false,
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
      floats: false,
    },
    build: buildAirliner,
  },
];

class Parts implements AircraftModel {
  readonly object = new Group();
  readonly propellers: Object3D[] = [];

  add(geometry: BufferGeometry, material: Material, x = 0, y = 0, z = 0): Mesh {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    this.object.add(mesh);
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
    this.add(new CylinderGeometry(radius, radius, radius * 0.7, 12).rotateZ(Math.PI / 2), material, x, y, z);
    this.add(new BoxGeometry(radius * 0.35, strut, radius * 0.35), material, x, y + strut / 2, z);
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

  propeller(z: number, length: number, material: Material, x = 0, y = 0): void {
    const prop = new Group();
    const blade = new Mesh(new BoxGeometry(0.16, length, 0.06), material);
    blade.castShadow = true;
    prop.add(blade);
    prop.position.set(x, y, z);
    this.object.add(prop);
    this.propellers.push(prop);
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
  p.add(new BoxGeometry(10, 0.2, 1.7), white, 0, -0.15, -0.8);
  p.add(new BoxGeometry(1.2, 0.22, 1.72), red, 4.4, -0.15, -0.8);
  p.add(new BoxGeometry(1.2, 0.22, 1.72), red, -4.4, -0.15, -0.8);
  p.add(new BoxGeometry(3.6, 0.14, 0.9), white, 0, 0.15, 3.1);
  p.add(new BoxGeometry(0.14, 1.5, 1.1), yellow, 0, 0.9, 3.15);
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
    p.add(new BoxGeometry(0.12, 1.8, 1.4), blue, side * 0.5, 1.1, 3.6).rotation.z = side * -0.3;
    p.add(new BoxGeometry(1.8, 0.1, 1), white, side * 1.3, 0, 4.1);
    p.wheel(0.3, side * 1.2, -1.2, 0.8, 0.9, dark);
  }
  p.wheel(0.3, 0, -1.2, -3.5, 0.9, dark);
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
  p.add(new BoxGeometry(11, 0.18, 1.6), white, 0, 0.85, -0.6);
  p.add(new BoxGeometry(1.1, 0.2, 1.62), blue, 5, 0.85, -0.6);
  p.add(new BoxGeometry(1.1, 0.2, 1.62), blue, -5, 0.85, -0.6);
  p.add(new BoxGeometry(3.4, 0.14, 0.9), white, 0, 0.15, 2.9);
  p.add(new BoxGeometry(0.14, 1.4, 1.1), blue, 0, 0.85, 2.95);
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
    p.add(new BoxGeometry(13, 0.4, 3.5), white, side * 7.2, -0.9, 1.5).rotation.y = side * -0.3;
    p.tube(0.9, 0.8, 3.5, grey, side * 5.5, -2, -0.5, 12);
    p.add(new CircleGeometry(0.75, 12).rotateY(Math.PI), dark, side * 5.5, -2, -2.26);
    p.wheel(0.6, side * 2.5, -2.6, 2, 1.5, dark);
  }
  p.wheel(0.6, 0, -2.6, -9, 1.5, dark);

  p.add(new BoxGeometry(0.4, 6, 4), tail, 0, 4.2, 12.5).rotation.x = 0.35;
  p.add(new BoxGeometry(10, 0.3, 2.5), white, 0, 0.8, 13);

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
