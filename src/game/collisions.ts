import { Vector3 } from 'three';
import type { FlightModel } from '../physics/FlightModel';

/**
 * Bumping into other planes. Each plane is treated as a ball about as wide as its wings,
 * shrunk a little so a hit only counts when the planes really touch on screen.
 */

/** Another plane: where it is, how big, and how it moves (parked planes stand still). */
export interface Obstacle {
  position: Vector3;
  radius: number;
  velocity: Vector3;
}

/** A plane's ball, from its wingspan. */
export function planeRadius(wingspan: number): number {
  return wingspan * 0.4;
}

const TOUCH = 0.8; // share of the two balls' radii that must overlap
const WARN_DISTANCE = 400; // m, how far ahead another plane starts to matter
const WARN_ANGLE = Math.cos((50 * Math.PI) / 180); // within 50° of the nose
const WARN_HEIGHT = 80; // m above or below
const WARN_TIME = 12; // s, only if we'd meet within this long

const toOther = new Vector3();
const closing = new Vector3();
const nose = new Vector3();

/** The plane we just flew into, if any. */
export function collision(model: FlightModel, others: Obstacle[]): Obstacle | null {
  const radius = planeRadius(model.spec.wingspan);
  for (const other of others) {
    if (model.position.distanceTo(other.position) < (radius + other.radius) * TOUCH) return other;
  }
  return null;
}

/** Another plane ahead and coming closer, worth a warning. */
export function planeAhead(model: FlightModel, others: Obstacle[]): Obstacle | null {
  nose.set(0, 0, -1).applyQuaternion(model.quaternion);
  for (const other of others) {
    toOther.copy(other.position).sub(model.position);
    const distance = toOther.length();
    if (distance > WARN_DISTANCE || Math.abs(toOther.y) > WARN_HEIGHT) continue;
    if (toOther.dot(nose) < distance * WARN_ANGLE) continue;
    closing.copy(model.velocity).sub(other.velocity);
    const speed = closing.dot(toOther) / Math.max(distance, 1); // m/s towards it
    if (speed > 0 && distance / speed < WARN_TIME) return other;
  }
  return null;
}
