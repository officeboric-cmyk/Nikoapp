import {
  AdditiveBlending,
  BoxGeometry,
  ConeGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Shape,
  ExtrudeGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NAV_LIGHTS, lightPoints } from '../world/lights';
import { AIRLINES, type Airline } from './airlines';
import type { AircraftModel, ControlSurfaces, Propeller } from './catalog';
import { body, controlSurface, hingeMatrix, wing, wingPoint, withDetail, type Planform, type Section } from './shapes';

/**
 * The planes' 3D models, built from smooth shapes (see shapes.ts) so no model files are
 * needed. Nose to -Z; the wheels or floats touch y = -spec.gearHeight.
 */

const UP = new Vector3(0, 1, 0);
const LEFT = new Vector3(-1, 0, 0);

export function paint(color: number, roughness = 0.45, metalness = 0.05): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness });
}

const metal = () => paint(0xb8bec6, 0.35, 0.6);
const rubber = () => paint(0x1f2124, 0.9, 0);
const darkGrey = () => paint(0x3a3f45, 0.6, 0.2);
const glass = () => new MeshStandardMaterial({ color: 0x4f8fc7, roughness: 0.08, metalness: 0.3 });
/** See-through, for bubble canopies with a pilot inside. */
const canopyGlass = () => new MeshStandardMaterial({ color: 0x6aa6d8, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.55, depthWrite: false });
const tintedGlass = () => new MeshStandardMaterial({ color: 0x1c2a3a, roughness: 0.1, metalness: 0.4, side: DoubleSide });

class Parts implements AircraftModel {
  readonly object = new Group();
  readonly propellers: Propeller[] = [];
  readonly gear = new Group();
  readonly surfaces: ControlSurfaces = { ailerons: { left: [], right: [] }, elevators: [], rudders: [], flaps: [] };
  afterburner?: Object3D;
  private readonly statics: Mesh[] = [];

  constructor() {
    this.object.add(this.gear);
  }

  add(geometry: BufferGeometry, material: Material, x = 0, y = 0, z = 0, parent: Object3D = this.object): Mesh {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    if (parent === this.object) this.statics.push(mesh);
    return mesh;
  }

  body(sections: Section[], material: Material, options?: Parameters<typeof body>[1]): Mesh {
    const mesh = this.add(body(sections, options), material);
    // Stripes and window bands lie right on the skin; their shadows would only speckle it.
    if (options?.from !== undefined) mesh.castShadow = false;
    return mesh;
  }

  /** Both wings (or tailplane halves) for `pieces` of the span, each in its own material. */
  wings(p: Omit<Planform, 'side'>, pieces: { s0: number; s1: number; material: Material; tip?: boolean }[], chordShare = 1, parent?: Object3D): void {
    for (const side of [-1, 1] as const) {
      for (const piece of pieces) {
        this.add(wing({ ...p, side }, piece.s0, piece.s1, { chordShare, roundTip: piece.tip }), piece.material, 0, 0, 0, parent);
      }
    }
  }

  /**
   * A moving surface behind the wing's trailing edge between span s0 and s1, on both sides.
   * Returns the pivots, right side first.
   */
  hinged(p: Omit<Planform, 'side'>, s0: number, s1: number, chordShare: number, thickness: number, material: Material, parent?: Object3D): [Object3D, Object3D] {
    const pivots: Object3D[] = [];
    for (const side of [1, -1] as const) {
      const planform = { ...p, side };
      const inner = wingPoint(planform, s0, chordShare);
      const outer = wingPoint(planform, s1, chordShare);
      const meanChord = (wingChord(p, s0) + wingChord(p, s1)) / 2;
      // Hinges always run left to right, so the surface trails behind (+Z).
      const [a, b] = side > 0 ? [inner, outer] : [outer, inner];
      pivots.push(this.hinge(a, b, meanChord * (1 - chordShare), thickness, material, UP, parent));
    }
    return pivots as [Object3D, Object3D];
  }

  /** A surface hinged along a → b (turn the returned pivot about its X). */
  hinge(a: Vector3, b: Vector3, chord: number, thickness: number, material: Material, up = UP, parent: Object3D = this.object): Object3D {
    const mount = new Group();
    mount.applyMatrix4(hingeMatrix(a, b, up));
    const pivot = new Group();
    mount.add(pivot);
    parent.add(mount);
    const mesh = new Mesh(controlSurface(a.distanceTo(b), chord, thickness), material);
    mesh.castShadow = true;
    pivot.add(mesh);
    return pivot;
  }

  /** A fin (vertical tail) on the given planform, standing up from `root`; returns its rudder pivot. */
  fin(p: Omit<Planform, 'side' | 'dihedral'>, chordShare: number, material: Material, rudderFrom: number, rudderTo: number, parent: Object3D = this.object): Object3D {
    // Built as a right wing, then stood up: its span runs up the fin.
    const holder = new Group();
    holder.position.copy(p.root);
    parent.add(holder);
    const local = { ...p, root: new Vector3(), side: 1 as const, dihedral: 0 };
    const skin = new Mesh(wing(local, 0, p.span, { chordShare, roundTip: true }).rotateZ(Math.PI / 2), material);
    skin.castShadow = true;
    holder.add(skin);
    const up = (v: Vector3) => new Vector3(-v.y, v.x, v.z); // the same 90° turn for points
    const a = up(wingPoint(local, rudderFrom, chordShare));
    const b = up(wingPoint(local, rudderTo, chordShare));
    const meanChord = (wingChord(p, rudderFrom) + wingChord(p, rudderTo)) / 2;
    const rudder = this.hinge(a, b, meanChord * (1 - chordShare), p.thickness * p.rootChord * 0.6, material, LEFT, holder);
    this.surfaces.rudders.push(rudder);
    return rudder;
  }

  /** A rod (strut, brace, aerial) from a to b. */
  rod(a: Vector3, b: Vector3, radius: number, material: Material, parent: Object3D = this.object): Mesh {
    const length = a.distanceTo(b);
    const geometry = new CylinderGeometry(radius, radius, length, 8);
    const mesh = this.add(geometry, material, 0, 0, 0, parent);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.copy(new Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize()));
    return mesh;
  }

  /** A wheel (tyre and hub) with its axle along X, part of the folding gear. */
  wheel(radius: number, x: number, y: number, z: number, tyre: Material, hub: Material, width = radius * 0.7): void {
    const t = this.add(new TorusGeometry(radius * 0.7, radius * 0.3, 8, 18).rotateY(Math.PI / 2), tyre, x, y, z, this.gear);
    t.scale.set(width / (radius * 0.6), 1, 1);
    this.add(new CylinderGeometry(radius * 0.48, radius * 0.48, width * 0.8, 14).rotateZ(Math.PI / 2), hub, x, y, z, this.gear);
  }

  /** Red light on the left wing tip, green on the right, white strobe on the tail (shown at night). */
  navLights(wingTip: Vector3, tail: Vector3): void {
    this.object.add(
      lightPoints([new Vector3(-wingTip.x, wingTip.y, wingTip.z)], NAV_LIGHTS.left),
      lightPoints([wingTip.clone()], NAV_LIGHTS.right),
      lightPoints([tail.clone()], NAV_LIGHTS.strobe),
    );
  }

  /** A propeller with shaped, slightly twisted blades and a pointed spinner, at the nose. */
  propeller(z: number, length: number, bladeMaterial: Material, spinnerMaterial: Material, x = 0, y = 0, blades = 2): void {
    const spinner = new Group();
    const hub = new Group();
    const bladeShape = new Shape();
    const half = length / 2;
    bladeShape.moveTo(-0.06, 0.1);
    bladeShape.quadraticCurveTo(-0.13, half * 0.35, -0.1, half * 0.85);
    bladeShape.quadraticCurveTo(0, half * 1.02, 0.1, half * 0.85);
    bladeShape.quadraticCurveTo(0.13, half * 0.35, 0.06, 0.1);
    const bladeGeometry = new ExtrudeGeometry(bladeShape, { depth: 0.03, bevelEnabled: false, curveSegments: 6 }).translate(0, 0, -0.015);
    for (let k = 0; k < blades; k++) {
      const blade = new Mesh(bladeGeometry, bladeMaterial);
      blade.rotation.z = (k / blades) * Math.PI * 2;
      blade.rotateY(0.35); // pitch, so it looks like it bites the air
      blade.castShadow = true;
      hub.add(blade);
    }
    spinner.add(hub);
    const cone = new Mesh(
      body([
        { z: -0.55, w: 0.01, h: 0.01 },
        { z: -0.42, w: 0.12, h: 0.12 },
        { z: -0.18, w: 0.22, h: 0.22 },
        { z: 0.05, w: 0.26, h: 0.26 },
      ], { segments: 16, steps: 3 }),
      spinnerMaterial,
    );
    cone.castShadow = true;
    spinner.add(cone);
    const disc = new Mesh(
      new CircleGeometry(half, 28),
      new MeshBasicMaterial({ color: 0x9aa5ad, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }),
    );
    disc.visible = false;
    spinner.add(disc);
    spinner.position.set(x, y, z);
    this.object.add(spinner);
    this.propellers.push({ spinner, blades: hub, disc });
  }

  /**
   * Merges the fixed parts that look the same (same kind of paint), on the plane and on its
   * folding gear, so a plane draws in a handful of calls instead of dozens.
   */
  finish(): this {
    const gearParts = this.gear.children.filter((c): c is Mesh => c instanceof Mesh);
    merge(this.object, this.statics);
    merge(this.gear, gearParts);
    return this;
  }
}

function merge(parent: Object3D, meshes: Mesh[]): void {
  const groups = new Map<string, Mesh[]>();
  for (const mesh of meshes) {
    const m = mesh.material as MeshStandardMaterial;
    const key = [m.type, m.color?.getHex(), m.roughness, m.metalness, m.transparent, m.opacity, m.side, m.polygonOffset, m.map?.uuid, mesh.castShadow].join('|');
    groups.set(key, [...(groups.get(key) ?? []), mesh]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const geometries = group.map((mesh) => {
      mesh.updateMatrix();
      const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      return g.applyMatrix4(mesh.matrix);
    });
    const merged = mergeGeometries(geometries);
    if (!merged) continue;
    for (const mesh of group) parent.remove(mesh);
    const mesh = new Mesh(merged, group[0].material);
    mesh.castShadow = group[0].castShadow;
    parent.add(mesh);
  }
}

function wingChord(p: { rootChord: number; tipChord: number; span: number }, s: number): number {
  return p.rootChord + (p.tipChord - p.rootChord) * (s / p.span);
}

/** A pilot's head with a helmet, so the cockpit isn't empty. */
function pilot(p: Parts, x: number, y: number, z: number, helmet: number): void {
  p.add(new SphereGeometry(0.15, 14, 10), paint(0xf2c9a0, 0.7), x, y, z);
  p.add(new SphereGeometry(0.17, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), paint(helmet, 0.4), x, y + 0.02, z + 0.01);
}

export function buildTrainer(_airline?: Airline, distant = false): AircraftModel {
  return withDetail(distant ? 0.5 : 1, trainer);
}

function trainer(): AircraftModel {
  const p = new Parts();
  const red = paint(0xe63946);
  const white = paint(0xf4f6f8);
  const yellow = paint(0xffc93c);
  const strut = darkGrey();

  // Fuselage: yellow cowling at the front, red body tapering to the tail.
  p.body(
    [
      { z: -3.75, w: 0.32, h: 0.31, y: 0 },
      { z: -3.5, w: 0.6, h: 0.58, y: 0 },
      { z: -3.0, w: 0.7, h: 0.68, y: 0.02 },
    ],
    yellow,
  );
  const fuselage: Section[] = [
    { z: -3.0, w: 0.7, h: 0.68, y: 0.02 },
    { z: -1.9, w: 0.74, h: 0.74, y: 0.05 },
    { z: -0.6, w: 0.7, h: 0.72, y: 0.06 },
    { z: 0.8, w: 0.5, h: 0.56, y: 0.12 },
    { z: 2.2, w: 0.3, h: 0.38, y: 0.22 },
    { z: 3.5, w: 0.1, h: 0.16, y: 0.32 },
    { z: 3.75, w: 0.02, h: 0.04, y: 0.32 },
  ];
  p.body(fuselage, red, { segments: 32 });
  // A white stripe along each side.
  const stripe = stripeMaterial(0xf4f6f8);
  for (const [from, to] of [
    [-0.18, 0.02],
    [Math.PI - 0.02, Math.PI + 0.18],
  ]) {
    p.body(fuselage, stripe, { segments: 64, from, to, grow: 1.015, between: [-2.9, 3.3] });
  }

  // Bubble canopy with a frame hoop, and the pilot inside.
  const canopy = p.add(new SphereGeometry(1, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), canopyGlass(), 0, 0.62, -0.8);
  canopy.scale.set(0.48, 0.5, 1.35);
  p.add(new TorusGeometry(0.48, 0.035, 6, 20, Math.PI), white, 0, 0.62, -1.2).scale.set(1, 1.02, 1);
  p.add(new TorusGeometry(0.46, 0.035, 6, 20, Math.PI), white, 0, 0.62, -0.2);
  pilot(p, 0, 0.82, -0.6, 0xf4f6f8);

  // Low wing with red tips; ailerons outboard and flaps inboard on its trailing edge.
  const wingForm = { span: 5, rootChord: 1.75, tipChord: 1.15, sweep: 0.1, dihedral: 0.07, thickness: 0.15, root: new Vector3(0, -0.32, -1.75) };
  const share = 0.78;
  p.wings(wingForm, [{ s0: 0, s1: 4.4, material: white }], share);
  const [aileronR, aileronL] = p.hinged(wingForm, 2.6, 4.35, share, 0.08, white);
  p.surfaces.ailerons.right.push(aileronR);
  p.surfaces.ailerons.left.push(aileronL);
  p.surfaces.flaps.push(...p.hinged(wingForm, 0.75, 2.5, share, 0.08, white));
  p.wings(wingForm, [{ s0: 4.4, s1: 5, material: red, tip: true }]); // the red tips run the full chord

  // Tail: tailplane with elevators, fin with rudder.
  const tailForm = { span: 1.8, rootChord: 0.9, tipChord: 0.55, sweep: 0.2, dihedral: 0, thickness: 0.1, root: new Vector3(0, 0.25, 2.6) };
  p.wings(tailForm, [{ s0: 0, s1: 1.8, material: white, tip: true }], 0.62);
  p.surfaces.elevators.push(...p.hinged(tailForm, 0.12, 1.75, 0.62, 0.06, white));
  p.fin({ span: 1.45, rootChord: 1.25, tipChord: 0.6, sweep: 0.55, thickness: 0.1, root: new Vector3(0, 0.3, 2.45) }, 0.65, yellow, 0.1, 1.35);

  // Engine exhausts and an aerial.
  for (const side of [-1, 1]) p.add(new CylinderGeometry(0.05, 0.06, 0.35, 8).rotateX(Math.PI / 2.4), metal(), side * 0.62, -0.35, -2.75);
  p.rod(new Vector3(0, 0.68, 0.8), new Vector3(0, 1.15, 1.15), 0.015, strut);

  // Fixed gear: spring legs to wheels in teardrop spats, and a nose wheel.
  const tyre = rubber();
  const hub = metal();
  for (const side of [-1, 1]) {
    p.rod(new Vector3(side * 0.45, -0.55, -0.6), new Vector3(side * 1.2, -1.1, -0.6), 0.05, strut, p.gear);
    p.wheel(0.3, side * 1.2, -1.1, -0.6, tyre, hub);
    const spat = new Mesh(
      body([
        { z: -0.55, w: 0.02, h: 0.02, y: 0 },
        { z: -0.35, w: 0.14, h: 0.24, y: 0 },
        { z: 0.05, w: 0.17, h: 0.34, y: 0.02 },
        { z: 0.45, w: 0.06, h: 0.12, y: 0.06 },
      ], { segments: 16, steps: 3 }),
      red,
    );
    spat.position.set(side * 1.2, -1.02, -0.6);
    spat.castShadow = true;
    p.gear.add(spat);
  }
  p.rod(new Vector3(0, -0.5, -2.8), new Vector3(0, -1.1, -2.8), 0.05, metal(), p.gear);
  p.wheel(0.27, 0, -1.13, -2.8, tyre, hub);

  p.propeller(-3.9, 2.6, darkGrey(), yellow);
  p.navLights(new Vector3(5.1, 0.04, -1.1), new Vector3(0, 1.8, 3.4));
  return p.finish();
}

export function buildJet(_airline?: Airline, distant = false): AircraftModel {
  return withDetail(distant ? 0.5 : 1, jet);
}

function jet(): AircraftModel {
  const p = new Parts();
  const blue = paint(0x1d70b8, 0.4, 0.15);
  const white = paint(0xeef2f5, 0.4, 0.1);
  const grey = darkGrey();

  // Pointed white nose, blue body, metal nozzle.
  const noseSections: Section[] = [
    { z: -7.2, w: 0.02, h: 0.02, y: -0.05 },
    { z: -6.6, w: 0.22, h: 0.2, y: -0.03 },
    { z: -5.6, w: 0.45, h: 0.42, y: 0 },
    { z: -4.6, w: 0.6, h: 0.6, y: 0.04 },
  ];
  p.body(noseSections, white);
  p.body(
    [
      { z: -4.6, w: 0.6, h: 0.6, y: 0.04 },
      { z: -3.0, w: 0.72, h: 0.68, y: 0.05 },
      { z: -1.0, w: 0.82, h: 0.66, y: 0 },
      { z: 1.5, w: 0.82, h: 0.6, y: 0 },
      { z: 3.5, w: 0.68, h: 0.56, y: 0 },
      { z: 4.9, w: 0.52, h: 0.5, y: 0 },
    ],
    blue,
  );
  p.body(
    [
      { z: 4.85, w: 0.5, h: 0.48 },
      { z: 5.3, w: 0.47, h: 0.45 },
      { z: 5.6, w: 0.43, h: 0.41 },
    ],
    metal(),
    { steps: 1 },
  );
  const glow = p.add(new CircleGeometry(0.36, 16), new MeshBasicMaterial({ color: 0xffa94d }), 0, 0, 5.62);
  glow.castShadow = false;
  p.rod(new Vector3(0, -0.05, -7.15), new Vector3(0, -0.05, -7.9), 0.02, metal()); // pitot tube

  // Canopy and pilot.
  const canopy = p.add(new SphereGeometry(1, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), canopyGlass(), 0, 0.5, -3.1);
  canopy.scale.set(0.46, 0.5, 1.5);
  p.add(new TorusGeometry(0.46, 0.03, 6, 20, Math.PI), grey, 0, 0.5, -2.35);
  pilot(p, 0, 0.68, -2.9, 0xffffff);

  // Air intakes on both sides.
  for (const side of [-1, 1]) {
    const intake = body(
      [
        { z: -2.4, w: 0.26, h: 0.34 },
        { z: -1.6, w: 0.3, h: 0.38 },
        { z: 0.5, w: 0.22, h: 0.3 },
        { z: 1.4, w: 0.05, h: 0.08 },
      ],
      { segments: 16, steps: 3 },
    ).translate(side * 0.78, -0.05, 0);
    p.add(intake, blue);
    p.add(new CircleGeometry(1, 16).scale(0.22, 0.3, 1).rotateY(Math.PI), paint(0x111316, 0.8), side * 0.78, -0.05, -2.42);
  }

  // Delta wing with ailerons and flaps.
  const wingForm = { span: 4.6, rootChord: 5.2, tipChord: 0.9, sweep: 3.9, dihedral: -0.03, thickness: 0.05, root: new Vector3(0.4, -0.15, -1.9) };
  const share = 0.9;
  p.wings(wingForm, [{ s0: 0, s1: 4.6, material: white, tip: true }], share);
  const [aileronR, aileronL] = p.hinged(wingForm, 2.8, 4.4, share, 0.06, white);
  p.surfaces.ailerons.right.push(aileronR);
  p.surfaces.ailerons.left.push(aileronL);
  p.surfaces.flaps.push(...p.hinged(wingForm, 0.4, 2.7, share, 0.06, white));

  // Twin fins leaning outwards, with rudders.
  for (const side of [-1, 1]) {
    const lean = new Group();
    lean.position.set(side * 0.45, 0.35, 0);
    lean.rotation.z = side * -0.3;
    p.object.add(lean);
    p.fin({ span: 1.8, rootChord: 1.9, tipChord: 0.7, sweep: 1.1, thickness: 0.06, root: new Vector3(0, 0, 2.7) }, 0.72, blue, 0.15, 1.7, lean);
  }

  // All-moving tailplanes: each half turns as a whole about its own pivot.
  for (const side of [-1, 1] as const) {
    const pivot = new Group();
    pivot.position.set(side * 1.4, 0, 4.0);
    p.object.add(pivot);
    const half = new Mesh(
      wing({ span: 1.7, rootChord: 1.4, tipChord: 0.6, sweep: 0.8, dihedral: 0, thickness: 0.05, root: new Vector3(-side * 0.85, 0, -0.5), side }, 0, 1.7, { roundTip: true }),
      white,
    );
    half.castShadow = true;
    pivot.add(half);
    p.surfaces.elevators.push(pivot);
  }

  // Retractable gear.
  const tyre = rubber();
  const leg = metal();
  p.rod(new Vector3(0, -0.5, -3.5), new Vector3(0, -1.2, -3.5), 0.06, leg, p.gear);
  p.wheel(0.3, 0, -1.2, -3.5, tyre, leg);
  for (const side of [-1, 1]) {
    p.rod(new Vector3(side * 1.0, -0.3, 0.8), new Vector3(side * 1.2, -1.2, 0.8), 0.07, leg, p.gear);
    p.wheel(0.32, side * 1.2, -1.18, 0.8, tyre, leg);
  }

  p.navLights(new Vector3(5.05, -0.28, 2.7), new Vector3(0, 2.15, 4.4));
  return p.finish();
}

export function buildFighter(_airline?: Airline, distant = false): AircraftModel {
  return withDetail(distant ? 0.5 : 1, fighter);
}

/**
 * A light fighter: a long pointed nose, a bubble canopy far forward, the air intake under the
 * belly, a cropped delta wing blending into the body, one tall fin and an afterburner nozzle;
 * in two shades of grey camouflage. The gun fires from beside the cockpit.
 */
function fighter(): AircraftModel {
  const p = new Parts();
  const light = paint(0x8a939b, 0.55, 0.15);
  const dark = paint(0x5f6870, 0.55, 0.15);
  const grey = darkGrey();
  const nozzle = paint(0x4b4f55, 0.4, 0.7);

  const fuselage: Section[] = [
    { z: -8.4, w: 0.02, h: 0.02, y: -0.02 },
    { z: -7.8, w: 0.24, h: 0.24, y: -0.02 },
    { z: -6.8, w: 0.46, h: 0.48, y: 0 },
    { z: -5.4, w: 0.6, h: 0.66, y: 0.06 },
    { z: -3.8, w: 0.72, h: 0.76, y: 0.1 },
    { z: -2.0, w: 0.92, h: 0.76, y: 0.06 },
    { z: 0.2, w: 1.0, h: 0.74, y: 0.04 },
    { z: 2.6, w: 0.92, h: 0.7, y: 0.04 },
    { z: 4.6, w: 0.7, h: 0.62, y: 0.02 },
    { z: 5.7, w: 0.56, h: 0.55, y: 0 },
  ];
  p.body(fuselage, light);
  // Camouflage: a darker band over the back, from behind the canopy to the tail.
  p.body(fuselage, dark, { from: 0.5, to: Math.PI - 0.5, grow: 1.02, between: [-3.8, 5.7] });
  p.add(body(fuselage, { segments: 20, steps: 2, between: [-8.4, -7.0] }), paint(0x3f454b, 0.4, 0.2)); // dark radome tip
  p.body(
    [
      { z: 5.65, w: 0.54, h: 0.53 },
      { z: 6.3, w: 0.5, h: 0.5 },
      { z: 6.7, w: 0.47, h: 0.47 },
    ],
    nozzle,
    { steps: 1 },
  );
  const glow = p.add(new CircleGeometry(0.4, 16), new MeshBasicMaterial({ color: 0xffa94d }), 0, 0, 6.72);
  glow.castShadow = false;
  p.rod(new Vector3(0, -0.02, -8.35), new Vector3(0, -0.02, -9.0), 0.02, metal()); // pitot tube

  // Bubble canopy far forward, and the pilot.
  const canopy = p.add(new SphereGeometry(1, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), canopyGlass(), 0, 0.66, -4.4);
  canopy.scale.set(0.5, 0.56, 1.75);
  p.add(new TorusGeometry(0.5, 0.03, 6, 20, Math.PI), grey, 0, 0.66, -3.5);
  pilot(p, 0, 0.82, -4.3, 0x4f5d2f);

  // The air intake under the belly.
  const intake = body(
    [
      { z: -3.7, w: 0.56, h: 0.4 },
      { z: -2.8, w: 0.6, h: 0.44 },
      { z: -0.5, w: 0.56, h: 0.4 },
      { z: 1.2, w: 0.3, h: 0.22 },
      { z: 2.2, w: 0.05, h: 0.05 },
    ],
    { segments: 18, steps: 3 },
  ).translate(0, -0.72, 0);
  p.add(intake, light);
  p.add(new CircleGeometry(1, 18).scale(0.5, 0.35, 1).rotateY(Math.PI), paint(0x111316, 0.8), 0, -0.72, -3.72);

  // The gun's muzzle beside the cockpit, on the left.
  p.add(new CylinderGeometry(0.07, 0.07, 0.5, 8).rotateX(Math.PI / 2), paint(0x1b1d20, 0.5, 0.6), -0.62, 0.32, -3.9);

  // Wing: strakes blending forward into the body, a cropped delta with flaperons, missile rails at the tips.
  p.wings({ span: 0.55, rootChord: 3.4, tipChord: 0.15, sweep: 3.0, dihedral: 0, thickness: 0.03, root: new Vector3(0.75, 0.0, -4.1) }, [{ s0: 0, s1: 0.55, material: light }]);
  const wingForm = { span: 4.4, rootChord: 4.6, tipChord: 1.3, sweep: 3.3, dihedral: -0.02, thickness: 0.04, root: new Vector3(0.85, -0.05, -1.2) };
  const share = 0.82;
  p.wings(wingForm, [{ s0: 0, s1: 4.4, material: light, tip: true }], share);
  const [aileronR, aileronL] = p.hinged(wingForm, 2.3, 4.2, share, 0.05, light);
  p.surfaces.ailerons.right.push(aileronR);
  p.surfaces.ailerons.left.push(aileronL);
  p.surfaces.flaps.push(...p.hinged(wingForm, 0.3, 2.2, share, 0.05, light));
  for (const side of [-1, 1]) p.rod(new Vector3(side * 5.28, -0.1, 1.9), new Vector3(side * 5.28, -0.1, 3.4), 0.06, grey);

  // One tall fin with its rudder.
  p.fin({ span: 3.1, rootChord: 3.4, tipChord: 1.1, sweep: 2.5, thickness: 0.05, root: new Vector3(0, 0.6, 2.3) }, 0.72, dark, 0.2, 2.7);

  // All-moving tailplanes, drooping a little.
  for (const side of [-1, 1] as const) {
    const pivot = new Group();
    pivot.position.set(side * 1.55, -0.05, 4.9);
    pivot.rotation.z = side * -0.08;
    p.object.add(pivot);
    const half = new Mesh(
      wing({ span: 2.1, rootChord: 1.8, tipChord: 0.7, sweep: 1.2, dihedral: 0, thickness: 0.04, root: new Vector3(-side * 0.85, 0, -0.7), side }, 0, 2.1, { roundTip: true }),
      light,
    );
    half.castShadow = true;
    pivot.add(half);
    p.surfaces.elevators.push(pivot);
  }

  // The afterburner flame, lit at full power (see Aircraft).
  const flame = new Group();
  flame.position.set(0, 0, 6.7);
  const flameMaterial = new MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
  flame.add(new Mesh(new ConeGeometry(0.42, 3.2, 16, 1, true).rotateX(Math.PI / 2).translate(0, 0, 1.6), flameMaterial));
  const core = new Mesh(new ConeGeometry(0.25, 1.6, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.8), new MeshBasicMaterial({ color: 0xbfe4ff, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
  flame.add(core);
  flame.visible = false;
  p.object.add(flame);
  p.afterburner = flame;

  // Retractable gear.
  const tyre = rubber();
  const leg = metal();
  p.rod(new Vector3(0, -0.6, -5.0), new Vector3(0, -1.3, -5.0), 0.06, leg, p.gear);
  p.wheel(0.3, 0, -1.3, -5.0, tyre, leg);
  for (const side of [-1, 1]) {
    p.rod(new Vector3(side * 0.9, -0.5, 0.9), new Vector3(side * 1.15, -1.28, 0.9), 0.07, leg, p.gear);
    p.wheel(0.34, side * 1.15, -1.26, 0.9, tyre, leg);
  }

  p.navLights(new Vector3(5.28, -0.1, 2.7), new Vector3(0, 3.65, 5.4));
  return p.finish();
}

export function buildSeaplane(_airline?: Airline, distant = false): AircraftModel {
  return withDetail(distant ? 0.5 : 1, seaplane);
}

function seaplane(): AircraftModel {
  const p = new Parts();
  const yellow = paint(0xffc93c);
  const blue = paint(0x2a6fdb);
  const white = paint(0xf4f6f8);
  const strut = darkGrey();

  p.body(
    [
      { z: -3.65, w: 0.3, h: 0.3, y: 0.05 },
      { z: -3.4, w: 0.6, h: 0.6, y: 0.05 },
      { z: -2.9, w: 0.7, h: 0.72, y: 0.07 },
    ],
    blue,
  );
  p.body(
    [
      { z: -2.9, w: 0.7, h: 0.72, y: 0.07 },
      { z: -2.0, w: 0.75, h: 0.8, y: 0.1 },
      { z: -0.8, w: 0.74, h: 0.82, y: 0.1 },
      { z: 0.6, w: 0.6, h: 0.68, y: 0.13 },
      { z: 1.9, w: 0.36, h: 0.46, y: 0.21 },
      { z: 3.2, w: 0.12, h: 0.2, y: 0.32 },
      { z: 3.4, w: 0.03, h: 0.05, y: 0.33 },
    ],
    yellow,
  );
  // Windscreen and side windows.
  const screen = p.add(new SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass(), 0, 0.66, -1.6);
  screen.scale.set(0.56, 0.34, 0.85);
  const sideWindow = glass();
  for (const side of [-1, 1]) {
    for (const z of [-1.15, -0.35]) {
      const pane = p.add(new BoxGeometry(0.03, 0.4, 0.66), sideWindow, side * 0.6, 0.5, z);
      pane.rotation.z = side * 0.42; // leaning in with the cabin's curve
    }
  }

  // High wing on struts, with blue tips.
  const wingForm = { span: 5.5, rootChord: 1.6, tipChord: 1.45, sweep: 0, dihedral: 0.03, thickness: 0.13, root: new Vector3(0, 0.95, -1.4) };
  const share = 0.78;
  p.wings(wingForm, [{ s0: 0, s1: 5.0, material: white }], share);
  p.wings(wingForm, [{ s0: 5.0, s1: 5.5, material: blue, tip: true }]); // blue tips, full chord
  const [aileronR, aileronL] = p.hinged(wingForm, 3.2, 4.95, share, 0.08, white);
  p.surfaces.ailerons.right.push(aileronR);
  p.surfaces.ailerons.left.push(aileronL);
  p.surfaces.flaps.push(...p.hinged(wingForm, 0.7, 3.1, share, 0.08, white));
  for (const side of [-1, 1]) p.rod(new Vector3(side * 0.6, -0.3, -0.8), new Vector3(side * 2.9, 0.98, -0.75), 0.045, strut);

  // Tail.
  const tailForm = { span: 1.75, rootChord: 0.9, tipChord: 0.6, sweep: 0.15, dihedral: 0, thickness: 0.1, root: new Vector3(0, 0.25, 2.4) };
  p.wings(tailForm, [{ s0: 0, s1: 1.75, material: white, tip: true }], 0.62);
  p.surfaces.elevators.push(...p.hinged(tailForm, 0.12, 1.7, 0.62, 0.06, white));
  p.fin({ span: 1.4, rootChord: 1.2, tipChord: 0.6, sweep: 0.5, thickness: 0.1, root: new Vector3(0, 0.35, 2.3) }, 0.65, blue, 0.1, 1.3);

  // Floats (their bottoms at y = -1.6) on struts.
  const float: Section[] = [
    { z: -3.4, w: 0.04, h: 0.03, y: -1.12 },
    { z: -3.05, w: 0.2, h: 0.16, y: -1.2 },
    { z: -2.4, w: 0.3, h: 0.28, y: -1.3 },
    { z: 0.2, w: 0.32, h: 0.3, y: -1.3 },
    { z: 1.6, w: 0.26, h: 0.24, y: -1.3 },
    { z: 2.4, w: 0.06, h: 0.07, y: -1.24 },
  ];
  const floatStripe = stripeMaterial(0x2a6fdb);
  for (const side of [-1, 1]) {
    p.add(body(float).translate(side * 1.4, 0, 0), white);
    // A blue band along the bottom.
    const band = p.add(body(float, { segments: 48, from: Math.PI + 0.3, to: Math.PI * 2 - 0.3, grow: 1.02, between: [-3.0, 2.1] }).translate(side * 1.4, 0, 0), floatStripe);
    band.castShadow = false;
    for (const z of [-1.5, 0.9]) p.rod(new Vector3(side * 1.4, -1.0, z), new Vector3(side * 0.55, -0.45, z), 0.04, strut);
  }

  p.propeller(-3.8, 2.4, darkGrey(), blue);
  p.navLights(new Vector3(5.6, 1.12, -0.7), new Vector3(0, 1.7, 3.3));
  return p.finish();
}

export function buildAirliner(airline: Airline = AIRLINES[0], distant = false): AircraftModel {
  return withDetail(distant ? 0.5 : 1, () => airliner(airline));
}

function airliner(airline: Airline): AircraftModel {
  const p = new Parts();
  const white = paint(0xf6f7f9, 0.4, 0.1);
  const tailPaint = paint(airline.tail);
  const grey = paint(0xb7bec7, 0.4, 0.4);
  const dark = paint(0x2b2f36, 0.5, 0.3);

  const hull: Section[] = [
    { z: -14.7, w: 0.05, h: 0.05, y: -0.25 },
    { z: -14.3, w: 0.85, h: 0.8, y: -0.16 },
    { z: -13.4, w: 1.38, h: 1.35, y: -0.06 },
    { z: -12.2, w: 1.66, h: 1.64, y: 0 },
    { z: -10.5, w: 1.72, h: 1.72, y: 0 },
    { z: 9.0, w: 1.72, h: 1.72, y: 0 },
    { z: 11.5, w: 1.52, h: 1.48, y: 0.25 },
    { z: 14.0, w: 1.0, h: 1.0, y: 0.8 },
    { z: 16.0, w: 0.45, h: 0.5, y: 1.3 },
    { z: 17.0, w: 0.1, h: 0.15, y: 1.5 },
  ];
  // Many slices round, so the stripes and windows laid on top don't dip into its facets.
  const round = 44;
  p.body(hull, white, { segments: round, steps: 8 });
  // Grey belly, the airline's cheat line, and the cockpit windscreen.
  const band = { segments: round * 2, steps: 8 };
  p.body(hull, stripeMaterial(0xb7bec7), { ...band, from: Math.PI * 1.15, to: Math.PI * 1.85, grow: 1.008, between: [-13.4, 14] });
  p.body(hull, stripeMaterial(airline.stripe), { ...band, from: -0.32, to: -0.12, grow: 1.01, between: [-12.2, 14] });
  p.body(hull, stripeMaterial(airline.stripe), { ...band, from: Math.PI + 0.12, to: Math.PI + 0.32, grow: 1.01, between: [-12.2, 14] });
  // The cockpit windscreen: a dark band round the top of the nose.
  p.body(hull, tintedGlass(), { ...band, from: 0.25, to: Math.PI - 0.25, grow: 1.012, between: [-14.1, -13.1] });

  // Passenger windows along both sides, and doors.
  const windowGeometry = new CylinderGeometry(0.13, 0.13, 0.06, 12).rotateZ(Math.PI / 2).scale(1, 1.35, 1);
  const rows = 26;
  const windows = new InstancedMesh(windowGeometry, tintedGlass(), rows * 2);
  const m = new Matrix4();
  for (let i = 0; i < rows; i++) {
    const z = -10.2 + i * 0.78 + (i > 12 ? 0.9 : 0);
    for (const side of [-1, 1]) windows.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), m.makeTranslation(side * 1.66, 0.45, z));
  }
  p.object.add(windows);
  const doorPaint = stripeMaterial(0xd3d9e0);
  for (const z of [-10, 1.4, 8.6]) {
    const at = (dz: number): Section => ({ z: z + dz, w: 1.72, h: 1.72 });
    p.body([at(-0.42), at(0.42)], doorPaint, { from: -0.5, to: 0.55, grow: 1.006, steps: 1, segments: round * 2 });
    p.body([at(-0.42), at(0.42)], doorPaint, { from: Math.PI - 0.55, to: Math.PI + 0.5, grow: 1.006, steps: 1, segments: round * 2 });
  }

  // Airline name on both sides.
  const logo = new MeshBasicMaterial({ map: textTexture(airline.name.toUpperCase(), airline.text), transparent: true, side: DoubleSide });
  for (const side of [-1, 1]) {
    const label = p.add(new PlaneGeometry(8, 1.2).rotateY((side * Math.PI) / 2), logo, side * 1.735, 1.2, -3);
    label.castShadow = false;
  }

  // Swept wings with winglets, flaps and ailerons.
  const wingForm = { span: 12.6, rootChord: 5.6, tipChord: 1.6, sweep: 6.8, dihedral: 0.09, thickness: 0.11, root: new Vector3(1.3, -1.0, -1.2) };
  const share = 0.84;
  p.wings(wingForm, [{ s0: 0, s1: 12.6, material: white }], share);
  const [aileronR, aileronL] = p.hinged(wingForm, 8.9, 12.2, share, 0.12, white);
  p.surfaces.ailerons.right.push(aileronR);
  p.surfaces.ailerons.left.push(aileronL);
  p.surfaces.flaps.push(...p.hinged(wingForm, 0.6, 8.7, share, 0.14, grey));
  for (const side of [-1, 1] as const) {
    const tip = wingPoint({ ...wingForm, side }, 12.6, 0);
    const winglet = new Group();
    winglet.position.copy(tip);
    winglet.rotation.z = side * -0.25;
    p.object.add(winglet);
    const skin = new Mesh(wing({ span: 1.6, rootChord: 1.55, tipChord: 0.6, sweep: 0.9, dihedral: 0, thickness: 0.08, root: new Vector3(), side: 1 }, 0, 1.6, { roundTip: true }).rotateZ(Math.PI / 2), tailPaint);
    skin.castShadow = true;
    winglet.add(skin);
  }

  // Engines: pods with a dark fan behind the intake lip, hung on pylons.
  for (const side of [-1, 1]) {
    const x = side * 5.5;
    const pod = body(
      [
        { z: -2.7, w: 0.88, h: 0.88 },
        { z: -2.4, w: 0.98, h: 0.98 },
        { z: -1.0, w: 1.0, h: 1.0 },
        { z: 0.5, w: 0.85, h: 0.85 },
        { z: 1.3, w: 0.6, h: 0.6 },
      ],
      { segments: 24, steps: 3 },
    ).translate(x, -2.0, 0);
    p.add(pod, grey);
    p.add(new CircleGeometry(0.82, 20).rotateY(Math.PI), dark, x, -2.0, -2.62);
    p.add(new CircleGeometry(0.2, 12).rotateY(Math.PI), metal(), x, -2.0, -2.63);
    p.add(body([{ z: 1.2, w: 0.4, h: 0.4 }, { z: 2.1, w: 0.03, h: 0.03 }], { segments: 14, steps: 1 }).translate(x, -2.0, 0), dark);
    p.add(new BoxGeometry(0.25, 1.1, 3.0), white, x, -1.35, -0.3);
  }

  // Tailplane with elevators, and the fin in the airline's colour.
  const tailForm = { span: 5.2, rootChord: 3.0, tipChord: 1.2, sweep: 2.6, dihedral: 0.1, thickness: 0.09, root: new Vector3(0.4, 0.9, 12.6) };
  p.wings(tailForm, [{ s0: 0, s1: 5.2, material: white, tip: true }], 0.78);
  p.surfaces.elevators.push(...p.hinged(tailForm, 0.3, 5.0, 0.78, 0.1, white));
  p.fin({ span: 6, rootChord: 5.0, tipChord: 2.0, sweep: 3.6, thickness: 0.09, root: new Vector3(0, 1.4, 10.6) }, 0.78, tailPaint, 0.4, 5.6);

  // Retractable gear: two-wheel nose leg and main legs.
  const tyre = rubber();
  const leg = metal();
  p.rod(new Vector3(0, -1.3, -9), new Vector3(0, -2.6, -9), 0.1, leg, p.gear);
  for (const dx of [-0.32, 0.32]) p.wheel(0.55, dx, -2.65, -9, tyre, leg, 0.35);
  for (const side of [-1, 1]) {
    p.rod(new Vector3(side * 2.5, -1.2, 2), new Vector3(side * 2.5, -2.6, 2), 0.13, leg, p.gear);
    for (const dx of [-0.38, 0.38]) p.wheel(0.6, side * 2.5 + dx, -2.6, 2, tyre, leg, 0.42);
  }

  p.navLights(new Vector3(13.95, 0.15, 6.4), new Vector3(0, 7.35, 15.9));
  return p.finish();
}

/** A stripe's paint: double-sided, as the stripe is a thin shell on the body. */
function stripeMaterial(color: number): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
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
