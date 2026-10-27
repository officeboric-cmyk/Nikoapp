import { Euler, MathUtils, Quaternion, Vector3 } from 'three';
import type { Controls } from '../core/Input';

/**
 * Flight model with three levels of realism:
 *
 * - arcade: the plane flies exactly where its nose points, levels itself and can't loop.
 * - normal: real forces (thrust, lift from the wing's angle to the air, drag, gravity), so
 *   the plane has momentum, drifts in turns and stalls when the nose is too high, but
 *   it still levels its wings and holds its height when you let go, within limits.
 * - realistic: the same forces with no help at all: no levelling, no limits, loops allowed.
 *
 * Axes: the plane's nose is local -Z, up is +Y, right wing is +X.
 */

export type Realism = 'arcade' | 'normal' | 'realistic';

export interface AircraftSpec {
  maxThrust: number; // m/s² acceleration at full throttle
  maxSpeed: number; // m/s top speed in level flight
  stallSpeed: number; // m/s, slowest the wing can hold the plane up (flaps up)
  rotateSpeed: number; // m/s needed before the nose can lift on the runway
  pitchRate: number; // rad/s
  rollRate: number; // rad/s
  yawRate: number; // rad/s, rudder in the air
  groundSteerRate: number; // rad/s, nose wheel on the runway
  turnRate: number; // rad/s heading change at a 90° bank (arcade only)
  gearHeight: number; // m from the plane's origin down to the wheels
  wingspan: number; // m, sets how close to the ground the cushion of air (ground effect) starts
  maxLoad: number; // g, the most the wings may be loaded: pulling harder than this stops working
  endurance: number; // s a full tank lasts at full throttle (normal and realistic; arcade never runs dry)
  glideRatio: number; // metres forward per metre down, gliding at the best speed with the engine stopped
  propeller: boolean; // a stopped propeller windmills and brakes more than a stopped jet engine
  floats: boolean; // a seaplane: can land on and take off from water
  retractableGear?: boolean; // the wheels can be pulled up in flight
  bellyHeight?: number; // m from the plane's origin down to its belly (a wheels-up landing)
}

/** What the plane can bump into: the ground height in metres, open water wherever it is below SEA_LEVEL. */
export interface Ground {
  heightAt(x: number, z: number): number;
}

export const SEA_LEVEL = 0;
export const FLAT_GROUND: Ground = { heightAt: () => 0 };

export type FlightEvent = 'takeoff' | 'touchdown' | 'belly' | 'crash' | 'splash' | 'collision' | 'engine-out';
export type GearCommand = 'up' | 'down' | 'fixed' | 'on-ground';

export const FLAP_STAGES = [0, 0.5, 1];
/** Tank levels for the "little fuel" and "nearly empty" warnings. */
export const FUEL_LOW = 0.25;
export const FUEL_VERY_LOW = 0.1;

const G = 9.81;
const THROTTLE_RATE = 0.5; // throttle change per second while a key is held
const THROTTLE_FOLLOW = 1.5; // throttle change per second towards a touch slider position
const ROLLING_FRICTION = 0.5; // m/s²
const WATER_FRICTION = 2; // m/s², floats drag more than wheels
const BRAKE_DECEL = 6; // m/s²
const BELLY_FRICTION = 4; // m/s², sliding on the belly after a wheels-up landing
const GEAR_TIME = 3; // s for the wheels to go fully up or down
const GEAR_DRAG_SAVING = 0.15; // less drag with the wheels up, so a little more top speed
const FLAP_TIME = 2; // s for the flaps to move fully
const CRASH_SINK = 7; // m/s vertical speed a touchdown can survive
const CRASH_BANK = 0.5; // sin of the bank angle a touchdown can survive (~30°)
const CRASH_NOSE_DOWN = -0.3; // sin of the pitch angle a touchdown can survive
const CRASH_SLOPE = 0.35; // steepest hillside (rise over run) a touchdown can survive
const LIFTOFF_CLIMB = 0.3; // m/s upward speed that counts as leaving the ground
const IDLE_BURN = 0.1; // share of the full-throttle fuel use the engine burns at idle
const REFUEL_TIME = 12; // s to fill an empty tank

// --- arcade ---
const GRAVITY_ALONG_PATH = G * 0.6; // softened: climbing slows you, diving speeds you up
const MAX_SINK = 12; // m/s sink rate when fully stalled
const AUTO_LEVEL_ROLL = 1.5;
const AUTO_LEVEL_PITCH = 0.8;
const STALL_NOSE_DROP = 1.5;
const ARCADE_LIMITS = { bank: MathUtils.degToRad(60), pitch: MathUtils.degToRad(45) };

// --- normal / realistic: the wing ---
const STALL_ANGLE = MathUtils.degToRad(15); // angle of attack where the wing gives most lift
const CL_ZERO = 0.25; // lift (as a share of the most) with the wing flat to the air
const CL_FLAPS = 0.25; // extra lift with full flaps (so a slower stall)
const FLAP_DRAG = 0.6; // arcade: extra drag with full flaps, as a share of the clean drag
// Normal and realistic drag. Real planes glide far without the engine (a small plane about 9 m forward per
// metre down, an airliner about 17), furthest at about 1.4 × their stall speed; each plane's drag is set from
// its glide ratio. The engine's push fades with speed, so full power still tops out at the plane's top speed.
const BEST_GLIDE = 1.4; // × stall speed (flaps up) where a plane glides furthest
const WINDMILL_DRAG = { propeller: 0.25, jet: 0.05 }; // a stopped engine turning in the wind: extra drag, share of the airframe's
const FLAP_DRAG_SHARE = 1.2; // full flaps: extra drag, share of the airframe's
const GEAR_DRAG_SHARE = 0.5; // retractable wheels down: extra drag, share of the airframe's (fixed wheels are part of it)
const GLIDE_HOLD = 1.2; // normal, engine stopped: stick per share of speed off the best gliding speed
const GLIDE_DAMP = 0.15; // ...and per m/s² the speed is changing (keeps the nose from see-sawing)
const SIDE_GRIP = 0.8; // 1/s, the fuselage resisting sliding sideways (kept small: it mustn't hold the plane up)
const PITCH_STABILITY = 1.5; // 1/s, how strongly the nose weathervanes back to the airflow
const YAW_STABILITY = 6; // 1/s, how strongly the nose swings into the airflow sideways (the fin)
const TRIM_ANGLE = 0.02; // rad, the angle of attack the plane settles to by itself
const GROUND_EFFECT = 0.25; // extra lift right on the ground, fading out at half a wingspan up
const NORMAL_LIMITS = { bank: MathUtils.degToRad(70), pitch: MathUtils.degToRad(50) };
const NORMAL_LEVEL_ROLL = 0.8;
const NORMAL_HOLD_HEIGHT = 0.4; // pitch input per m/s of climb or sink, when the stick is let go
const STALL_PROTECTION = 0.85; // normal: back stick fades out as the wing nears this share of its stall angle
const SPEED_PROTECTION = 0.15; // normal: ...and as the speed falls to within this share of the stall speed
const NORMAL_TURN_PULL = 0.75; // back stick added per unit of extra lift a level turn needs (1/cos(bank) − 1)
const DIHEDRAL = 1.2; // rad/s of roll per radian of sideslip: the upwind wing lifts (so the rudder banks the plane too)
const LOAD_SOFTNESS = 0.5; // g over which back stick fades out as the load nears the plane's limit
// --- realistic: trim and the stall ---
const TRIM_RANGE = { min: MathUtils.degToRad(-3), max: MathUtils.degToRad(9) }; // angles of attack the trim can hold
const WING_DROP = 0.8; // rad/s of roll when deep in a stall (a wing stalls first and drops)
const REALISTIC_FULL_CONTROL = 2; // × stall speed where the controls reach full effect

const TAIL_STIFFNESS = 2.5;
const ELEVATOR_UP = MathUtils.degToRad(20); // realistic: full back stick raises the angle of attack this far above trim
const ELEVATOR_DOWN = MathUtils.degToRad(14); // ...and full forward stick lowers it this far
// Realistic engines push about half as hard as the game's (closer to real planes, so full power
// climbs at a sensible angle); the drag shrinks with them, so the top speed stays the same.
const REALISTIC_THRUST = 0.5; // realistic: a real tail holds the trimmed angle of attack much more firmly
const TAIL_FULL_EFFECT = 1.5; // × stall speed where the tail's pull into the airflow is at its usual strength

const FORWARD = new Vector3(0, 0, -1);
const RIGHT = new Vector3(1, 0, 0);
const UP = new Vector3(0, 1, 0);

const fwd = new Vector3();
const right = new Vector3();
const up = new Vector3();
const limitUp = new Vector3();
const air = new Vector3();
const airDir = new Vector3();
const liftDir = new Vector3();
const force = new Vector3();
const flatFwd = new Vector3();
const tmpQ = new Quaternion();
const tmpEuler = new Euler(0, 0, 0, 'YXZ');

export class FlightModel {
  readonly position = new Vector3();
  readonly quaternion = new Quaternion();
  /** Over the ground, m/s. */
  readonly velocity = new Vector3();
  /** Airspeed (arcade: speed along the nose), m/s. */
  speed = 0;
  throttle = 0; // 0..1
  onGround = true;
  stalled = false;
  crashed = false;
  realism: Realism = 'normal';
  /** How the last touchdown went: sink rate (m/s) and sin of the bank angle (+ = right wing down). */
  readonly lastTouchdown = { sink: 0, bank: 0 };
  /** Air movement (m/s) that carries the plane along while it flies. */
  readonly wind = new Vector3();
  /** 0 = calm air, 1 = bumpy: gently rocks the plane in flight. */
  turbulence = 0;
  /** 1 = wheels down and locked, 0 = fully up; moves smoothly between. */
  gear = 1;
  /** 0 = flaps up, 1 = fully down; moves smoothly to the chosen stage. */
  flaps = 0;
  /** 1 = full tank, 0 = empty: the engine stops (except in arcade, where the tank never runs dry). */
  fuel = 1;
  /** Landed without wheels: slides to a stop and can't take off again. */
  bellyLanded = false;
  /** The stick and pedals as applied last step (-1..1), for moving the control surfaces. */
  readonly surfaces = { pitch: 0, roll: 0, yaw: 0 };
  /** Angle between the nose and the airflow, radians (normal / realistic). */
  angleOfAttack = 0;
  /**
   * Realistic: the angle of attack the plane settles to by itself. Let go of the stick and the
   * trim is set to fly on at the current speed, as a pilot trims after changing speed.
   */
  trim = TRIM_ANGLE;
  private pitchHeld = false;
  /** Normal and realistic: the airframe's drag (× airspeed²) and the drag of making lift (× lift × lift coefficient). */
  private readonly airframeDrag: number;
  private readonly inducedDrag: number;
  private lastAirspeed = 0;
  private gearTarget = 1;
  private flapStage = 0;
  private time = 0;

  constructor(readonly spec: AircraftSpec) {
    // Gliding at the best speed, the airframe's drag equals the drag of making lift, and lift ÷ drag is the glide ratio.
    const best = BEST_GLIDE * spec.stallSpeed;
    const total = G / (2 * spec.glideRatio * best * best); // with the stopped engine windmilling
    this.airframeDrag = total / (1 + (spec.propeller ? WINDMILL_DRAG.propeller : WINDMILL_DRAG.jet));
    this.inducedDrag = (total * best ** 4) / (G * spec.stallSpeed ** 2);
  }

  /** Puts the plane down with its wheels at `position`, nose pointing along `heading` (radians, 0 = -Z). */
  reset(position: Vector3, heading: number): void {
    this.position.copy(position);
    this.position.y += this.spec.gearHeight;
    this.quaternion.setFromEuler(tmpEuler.set(0, heading, 0));
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.throttle = 0;
    this.onGround = true;
    this.stalled = false;
    this.crashed = false;
    this.gear = this.gearTarget = 1;
    this.flaps = this.flapStage = 0;
    this.bellyLanded = false;
    this.angleOfAttack = 0;
    this.trim = TRIM_ANGLE;
    this.pitchHeld = false;
    this.fuel = 1;
  }

  /** False once the tank is empty: the propeller only windmills and the plane glides. */
  get engineRunning(): boolean {
    return this.fuel > 0 || this.realism === 'arcade';
  }

  /** The throttle the engine actually gives: none without fuel. */
  get power(): number {
    return this.engineRunning ? this.throttle : 0;
  }

  /** Fills the tank a little (standing at an airport); returns true once it is full. */
  refuel(dt: number): boolean {
    this.fuel = Math.min(1, this.fuel + dt / REFUEL_TIME);
    return this.fuel >= 1;
  }

  /** The angle of attack that holds the plane up (1 g) at this airspeed with the flaps as they are. */
  private trimFor(airspeed: number): number {
    const needed = (this.spec.stallSpeed / Math.max(airspeed, 1)) ** 2 - CL_FLAPS * this.flaps;
    return MathUtils.clamp(((needed - CL_ZERO) / (1 - CL_ZERO)) * STALL_ANGLE, TRIM_RANGE.min, TRIM_RANGE.max);
  }

  /** True when the wheels are down or on their way down. */
  get gearDown(): boolean {
    return this.gearTarget === 1;
  }

  /** Raises or lowers the wheels, if this plane can and it is flying. */
  toggleGear(): GearCommand {
    if (!this.spec.retractableGear) return 'fixed';
    if (this.onGround) return 'on-ground';
    this.gearTarget = this.gearTarget === 1 ? 0 : 1;
    return this.gearTarget === 1 ? 'down' : 'up';
  }

  /** Steps the flaps to the next stage (up → half → full → up) and returns it. */
  cycleFlaps(): number {
    this.flapStage = (this.flapStage + 1) % FLAP_STAGES.length;
    return FLAP_STAGES[this.flapStage];
  }

  /** The stall speed right now: flaps let the wing fly slower. */
  get currentStallSpeed(): number {
    return this.spec.stallSpeed / Math.sqrt(1 + CL_FLAPS * this.flaps);
  }

  /** Advances the simulation by `dt` seconds and returns what happened during the step. */
  step(dt: number, c: Controls, ground: Ground = FLAT_GROUND): FlightEvent[] {
    const events: FlightEvent[] = [];
    if (this.crashed) return events;
    this.time += dt;

    this.gear += MathUtils.clamp(this.gearTarget - this.gear, -dt / GEAR_TIME, dt / GEAR_TIME);
    this.flaps += MathUtils.clamp(FLAP_STAGES[this.flapStage] - this.flaps, -dt / FLAP_TIME, dt / FLAP_TIME);
    if (this.bellyLanded) {
      this.throttle = 0;
    } else if (c.throttleSet !== undefined) {
      const step = THROTTLE_FOLLOW * dt;
      this.throttle += MathUtils.clamp(c.throttleSet - this.throttle, -step, step);
    } else {
      this.throttle = MathUtils.clamp(this.throttle + c.throttle * THROTTLE_RATE * dt, 0, 1);
    }

    if (this.realism !== 'arcade' && this.fuel > 0) {
      this.fuel = Math.max(0, this.fuel - ((IDLE_BURN + (1 - IDLE_BURN) * this.throttle) * dt) / this.spec.endurance);
      if (this.fuel === 0) events.push('engine-out');
    }

    // The surfaces follow the stick, also standing still on the ground (in the air the helper may move them too).
    this.surfaces.pitch = c.pitch;
    this.surfaces.roll = c.roll;
    this.surfaces.yaw = c.yaw;
    if (this.realism === 'arcade' || this.onGround) this.stepArcade(dt, c, ground);
    else this.stepForces(dt, c, ground);
    return this.contact(events, ground);
  }

  /** The engine's full push, m/s². */
  private get maxThrust(): number {
    return this.spec.maxThrust * (this.realism === 'realistic' ? REALISTIC_THRUST : 1);
  }

  /**
   * Normal and realistic drag (× airspeed²): the airframe plus flaps, wheels and a stopped engine, and the
   * engine's push fading with speed (counted here as drag that grows with the throttle) so that full power
   * reaches the top speed, but no faster.
   */
  private airDrag(): number {
    const s = this.spec;
    let extra = FLAP_DRAG_SHARE * this.flaps;
    if (s.retractableGear) extra += GEAR_DRAG_SHARE * this.gear;
    if (!this.engineRunning) extra += s.propeller ? WINDMILL_DRAG.propeller : WINDMILL_DRAG.jet;
    const topSpeedDrag = (this.maxThrust / (s.maxSpeed * s.maxSpeed)) * (s.retractableGear ? 1 - GEAR_DRAG_SAVING : 1);
    return this.airframeDrag * (1 + extra) + this.power * Math.max(0, topSpeedDrag - this.airframeDrag);
  }

  /** Arcade (and on the ground): drag (× speed²) that makes full power reach the top speed. */
  private dragFactor(): number {
    const s = this.spec;
    const clean = (this.maxThrust / (s.maxSpeed * s.maxSpeed)) * (1 - GEAR_DRAG_SAVING * (1 - this.gear));
    return clean * (1 + FLAP_DRAG * this.flaps);
  }

  /** Bumps from turbulence, added to the pilot's input: smooth sums of slow waves. */
  private gusts(): { pitch: number; roll: number } {
    if (this.onGround || this.turbulence === 0) return { pitch: 0, roll: 0 };
    const t = this.time;
    return {
      pitch: this.turbulence * 0.25 * Math.sin(t * 1.3) * Math.sin(t * 0.47),
      roll: this.turbulence * 0.35 * Math.sin(t * 1.7 + 1) * Math.sin(t * 0.61),
    };
  }

  /** Rotates the plane by the given stick inputs (-1..1), scaled by how much the controls bite. */
  private rotate(dt: number, pitchIn: number, rollIn: number, yawIn: number, authority: number, yawRate: number): void {
    const s = this.spec;
    tmpEuler.set(pitchIn * s.pitchRate * authority * dt, -yawIn * yawRate * dt, -rollIn * s.rollRate * authority * dt);
    this.quaternion.multiply(tmpQ.setFromEuler(tmpEuler));
  }

  /** Stops the stick from rolling or pitching past the limits (keeps the plane the right way up). */
  private limit(input: { pitch: number; roll: number }, limits: { bank: number; pitch: number }): void {
    // The true bank, also with the nose high (the wing's height alone reads too little then, so a climbing plane could roll over).
    const bank = Math.atan2(-right.y, limitUp.copy(UP).applyQuaternion(this.quaternion).y); // + = right wing down
    if (Math.abs(bank) >= limits.bank && Math.sign(input.roll) === Math.sign(bank)) input.roll = 0;
    const pitch = Math.asin(MathUtils.clamp(fwd.y, -1, 1));
    if (Math.abs(pitch) >= limits.pitch && Math.sign(input.pitch) === Math.sign(pitch)) input.pitch = 0;
  }

  /**
   * The arcade model (also used by every level on the ground): speed along the nose,
   * the plane goes where it points.
   */
  private stepArcade(dt: number, c: Controls, ground: Ground): void {
    const s = this.spec;
    fwd.copy(FORWARD).applyQuaternion(this.quaternion);
    right.copy(RIGHT).applyQuaternion(this.quaternion);
    const stallSpeed = this.currentStallSpeed;

    // 0 = no lift at all, 1 = wings fully flying.
    const lift = MathUtils.smoothstep(this.speed, stallSpeed * 0.6, stallSpeed);

    let accel = this.power * this.maxThrust - this.dragFactor() * this.speed * this.speed - GRAVITY_ALONG_PATH * fwd.y;
    if (this.onGround) {
      const onWater = ground.heightAt(this.position.x, this.position.z) < SEA_LEVEL;
      const friction = this.bellyLanded ? BELLY_FRICTION : onWater ? WATER_FRICTION : ROLLING_FRICTION;
      accel -= friction + (c.brake ? BRAKE_DECEL : 0);
    }
    this.speed = Math.max(0, this.speed + accel * dt);

    const input = { pitch: c.pitch, roll: c.roll };
    let yawIn = c.yaw;
    if (this.onGround) {
      // On the runway left/right steers the nose wheel; there is nothing to roll.
      yawIn = this.bellyLanded ? 0 : MathUtils.clamp(yawIn + input.roll, -1, 1);
      input.roll = 0;
      if (this.speed < s.rotateSpeed || this.bellyLanded) input.pitch = Math.min(input.pitch, 0);
    } else {
      // Let go of the keys and the plane flies straight and level again.
      if (input.roll === 0) input.roll = MathUtils.clamp(right.y * AUTO_LEVEL_ROLL, -1, 1);
      if (input.pitch === 0) input.pitch = MathUtils.clamp(-fwd.y * AUTO_LEVEL_PITCH, -1, 1);
      // Without lift the nose drops so the plane picks up speed again.
      input.pitch -= (1 - lift) * STALL_NOSE_DROP;
      this.limit(input, ARCADE_LIMITS);
    }

    // Controls get mushy as the plane slows down.
    const authority = this.onGround ? 1 : 0.3 + 0.7 * lift;
    const yawRate = this.onGround ? s.groundSteerRate * Math.min(1, this.speed / 6) : s.yawRate * authority;
    const gust = this.gusts();
    this.rotate(dt, input.pitch + gust.pitch, input.roll + gust.roll, yawIn, authority, yawRate);

    // Banking turns the plane: a coordinated turn without needing the rudder.
    if (!this.onGround) this.quaternion.premultiply(tmpQ.setFromAxisAngle(UP, right.y * s.turnRate * lift * dt));
    this.quaternion.normalize();

    fwd.copy(FORWARD).applyQuaternion(this.quaternion);
    this.velocity.copy(fwd).multiplyScalar(this.speed);
    if (this.onGround && this.realism !== 'arcade') {
      // Raising the nose isn't enough: the plane leaves the runway only once the wing lifts more than it weighs.
      const pitch = Math.asin(MathUtils.clamp(fwd.y, -1, 1));
      if (this.liftAccel(this.speed, pitch, 0) < G) this.velocity.y = Math.min(this.velocity.y, 0);
    }
    if (!this.onGround) this.velocity.y -= (1 - lift) * MAX_SINK;
    this.position.addScaledVector(this.velocity, dt);
    if (!this.onGround) this.position.addScaledVector(this.wind, dt); // the wind carries you sideways
    this.stalled = !this.onGround && lift < 0.9;
    this.angleOfAttack = 0;
  }

  /** Lift from the wing as an acceleration, for an airspeed and angle of attack, near the ground or not. */
  private liftAccel(airspeed: number, alpha: number, heightAboveGround: number): number {
    const stallSpeed = this.spec.stallSpeed;
    // Lift grows with the angle up to the stall, then falls away as the airflow breaks off the wing.
    const a = MathUtils.clamp(alpha, -STALL_ANGLE, STALL_ANGLE);
    let cl = CL_ZERO + ((1 - CL_ZERO) * a) / STALL_ANGLE + CL_FLAPS * this.flaps;
    if (alpha > STALL_ANGLE) cl *= 1 - 0.45 * MathUtils.smoothstep(alpha, STALL_ANGLE, STALL_ANGLE + 0.2);
    const groundEffect = 1 + GROUND_EFFECT * MathUtils.clamp(1 - heightAboveGround / (0.5 * this.spec.wingspan), 0, 1);
    return G * (airspeed / stallSpeed) ** 2 * cl * groundEffect;
  }

  /** Normal and realistic: integrate the real forces on the plane. */
  private stepForces(dt: number, c: Controls, ground: Ground): void {
    const s = this.spec;
    const helped = this.realism === 'normal';
    fwd.copy(FORWARD).applyQuaternion(this.quaternion);
    right.copy(RIGHT).applyQuaternion(this.quaternion);
    up.copy(UP).applyQuaternion(this.quaternion);

    // The airflow: our motion through the air (the wind moves the air itself).
    air.copy(this.velocity).sub(this.wind);
    const airspeed = Math.max(air.length(), 0.1);
    airDir.copy(air).divideScalar(airspeed);
    const alpha = Math.atan2(-air.dot(up), air.dot(fwd)); // + = air hits the wing from below
    const sideslip = Math.asin(MathUtils.clamp(air.dot(right) / airspeed, -1, 1)); // + = sliding right
    this.angleOfAttack = alpha;
    this.speed = airspeed;

    const height = this.position.y - this.spec.gearHeight - Math.max(ground.heightAt(this.position.x, this.position.z), SEA_LEVEL);
    const lift = this.liftAccel(airspeed, alpha, height);
    const cl = lift / Math.max(G * (airspeed / s.stallSpeed) ** 2, 1e-6);

    // --- forces ---
    force.set(0, -G, 0);
    force.addScaledVector(fwd, this.power * this.maxThrust);
    liftDir.crossVectors(right, airDir).normalize(); // perpendicular to the airflow, towards the canopy
    force.addScaledVector(liftDir, lift);
    const drag = this.airDrag() * airspeed * airspeed + this.inducedDrag * lift * Math.max(cl, 0);
    force.addScaledVector(airDir, -drag);
    force.addScaledVector(right, -air.dot(right) * SIDE_GRIP); // the fuselage resists sliding sideways
    if (this.turbulence > 0) force.y += this.turbulence * 2.5 * Math.sin(this.time * 2.1) * Math.sin(this.time * 0.73);
    this.velocity.addScaledVector(force, dt);

    // --- rotation: the pilot, plus the plane's own stability ---
    const stallSpeed = this.currentStallSpeed;
    // How much the controls bite. Realistic: like real control surfaces, with the dynamic pressure,
    // so they are soft at landing speeds and only reach full effect at twice the stall speed.
    const authority = helped
      ? MathUtils.clamp(0.25 + 0.75 * (airspeed / (1.3 * stallSpeed)) ** 2, 0.25, 1)
      : MathUtils.clamp((airspeed / (REALISTIC_FULL_CONTROL * stallSpeed)) ** 2, 0.15, 1);
    this.stalled = alpha > STALL_ANGLE || airspeed < stallSpeed * 0.85;
    const input = { pitch: c.pitch, roll: c.roll };
    // Pulling can't load the wings past the plane's limit: the back stick fades out near it.
    const load = lift / G;
    if (input.pitch > 0) input.pitch *= MathUtils.clamp((s.maxLoad - load) / LOAD_SOFTNESS, 0, 1);
    if (!helped) {
      // Auto-trim: letting go of the stick trims the plane to fly on at this speed.
      if (Math.abs(c.pitch) > 0.3) this.pitchHeld = true;
      else if (this.pitchHeld && Math.abs(c.pitch) < 0.05) {
        this.pitchHeld = false;
        this.trim = this.trimFor(airspeed);
      }
    }
    if (helped) {
      // Let go and the wings level and the plane holds its height.
      if (input.roll === 0) input.roll = MathUtils.clamp(right.y * NORMAL_LEVEL_ROLL, -1, 1);
      if (input.pitch === 0 && !this.stalled && !this.engineRunning) {
        // No engine: keep the best gliding speed (the nose lower when slow, higher when fast), as a pilot does.
        const best = BEST_GLIDE * stallSpeed;
        const speeding = (airspeed - this.lastAirspeed) / dt;
        input.pitch = MathUtils.clamp(((airspeed - best) / best) * GLIDE_HOLD + speeding * GLIDE_DAMP, -0.6, 0.6);
      } else if (input.pitch === 0 && !this.stalled) {
        // Hold the height, and in a bank pull a little, as a pilot does to keep a turn level.
        const extraLift = 1 / Math.max(Math.cos(Math.asin(MathUtils.clamp(-right.y, -1, 1))), 0.3) - 1;
        input.pitch = MathUtils.clamp(-this.velocity.y * NORMAL_HOLD_HEIGHT + extraLift * NORMAL_TURN_PULL, -0.6, 0.6);
      }
      this.limit(input, NORMAL_LIMITS);
      // Stall protection (as on many airliners): pulling back stops raising the nose before the wing stalls.
      // Too slow, it lowers the nose itself so the plane keeps flying.
      const angleRoom = (STALL_ANGLE * STALL_PROTECTION - alpha) / (STALL_ANGLE * (1 - STALL_PROTECTION));
      const speedRoom = (airspeed / stallSpeed - 1) / SPEED_PROTECTION;
      const room = Math.min(angleRoom, speedRoom);
      if (input.pitch > 0) input.pitch *= MathUtils.clamp(room, 0, 1);
      if (speedRoom < 0) input.pitch = Math.min(input.pitch, speedRoom);
    }
    this.lastAirspeed = airspeed;
    const gust = this.gusts();
    // The nose weathervanes into the airflow, harder when stalled so it drops and the plane recovers.
    // Realistic: the elevator moves the angle of attack the tail settles the wing at (back stick = more, up to past the stall).
    const target = helped ? TRIM_ANGLE : this.trim + input.pitch * (input.pitch > 0 ? ELEVATOR_UP : ELEVATOR_DOWN);
    const pitchBack = (target - alpha) * PITCH_STABILITY * (helped && this.stalled ? 3 : 1);
    // Sliding sideways rolls the plane away from the slip (the wings' dihedral).
    const dihedralRoll = (-sideslip * DIHEDRAL * authority) / s.rollRate;
    // Deep in a stall one wing quits first and the plane rolls off (left, with the propeller's torque, unless slipping).
    const wingDrop = helped ? 0 : (MathUtils.clamp((alpha - STALL_ANGLE) / 0.15, 0, 1) * WING_DROP * (sideslip > 0.01 ? 1 : -1)) / s.rollRate;
    // Normal: the nose's pull back to the airflow goes through the same (speed-limited) controls.
    // Realistic: like a real tail, it weakens only in step with the speed, so even a slow plane
    // noses back into the airflow instead of hanging in a deep stall.
    const total = { pitch: helped ? input.pitch + gust.pitch + pitchBack / s.pitchRate : gust.pitch, roll: input.roll + gust.roll + dihedralRoll + wingDrop };
    // The limits hold against everything turning the plane (it would otherwise follow its own curving path into a loop).
    if (helped) this.limit(total, NORMAL_LIMITS);
    this.rotate(dt, total.pitch, total.roll, c.yaw, authority, s.yawRate * authority);
    if (!helped) {
      const tail = MathUtils.clamp(airspeed / (TAIL_FULL_EFFECT * stallSpeed), 0.4, 2);
      this.quaternion.multiply(tmpQ.setFromAxisAngle(RIGHT, pitchBack * TAIL_STIFFNESS * tail * dt));
    }
    this.surfaces.pitch = input.pitch;
    this.surfaces.roll = input.roll;
    // Sideways, the nose swings into the airflow, which is what makes a banked plane turn.
    this.quaternion.multiply(tmpQ.setFromAxisAngle(UP, -sideslip * YAW_STABILITY * authority * dt));
    this.quaternion.normalize();

    this.position.addScaledVector(this.velocity, dt);
  }

  /** Touching the ground or the sea: rolling, landing, crashing or splashing. */
  private contact(events: FlightEvent[], ground: Ground): FlightEvent[] {
    const s = this.spec;
    fwd.copy(FORWARD).applyQuaternion(this.quaternion);
    right.copy(RIGHT).applyQuaternion(this.quaternion);
    const terrain = ground.heightAt(this.position.x, this.position.z);
    const onWater = terrain < SEA_LEVEL;
    const wheelsReady = this.gear >= 0.99;
    const floor = Math.max(terrain, SEA_LEVEL) + (wheelsReady ? s.gearHeight : (s.bellyHeight ?? s.gearHeight));
    const sinks = onWater && !s.floats;
    if (this.position.y <= floor || (this.onGround && this.velocity.y < LIFTOFF_CLIMB)) {
      // Below the surface, or rolling along it (also downhill): stay on it.
      this.position.y = floor;
      if (!this.onGround) {
        // Sink rate relative to the ground's surface: flying level into a rising hillside counts as hitting it.
        const groundSpeed = Math.hypot(this.velocity.x, this.velocity.z);
        const rise = groundSpeed > 1 ? slopeAlong(ground, this.position.x, this.position.z, this.velocity.x / groundSpeed, this.velocity.z / groundSpeed) : 0;
        const hardLanding = -this.velocity.y + Math.max(0, rise) * groundSpeed > CRASH_SINK;
        const wingFirst = Math.abs(right.y) > CRASH_BANK;
        const noseFirst = fwd.y < CRASH_NOSE_DOWN;
        const hillside = !onWater && slopeAt(ground, this.position.x, this.position.z) > CRASH_SLOPE;
        if (sinks || hardLanding || wingFirst || noseFirst || hillside) return this.crash(events, sinks ? 'splash' : 'crash');
        this.onGround = true;
        this.stalled = false;
        this.lastTouchdown.sink = Math.max(0, -this.velocity.y);
        this.lastTouchdown.bank = -right.y;
        this.bellyLanded = !wheelsReady;
        // From now on the wheels roll along the nose at the speed we were going.
        flatFwd.set(fwd.x, 0, fwd.z).normalize();
        this.trim = TRIM_ANGLE;
        this.speed = Math.max(0, this.velocity.dot(flatFwd));
        events.push(wheelsReady ? 'touchdown' : 'belly');
      } else if (sinks) {
        return this.crash(events, 'splash'); // rolled off the runway into the sea
      }
      // Wheels on the ground: wings level and the nose no lower than the horizon.
      const heading = Math.atan2(-fwd.x, -fwd.z);
      const pitch = Math.max(0, Math.asin(MathUtils.clamp(fwd.y, -1, 1)));
      this.quaternion.setFromEuler(tmpEuler.set(pitch, heading, 0));
    } else if (this.onGround) {
      this.onGround = false;
      this.trim = this.trimFor(this.speed); // trimmed to the speed it left the ground at
      this.pitchHeld = false;
      events.push('takeoff');
    }
    return events;
  }

  /** Flew into another plane. */
  collide(): FlightEvent[] {
    return this.crashed ? [] : this.crash([], 'collision');
  }

  private crash(events: FlightEvent[], kind: 'crash' | 'splash' | 'collision'): FlightEvent[] {
    this.crashed = true;
    this.speed = 0;
    this.velocity.set(0, 0, 0);
    events.push(kind);
    return events;
  }
}

/** How much the ground rises (rise over run) going in direction (dx, dz) through a point. */
function slopeAlong(ground: Ground, x: number, z: number, dx: number, dz: number): number {
  const d = 3;
  return (ground.heightAt(x + dx * d, z + dz * d) - ground.heightAt(x - dx * d, z - dz * d)) / (2 * d);
}

/** Steepness of the ground (rise over run) around a point. */
function slopeAt(ground: Ground, x: number, z: number): number {
  const d = 3;
  const dx = ground.heightAt(x + d, z) - ground.heightAt(x - d, z);
  const dz = ground.heightAt(x, z + d) - ground.heightAt(x, z - d);
  return Math.hypot(dx, dz) / (2 * d);
}
