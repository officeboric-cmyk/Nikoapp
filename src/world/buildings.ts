import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';

/**
 * Houses as on the Dalmatian islands: plastered stone walls with windows and shutters (the wall texture
 * holds two floors), a gable roof of terracotta tiles with eaves, and a chimney.
 */

export interface HouseTemplate {
  width: number; // m along the ridge
  depth: number;
  height: number; // m to the eaves
  walls: BufferGeometry; // walls, gables and chimney: the wall texture
  roof: BufferGeometry; // the two roof slopes: the tile texture
}

const PITCH = Math.tan((27 * Math.PI) / 180);
const EAVES = 0.45; // m the roof overhangs the walls
const FLOOR_TEXTURE = 7.2; // m of wall one repeat of the wall texture covers (two floors)
const WINDOW_BAY = 7.5; // m of wall per repeat sideways (three windows)
const TILE_REPEAT = 1.8; // m of roof one repeat of the tile texture covers
/** A spot in the wall texture with plain plaster only, for gables and chimneys. */
const PLAIN: [number, number] = [0.37, 0.94];

class Builder {
  readonly positions: number[] = [];
  readonly uvs: number[] = [];

  /** Corners counter-clockwise as seen from outside, with their texture coordinates. */
  quad(corners: Vector3[], uv: [number, number][]): void {
    for (const k of [0, 1, 2, 0, 2, 3]) {
      this.positions.push(corners[k].x, corners[k].y, corners[k].z);
      this.uvs.push(...uv[k]);
    }
  }

  triangle(corners: Vector3[], uv: [number, number][]): void {
    for (const k of [0, 1, 2]) {
      this.positions.push(corners[k].x, corners[k].y, corners[k].z);
      this.uvs.push(...uv[k]);
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2));
    g.computeVertexNormals();
    return g;
  }
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
const plain = (): [number, number][] => [PLAIN, [PLAIN[0] + 0.05, PLAIN[1]], [PLAIN[0] + 0.05, PLAIN[1] + 0.03], [PLAIN[0], PLAIN[1] + 0.03]];

/** A house `width` along its ridge, `depth` across, walls `height` high; the origin is the middle of its floor. */
export function houseTemplate(width: number, depth: number, height: number, chimney = true): HouseTemplate {
  const w = width / 2;
  const d = depth / 2;
  const h = height;
  const ridge = d * PITCH;
  const walls = new Builder();
  const ry = h / FLOOR_TEXTURE;
  const rw = Math.max(1, Math.round(width / WINDOW_BAY));
  const rd = Math.max(1, Math.round(depth / WINDOW_BAY));
  const face = (repeat: number): [number, number][] => [[0, 0], [repeat, 0], [repeat, ry], [0, ry]];
  walls.quad([v(-w, 0, d), v(w, 0, d), v(w, h, d), v(-w, h, d)], face(rw));
  walls.quad([v(w, 0, -d), v(-w, 0, -d), v(-w, h, -d), v(w, h, -d)], face(rw));
  walls.quad([v(w, 0, d), v(w, 0, -d), v(w, h, -d), v(w, h, d)], face(rd));
  walls.quad([v(-w, 0, -d), v(-w, 0, d), v(-w, h, d), v(-w, h, -d)], face(rd));
  const gable = plain().slice(0, 3);
  walls.triangle([v(w, h, d), v(w, h, -d), v(w, h + ridge, 0)], gable);
  walls.triangle([v(-w, h, -d), v(-w, h, d), v(-w, h + ridge, 0)], gable);
  if (chimney) {
    // Standing on the back slope, a third of the way along.
    const cx = w * 0.45;
    const cz = -d * 0.35;
    const base = h + ridge * (1 - Math.abs(cz) / d) - 0.4;
    const top = h + ridge + 0.9;
    const s = 0.35;
    const p = plain();
    walls.quad([v(cx - s, base, cz + s), v(cx + s, base, cz + s), v(cx + s, top, cz + s), v(cx - s, top, cz + s)], p);
    walls.quad([v(cx + s, base, cz - s), v(cx - s, base, cz - s), v(cx - s, top, cz - s), v(cx + s, top, cz - s)], p);
    walls.quad([v(cx + s, base, cz + s), v(cx + s, base, cz - s), v(cx + s, top, cz - s), v(cx + s, top, cz + s)], p);
    walls.quad([v(cx - s, base, cz - s), v(cx - s, base, cz + s), v(cx - s, top, cz + s), v(cx - s, top, cz - s)], p);
    walls.quad([v(cx - s, top, cz + s), v(cx + s, top, cz + s), v(cx + s, top, cz - s), v(cx - s, top, cz - s)], p);
  }

  const roof = new Builder();
  const W = w + EAVES;
  const Z = d + EAVES;
  const eave = h - EAVES * PITCH;
  const top = h + ridge;
  const slope = Math.hypot(Z, top - eave) / TILE_REPEAT;
  const across = (2 * W) / TILE_REPEAT;
  const tiles: [number, number][] = [[0, 0], [across, 0], [across, slope], [0, slope]];
  roof.quad([v(-W, eave, Z), v(W, eave, Z), v(W, top, 0), v(-W, top, 0)], tiles);
  roof.quad([v(W, eave, -Z), v(-W, eave, -Z), v(-W, top, 0), v(W, top, 0)], tiles);
  return { width, depth, height, walls: walls.build(), roof: roof.build() };
}
