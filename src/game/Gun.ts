import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Scene,
} from 'three';
import { SEA_LEVEL, type FlightModel, type Ground } from '../physics/FlightModel';
import type { Effects } from '../world/Effects';

/**
 * A fighter's gun: glowing tracer rounds that fly straight out of the nose (plus the plane's own
 * speed), fall a little, and strike what they meet: target balloons burst, other planes and houses
 * are damaged and then brought down (see Shootable), the ground and the sea puff dust or spray.
 */

/** What a round struck: `down` when that hit finished it off. */
export type Strike = { kind: 'balloon' } | { kind: 'plane' | 'house' | 'parked'; down: boolean };

/** Anything the gun can hit. */
export interface Shootable {
  /** Checks a round flying from `a` to `b` this step; if it hits something, deals with it and says what. */
  strike(a: Vector3, b: Vector3): Strike | null;
}

/** True when the path from `a` to `b` passes within `radius` of `centre`. */
export function passesNear(a: Vector3, b: Vector3, centre: Vector3, radius: number): boolean {
  segment.subVectors(b, a);
  const length2 = segment.lengthSq();
  toCentre.subVectors(centre, a);
  const t = length2 > 0 ? Math.min(1, Math.max(0, toCentre.dot(segment) / length2)) : 0;
  return toCentre.addScaledVector(segment, -t).lengthSq() < radius * radius;
}
const segment = new Vector3();
const toCentre = new Vector3();

export const AMMO = 600; // rounds in a full gun
const RATE = 18; // rounds per second while the trigger is held
const MUZZLE_SPEED = 1000; // m/s
const LIFE = 2.2; // s before a round is spent
const MAX_ROUNDS = 64;
const TRACER_LENGTH = 16; // m, the glowing streak each round draws (drawn thick so it shows from afar)
const GRAVITY = 9.81;

interface Round {
  position: Vector3;
  velocity: Vector3;
  age: number;
}

const forward = new Vector3();
const from = new Vector3();
const turn = new Quaternion();
const scale = new Vector3();
const m = new Matrix4();
const zAxis = new Vector3(0, 0, 1);

export class Gun {
  ammo = AMMO;
  private rounds: Round[] = [];
  private cooldown = 0;
  private readonly tracers: InstancedMesh;
  private readonly flash: Mesh;
  private flashTime = 0;

  constructor(
    scene: Scene,
    private readonly effects: Effects,
    private readonly muzzle: Vector3, // in the plane's frame
  ) {
    // Bright beyond white so the bloom makes them glow.
    const glow = new MeshBasicMaterial({ color: new Color(4, 2.6, 1.1), toneMapped: false, transparent: true, blending: AdditiveBlending, depthWrite: false });
    this.tracers = new InstancedMesh(new BoxGeometry(0.55, 0.55, TRACER_LENGTH), glow, MAX_ROUNDS);
    this.tracers.count = 0;
    this.tracers.frustumCulled = false;
    this.flash = new Mesh(new SphereGeometry(0.6, 10, 8), new MeshBasicMaterial({ color: new Color(5, 3.4, 1.2), toneMapped: false, transparent: true, blending: AdditiveBlending, depthWrite: false }));
    this.flash.visible = false;
    scene.add(this.tracers, this.flash);
  }

  /** Clears the sky of rounds and fills the gun again. */
  reload(): void {
    this.ammo = AMMO;
    this.rounds = [];
    this.tracers.count = 0;
  }

  /** Where a round fired now would be, `distance` metres ahead: for the gunsight. */
  aimPoint(model: FlightModel, distance: number, out: Vector3): Vector3 {
    forward.set(0, 0, -1).applyQuaternion(model.quaternion);
    from.copy(this.muzzle).applyQuaternion(model.quaternion).add(model.position);
    const time = distance / MUZZLE_SPEED;
    return out.copy(from).addScaledVector(forward, distance).addScaledVector(model.velocity, time).setY(out.y - 0.5 * GRAVITY * time * time);
  }

  /**
   * Fires while `trigger` is held, moves the rounds and checks what they strike. Returns how many
   * rounds were fired this step (for the sound) and what they struck.
   */
  update(dt: number, model: FlightModel, trigger: boolean, ground: Ground, targets: (Shootable | null)[]): { fired: number; strikes: Strike[] } {
    let fired = 0;
    const strikes: Strike[] = [];
    this.cooldown -= dt;
    if (trigger && this.ammo > 0 && !model.crashed) {
      while (this.cooldown <= 0 && this.ammo > 0) {
        this.cooldown += 1 / RATE;
        this.ammo--;
        fired++;
        forward.set(0, 0, -1).applyQuaternion(model.quaternion);
        const position = this.muzzle.clone().applyQuaternion(model.quaternion).add(model.position);
        const velocity = forward.clone().multiplyScalar(MUZZLE_SPEED).add(model.velocity);
        if (this.rounds.length >= MAX_ROUNDS) this.rounds.shift();
        this.rounds.push({ position, velocity, age: 0 });
        this.flashTime = 0.05;
      }
    } else if (this.cooldown < 0) {
      this.cooldown = 0;
    }

    // The muzzle flash flickers at the gun while it fires.
    this.flashTime -= dt;
    this.flash.visible = this.flashTime > 0;
    if (this.flash.visible) {
      this.flash.position.copy(this.muzzle).applyQuaternion(model.quaternion).add(model.position);
      this.flash.scale.setScalar(0.7 + Math.random() * 0.8);
    }

    const kept: Round[] = [];
    for (const round of this.rounds) {
      from.copy(round.position);
      round.velocity.y -= GRAVITY * dt;
      round.position.addScaledVector(round.velocity, dt);
      round.age += dt;
      let strike: Strike | null = null;
      for (const target of targets) if (target && (strike = target.strike(from, round.position))) break;
      if (strike) {
        strikes.push(strike);
        this.effects.burst('spark', round.position, 4, new Vector3(0, 0, 0), 8);
        continue;
      }
      const floor = ground.heightAt(round.position.x, round.position.z);
      if (round.position.y < Math.max(floor, SEA_LEVEL)) {
        const sea = floor < SEA_LEVEL;
        round.position.y = Math.max(floor, SEA_LEVEL);
        this.effects.burst(sea ? 'spray' : 'dust', round.position, sea ? 4 : 3, new Vector3(0, sea ? 6 : 2, 0), 2);
        this.effects.emit('spark', round.position, new Vector3(0, 2, 0), 3);
        continue;
      }
      if (round.age < LIFE) kept.push(round);
    }
    this.rounds = kept;

    this.rounds.forEach((round, i) => {
      turn.setFromUnitVectors(zAxis, forward.copy(round.velocity).normalize());
      this.tracers.setMatrixAt(i, m.compose(round.position, turn, scale.set(1, 1, 1)));
    });
    this.tracers.count = this.rounds.length;
    this.tracers.instanceMatrix.needsUpdate = true;
    return { fired, strikes };
  }

  dispose(scene: Scene): void {
    scene.remove(this.tracers, this.flash);
  }
}
