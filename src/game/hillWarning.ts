import { Vector3 } from 'three';
import { SEA_LEVEL, type FlightModel, type Ground } from '../physics/FlightModel';

const LOOK_AHEAD = [3, 6, 10]; // s of flight ahead checked for hills (so faster planes look further)
const MIN_SPEED = 50; // m/s used for slower planes, so they still look at least 150 / 300 / 500 m ahead
const MARGIN = 25; // m, warn when the ground ahead comes this close to the wheels
const RISE = 15; // m, only warn about ground that rises ahead (not a runway you're landing on)

const ahead = new Vector3();

/** True when rising ground ahead is about as high as the plane, so the player should pull up. */
export function hillAhead(model: FlightModel, ground: Ground): boolean {
  if (model.onGround || model.crashed) return false;
  ahead.set(0, 0, -1).applyQuaternion(model.quaternion).setY(0).normalize();
  const wheels = model.position.y - model.spec.gearHeight;
  const below = Math.max(ground.heightAt(model.position.x, model.position.z), SEA_LEVEL);
  const speed = Math.max(model.speed, MIN_SPEED);
  return LOOK_AHEAD.some((seconds) => {
    const d = seconds * speed;
    const h = ground.heightAt(model.position.x + ahead.x * d, model.position.z + ahead.z * d);
    return h > below + RISE && h + MARGIN > wheels;
  });
}
