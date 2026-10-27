import { BufferGeometry, Float32BufferAttribute, Matrix4, Vector3 } from 'three';

/**
 * Smooth shapes for the planes, built from cross-sections: a fuselage is a row of ellipses
 * from nose to tail, a wing is a row of airfoils from root to tip. In the plane's frame the
 * nose points to -Z, up is +Y and the right wing is +X.
 */

/** 1 = full detail; less (e.g. 0.5) builds rounder shapes from fewer pieces, for planes seen from afar. */
let detail = 1;

/** Builds everything inside `make` at the given level of detail. */
export function withDetail<T>(level: number, make: () => T): T {
  const before = detail;
  detail = level;
  try {
    return make();
  } finally {
    detail = before;
  }
}

/** One slice of a body: an ellipse `w` half-wide and `h` half-high, centred `y` up, at `z`. */
export interface Section {
  z: number;
  w: number;
  h: number;
  y?: number;
}

/**
 * Skins a ring of points per slice (all rings the same length, going round the same way)
 * into one closed, smoothly shaded surface; the ends are capped flat.
 */
export function loft(rings: Vector3[][], caps = true): BufferGeometry {
  const n = rings[0].length;
  const positions: number[] = [];
  const index: number[] = [];
  for (const ring of rings) for (const p of ring) positions.push(p.x, p.y, p.z);
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * n + j;
      const b = (i + 1) * n + j;
      const c = i * n + ((j + 1) % n);
      const d = (i + 1) * n + ((j + 1) % n);
      index.push(a, c, b, b, c, d);
    }
  }
  if (caps) {
    // Each end gets its own vertices, so its flat face doesn't bend the side's shading.
    for (const [ring, flip] of [
      [rings[0], true],
      [rings[rings.length - 1], false],
    ] as const) {
      const centre = ring.reduce((sum, p) => sum.add(p), new Vector3()).divideScalar(n);
      const start = positions.length / 3;
      positions.push(centre.x, centre.y, centre.z);
      for (const p of ring) positions.push(p.x, p.y, p.z);
      for (let j = 0; j < n; j++) {
        const a = start + 1 + j;
        const b = start + 1 + ((j + 1) % n);
        index.push(...(flip ? [start, a, b] : [start, b, a]));
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  geometry.setIndex(index);
  outward(geometry);
  geometry.computeVertexNormals();
  return geometry;
}

/** Turns every triangle to face outwards (the enclosed volume comes out positive). */
function outward(geometry: BufferGeometry): void {
  const p = geometry.attributes.position;
  const index = geometry.index!;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  let volume = 0;
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(p, index.getX(i));
    b.fromBufferAttribute(p, index.getX(i + 1));
    c.fromBufferAttribute(p, index.getX(i + 2));
    volume += a.dot(b.cross(c));
  }
  if (volume >= 0) return;
  const array = index.array as Uint16Array | Uint32Array;
  for (let i = 0; i < array.length; i += 3) [array[i + 1], array[i + 2]] = [array[i + 2], array[i + 1]];
  index.needsUpdate = true;
}

/** Catmull-Rom through the values, `steps` new points per span, for gentle curves from a few slices. */
function smooth(sections: Section[], steps: number): Required<Section>[] {
  const s = sections.map((x) => ({ y: 0, ...x }));
  if (steps <= 1) return s;
  const out: Required<Section>[] = [];
  const keys = ['w', 'h', 'y'] as const;
  for (let i = 0; i < s.length - 1; i++) {
    const p0 = s[Math.max(i - 1, 0)];
    const p1 = s[i];
    const p2 = s[i + 1];
    const p3 = s[Math.min(i + 2, s.length - 1)];
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const v = {} as Required<Section>;
      for (const key of keys) {
        const [a, b, c, d] = [p0[key], p1[key], p2[key], p3[key]];
        v[key] = 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
      }
      v.z = p1.z + (p2.z - p1.z) * t; // straight along the body, so uneven slice spacing can't fold it
      v.w = Math.max(v.w, 0.005);
      v.h = Math.max(v.h, 0.005);
      out.push(v);
    }
  }
  out.push(s[s.length - 1]);
  return out;
}

/**
 * A smooth body (fuselage, engine pod, float) through the given slices, front to back.
 * `from`/`to` (radians, 0 = right side, π/2 = top) skin only part of the way round, for
 * window bands and stripes; `grow` puffs it out a little so such a band sits on the body,
 * and `between` limits it to a stretch of the body.
 */
export function body(
  sections: Section[],
  options: { segments?: number; steps?: number; from?: number; to?: number; grow?: number; between?: [number, number] } = {},
): BufferGeometry {
  const { from, to, grow = 1, between } = options;
  const segments = Math.max(8, Math.round((options.segments ?? 24) * detail));
  const steps = Math.max(1, Math.round((options.steps ?? 4) * detail));
  const partial = from !== undefined && to !== undefined;
  // `between` keeps only the slices in that stretch of z: a stripe on part of a body follows it exactly.
  const slices = smooth(sections, steps).filter((s) => !between || (s.z >= between[0] - 1e-6 && s.z <= between[1] + 1e-6));
  const rings = slices.map((s) => {
    const ring: Vector3[] = [];
    const count = partial ? Math.max(3, Math.round((segments * (to! - from!)) / (Math.PI * 2))) : segments;
    for (let j = 0; j < count; j++) {
      const angle = partial ? from! + ((to! - from!) * j) / (count - 1) : (j / count) * Math.PI * 2;
      ring.push(new Vector3(Math.cos(angle) * s.w * grow, s.y + Math.sin(angle) * s.h * grow, s.z));
    }
    return ring;
  });
  if (!partial) return loft(rings);
  // A strip: two rows of points that are skinned as a thin shell.
  return strip(rings);
}

/** A thin open surface through rows of points; give it a double-sided material. */
function strip(rows: Vector3[][]): BufferGeometry {
  const n = rows[0].length;
  const positions: number[] = [];
  const index: number[] = [];
  for (const row of rows) for (const p of row) positions.push(p.x, p.y, p.z);
  for (let i = 0; i < rows.length - 1; i++) {
    for (let j = 0; j < n - 1; j++) {
      const a = i * n + j;
      const b = (i + 1) * n + j;
      const c = i * n + j + 1;
      const d = (i + 1) * n + j + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/** A wing's outline: where its leading edge is and how deep it is at each point along the span. */
export interface Planform {
  span: number; // m from root to tip
  rootChord: number;
  tipChord: number;
  sweep: number; // m the leading edge moves back from root to tip
  dihedral: number; // radians the wing tilts up towards the tip
  thickness: number; // share of the chord
  root: Vector3; // leading edge at the root
  side: 1 | -1; // 1 = right wing (+X), -1 = left
}

/** The point at span `s` (m from the root) and `u` of the way from leading to trailing edge. */
export function wingPoint(p: Planform, s: number, u: number): Vector3 {
  const t = s / p.span;
  const chord = p.rootChord + (p.tipChord - p.rootChord) * t;
  return new Vector3(p.root.x + p.side * s, p.root.y + Math.sin(p.dihedral) * s, p.root.z + p.sweep * t + u * chord);
}

/** Half-thickness of a symmetric NACA airfoil at `x` (0 = leading edge, 1 = trailing edge), for a 100 % thick one. */
function naca(x: number): number {
  return 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
}

/**
 * The wing between span `s0` and `s1`, with a real airfoil cross-section. Only the front
 * `chordShare` of the chord is built (the rest is for the moving surfaces behind it).
 * `roundTip` closes the outer end in a rounded tip instead of a flat cut.
 */
export function wing(p: Planform, s0: number, s1: number, options: { chordShare?: number; roundTip?: boolean; slices?: number } = {}): BufferGeometry {
  const { chordShare = 1, roundTip = false } = options;
  const slices = Math.max(1, Math.round((options.slices ?? 4) * detail));
  const points = detail < 1 ? 6 : 9;
  const xs = Array.from({ length: points }, (_, k) => (1 - Math.cos((k / (points - 1)) * Math.PI)) / 2); // bunched at both edges
  const up = new Vector3(-p.side * Math.sin(p.dihedral), Math.cos(p.dihedral), 0);
  // `thin` scales the thickness and `inset` trims the chord at both edges (for the rounded tip).
  const ring = (s: number, thin = 1, inset = 0): Vector3[] => {
    const fullChord = p.rootChord + (p.tipChord - p.rootChord) * (s / p.span);
    const le = wingPoint(p, s, 0);
    const half = p.thickness * fullChord * thin;
    const at = (x: number, sign: number) =>
      le
        .clone()
        .add(new Vector3(0, 0, (inset + x * (chordShare - 2 * inset)) * fullChord))
        .addScaledVector(up, sign * (naca(x) * half + 0.002));
    const out: Vector3[] = [];
    // Upper surface from the trailing edge forward, then the lower one back again.
    for (let k = points - 1; k >= 0; k--) out.push(at(xs[k], 1));
    for (let k = 1; k < points - 1; k++) out.push(at(xs[k], -1));
    return out;
  };
  const rings: Vector3[][] = [];
  for (let k = 0; k <= slices; k++) rings.push(ring(s0 + ((s1 - s0) * k) / slices));
  if (roundTip) {
    const reach = 0.05 * p.rootChord;
    rings.push(ring(s1 + reach * 0.6, 0.6, 0.04), ring(s1 + reach, 0.2, 0.15));
  }
  return loft(rings);
}

/**
 * A control surface (aileron, flap, elevator, rudder) in its hinge's frame: `span` along X
 * (centred), `chord` back along +Z, thickest at the hinge and thinning to a sharp trailing edge.
 */
export function controlSurface(span: number, chord: number, thickness: number): BufferGeometry {
  const ring = (x: number) => [
    new Vector3(x, thickness / 2, 0),
    new Vector3(x, 0, chord),
    new Vector3(x, -thickness / 2, 0),
    new Vector3(x, 0, -thickness * 0.4),
  ];
  return loft([ring(-span / 2), ring(span / 2)]);
}

/** A matrix that puts local X along a → b, local Y as close to `up` as it can, at a's and b's middle. */
export function hingeMatrix(a: Vector3, b: Vector3, up = new Vector3(0, 1, 0)): Matrix4 {
  const x = b.clone().sub(a).normalize();
  const z = x.clone().cross(up).normalize();
  const y = z.clone().cross(x).normalize();
  return new Matrix4().makeBasis(x, y, z).setPosition(a.clone().add(b).multiplyScalar(0.5));
}
