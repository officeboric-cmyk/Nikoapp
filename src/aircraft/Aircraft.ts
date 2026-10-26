import type { FlightModel } from '../physics/FlightModel';
import type { Airline } from './airlines';
import type { AircraftModel, AircraftType } from './catalog';

/** The visible plane: follows the flight model and spins its propellers with the throttle. */
export class Aircraft {
  private readonly model: AircraftModel;

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
    // Folding the wheels: squash the gear up towards the fuselage, then hide it.
    const gear = this.model.gear;
    gear.scale.y = Math.max(flight.gear, 0.05);
    gear.visible = flight.gear > 0.05;
    if (flight.crashed) return;
    for (const prop of this.model.propellers) prop.rotation.z += (4 + flight.throttle * 40) * dt;
  }
}
