import { Euler, MathUtils, Scene, Vector3 } from 'three';
import { airlineById } from '../aircraft/airlines';
import { AIRCRAFT, spinPropellers, type AircraftModel } from '../aircraft/catalog';
import type { Airport } from './Airport';
import type { Terrain } from './Terrain';

/**
 * Other planes flying between the airports, so the sky isn't empty. They follow a loop
 * of airports, cruising high and dipping into a low pass over each one. They are only
 * scenery: the player can't bump into them.
 */

interface RouteDef {
  aircraft: string; // id from the catalog
  airline?: string; // id from airlines.ts, for the passenger planes
  airports: string[];
  speed: number; // m/s
  cruise: number; // m above sea level between airports
  turnRate: number; // rad/s
}

const ROUTES: RouteDef[] = [
  { aircraft: 'airliner', airline: 'niko', airports: ['Sunčani otok', 'Dugi otok', 'Zeleni otok'], speed: 75, cruise: 700, turnRate: 0.12 },
  { aircraft: 'airliner', airline: 'jadran', airports: ['Planinski otok', 'Sunčani otok', 'Pješčani otok', 'Borov otok'], speed: 75, cruise: 780, turnRate: 0.12 },
  { aircraft: 'airliner', airline: 'galeb', airports: ['Zeleni otok', 'Pješčani otok', 'Dugi otok'], speed: 72, cruise: 650, turnRate: 0.12 },
  { aircraft: 'airliner', airline: 'otok', airports: ['Borov otok', 'Planinski otok', 'Zeleni otok', 'Dugi otok'], speed: 78, cruise: 820, turnRate: 0.12 },
  { aircraft: 'trainer', airports: ['Sunčani otok', 'Borov otok'], speed: 45, cruise: 380, turnRate: 0.25 },
  { aircraft: 'seaplane', airports: ['Pješčani otok', 'Dugi otok'], speed: 42, cruise: 320, turnRate: 0.25 },
];

const PASS_ALTITUDE = 180; // m above the runway when flying over an airport
const DESCENT_TIME = 60; // s before reaching an airport that the low pass begins
const NEXT_WAYPOINT = 500; // m from the airport where it turns towards the next one
const CLEARANCE = 150; // m kept above any hill ahead
const LOOK_AHEAD = 600; // m ahead checked for hills
const CLIMB_RATE = 8; // m/s

const tmpEuler = new Euler(0, 0, 0, 'YXZ');

class Flight {
  readonly position = new Vector3();
  heading = 0; // radians, FlightModel convention (0 = -Z, + = towards -X)
  private bank = 0;
  private pitch = 0;
  private leg = 0;

  constructor(
    readonly def: RouteDef,
    readonly model: AircraftModel,
    readonly route: Airport[],
    start: number, // 0..1, how far along the first leg it begins
  ) {
    const from = route[0].center;
    const to = route[1].center;
    this.position.lerpVectors(from, to, start).setY(def.cruise);
    this.leg = 1;
    this.heading = Math.atan2(-(to.x - from.x), -(to.z - from.z));
  }

  update(dt: number, terrain: Terrain): void {
    const { def } = this;
    const target = this.route[this.leg].center;
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < NEXT_WAYPOINT) this.leg = (this.leg + 1) % this.route.length;

    // Turn towards the airport, banking into the turn.
    const wanted = Math.atan2(-dx, -dz);
    const turn = Math.atan2(Math.sin(wanted - this.heading), Math.cos(wanted - this.heading));
    this.heading += MathUtils.clamp(turn, -def.turnRate * dt, def.turnRate * dt);
    this.bank = MathUtils.damp(this.bank, MathUtils.clamp(-turn * 1.5, -0.45, 0.45), 2, dt);

    // Cruise high, come down for a low pass over the airport, and always clear the hills ahead.
    const low = target.y + PASS_ALTITUDE;
    const descentStart = def.speed * DESCENT_TIME;
    let altitude = MathUtils.lerp(low, def.cruise, MathUtils.smoothstep(distance, NEXT_WAYPOINT, descentStart));
    const aheadX = this.position.x - Math.sin(this.heading) * LOOK_AHEAD;
    const aheadZ = this.position.z - Math.cos(this.heading) * LOOK_AHEAD;
    const ground = Math.max(terrain.heightAt(this.position.x, this.position.z), terrain.heightAt(aheadX, aheadZ));
    altitude = Math.max(altitude, ground + CLEARANCE);
    const climb = MathUtils.clamp(altitude - this.position.y, -CLIMB_RATE * dt, CLIMB_RATE * dt);
    this.position.y += climb;
    this.pitch = MathUtils.damp(this.pitch, Math.atan2(climb / dt, def.speed), 2, dt);

    this.position.x -= Math.sin(this.heading) * def.speed * dt;
    this.position.z -= Math.cos(this.heading) * def.speed * dt;

    const object = this.model.object;
    object.position.copy(this.position);
    object.quaternion.setFromEuler(tmpEuler.set(this.pitch, this.heading, -this.bank));
    spinPropellers(this.model.propellers, 30, dt);
  }
}

export class Traffic {
  readonly flights: Flight[] = [];

  constructor(
    scene: Scene,
    private readonly terrain: Terrain,
  ) {
    ROUTES.forEach((def, i) => {
      const type = AIRCRAFT.find((a) => a.id === def.aircraft)!;
      const model = type.build(def.airline ? airlineById(def.airline) : undefined, true);
      if (type.spec.retractableGear) model.gear.visible = false; // always flying, so the wheels are tucked away
      const route = def.airports.map((name) => terrain.airports.find((a) => a.name === name)!);
      // Spread them out so they aren't all leaving the same airport at once.
      const flight = new Flight(def, model, route, 0.2 + ((i * 0.37) % 0.6));
      scene.add(model.object);
      this.flights.push(flight);
    });
  }

  update(dt: number): void {
    if (dt <= 0) return;
    for (const flight of this.flights) flight.update(dt, this.terrain);
  }

  get positions(): Vector3[] {
    return this.flights.map((f) => f.position);
  }
}
