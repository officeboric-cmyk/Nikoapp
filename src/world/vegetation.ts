import { BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, IcosahedronGeometry } from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { noise2 } from './noise';

/** How wooded a spot is (above about 0.1 there is pine wood): big patches with ragged edges. */
export function woodsAt(x: number, z: number): number {
  return noise2(x / 450, z / 450, 99) + 0.4 * noise2(x / 120, z / 120, 98);
}

/**
 * Trees and bushes of the Adriatic islands, each one geometry (trunk and leaves together, coloured per
 * vertex) to be drawn many times over: Aleppo pines, holm oaks, cypresses, olives and low scrub.
 */

export type Species = 'pine' | 'oak' | 'cypress' | 'olive' | 'bush';

const BARK = new Color(0x6b5440);
const OLIVE_BARK = new Color(0x7d7468);

/**
 * A lumpy mass of leaves: a sphere pushed in and out by noise, then stretched to size and lifted to `y`.
 * Darker underneath and inside, as real crowns are where the light doesn't reach. `taper` narrows the top.
 */
function crown(
  detail: number,
  seed: number,
  size: [number, number, number],
  offset: [number, number, number],
  leaves: Color,
  lumps = 0.22,
  taper = 0,
): BufferGeometry {
  let g: BufferGeometry = new IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const bump = noise2(x * 1.9 + z * 0.7 + seed, y * 1.9 - z * 1.1, seed) * 0.7 + noise2(x * 4 + seed, z * 4 + y * 3, seed + 1) * 0.3;
    const r = 1 + lumps * bump;
    const narrow = taper > 0 ? 1 - taper * Math.max(0, y) : 1;
    pos.setXYZ(i, x * r * size[0] * narrow + offset[0], y * r * size[1] + offset[1], z * r * size[2] + offset[2]);
    const light = 0.55 + 0.32 * (y + 1) * 0.5 + 0.18 * bump;
    c.copy(leaves).multiplyScalar(light);
    c.toArray(colors, i * 3);
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return g;
}

/** A trunk from the ground up to `height`, leaning by `lean` metres at the top. */
function trunk(height: number, bottom: number, top: number, bark: Color, lean: number, sides: number): BufferGeometry {
  const g = new CylinderGeometry(top, bottom, height, sides, sides > 4 ? 2 : 1, true).translate(0, height / 2, 0);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal'); // made smooth for the whole tree in join()
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) + lean * (pos.getY(i) / height) ** 2);
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) bark.toArray(colors, i * 3);
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return g;
}

function join(...parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts.map((p) => (p.index ? p : mergeVertices(p))))!;
  g.computeVertexNormals();
  return g;
}

/** Near: smooth lumpy crowns. Far: the same shapes from far fewer triangles. */
export type Detail = 'near' | 'far';

/** The shape of each kind of tree, near or far. */
export function speciesGeometry(species: Species, detail: Detail): BufferGeometry {
  const d = detail === 'near' ? 1 : 0;
  const near = detail === 'near';
  const sides = near ? 6 : 3;
  switch (species) {
    case 'pine': {
      // Aleppo pine: a tall, often leaning trunk and a flat, broken crown on top.
      const parts = [trunk(7, 0.34, 0.2, BARK, 0.7, sides), crown(d, 3, [3.3, 1.35, 3.0], [0.7, 7.2, 0], new Color(0x40602c), 0.28)];
      if (near) parts.push(crown(d, 8, [2.0, 1.0, 2.2], [-0.9, 6.3, 1.0], new Color(0x3c5a29), 0.3));
      return join(...parts);
    }
    case 'oak':
      // Holm oak: a short trunk and a big round dark crown.
      return join(trunk(2.6, 0.38, 0.26, BARK, 0, sides), crown(d, 5, [3.1, 2.5, 3.0], [0, 4.4, 0], new Color(0x4a6630), 0.24));
    case 'cypress':
      // Cypress: a tall dark flame.
      return join(trunk(1.2, 0.2, 0.15, BARK, 0, sides), crown(d, 7, [1.05, 4.4, 1.05], [0, 5.2, 0], new Color(0x34502a), 0.1, 0.55));
    case 'olive':
      // Olive: a short twisted trunk and a light, silvery-green crown.
      return join(trunk(1.6, 0.32, 0.2, OLIVE_BARK, 0.4, sides), crown(d, 9, [2.3, 1.5, 2.2], [0.4, 2.9, 0], new Color(0x7f8e5c), 0.3));
    case 'bush':
      // Macchia: low, dense scrub.
      return join(crown(d, 11, [1.3, 0.85, 1.2], [0, 0.45, 0], new Color(0x4d6a31), 0.3));
  }
}
