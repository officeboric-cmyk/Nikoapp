import type { FlightModel } from '../physics/FlightModel';
import type { AircraftModel, AircraftType } from './catalog';

/** The visible plane: follows the flight model and spins its propellers with the throttle. */
export class Aircraft {
  private readonly model: AircraftModel;

  constructor(readonly type: AircraftType) {
    this.model = type.build();
  }

  get object() {
    return this.model.object;
  }

  update(flight: FlightModel, dt: number): void {
    this.object.position.copy(flight.position);
    this.object.quaternion.copy(flight.quaternion);
    if (flight.crashed) return;
    for (const prop of this.model.propellers) prop.rotation.z += (4 + flight.throttle * 40) * dt;
  }
}
