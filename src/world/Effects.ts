import {
  BufferAttribute,
  BufferGeometry,
  Color,
  MathUtils,
  Points,
  Scene,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three';
import { SEA_LEVEL, type FlightModel } from '../physics/FlightModel';
import type { Terrain } from './Terrain';

/**
 * Puffs and sprays: tyre smoke when the wheels touch down, dust rolling on grass, spray on the
 * water, contrails behind jets up high and a cloud of smoke after a crash. All are soft round
 * particles in one pool, drawn in a single call.
 */

export type EffectKind = 'smoke' | 'dust' | 'spray' | 'contrail' | 'crash';

interface Look {
  color: number;
  size: [number, number]; // m, at birth and at the end of its life
  life: number; // s
  alpha: number;
  drag: number; // how quickly it stops moving (per second)
  lift: number; // m/s² upwards (negative falls)
}

const LOOKS: Record<EffectKind, Look> = {
  smoke: { color: 0xe6e6e6, size: [1.2, 7], life: 1.8, alpha: 0.65, drag: 2.5, lift: 0.6 },
  dust: { color: 0xc9b285, size: [1, 5], life: 1.4, alpha: 0.45, drag: 2, lift: 0.5 },
  spray: { color: 0xffffff, size: [0.6, 2.8], life: 0.9, alpha: 0.75, drag: 0.8, lift: -9 },
  contrail: { color: 0xffffff, size: [3, 10], life: 7, alpha: 0.4, drag: 0.4, lift: 0 },
  crash: { color: 0x6b6b6b, size: [3, 16], life: 3.5, alpha: 0.75, drag: 1.2, lift: 2.5 },
};

const COLORS = Object.fromEntries(Object.entries(LOOKS).map(([kind, look]) => [kind, new Color(look.color)])) as Record<EffectKind, Color>;

const MAX = 3000;
const CONTRAIL_HEIGHT = 350; // m above the sea, jets start leaving trails
const CONTRAIL_SPACING = 2.5; // m between puffs, so the trail stays unbroken at any speed

const tmp = new Vector3();
const right = new Vector3();
const down = new Vector3();
const back = new Vector3();

export class Effects {
  readonly points: Points;
  private readonly position = new Float32Array(MAX * 3);
  private readonly velocity = new Float32Array(MAX * 3);
  private readonly age = new Float32Array(MAX).fill(Infinity);
  private readonly kind: EffectKind[] = new Array(MAX).fill('smoke');
  private readonly size = new Float32Array(MAX);
  private readonly alpha = new Float32Array(MAX);
  private readonly color = new Float32Array(MAX * 3);
  private readonly material: ShaderMaterial;
  private next = 0;
  private contrailGap = 0;
  private exhausts: Vector3[] = [];

  constructor(scene: Scene) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.position, 3));
    geometry.setAttribute('size', new BufferAttribute(this.size, 1));
    geometry.setAttribute('alpha', new BufferAttribute(this.alpha, 1));
    geometry.setAttribute('color', new BufferAttribute(this.color, 3));
    this.material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([UniformsLib.fog, { light: { value: new Color(0xffffff) }, viewportHalfHeight: { value: 400 } }]),
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        attribute vec3 color;
        uniform float viewportHalfHeight;
        varying float vAlpha;
        varying vec3 vColor;
        #include <fog_pars_vertex>
        void main() {
          vAlpha = alpha;
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = size * projectionMatrix[1][1] * viewportHalfHeight / max(-mvPosition.z, 0.1);
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 light;
        varying float vAlpha;
        varying vec3 vColor;
        #include <fog_pars_fragment>
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          if (r > 1.0) discard;
          gl_FragColor = vec4(vColor * light, vAlpha * (1.0 - r * r));
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.points = new Points(geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /** The light falling on the smoke: white by day, dim and blue at night. */
  setLight(color: Color): void {
    this.material.uniforms.light.value.copy(color);
  }

  /** Call when the canvas changes size (in device pixels) so puffs keep their size in metres. */
  setViewport(heightInPixels: number): void {
    this.material.uniforms.viewportHalfHeight.value = heightInPixels / 2;
  }

  /** Where the plane's engines leave contrails, in the plane's own frame (none for propellers). */
  setExhausts(points: [number, number, number][]): void {
    this.exhausts = points.map((p) => new Vector3(...p));
  }

  clear(): void {
    this.age.fill(Infinity);
    this.alpha.fill(0);
    (this.points.geometry.attributes.alpha as BufferAttribute).needsUpdate = true;
  }

  /** Adds one particle at `at`, moving with `velocity` plus a random spread of `spread` m/s. */
  emit(kind: EffectKind, at: Vector3, velocity: Vector3, spread: number): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.position.set([at.x, at.y, at.z], i * 3);
    this.velocity.set(
      [
        velocity.x + MathUtils.randFloatSpread(spread * 2),
        velocity.y + MathUtils.randFloatSpread(spread * 2),
        velocity.z + MathUtils.randFloatSpread(spread * 2),
      ],
      i * 3,
    );
    this.age[i] = 0;
    this.kind[i] = kind;
    COLORS[kind].toArray(this.color, i * 3);
  }

  burst(kind: EffectKind, at: Vector3, count: number, velocity: Vector3, spread: number): void {
    for (let n = 0; n < count; n++) this.emit(kind, at, velocity, spread);
  }

  /** Tyre smoke from both main wheels as they touch the runway. */
  touchdown(model: FlightModel): void {
    this.planeAxes(model);
    for (const side of [-1, 1]) {
      tmp.copy(model.position).addScaledVector(down, model.spec.gearHeight).addScaledVector(right, side * wheelSpread(model));
      this.burst('smoke', tmp, 14, back.clone().multiplyScalar(-model.speed * 0.15).setY(0.5), 1.5);
    }
  }

  splash(model: FlightModel): void {
    tmp.set(model.position.x, SEA_LEVEL, model.position.z);
    this.burst('spray', tmp, 90, new Vector3(0, 7, 0), 5);
  }

  crash(model: FlightModel): void {
    this.burst('crash', model.position, 40, new Vector3(0, 3, 0), 4);
  }

  /** Continuous effects from the plane (dust, spray, contrails) and moving every particle. */
  update(dt: number, model: FlightModel, terrain: Terrain): void {
    if (dt > 0 && !model.crashed) this.emitFromPlane(dt, model, terrain);

    for (let i = 0; i < MAX; i++) {
      if (this.age[i] === Infinity) continue;
      const look = LOOKS[this.kind[i]];
      const age = (this.age[i] += dt);
      if (age >= look.life) {
        this.age[i] = Infinity;
        this.alpha[i] = 0;
        continue;
      }
      const t = age / look.life;
      const keep = Math.exp(-look.drag * dt);
      const k = i * 3;
      this.velocity[k] *= keep;
      this.velocity[k + 1] = this.velocity[k + 1] * keep + look.lift * dt;
      this.velocity[k + 2] *= keep;
      this.position[k] += this.velocity[k] * dt;
      this.position[k + 1] = Math.max(this.position[k + 1] + this.velocity[k + 1] * dt, SEA_LEVEL - 1);
      this.position[k + 2] += this.velocity[k + 2] * dt;
      this.size[i] = MathUtils.lerp(look.size[0], look.size[1], Math.sqrt(t));
      this.alpha[i] = look.alpha * (1 - t) * Math.min(1, age * 10); // fades in quickly, out slowly
    }
    const attributes = this.points.geometry.attributes;
    for (const name of ['position', 'size', 'alpha', 'color']) (attributes[name] as BufferAttribute).needsUpdate = true;
  }

  private emitFromPlane(dt: number, model: FlightModel, terrain: Terrain): void {
    this.planeAxes(model);
    const { x, z } = model.position;
    const ground = terrain.heightAt(x, z);

    if (model.onGround && model.speed > 3) {
      const onWater = ground < SEA_LEVEL;
      if (onWater || !terrain.runwayAt(x, z)) {
        // Spray off the floats, or dust kicked up by the wheels on grass.
        const kind: EffectKind = onWater ? 'spray' : 'dust';
        const count = Math.min(6, Math.ceil(model.speed * dt * (onWater ? 1.5 : 0.6)));
        for (const side of [-1, 1]) {
          for (let n = 0; n < count; n++) {
            tmp.copy(model.position).addScaledVector(down, model.spec.gearHeight * 0.9).addScaledVector(right, side * wheelSpread(model));
            if (onWater) tmp.y = SEA_LEVEL + 0.2;
            const kick = onWater ? new Vector3().addScaledVector(right, side * 2.5).setY(2 + model.speed * 0.12) : new Vector3(0, 0.6, 0);
            this.emit(kind, tmp, kick, onWater ? 1.2 : 0.8);
          }
        }
      }
    }

    // Contrails: a puff every few metres from each engine.
    const high = model.position.y - SEA_LEVEL > CONTRAIL_HEIGHT;
    if (this.exhausts.length && high && !model.onGround) {
      this.contrailGap += model.speed * dt;
      while (this.contrailGap >= CONTRAIL_SPACING) {
        this.contrailGap -= CONTRAIL_SPACING;
        for (const exhaust of this.exhausts) {
          tmp.copy(exhaust).applyQuaternion(model.quaternion).add(model.position).addScaledVector(back, this.contrailGap);
          this.emit('contrail', tmp, model.velocity.clone().multiplyScalar(0.05), 0.3);
        }
      }
    } else {
      this.contrailGap = 0;
    }
  }

  private planeAxes(model: FlightModel): void {
    right.set(1, 0, 0).applyQuaternion(model.quaternion);
    down.set(0, -1, 0).applyQuaternion(model.quaternion);
    back.set(0, 0, 1).applyQuaternion(model.quaternion);
  }
}

/** How far out from the middle the main wheels (or floats) sit. */
function wheelSpread(model: FlightModel): number {
  return Math.min(model.spec.wingspan * 0.13, 3);
}
