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
}

export const TRAINER: AircraftSpec = {
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
};

export type FlightEvent = 'takeoff' | 'touchdown' | 'crash';

const GRAVITY_ALONG_PATH = 9.81 * 0.6; // softened: climbing slows you, diving speeds you up
const MAX_SINK = 12; // m/s sink rate when fully stalled
const THROTTLE_RATE = 0.5; // throttle change per second while a key is held
const ROLLING_FRICTION = 0.5; // m/s²
const BRAKE_DECEL = 6; // m/s²
const AUTO_LEVEL_ROLL = 1.5;
const AUTO_LEVEL_PITCH = 0.8;
const STALL_NOSE_DROP = 1.5;
const MAX_BANK = MathUtils.degToRad(60); // no rolling upside down
const MAX_PITCH = MathUtils.degToRad(45); // no loops
const CRASH_SINK = 7; // m/s vertical speed a touchdown can survive
const CRASH_BANK = 0.5; // sin of the bank angle a touchdown can survive (~30°)
const CRASH_NOSE_DOWN = -0.3; // sin of the pitch angle a touchdown can survive

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

  constructor(readonly spec: AircraftSpec = TRAINER) {}

  /** Puts the plane on the ground at `position`, nose pointing along `heading` (radians, 0 = -Z). */
  reset(position: Vector3, heading: number): void {
    this.position.copy(position);
    this.position.y = this.spec.gearHeight;
    this.quaternion.setFromEuler(tmpEuler.set(0, heading, 0));
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.throttle = 0;
    this.onGround = true;
    this.stalled = false;
    this.crashed = false;
  }

  /** Advances the simulation by `dt` seconds and returns what happened during the step. */
  step(dt: number, c: Controls): FlightEvent[] {
    const events: FlightEvent[] = [];
    if (this.crashed) return events;
    const s = this.spec;

    fwd.copy(FORWARD).applyQuaternion(this.quaternion);
    right.copy(RIGHT).applyQuaternion(this.quaternion);

    this.throttle = MathUtils.clamp(this.throttle + c.throttle * THROTTLE_RATE * dt, 0, 1);

    // 0 = no lift at all, 1 = wings fully flying.
    const lift = MathUtils.smoothstep(this.speed, s.stallSpeed * 0.6, s.stallSpeed);

    // --- speed along the nose ---
    const drag = s.maxThrust / (s.maxSpeed * s.maxSpeed);
    let accel = this.throttle * s.maxThrust - drag * this.speed * this.speed - GRAVITY_ALONG_PATH * fwd.y;
    if (this.onGround) accel -= ROLLING_FRICTION + (c.brake ? BRAKE_DECEL : 0);
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

    // --- ground contact ---
    const floor = s.gearHeight;
    if (this.position.y <= floor) {
      if (!this.onGround) {
        const hardLanding = -this.velocity.y > CRASH_SINK;
        const wingFirst = Math.abs(right.y) > CRASH_BANK;
        const noseFirst = fwd.y < CRASH_NOSE_DOWN;
        if (hardLanding || wingFirst || noseFirst) {
          this.position.y = floor;
          this.crashed = true;
          this.speed = 0;
          this.velocity.set(0, 0, 0);
          events.push('crash');
          return events;
        }
        this.onGround = true;
        this.stalled = false;
        events.push('touchdown');
      }
      this.position.y = floor;
      // Wheels on the runway: wings level and the nose no lower than the horizon.
      const heading = Math.atan2(-fwd.x, -fwd.z);
      const pitch = Math.max(0, Math.asin(MathUtils.clamp(fwd.y, -1, 1)));
      this.quaternion.setFromEuler(tmpEuler.set(pitch, heading, 0));
    } else if (this.onGround) {
      this.onGround = false;
      events.push('takeoff');
    }

    return events;
  }
}
