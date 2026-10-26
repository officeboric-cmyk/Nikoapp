import { Euler, MathUtils, Quaternion, Vector3 } from 'three';
import type { Controls } from '../core/Input';

/**
 * Arcade flight model tuned for kids: the plane flies where its nose points,
 * levels itself when you let go of the keys, and only loses lift (stalls)
 * when it gets really slow.
 *
 * Axes: the plane's nose is local -Z, up is +Y, right wing is +X.
 */

export interface AircraftSpec {
  maxThrust: number; // m/s² acceleration at full throttle
  maxSpeed: number; // m/s top speed in level flight
  stallSpeed: number; // m/s below this the wings start losing lift
  rotateSpeed: number; // m/s needed before the nose can lift on the runway
  pitchRate: number; // rad/s
  rollRate: number; // rad/s
  yawRate: number; // rad/s, rudder in the air
  groundSteerRate: number; // rad/s, nose wheel on the runway
  turnRate: number; // rad/s heading change at a 90° bank
  gearHeight: number; // m from the plane's origin down to the wheels
  floats: boolean; // a seaplane: can land on and take off from water
}

/** What the plane can bump into: the ground height in metres, open water wherever it is below SEA_LEVEL. */
export interface Ground {
  heightAt(x: number, z: number): number;
}

export const SEA_LEVEL = 0;
export const FLAT_GROUND: Ground = { heightAt: () => 0 };

export type FlightEvent = 'takeoff' | 'touchdown' | 'crash' | 'splash';

const GRAVITY_ALONG_PATH = 9.81 * 0.6; // softened: climbing slows you, diving speeds you up
const MAX_SINK = 12; // m/s sink rate when fully stalled
const THROTTLE_RATE = 0.5; // throttle change per second while a key is held
const THROTTLE_FOLLOW = 1.5; // throttle change per second towards a touch slider position
const ROLLING_FRICTION = 0.5; // m/s²
const WATER_FRICTION = 2; // m/s², floats drag more than wheels
const BRAKE_DECEL = 6; // m/s²
const AUTO_LEVEL_ROLL = 1.5;
const AUTO_LEVEL_PITCH = 0.8;
const STALL_NOSE_DROP = 1.5;
const MAX_BANK = MathUtils.degToRad(60); // no rolling upside down
const MAX_PITCH = MathUtils.degToRad(45); // no loops
const CRASH_SINK = 7; // m/s vertical speed a touchdown can survive
const CRASH_BANK = 0.5; // sin of the bank angle a touchdown can survive (~30°)
const CRASH_NOSE_DOWN = -0.3; // sin of the pitch angle a touchdown can survive
const CRASH_SLOPE = 0.35; // steepest hillside (rise over run) a touchdown can survive
const LIFTOFF_CLIMB = 0.3; // m/s upward speed that counts as leaving the ground

const FORWARD = new Vector3(0, 0, -1);
const RIGHT = new Vector3(1, 0, 0);
const UP = new Vector3(0, 1, 0);

const fwd = new Vector3();
const right = new Vector3();
const tmpQ = new Quaternion();
const tmpEuler = new Euler(0, 0, 0, 'YXZ');

export class FlightModel {
  readonly position = new Vector3();
  readonly quaternion = new Quaternion();
  readonly velocity = new Vector3();
  speed = 0; // m/s along the nose
  throttle = 0; // 0..1
  onGround = true;
  stalled = false;
  crashed = false;
  /** How the last touchdown went: sink rate (m/s) and sin of the bank angle (+ = right wing down). */
  readonly lastTouchdown = { sink: 0, bank: 0 };

  constructor(readonly spec: AircraftSpec) {}

  /** Puts the plane down with its wheels at `position`, nose pointing along `heading` (radians, 0 = -Z). */
  reset(position: Vector3, heading: number): void {
    this.position.copy(position);
    this.position.y += this.spec.gearHeight;
    this.quaternion.setFromEuler(tmpEuler.set(0, heading, 0));
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.throttle = 0;
    this.onGround = true;
    this.stalled = false;
    this.crashed = false;
  }

  /** Advances the simulation by `dt` seconds and returns what happened during the step. */
  step(dt: number, c: Controls, ground: Ground = FLAT_GROUND): FlightEvent[] {
    const events: FlightEvent[] = [];
    if (this.crashed) return events;
    const s = this.spec;

    fwd.copy(FORWARD).applyQuaternion(this.quaternion);
    right.copy(RIGHT).applyQuaternion(this.quaternion);

    if (c.throttleSet !== undefined) {
      const step = THROTTLE_FOLLOW * dt;
      this.throttle += MathUtils.clamp(c.throttleSet - this.throttle, -step, step);
    } else {
      this.throttle = MathUtils.clamp(this.throttle + c.throttle * THROTTLE_RATE * dt, 0, 1);
    }

    // 0 = no lift at all, 1 = wings fully flying.
    const lift = MathUtils.smoothstep(this.speed, s.stallSpeed * 0.6, s.stallSpeed);

    // --- speed along the nose ---
    const drag = s.maxThrust / (s.maxSpeed * s.maxSpeed);
    let accel = this.throttle * s.maxThrust - drag * this.speed * this.speed - GRAVITY_ALONG_PATH * fwd.y;
    if (this.onGround) {
      const onWater = ground.heightAt(this.position.x, this.position.z) < SEA_LEVEL;
      accel -= (onWater ? WATER_FRICTION : ROLLING_FRICTION) + (c.brake ? BRAKE_DECEL : 0);
    }
    this.speed = Math.max(0, this.speed + accel * dt);

    // --- control inputs ---
    let pitchIn = c.pitch;
    let rollIn = c.roll;
    let yawIn = c.yaw;
    if (this.onGround) {
      // On the runway left/right steers the nose wheel; there is nothing to roll.
      yawIn = MathUtils.clamp(yawIn + rollIn, -1, 1);
      rollIn = 0;
      if (this.speed < s.rotateSpeed) pitchIn = Math.min(pitchIn, 0);
    } else {
      // Let go of the keys and the plane flies straight and level again.
      if (rollIn === 0) rollIn = MathUtils.clamp(right.y * AUTO_LEVEL_ROLL, -1, 1);
      if (pitchIn === 0) pitchIn = MathUtils.clamp(-fwd.y * AUTO_LEVEL_PITCH, -1, 1);
      // Without lift the nose drops so the plane picks up speed again.
      pitchIn -= (1 - lift) * STALL_NOSE_DROP;

      // Keep the plane the right way up: stop rolling or pitching past the limits.
      const bank = Math.asin(MathUtils.clamp(-right.y, -1, 1)); // + = right wing down
      if (Math.abs(bank) >= MAX_BANK && Math.sign(rollIn) === Math.sign(bank)) rollIn = 0;
      const pitch = Math.asin(MathUtils.clamp(fwd.y, -1, 1));
      if (Math.abs(pitch) >= MAX_PITCH && Math.sign(pitchIn) === Math.sign(pitch)) pitchIn = 0;
    }

    // Controls get mushy as the plane slows down.
    const authority = this.onGround ? 1 : 0.3 + 0.7 * lift;
    const yawRate = this.onGround ? s.groundSteerRate * Math.min(1, this.speed / 6) : s.yawRate * authority;
    tmpEuler.set(pitchIn * s.pitchRate * authority * dt, -yawIn * yawRate * dt, -rollIn * s.rollRate * authority * dt);
    this.quaternion.multiply(tmpQ.setFromEuler(tmpEuler));

    // Banking turns the plane: a coordinated turn without needing the rudder.
    if (!this.onGround) {
      this.quaternion.premultiply(tmpQ.setFromAxisAngle(UP, right.y * s.turnRate * lift * dt));
    }
    this.quaternion.normalize();

    // --- movement ---
    fwd.copy(FORWARD).applyQuaternion(this.quaternion);
    right.copy(RIGHT).applyQuaternion(this.quaternion);
    this.velocity.copy(fwd).multiplyScalar(this.speed);
    if (!this.onGround) this.velocity.y -= (1 - lift) * MAX_SINK;
    this.position.addScaledVector(this.velocity, dt);
    this.stalled = !this.onGround && lift < 0.9;

    // --- ground and water contact ---
    const terrain = ground.heightAt(this.position.x, this.position.z);
    const onWater = terrain < SEA_LEVEL;
    const floor = Math.max(terrain, SEA_LEVEL) + s.gearHeight;
    const sinks = onWater && !s.floats;
    if (this.position.y <= floor || (this.onGround && this.velocity.y < LIFTOFF_CLIMB)) {
      // Below the surface, or rolling along it (also downhill): stay on it.
      this.position.y = floor;
      if (!this.onGround) {
        const hardLanding = -this.velocity.y > CRASH_SINK;
        const wingFirst = Math.abs(right.y) > CRASH_BANK;
        const noseFirst = fwd.y < CRASH_NOSE_DOWN;
        const hillside = !onWater && slopeAt(ground, this.position.x, this.position.z) > CRASH_SLOPE;
        if (sinks || hardLanding || wingFirst || noseFirst || hillside) return this.crash(events, sinks ? 'splash' : 'crash');
        this.onGround = true;
        this.stalled = false;
        this.lastTouchdown.sink = Math.max(0, -this.velocity.y);
        this.lastTouchdown.bank = -right.y;
        events.push('touchdown');
      } else if (sinks) {
        return this.crash(events, 'splash'); // rolled off the runway into the sea
      }
      // Wheels on the ground: wings level and the nose no lower than the horizon.
      const heading = Math.atan2(-fwd.x, -fwd.z);
      const pitch = Math.max(0, Math.asin(MathUtils.clamp(fwd.y, -1, 1)));
      this.quaternion.setFromEuler(tmpEuler.set(pitch, heading, 0));
    } else if (this.onGround) {
      this.onGround = false;
      events.push('takeoff');
    }

    return events;
  }

  private crash(events: FlightEvent[], kind: 'crash' | 'splash'): FlightEvent[] {
    this.crashed = true;
    this.speed = 0;
    this.velocity.set(0, 0, 0);
    events.push(kind);
    return events;
  }
}

/** Steepness of the ground (rise over run) around a point. */
function slopeAt(ground: Ground, x: number, z: number): number {
  const d = 3;
  const dx = ground.heightAt(x + d, z) - ground.heightAt(x - d, z);
  const dz = ground.heightAt(x, z + d) - ground.heightAt(x, z - d);
  return Math.hypot(dx, dz) / (2 * d);
}
