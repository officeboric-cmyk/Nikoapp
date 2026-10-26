import { PerspectiveCamera, Vector3 } from 'three';
import type { FlightModel } from '../physics/FlightModel';

const DISTANCE = 13; // m behind the plane
const HEIGHT = 4; // m above the plane
const LOOK_AHEAD = 10; // m in front of the plane
const STIFFNESS = 4; // higher = camera follows more tightly
const MIN_HEIGHT = 1.5; // never dip below the ground

const flatForward = new Vector3();
const desired = new Vector3();
const target = new Vector3();

/**
 * Third-person camera that trails the plane. It follows the heading but keeps the
 * horizon level, which is much less disorienting for young players.
 */
export class ChaseCamera {
  constructor(readonly camera: PerspectiveCamera) {}

  /** Jumps straight to the follow position (used on start and respawn). */
  snap(model: FlightModel): void {
    this.computeDesired(model);
    this.camera.position.copy(desired);
    this.camera.lookAt(target);
  }

  update(model: FlightModel, dt: number): void {
    this.computeDesired(model);
    this.camera.position.lerp(desired, 1 - Math.exp(-STIFFNESS * dt));
    this.camera.position.y = Math.max(this.camera.position.y, MIN_HEIGHT);
    this.camera.lookAt(target);
  }

  private computeDesired(model: FlightModel): void {
    flatForward.set(0, 0, -1).applyQuaternion(model.quaternion);
    target.copy(model.position).addScaledVector(flatForward, LOOK_AHEAD);
    flatForward.y = 0;
    if (flatForward.lengthSq() < 1e-6) flatForward.set(0, 0, -1);
    flatForward.normalize();
    desired.copy(model.position).addScaledVector(flatForward, -DISTANCE);
    desired.y += HEIGHT;
  }
}
