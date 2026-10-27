import { MathUtils } from 'three';
import type { FlightModel } from '../physics/FlightModel';
import type { Airline } from './airlines';
import { spinPropellers, type AircraftModel, type AircraftType } from './catalog';

// Full deflection of each control surface, radians.
const AILERON = 0.35;
const ELEVATOR = 0.35;
const RUDDER = 0.4;
const FLAPS = 0.6;
const SURFACE_SPEED = 12; // how quickly the surfaces follow the stick (higher = snappier)

// The wheels' springs: a stiff, well-damped bounce that settles in about half a second.
const SPRING = 300;
const DAMPING = 14;
const IMPACT = 1.8; // spring speed (m/s) per m/s of sink when the wheels touch down
const BUMPS = 0.025; // m, runway bumps while rolling fast
const MAX_SQUASH = 0.35; // m

/** The visible plane: follows the flight model, moves its control surfaces, bounces on its wheels and spins its propellers. */
export class Aircraft {
  private readonly model: AircraftModel;
  private readonly shown = { pitch: 0, roll: 0, yaw: 0, flaps: 0 };
  private squash = 0; // m the body sits lower on its springs than the flight model says
  private squashSpeed = 0;
  private wasOnGround = true;
  private rolled = 0; // m rolled along the ground, for the bumps

  constructor(
    readonly type: AircraftType,
    readonly airline?: Airline,
  ) {
    this.model = type.build(airline);
  }

  get object() {
    return this.model.object;
  }

  update(flight: FlightModel, dt: number): void {
    this.object.position.copy(flight.position);
    this.object.quaternion.copy(flight.quaternion);
    this.updateSuspension(flight, dt);
    // Folding the wheels: squash the gear up towards the fuselage, then hide it.
    const gear = this.model.gear;
    gear.scale.y = Math.max(flight.gear, 0.05);
    gear.visible = flight.gear > 0.05;
    if (flight.crashed) return;
    this.updateSurfaces(flight, dt);
    spinPropellers(this.model.propellers, 4 + flight.throttle * 40, dt);
  }

  private updateSurfaces(flight: FlightModel, dt: number): void {
    const shown = this.shown;
    shown.pitch = MathUtils.damp(shown.pitch, flight.surfaces.pitch, SURFACE_SPEED, dt);
    shown.roll = MathUtils.damp(shown.roll, flight.surfaces.roll, SURFACE_SPEED, dt);
    shown.yaw = MathUtils.damp(shown.yaw, flight.surfaces.yaw, SURFACE_SPEED, dt);
    shown.flaps = flight.flaps; // the flight model already moves the flaps slowly
    const s = this.model.surfaces;
    // Trailing edges: elevator up lifts the nose; right aileron up and left down rolls right.
    for (const elevator of s.elevators) elevator.rotation.x = -clamp(shown.pitch) * ELEVATOR;
    for (const aileron of s.ailerons.right) aileron.rotation.x = -clamp(shown.roll) * AILERON;
    for (const aileron of s.ailerons.left) aileron.rotation.x = clamp(shown.roll) * AILERON;
    for (const rudder of s.rudders) rudder.rotation.y = clamp(shown.yaw) * RUDDER;
    for (const flap of s.flaps) flap.rotation.x = shown.flaps * FLAPS;
  }

  /** The body dips on its springs when the wheels touch down and jiggles over the runway; the wheels stay put. */
  private updateSuspension(flight: FlightModel, dt: number): void {
    if (flight.onGround && !this.wasOnGround) this.squashSpeed += flight.lastTouchdown.sink * IMPACT;
    this.wasOnGround = flight.onGround;
    let push = 0;
    if (flight.onGround && !flight.crashed) {
      this.rolled += flight.speed * dt;
      push = BUMPS * Math.min(flight.speed / 30, 1) * Math.sin(this.rolled * 1.7) * Math.sin(this.rolled * 0.43);
    }
    this.squashSpeed += (-SPRING * this.squash - DAMPING * this.squashSpeed + push * SPRING) * dt;
    this.squash = MathUtils.clamp(this.squash + this.squashSpeed * dt, -MAX_SQUASH * 0.3, MAX_SQUASH);
    this.object.translateY(-this.squash);
    this.model.gear.position.y = this.squash;
  }
}

function clamp(v: number): number {
  return MathUtils.clamp(v, -1, 1);
}
