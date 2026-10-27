import { MathUtils, Vector3 } from 'three';
import type { Controls } from '../core/Input';
import type { FlightModel, Ground } from '../physics/FlightModel';

/**
 * The autopilot: holds the height, the heading and the speed (working the gas itself), or flies
 * towards a target when there is one. It climbs over hills in its way, and lets go as soon as the
 * pilot moves the stick or the gas, as a real one does.
 */

const MAX_BANK = MathUtils.degToRad(25); // turns gently
const TURN_GAIN = 1.4; // bank per radian off the wanted heading
const BANK_GAIN = 2.2; // stick per radian off the wanted bank
const BANK_DAMP = 0.5; // ...less stick while the bank is already changing (stops the wings rocking)
const CLIMB_GAIN = 0.12; // m/s of climb per metre below the wanted height
const MAX_CLIMB = 0.1; // fastest climb or descent, as a share of the speed
const PITCH_GAIN = 0.05; // stick per m/s off the wanted climb
const PITCH_TRIM = 0.04; // stick added per m/s · s the climb has stayed off (finds the trim)
const SPEED_GAIN = 0.05; // throttle per m/s off the wanted speed
const SPEED_TRIM = 0.02; // throttle added per m/s · s the speed has stayed off
const CLEARANCE = 150; // m kept above the hills ahead
const LOOK_AHEAD = 90; // s of flight ahead checked for hills (time enough to climb over them)
const ARRIVED = 700; // m from the target: there, it holds its heading and hands back
const TAKE_OVER = 0.25; // stick movement that switches it off
const MIN_HEIGHT = 60; // m above the ground needed to switch it on

export type AutopilotRefusal = 'ground' | 'low' | 'stall' | 'engine';

export class Autopilot {
  engaged = false;
  /** Set once when it reaches its target, so the game can say so. */
  arrived = false;
  private height = 0;
  private heading = 0;
  private speed = 0;
  private pitchTrim = 0;
  private throttle = 0;
  private lastBank = 0;
  private lastThrottleSet: number | undefined;
  private goingToTarget = false;

  /** Switches on, keeping the height, heading and speed of the moment. Returns why not, if it can't. */
  engage(model: FlightModel, heightAboveGround: number): AutopilotRefusal | null {
    if (model.onGround) return 'ground';
    if (heightAboveGround < MIN_HEIGHT) return 'low';
    if (model.stalled) return 'stall';
    if (!model.engineRunning) return 'engine';
    this.engaged = true;
    this.arrived = false;
    this.goingToTarget = false;
    this.height = model.position.y;
    this.heading = trackOf(model);
    this.speed = Math.max(model.speed, model.currentStallSpeed * 1.5);
    this.pitchTrim = 0;
    this.throttle = model.throttle;
    this.lastBank = bankOf(model);
    this.lastThrottleSet = undefined; // the touch gas lever's position is noted on the first step
    return null;
  }

  disengage(): void {
    this.engaged = false;
  }

  /** True when the pilot's own stick or gas moved: the autopilot should let go. */
  pilotTookOver(pilot: Controls): boolean {
    const touched = pilot.throttleSet !== undefined && this.lastThrottleSet !== undefined && Math.abs(pilot.throttleSet - this.lastThrottleSet) > 0.05;
    return Math.abs(pilot.pitch) > TAKE_OVER || Math.abs(pilot.roll) > TAKE_OVER || pilot.throttle !== 0 || touched;
  }

  /** The stick and gas for this step. `target`, if given, is where to fly to. */
  fly(model: FlightModel, pilot: Controls, dt: number, ground: Ground, target: { x: number; z: number } | null): Controls {
    // Heading: towards the target until close to it, then straight on.
    if (target) {
      const dx = target.x - model.position.x;
      const dz = target.z - model.position.z;
      if (Math.hypot(dx, dz) > ARRIVED) {
        this.heading = Math.atan2(-dx, -dz);
        this.goingToTarget = true;
      } else if (this.goingToTarget) {
        this.goingToTarget = false;
        this.arrived = true;
      }
    }
    const turn = wrap(this.heading - trackOf(model)); // + = the wanted heading is to the left
    const wantBank = MathUtils.clamp(-turn * TURN_GAIN, -MAX_BANK, MAX_BANK);
    const bank = bankOf(model);
    const rolling = (bank - this.lastBank) / dt;
    this.lastBank = bank;
    const roll = MathUtils.clamp((wantBank - bank) * BANK_GAIN - rolling * BANK_DAMP, -1, 1);

    // Height: never closer than CLEARANCE to the hills ahead.
    const height = Math.max(this.height, this.safeHeight(model, ground));
    const maxClimb = MAX_CLIMB * model.speed;
    const wantClimb = MathUtils.clamp((height - model.position.y) * CLIMB_GAIN, -maxClimb, maxClimb);
    const climbError = wantClimb - model.velocity.y;
    this.pitchTrim = MathUtils.clamp(this.pitchTrim + climbError * PITCH_TRIM * dt, -0.5, 0.5);
    // A banked wing lifts less, so pull a little in turns.
    const turnPull = (1 / Math.max(Math.cos(bank), 0.5) - 1) * 0.6;
    const pitch = MathUtils.clamp(climbError * PITCH_GAIN + this.pitchTrim + turnPull, -0.7, 0.7);

    // Speed: the gas.
    const speedError = this.speed - model.speed;
    this.throttle = MathUtils.clamp(this.throttle + speedError * SPEED_TRIM * dt, 0, 1);
    const throttleSet = MathUtils.clamp(this.throttle + speedError * SPEED_GAIN, 0, 1);

    this.lastThrottleSet = pilot.throttleSet;
    return { pitch, roll, yaw: pilot.yaw, throttle: 0, throttleSet, brake: false };
  }

  /** The height that keeps CLEARANCE over the ground along the next LOOK_AHEAD seconds of the flight path. */
  private safeHeight(model: FlightModel, ground: Ground): number {
    const step = new Vector3(model.velocity.x, 0, model.velocity.z).multiplyScalar(LOOK_AHEAD / 24);
    let highest = -Infinity;
    for (let k = 0; k <= 24; k++) {
      highest = Math.max(highest, ground.heightAt(model.position.x + step.x * k, model.position.z + step.z * k));
    }
    return Math.max(highest, 0) + CLEARANCE;
  }
}

/** The direction the plane is moving over the ground (FlightModel convention: 0 = -Z, + = towards -X). */
function trackOf(model: FlightModel): number {
  const v = model.velocity;
  if (Math.hypot(v.x, v.z) < 1) {
    const nose = new Vector3(0, 0, -1).applyQuaternion(model.quaternion);
    return Math.atan2(-nose.x, -nose.z);
  }
  return Math.atan2(-v.x, -v.z);
}

/** Bank angle, + = right wing down. */
function bankOf(model: FlightModel): number {
  const right = new Vector3(1, 0, 0).applyQuaternion(model.quaternion);
  const up = new Vector3(0, 1, 0).applyQuaternion(model.quaternion);
  return Math.atan2(-right.y, up.y);
}

function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
