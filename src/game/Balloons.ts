import { Color, CylinderGeometry, Float32BufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, SphereGeometry, Vector3, type Scene } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SEA_LEVEL, type Ground } from '../physics/FlightModel';
import type { Effects } from '../world/Effects';
import { mulberry32 } from '../world/noise';
import { passesNear, type Shootable, type Strike } from './Gun';

/**
 * Target balloons for gunnery practice: big, bright balloons on long tethers, bobbing in the
 * air over and around an island. A round passing close enough bursts one.
 */

const RADIUS = 7; // m: big target balloons, easy to see and to hit
const HIT_RADIUS = RADIUS + 2.5; // a round this close bursts it (a little help for young pilots)
const COLORS = [0xe63946, 0xffb703, 0x2a9df4, 0x52b788, 0xf72585, 0xff7f11];

interface Balloon {
  home: Vector3;
  position: Vector3;
  phase: number;
  alive: boolean;
}

const m = new Matrix4();
const noTurn = new Quaternion();
const one = new Vector3(1, 1, 1);
const gone = new Vector3(0, 0, 0);

export class Balloons implements Shootable {
  private readonly balloons: Balloon[] = [];
  private readonly mesh: InstancedMesh;
  private time = 0;

  /** `count` balloons spread around (x, z), 400–`spread` m out, 120–380 m above the ground or sea. */
  constructor(
    private readonly scene: Scene,
    private readonly effects: Effects,
    ground: Ground,
    x: number,
    z: number,
    count: number,
    spread: number,
    seed: number,
  ) {
    const rand = mulberry32(seed);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rand() * 0.5;
      const r = 400 + rand() * (spread - 400);
      const bx = x + Math.cos(angle) * r;
      const bz = z + Math.sin(angle) * r;
      const floor = Math.max(ground.heightAt(bx, bz), SEA_LEVEL);
      const home = new Vector3(bx, floor + 120 + rand() * 260, bz);
      this.balloons.push({ home, position: home.clone(), phase: rand() * 10, alive: true });
    }
    this.mesh = new InstancedMesh(balloonGeometry(), new MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.05 }), count);
    this.balloons.forEach((_, i) => this.mesh.setColorAt(i, new Color(COLORS[i % COLORS.length])));
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    scene.add(this.mesh);
    this.update(0);
  }

  get left(): number {
    return this.balloons.filter((b) => b.alive).length;
  }

  get total(): number {
    return this.balloons.length;
  }

  /** The closest balloon still flying, for the target arrow. */
  nearest(from: Vector3): Vector3 | null {
    let best: Vector3 | null = null;
    let bestDistance = Infinity;
    for (const b of this.balloons) {
      if (!b.alive) continue;
      const d = b.position.distanceToSquared(from);
      if (d < bestDistance) {
        bestDistance = d;
        best = b.position;
      }
    }
    return best;
  }

  /** All back up (a new try). */
  reset(): void {
    for (const b of this.balloons) b.alive = true;
    this.update(0);
  }

  /** Bobbing on their tethers in the breeze. */
  update(dt: number): void {
    this.time += dt;
    this.balloons.forEach((b, i) => {
      const t = this.time + b.phase;
      b.position.set(b.home.x + Math.sin(t * 0.4) * 3, b.home.y + Math.sin(t * 0.7) * 2.5, b.home.z + Math.cos(t * 0.33) * 3);
      this.mesh.setMatrixAt(i, m.compose(b.position, noTurn, b.alive ? one : gone));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** A round passing close enough bursts a balloon. */
  strike(a: Vector3, b: Vector3): Strike | null {
    const i = this.balloons.findIndex((balloon) => balloon.alive && passesNear(a, b, balloon.position, HIT_RADIUS));
    if (i < 0) return null;
    this.burst(i);
    return { kind: 'balloon' };
  }

  burst(i: number): void {
    const balloon = this.balloons[i];
    balloon.alive = false;
    this.effects.burst('pop', balloon.position, 14, new Vector3(0, 1, 0), 9);
    this.effects.burst('spark', balloon.position, 10, new Vector3(0, 0, 0), 14);
    this.mesh.setMatrixAt(i, m.compose(balloon.position, noTurn, gone));
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
  }
}

/** A round balloon with a knot, and its tether hanging down; white parts are coloured per balloon. */
function balloonGeometry(): ReturnType<typeof mergeGeometries> {
  const parts = [
    new SphereGeometry(RADIUS, 20, 14).scale(1, 1.15, 1),
    new CylinderGeometry(0.4, 1.2, 1.4, 8).translate(0, -RADIUS * 1.15 - 0.5, 0),
    new CylinderGeometry(0.06, 0.06, 40, 4).translate(0, -RADIUS * 1.15 - 21, 0),
  ];
  // The tether is grey: everything else takes the balloon's colour.
  parts.forEach((part, k) => {
    part.deleteAttribute('uv');
    const shade = k === 2 ? 0.35 : 1;
    part.setAttribute('color', new Float32BufferAttribute(new Array(part.attributes.position.count * 3).fill(shade), 3));
  });
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
}
