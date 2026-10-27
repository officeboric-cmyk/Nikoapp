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
import type { Balloons } from './Balloons';

/**
 * A fighter's gun: glowing tracer rounds that fly straight out of the nose (plus the plane's own
 * speed), fall a little, puff dust or spray where they strike the ground or the sea, and burst the
 * target balloons they hit. Other planes and houses are never hurt: the rounds pass them by.
 */

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
   * rounds were fired this step (for the sound) and how many balloons burst.
   */
  update(dt: number, model: FlightModel, trigger: boolean, ground: Ground, balloons: Balloons | null): { fired: number; burst: number } {
    let fired = 0;
    let burst = 0;
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
      const hit = balloons?.hitBy(from, round.position) ?? -1;
      if (hit >= 0) {
        balloons!.burst(hit);
        burst++;
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
    return { fired, burst };
  }

  dispose(scene: Scene): void {
    scene.remove(this.tracers, this.flash);
  }
}
