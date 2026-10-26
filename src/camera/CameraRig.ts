import { PerspectiveCamera, Vector3 } from 'three';
import { SEA_LEVEL, type FlightModel, type Ground } from '../physics/FlightModel';

export type CameraMode = 'chase' | 'cockpit' | 'side';

export const CAMERA_NAMES: Record<CameraMode, string> = {
  chase: 'iza aviona',
  cockpit: 'iz kokpita (FPV)',
  side: 'sa strane',
};

const MODES: CameraMode[] = ['chase', 'cockpit', 'side'];
const LOOK_AHEAD = 10; // m in front of the plane
const STIFFNESS = 4; // higher = camera follows more tightly
const MIN_CLEARANCE = 2; // m, never dip into hills or the sea
const NEAR = { outside: 0.5, cockpit: 0.15 }; // m, the cockpit view needs a closer near plane
const FOV = { outside: 65, cockpit: 75 }; // degrees, a wider view from the cockpit

const forward = new Vector3();
const flatForward = new Vector3();
const flatRight = new Vector3();
const desired = new Vector3();
const target = new Vector3();

/**
 * The player's camera, in one of three modes:
 * - chase: trails the plane with the horizon kept level (easiest for young players)
 * - cockpit: the pilot's eyes, turning and banking with the plane (FPV)
 * - side: a film-style view from beside the plane
 */
export class CameraRig {
  mode: CameraMode = 'chase';
  distance = 13; // m behind the plane (chase) or beside it (side)
  height = 4; // m above the plane
  readonly cockpit = new Vector3(0, 1, 0); // pilot's eye, in the plane's own frame

  constructor(
    readonly camera: PerspectiveCamera,
    private readonly ground: Ground,
  ) {}

  /** Switches to the next view and returns it. */
  cycle(model: FlightModel): CameraMode {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    this.snap(model);
    return this.mode;
  }

  /** Jumps straight to the view's position (on start, respawn and when switching views). */
  snap(model: FlightModel): void {
    const lens = this.mode === 'cockpit' ? 'cockpit' : 'outside';
    if (this.camera.near !== NEAR[lens] || this.camera.fov !== FOV[lens]) {
      this.camera.near = NEAR[lens];
      this.camera.fov = FOV[lens];
      this.camera.updateProjectionMatrix();
    }
    this.place(model, 1);
  }

  update(model: FlightModel, dt: number): void {
    this.place(model, 1 - Math.exp(-STIFFNESS * dt));
  }

  /** Moves the camera `blend` of the way (0..1) towards where the current mode wants it. */
  private place(model: FlightModel, blend: number): void {
    const cam = this.camera;
    if (this.mode === 'cockpit') {
      // Rigidly fixed to the plane, so the world tilts when it banks, like real FPV.
      cam.position.copy(this.cockpit).applyQuaternion(model.quaternion).add(model.position);
      cam.quaternion.copy(model.quaternion);
      return;
    }

    forward.set(0, 0, -1).applyQuaternion(model.quaternion);
    flatForward.set(forward.x, 0, forward.z);
    if (flatForward.lengthSq() < 1e-6) flatForward.set(0, 0, -1);
    flatForward.normalize();

    if (this.mode === 'chase') {
      target.copy(model.position).addScaledVector(forward, LOOK_AHEAD + this.distance * 0.3);
      desired.copy(model.position).addScaledVector(flatForward, -this.distance);
      desired.y += this.height;
    } else {
      // Off the right wing and a little ahead, looking back at the plane.
      flatRight.set(-flatForward.z, 0, flatForward.x);
      target.copy(model.position);
      desired.copy(model.position).addScaledVector(flatRight, this.distance * 1.1).addScaledVector(flatForward, this.distance * 0.4);
      desired.y += this.height * 0.5;
    }

    cam.position.lerp(desired, blend);
    const surface = Math.max(this.ground.heightAt(cam.position.x, cam.position.z), SEA_LEVEL);
    cam.position.y = Math.max(cam.position.y, surface + MIN_CLEARANCE);
    cam.lookAt(target);
  }
}
