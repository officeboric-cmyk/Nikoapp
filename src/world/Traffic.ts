import { Euler, MathUtils, Scene, Vector3 } from 'three';
import { airlineById } from '../aircraft/airlines';
import { AIRCRAFT, spinPropellers, type AircraftModel } from '../aircraft/catalog';
import { planeRadius, type Obstacle } from '../game/collisions';
import { passesNear, type Shootable, type Strike } from '../game/Gun';
import { SEA_LEVEL } from '../physics/FlightModel';
import type { Airport } from './Airport';
import type { Effects } from './Effects';
import { Parachutes } from './Parachutes';
import type { Terrain } from './Terrain';

/**
 * Other planes flying between the airports, so the sky isn't empty. They follow a loop
 * of airports, cruising high and dipping into a low pass over each one. The player can
 * bump into them (see game/collisions.ts), and a fighter's gun can bring them down: smoking,
 * they spiral down while the crew jump out on parachutes, and a while later another one
 * takes their place.
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
const KNOCKED_OUT = 12; // s a plane the player flew into stays away before flying on
const REPLACED_AFTER = 45; // s after a crash before another plane flies the route
/** Hits each kind of plane takes before it goes down, and how many jump out on parachutes. */
const TOUGHNESS: Record<string, { hits: number; crew: number }> = {
  trainer: { hits: 5, crew: 1 },
  seaplane: { hits: 6, crew: 2 },
  airliner: { hits: 12, crew: 5 },
};
const SMOKE_EVERY = 0.06; // s between puffs of smoke behind a falling plane

class Flight {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  readonly obstacle: Obstacle;
  /** After a bump or a crash, s until it shows up again. */
  away = 0;
  /** Hits it can still take. */
  health: number;
  /** Shot down and falling. */
  falling = false;
  private spin = 0;
  private smoke = 0;
  heading = 0; // radians, FlightModel convention (0 = -Z, + = towards -X)
  private bank = 0;
  private pitch = 0;
  private leg = 0;

  constructor(
    readonly def: RouteDef,
    readonly model: AircraftModel,
    readonly route: Airport[],
    start: number, // 0..1, how far along the first leg it begins
    wingspan: number,
  ) {
    this.obstacle = { position: this.position, radius: planeRadius(wingspan), velocity: this.velocity };
    this.health = TOUGHNESS[def.aircraft].hits;
    const from = route[0].center;
    const to = route[1].center;
    this.position.lerpVectors(from, to, start).setY(def.cruise);
    this.leg = 1;
    this.heading = Math.atan2(-(to.x - from.x), -(to.z - from.z));
  }

  /** Hit by the gun: brought down when it has taken enough. Returns true if that hit brought it down. */
  hit(): boolean {
    if (this.falling || --this.health > 0) return false;
    this.falling = true;
    this.spin = (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random() * 0.6);
    return true;
  }

  /** Falls, trailing smoke and spinning; returns true on hitting the ground or the sea. */
  private fall(dt: number, terrain: Terrain, effects: Effects): boolean {
    this.velocity.x *= Math.exp(-0.15 * dt);
    this.velocity.z *= Math.exp(-0.15 * dt);
    this.velocity.y -= 9.81 * 0.7 * dt;
    this.position.addScaledVector(this.velocity, dt);
    this.bank += this.spin * dt;
    this.pitch = MathUtils.damp(this.pitch, Math.atan2(this.velocity.y, Math.hypot(this.velocity.x, this.velocity.z)), 1.5, dt);
    this.smoke -= dt;
    if (this.smoke <= 0) {
      this.smoke = SMOKE_EVERY;
      effects.emit('crash', this.position, new Vector3(0, 2, 0), 1.5);
      if (Math.random() < 0.5) effects.emit('flame', this.position, new Vector3(0, 1, 0), 1);
    }
    const object = this.model.object;
    object.position.copy(this.position);
    object.quaternion.setFromEuler(tmpEuler.set(this.pitch, this.heading, -this.bank));
    const floor = terrain.heightAt(this.position.x, this.position.z);
    return this.position.y < Math.max(floor, SEA_LEVEL) + 2;
  }

  /** After a crash: another plane takes over the route, from its next airport, out of sight for a while. */
  replace(): void {
    this.falling = false;
    this.health = TOUGHNESS[this.def.aircraft].hits;
    this.away = REPLACED_AFTER;
    this.bank = this.pitch = 0;
    const from = this.route[this.leg].center;
    this.leg = (this.leg + 1) % this.route.length;
    const to = this.route[this.leg].center;
    this.position.set(from.x, this.def.cruise, from.z);
    this.heading = Math.atan2(-(to.x - from.x), -(to.z - from.z));
  }

  /** Moves on along the route, or falls if shot down. Returns where it crashed, if it did just now. */
  update(dt: number, terrain: Terrain, effects: Effects): Vector3 | null {
    if (this.falling) {
      if (!this.fall(dt, terrain, effects)) return null;
      const crashed = this.position.clone();
      const sea = terrain.heightAt(crashed.x, crashed.z) < SEA_LEVEL;
      effects.burst(sea ? 'spray' : 'crash', crashed, 40, new Vector3(0, sea ? 14 : 4, 0), 8);
      effects.burst('flame', crashed, sea ? 6 : 24, new Vector3(0, 3, 0), 5);
      this.model.object.visible = false;
      this.replace();
      return crashed;
    }
    const { def } = this;
    this.away = Math.max(0, this.away - dt);
    this.model.object.visible = this.away === 0;
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

    this.velocity.set(-Math.sin(this.heading) * def.speed, climb / dt, -Math.cos(this.heading) * def.speed);
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    const object = this.model.object;
    object.position.copy(this.position);
    object.quaternion.setFromEuler(tmpEuler.set(this.pitch, this.heading, -this.bank));
    spinPropellers(this.model.propellers, 30, dt);
    return null;
  }
}

export class Traffic implements Shootable {
  readonly flights: Flight[] = [];
  /** Where shot-down planes hit the ground since the game last looked (for the sound). */
  readonly crashes: Vector3[] = [];
  private readonly parachutes: Parachutes;

  constructor(
    scene: Scene,
    private readonly terrain: Terrain,
    private readonly effects: Effects,
  ) {
    this.parachutes = new Parachutes(scene, terrain);
    ROUTES.forEach((def, i) => {
      const type = AIRCRAFT.find((a) => a.id === def.aircraft)!;
      const model = type.build(def.airline ? airlineById(def.airline) : undefined, true);
      if (type.spec.retractableGear) model.gear.visible = false; // always flying, so the wheels are tucked away
      const route = def.airports.map((name) => terrain.airports.find((a) => a.name === name)!);
      // Spread them out so they aren't all leaving the same airport at once.
      const flight = new Flight(def, model, route, 0.2 + ((i * 0.37) % 0.6), type.spec.wingspan);
      scene.add(model.object);
      this.flights.push(flight);
    });
  }

  update(dt: number): void {
    if (dt <= 0) return;
    for (const flight of this.flights) {
      const crashed = flight.update(dt, this.terrain, this.effects);
      if (crashed) this.crashes.push(crashed);
    }
    this.parachutes.update(dt);
  }

  get positions(): Vector3[] {
    return this.flights.filter((f) => f.away === 0).map((f) => f.position);
  }

  /** The planes in the air that can be bumped into right now (not those already falling). */
  get obstacles(): Obstacle[] {
    return this.flights.filter((f) => f.away === 0 && !f.falling).map((f) => f.obstacle);
  }

  /** A round hitting a plane: sparks and smoke, and enough of them bring it down. */
  strike(a: Vector3, b: Vector3): Strike | null {
    const flight = this.flights.find((f) => f.away === 0 && !f.falling && passesNear(a, b, f.position, f.obstacle.radius * 1.1));
    if (!flight) return null;
    this.effects.emit('smoke', flight.position, flight.velocity.clone().multiplyScalar(0.5), 2);
    const down = flight.hit();
    if (down) {
      this.parachutes.jump(flight.position, flight.velocity, TOUGHNESS[flight.def.aircraft].crew);
      this.effects.burst('flame', flight.position, 12, flight.velocity.clone().multiplyScalar(0.6), 4);
    }
    return { kind: 'plane', down };
  }

  /** The plane the player flew into goes away for a while (as if it went off to land). */
  knockOut(obstacle: Obstacle): void {
    const flight = this.flights.find((f) => f.obstacle === obstacle);
    if (flight) flight.away = KNOCKED_OUT;
  }
}
