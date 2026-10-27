import { MathUtils, Vector3 } from 'three';
import type { FlightModel } from '../physics/FlightModel';
import type { Stats } from './Progress';

/**
 * Watches the flight for records (height, speed, distance) and for tricks: a loop (the nose
 * goes all the way round, up over the top) and a roll (the plane turns all the way round
 * its own length).
 */

const LOOP = MathUtils.degToRad(330); // a little short of a full circle still counts
const ROLL = MathUtils.degToRad(340);
const UP = new Vector3(0, 1, 0);

const nose = new Vector3();
const wing = new Vector3();
const top = new Vector3();

export type Trick = 'loop' | 'roll';

export class FlightLog {
  private loopSide: Vector3 | null = null; // the wing's direction when the loop began (its axis)
  private loopAngle = 0;
  private lastElevation = 0;
  private rollAngle = 0;
  private lastBank = 0;

  /** Starts over (after a respawn). */
  reset(): void {
    this.loopSide = null;
    this.loopAngle = this.rollAngle = 0;
  }

  /** Updates the records in `stats` and returns a trick just completed, if any. */
  update(dt: number, model: FlightModel, stats: Stats): Trick | null {
    if (model.onGround || model.crashed) {
      this.reset();
      return null;
    }
    stats.maxAltitude = Math.max(stats.maxAltitude, model.position.y - model.spec.gearHeight);
    stats.maxSpeed = Math.max(stats.maxSpeed, model.speed * 3.6);
    stats.distance += (Math.hypot(model.velocity.x, model.velocity.z) * dt) / 1000;

    nose.set(0, 0, -1).applyQuaternion(model.quaternion);
    wing.set(1, 0, 0).applyQuaternion(model.quaternion);
    top.set(0, 1, 0).applyQuaternion(model.quaternion);

    // Loop: the nose turning round in the upright plane it started in.
    if (!this.loopSide || Math.abs(nose.dot(this.loopSide)) > 0.5) {
      this.loopSide = wing.clone().setY(0).normalize();
      this.loopAngle = 0;
      this.lastElevation = this.elevation();
    } else {
      const elevation = this.elevation();
      this.loopAngle += wrap(elevation - this.lastElevation);
      this.lastElevation = elevation;
      if (Math.abs(this.loopAngle) >= LOOP) {
        this.loopAngle = 0;
        return 'loop';
      }
    }

    // Roll: the bank angle going all the way round, with the nose not too steep.
    const bank = Math.atan2(-wing.y, top.y);
    if (Math.abs(nose.y) < 0.85) {
      this.rollAngle += wrap(bank - this.lastBank);
      if (Math.abs(this.rollAngle) >= ROLL) {
        this.rollAngle = 0;
        this.lastBank = bank;
        return 'roll';
      }
    } else {
      this.rollAngle = 0;
    }
    this.lastBank = bank;
    return null;
  }

  /** The nose's angle round the loop: 0 ahead, 90° straight up, 180° upside down going back. */
  private elevation(): number {
    const ahead = UP.clone().cross(this.loopSide!).normalize();
    return Math.atan2(nose.dot(UP), nose.dot(ahead));
  }
}

/** An angle change brought into -π..π (so passing ±180° doesn't look like a jump). */
function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
