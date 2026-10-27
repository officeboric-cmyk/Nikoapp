import {
  AdditiveBlending,
  MathUtils,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { SEA_LEVEL, type FlightModel } from '../physics/FlightModel';
import type { Target } from '../ui/Instruments';
import type { Airport } from '../world/Airport';
import { ISLANDS } from '../world/islands';
import type { Effects } from '../world/Effects';
import { mulberry32 } from '../world/noise';
import type { Terrain } from '../world/Terrain';
import type { LandingResult } from './landing';
import { formatTime, timeStars, type Goal, type MissionDef } from './missions';

const tmpV = new Vector3();
const tmpUp = new Vector3();

const RING_RADIUS = 30; // m, generous so kids get through (the plane carries on a little in turns)
const RING_CLEARANCE = 60; // m kept between a ring and the ground under it
const SPLASHDOWN_RADIUS = 250; // m from the spot that counts as "next to it"
const STOPPED = 4; // m/s, slow enough to count as stopped on the water
const BEACON_HEIGHT = 600; // m, tall enough to see from far away
// --- fire fighting ---
const SCOOP_SPEED = 15; // m/s, skimming the sea at least this fast fills the tank
const SCOOP_TIME = 4; // s to fill the tank from empty
const DROP_MAX_HEIGHT = 150; // m above the ground: any higher and the water just blows away as mist
const DROP_HIT = 70; // m from a fire's middle that the water must land within
const AIMING_RANGE = 800; // m from a fire where the blue circle shows where the water would land
const DROP_TIME = 1.2; // s the water pours out
const FIRE_SPACING = 250; // m between fires

// --- parcels ---
const PARCEL_MIN_HEIGHT = 30; // m above the ground, so the parachute has time to open
const CHUTE_DELAY = 1; // s of free fall before the parachute opens
const CHUTE_SINK = 6; // m/s down under the parachute
const TARGET_HIT = 60; // m from a target's middle that counts
const TARGET_PERFECT = 20; // m: right in the middle
const TARGET_SIZE = 130; // m across the painted target
const PARCEL_GAP = 1; // s between two parcels
const PARCEL_STAYS = 8; // s a landed parcel stays on the ground

interface DropTarget {
  position: Vector3;
  island: string;
  hit: boolean;
  paint: MeshBasicMaterial;
}

/** A parcel falling (then floating down on its parachute), or lying where it landed. */
interface Parcel {
  object: Group;
  chute: Mesh;
  velocity: Vector3;
  age: number;
  landedAt: number | null;
  heading: Vector3; // which way the plane flew when it dropped it (to say "too early / too late")
}

interface Fire {
  position: Vector3;
  strength: number; // 1 = blazing, 0 = out
  flames: Group;
}

export interface MissionResult {
  stars: number;
  detail: string;
}

/** Feedback from the mission for the frame: a message to show, or the mission's end. */
export interface MissionUpdate {
  message?: string;
  warn?: boolean;
  done?: MissionResult;
}

/** One attempt at a mission: tracks progress, draws its rings / beacon / boat, and decides when it's won. */
export class MissionRun {
  elapsed = 0;
  private finished = false;
  private nextRing = 0;
  private readonly visited = new Set<string>();
  private readonly group = new Group();
  private readonly rings: Mesh[] = [];
  private readonly beacon: Mesh;
  private boat?: Group;
  private readonly fires: Fire[] = [];
  /** Fire mission: water in the tank, 0 = empty, 1 = full. */
  water = 0;
  private pouring = 0; // s of water still falling out of the tank
  private aim?: Mesh; // the blue circle where the water (or a parcel) would land
  private readonly targets: DropTarget[] = [];
  private readonly parcels: Parcel[] = [];
  private lastDrop = -Infinity;

  constructor(
    readonly def: MissionDef,
    private readonly scene: Scene,
    private readonly terrain: Terrain,
    private readonly start: Airport,
    private readonly effects?: Effects,
  ) {
    this.beacon = new Mesh(
      new CylinderGeometry(14, 14, BEACON_HEIGHT, 20, 1, true),
      new MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.35, side: DoubleSide, depthWrite: false, blending: AdditiveBlending }),
    );
    this.group.add(this.beacon);

    const goal = def.goal;
    if (goal.kind === 'rings') this.buildRings(goal);
    if (goal.kind === 'splashdown' && goal.boat) this.buildBoat(goal.x, goal.z);
    if (goal.kind === 'parcels') this.buildTargets(goal);
    if (goal.kind === 'fire' || goal.kind === 'parcels') {
      if (goal.kind === 'fire') this.buildFires(goal);
      this.aim = new Mesh(
        new TorusGeometry(DROP_HIT * 0.6, 2.5, 6, 32).rotateX(Math.PI / 2),
        new MeshBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.8, depthWrite: false }),
      );
      this.aim.visible = false;
      this.group.add(this.aim);
    }
    scene.add(this.group);
    this.restart();
    this.placeBeacon(start.center);
  }

  get goal(): Goal {
    return this.def.goal;
  }

  /** Back to the beginning (after a crash or when the player restarts). */
  restart(): void {
    this.elapsed = 0;
    this.finished = false;
    this.nextRing = 0;
    this.visited.clear();
    this.water = 0;
    this.pouring = 0;
    for (const fire of this.fires) fire.strength = 1;
    for (const target of this.targets) target.hit = false;
    for (const parcel of this.parcels) this.group.remove(parcel.object);
    this.parcels.length = 0;
    this.lastDrop = -Infinity;
    this.refreshVisuals();
  }

  dispose(): void {
    this.scene.remove(this.group);
  }

  /** The line shown with the arrow, e.g. "🎯 Prsten 3/8". */
  objective(): string {
    const goal = this.goal;
    const time = this.timed ? ` · ${formatTime(this.elapsed)}` : '';
    switch (goal.kind) {
      case 'rings':
        return `🎯 Prsten ${Math.min(this.nextRing + 1, goal.count)}/${goal.count}${time}`;
      case 'land':
        return `🛬 Sleti: ${goal.at}`;
      case 'splashdown':
        return `🛟 ${goal.label}${time}`;
      case 'tour':
        return `🗺️ Otoci ${this.visited.size}/${goal.islands.length}${time}`;
      case 'fire':
        return `🔥 ${this.firesOut}/${goal.fires} · 💧 ${Math.round(this.water * 100)} %${time}`;
      case 'parcels':
        return `📦 Mete ${this.targets.filter((t) => t.hit).length}/${this.targets.length}${time}`;
    }
  }

  /** This mission has something to drop (key B or the 💧 / 📦 button). */
  get canDrop(): boolean {
    return this.goal.kind === 'fire' || this.goal.kind === 'parcels';
  }

  /** The drop button's picture. */
  get dropIcon(): string {
    return this.goal.kind === 'parcels' ? '📦' : '💧';
  }

  private get firesOut(): number {
    return this.fires.filter((f) => f.strength <= 0).length;
  }

  private get timed(): boolean {
    return this.goal.kind !== 'land';
  }

  /** Where the arrow should point. */
  target(model: FlightModel): Target | null {
    const point = this.targetPoint(model.position);
    return point ? { name: this.objective(), x: point.x, z: point.z } : null;
  }

  update(dt: number, model: FlightModel): MissionUpdate | null {
    if (this.finished) return null;
    this.elapsed += dt;
    const goal = this.goal;
    this.placeBeacon(model.position);
    if (this.boat) this.boat.position.y = SEA_LEVEL + Math.sin(this.elapsed * 1.5) * 0.25;

    if (goal.kind === 'rings') {
      const ring = this.rings[this.nextRing];
      if (ring.position.distanceTo(model.position) < RING_RADIUS + 6) {
        this.nextRing++;
        this.refreshVisuals();
        if (this.nextRing === goal.count) return this.finish(timeStars(this.elapsed, goal.par), `Vrijeme: ${formatTime(this.elapsed)}`);
        return { message: `Prsten ${this.nextRing}/${goal.count}! 🎯` };
      }
    }

    if (goal.kind === 'tour' && !model.onGround) {
      const island = this.terrain.islandAt(model.position.x, model.position.z);
      if (island && goal.islands.includes(island.name) && !this.visited.has(island.name)) {
        this.visited.add(island.name);
        this.refreshVisuals();
        if (this.visited.size === goal.islands.length) return this.finish(timeStars(this.elapsed, goal.par), `Vrijeme: ${formatTime(this.elapsed)}`);
        return { message: `✅ ${island.name} (${this.visited.size}/${goal.islands.length})` };
      }
    }

    if (goal.kind === 'fire') {
      const update = this.updateFire(dt, model);
      if (update) return update;
    }

    if (goal.kind === 'parcels') {
      const update = this.updateParcels(dt, model);
      if (update) return update;
    }

    if (goal.kind === 'splashdown' && model.onGround && model.speed < STOPPED) {
      const onWater = this.terrain.heightAt(model.position.x, model.position.z) < SEA_LEVEL;
      const near = Math.hypot(model.position.x - goal.x, model.position.z - goal.z) < SPLASHDOWN_RADIUS;
      if (onWater && near) return this.finish(timeStars(this.elapsed, goal.par), `Vrijeme: ${formatTime(this.elapsed)}`);
    }
    return null;
  }

  /** Fires burn, the tank fills while skimming the sea, and dropped water pours out. */
  private updateFire(dt: number, model: FlightModel): MissionUpdate | null {
    const effects = this.effects;
    for (const fire of this.fires) {
      if (fire.strength <= 0) continue;
      const flicker = 0.85 + 0.15 * Math.sin(this.elapsed * 9 + fire.position.x) * Math.sin(this.elapsed * 5.3);
      fire.flames.scale.setScalar(Math.max(0.3, fire.strength) * flicker);
      if (effects && dt > 0) {
        const p = fire.position;
        if (Math.random() < dt * 30 * fire.strength) effects.emit('flame', tmpV.set(p.x + (Math.random() - 0.5) * 30, p.y + 2, p.z + (Math.random() - 0.5) * 30), tmpUp.set(0, 3, 0), 2);
        if (Math.random() < dt * 7) effects.emit('fireSmoke', tmpV.set(p.x, p.y + 12, p.z), tmpUp.set(1.5, 5, 0), 2);
      }
    }
    if (this.pouring > 0) {
      this.pouring -= dt;
      if (effects) for (let k = 0; k < 4; k++) effects.emit('water', tmpV.copy(model.position).setY(model.position.y - 1.5), tmpUp.copy(model.velocity).multiplyScalar(0.8), 3);
    }
    // With water on board and close to a fire, a blue circle shows where it would land.
    if (this.aim) {
      const landing = this.waterLanding(model);
      const near = this.fires.some((f) => f.strength > 0 && Math.hypot(f.position.x - model.position.x, f.position.z - model.position.z) < AIMING_RANGE);
      this.aim.visible = this.water > 0.05 && !model.onGround && landing.height <= DROP_MAX_HEIGHT && near;
      if (this.aim.visible) this.aim.position.set(landing.x, this.terrain.heightAt(landing.x, landing.z) + 3, landing.z);
    }
    // Skimming the sea fast with the floats scoops water into the tank.
    const onSea = model.onGround && this.terrain.heightAt(model.position.x, model.position.z) < SEA_LEVEL;
    if (onSea && model.speed > SCOOP_SPEED && this.water < 1) {
      const before = this.water;
      this.water = Math.min(1, this.water + dt / SCOOP_TIME);
      if (before === 0) return { message: '💧 Punim vodu… samo nastavi kliziti!' };
      if (this.water === 1) return { message: '💧 Spremnik pun! Poleti do vatre i baci vodu (B / 💧)' };
    }
    return null;
  }

  /** The player dropped the load (water on a fire, or a parcel). */
  drop(model: FlightModel): MissionUpdate | null {
    if (this.finished) return null;
    if (this.goal.kind === 'parcels') return this.dropParcel(model);
    if (this.goal.kind !== 'fire') return null;
    if (this.water < 0.05) return { message: '💧 Spremnik je prazan! Kliži po moru da ga napuniš', warn: true };
    const amount = this.water;
    this.water = 0;
    this.pouring = DROP_TIME;
    if (model.onGround) return { message: '💦 Voda je ostala na tlu – baci je u letu iznad vatre', warn: true };
    const landing = this.waterLanding(model);
    if (landing.height > DROP_MAX_HEIGHT) return { message: `💦 Previsoko (${Math.round(landing.height)} m)! Voda se raspršila – spusti se ispod ${DROP_MAX_HEIGHT} m`, warn: true };
    const burning = this.fires.filter((f) => f.strength > 0);
    const fire = burning.find((f) => Math.hypot(f.position.x - landing.x, f.position.z - landing.z) < DROP_HIT);
    if (!fire) {
      // Say whether it fell short of the nearest fire or past it.
      const nearest = burning.reduce((a, b) => (Math.hypot(a.position.x - landing.x, a.position.z - landing.z) < Math.hypot(b.position.x - landing.x, b.position.z - landing.z) ? a : b));
      const ahead = (nearest.position.x - landing.x) * model.velocity.x + (nearest.position.z - landing.z) * model.velocity.z > 0;
      return { message: ahead ? '💦 Prerano! Pričekaj da plavi krug dođe na vatru' : '💦 Prekasno! Voda leti naprijed – baci prije nego dođeš iznad vatre', warn: true };
    }
    fire.strength -= amount;
    if (fire.strength > 0.05) return { message: '💦 Pogodak! Vatra je slabija – još malo vode' };
    fire.strength = 0;
    this.refreshVisuals();
    const goal = this.goal;
    if (this.firesOut === goal.fires) return this.finish(timeStars(this.elapsed, goal.par), `Vrijeme: ${formatTime(this.elapsed)}`);
    return { message: `🔥 Ugašeno! (${this.firesOut}/${goal.fires})` };
  }

  /** A parcel leaves the plane: it falls, opens its parachute and floats down. */
  private dropParcel(model: FlightModel): MissionUpdate | null {
    if (model.onGround) return { message: '📦 Paket se baca u letu, iznad mete', warn: true };
    const height = model.position.y - model.spec.gearHeight - Math.max(this.terrain.heightAt(model.position.x, model.position.z), SEA_LEVEL);
    if (height < PARCEL_MIN_HEIGHT) return { message: `📦 Prenisko! Popni se iznad ${PARCEL_MIN_HEIGHT} m da se padobran stigne otvoriti`, warn: true };
    if (this.elapsed - this.lastDrop < PARCEL_GAP) return null;
    this.lastDrop = this.elapsed;
    const object = new Group();
    const box = new Mesh(new BoxGeometry(1, 0.8, 1), new MeshStandardMaterial({ color: 0xb07a3c, roughness: 0.8 }));
    const chute = new Mesh(
      new SphereGeometry(3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new MeshStandardMaterial({ color: 0xff6b35, roughness: 0.7, side: DoubleSide }),
    );
    chute.position.y = 4;
    chute.scale.setScalar(0.01);
    box.castShadow = chute.castShadow = true;
    object.add(box, chute);
    object.position.copy(model.position).setY(model.position.y - 1.5);
    this.group.add(object);
    const heading = model.velocity.clone().setY(0).normalize();
    this.parcels.push({ object, chute, velocity: model.velocity.clone(), age: 0, landedAt: null, heading });
    return { message: '📦 Paket je pao! Gledaj padobran…' };
  }

  /** Parcels fall and land; a landing on a target is a hit. The blue circle shows where the next one would land. */
  private updateParcels(dt: number, model: FlightModel): MissionUpdate | null {
    let update: MissionUpdate | null = null;
    for (const parcel of [...this.parcels]) {
      if (parcel.landedAt !== null) {
        if (this.elapsed - parcel.landedAt > PARCEL_STAYS) {
          this.group.remove(parcel.object);
          this.parcels.splice(this.parcels.indexOf(parcel), 1);
        }
        continue;
      }
      parcel.age += dt;
      stepParcel(parcel.object.position, parcel.velocity, parcel.age, dt, model.wind);
      if (parcel.age > CHUTE_DELAY) parcel.chute.scale.setScalar(Math.min(1, (parcel.age - CHUTE_DELAY) * 2));
      const ground = Math.max(this.terrain.heightAt(parcel.object.position.x, parcel.object.position.z), SEA_LEVEL);
      if (parcel.object.position.y <= ground + 0.4) {
        parcel.object.position.y = ground + 0.4;
        parcel.landedAt = this.elapsed;
        parcel.chute.scale.set(1, 0.15, 1); // the parachute collapses over it
        update = this.scoreParcel(parcel) ?? update;
      }
    }
    if (this.aim) {
      const near = this.targets.some((t) => !t.hit && Math.hypot(t.position.x - model.position.x, t.position.z - model.position.z) < AIMING_RANGE);
      this.aim.visible = near && !model.onGround;
      if (this.aim.visible) {
        const landing = this.parcelLanding(model);
        this.aim.position.set(landing.x, Math.max(this.terrain.heightAt(landing.x, landing.z), SEA_LEVEL) + 3, landing.z);
      }
    }
    return update;
  }

  private scoreParcel(parcel: Parcel): MissionUpdate | null {
    const p = parcel.object.position;
    const left = this.targets.filter((t) => !t.hit);
    if (!left.length) return null;
    const target = left.reduce((a, b) => (Math.hypot(a.position.x - p.x, a.position.z - p.z) < Math.hypot(b.position.x - p.x, b.position.z - p.z) ? a : b));
    const miss = Math.hypot(target.position.x - p.x, target.position.z - p.z);
    if (miss > TARGET_HIT) {
      const short = (target.position.x - p.x) * parcel.heading.x + (target.position.z - p.z) * parcel.heading.z > 0;
      return { message: `📦 Promašaj – ${Math.round(miss)} m od mete. ${short ? 'Baci malo kasnije' : 'Baci malo ranije'}!`, warn: true };
    }
    target.hit = true;
    this.refreshVisuals();
    const hits = this.targets.filter((t) => t.hit).length;
    const goal = this.goal;
    if (goal.kind === 'parcels' && hits === this.targets.length) return this.finish(timeStars(this.elapsed, goal.par), `Vrijeme: ${formatTime(this.elapsed)}`);
    return { message: `${miss < TARGET_PERFECT ? '🎯 Savršeno, ravno u sredinu!' : '📦 Pogodak!'} ${target.island} (${hits}/${this.targets.length})` };
  }

  /** Where a parcel dropped now would land, by running its fall ahead of time. */
  private parcelLanding(model: FlightModel): { x: number; z: number } {
    const position = model.position.clone().setY(model.position.y - 1.5);
    const velocity = model.velocity.clone();
    const step = 0.1;
    for (let age = 0; age < 120; age += step) {
      stepParcel(position, velocity, age + step, step, model.wind);
      if (position.y <= Math.max(this.terrain.heightAt(position.x, position.z), SEA_LEVEL)) break;
    }
    return { x: position.x, z: position.z };
  }

  /** A big painted target on each island, laid over the ground's bumps. */
  private buildTargets(goal: Extract<Goal, { kind: 'parcels' }>): void {
    const texture = targetTexture();
    for (const name of goal.islands) {
      const island = ISLANDS.find((i) => i.name === name)!;
      // The flattest dry spot near the middle of the island.
      let best = { x: island.x, z: island.z, score: Infinity };
      for (let r = 0; r < island.radius * 0.7; r += 40) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
          const x = island.x + Math.cos(a) * r;
          const z = island.z + Math.sin(a) * r;
          const h = this.terrain.heightAt(x, z);
          if (h < 3) continue;
          const bump = Math.max(...[-50, 50].flatMap((d) => [this.terrain.heightAt(x + d, z), this.terrain.heightAt(x, z + d)])) - Math.min(...[-50, 50].flatMap((d) => [this.terrain.heightAt(x + d, z), this.terrain.heightAt(x, z + d)]));
          const score = bump + r * 0.01;
          if (score < best.score) best = { x, z, score };
        }
      }
      const geometry = new PlaneGeometry(TARGET_SIZE, TARGET_SIZE, 26, 26).rotateX(-Math.PI / 2);
      const position = geometry.attributes.position;
      for (let k = 0; k < position.count; k++) {
        position.setY(k, Math.max(this.terrain.heightAt(best.x + position.getX(k), best.z + position.getZ(k)), SEA_LEVEL) + 0.6);
      }
      const paint = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
      const mesh = new Mesh(geometry, paint);
      mesh.position.set(best.x, 0, best.z);
      this.group.add(mesh);
      this.targets.push({ position: new Vector3(best.x, this.terrain.heightAt(best.x, best.z), best.z), island: name, hit: false, paint });
    }
  }

  /** Where water dropped now would hit the ground (it keeps flying forwards as it falls, slowed by the air). */
  private waterLanding(model: FlightModel): { x: number; z: number; height: number } {
    const height = model.position.y - model.spec.gearHeight - Math.max(this.terrain.heightAt(model.position.x, model.position.z), SEA_LEVEL);
    const fall = Math.sqrt((2 * Math.max(height, 0)) / 9.81);
    return { x: model.position.x + model.velocity.x * fall * 0.8, z: model.position.z + model.velocity.z * fall * 0.8, height };
  }

  /** Landing goals are decided by where the plane touches down. */
  onLanding(landing: LandingResult): MissionUpdate | null {
    const goal = this.goal;
    if (this.finished || goal.kind !== 'land') return null;
    if (landing.airport?.name === goal.at) return this.finish(landing.stars, landing.text);
    if (landing.airport) return { message: `To nije ${goal.at}! Poleti opet i leti do ${goal.at}.`, warn: true };
    return null;
  }

  private finish(stars: number, detail: string): MissionUpdate {
    this.finished = true;
    this.beacon.visible = false;
    return { done: { stars, detail } };
  }

  /** The current goal's spot on the map, as seen from `from` (matters for the tour). */
  private targetPoint(from: Vector3): { x: number; z: number } | null {
    const goal = this.goal;
    switch (goal.kind) {
      case 'rings': {
        const ring = this.rings[Math.min(this.nextRing, this.rings.length - 1)];
        return { x: ring.position.x, z: ring.position.z };
      }
      case 'land': {
        const airport = this.terrain.airports.find((a) => a.name === goal.at)!;
        return { x: airport.center.x, z: airport.center.z };
      }
      case 'splashdown':
        return { x: goal.x, z: goal.z };
      case 'parcels': {
        const left = this.targets.filter((t) => !t.hit);
        if (!left.length) return null;
        const best = left.reduce((a, b) => (a.position.distanceTo(from) < b.position.distanceTo(from) ? a : b));
        return { x: best.position.x, z: best.position.z };
      }
      case 'fire': {
        // The nearest fire still burning.
        let best: Fire | null = null;
        for (const fire of this.fires) {
          if (fire.strength <= 0) continue;
          if (!best || fire.position.distanceTo(from) < best.position.distanceTo(from)) best = fire;
        }
        return best ? { x: best.position.x, z: best.position.z } : null;
      }
      case 'tour': {
        // The nearest island still to visit.
        let best: { x: number; z: number } | null = null;
        let bestDistance = Infinity;
        for (const name of goal.islands) {
          if (this.visited.has(name)) continue;
          const island = ISLANDS.find((i) => i.name === name)!;
          const d = Math.hypot(island.x - from.x, island.z - from.z);
          if (d < bestDistance) {
            best = { x: island.x, z: island.z };
            bestDistance = d;
          }
        }
        return best;
      }
    }
  }

  /**
   * Rings evenly around the island. The first ring and the way round are chosen so the plane
   * arrives along the circle rather than straight at its middle: no sharp turn after the first ring.
   */
  private buildRings(goal: Extract<Goal, { kind: 'rings' }>): void {
    const island = ISLANDS.find((i) => i.name === goal.around)!;
    const start = this.start.center;
    const runwayX = -Math.sin(this.start.heading);
    const runwayZ = -Math.cos(this.start.heading);
    const startsInside = Math.hypot(start.x - island.x, start.z - island.z) < goal.radius;

    let startBearing = 0;
    let direction = 1; // 1 = clockwise (seen from above), -1 = anticlockwise
    let bestScore = -Infinity;
    for (let deg = 0; deg < 360; deg += 5) {
      const bearing = MathUtils.degToRad(deg);
      const x = island.x + Math.sin(bearing) * goal.radius;
      const z = island.z - Math.cos(bearing) * goal.radius;
      const distance = Math.hypot(x - start.x, z - start.z);
      const toRingX = (x - start.x) / distance;
      const toRingZ = (z - start.z) / distance;
      // Taking off inside the circle, the plane comes along the runway; otherwise straight from the airport.
      const [inX, inZ] = startsInside ? [runwayX, runwayZ] : [toRingX, toRingZ];
      const ahead = startsInside ? toRingX * runwayX + toRingZ * runwayZ : 0;
      for (const dir of [1, -1]) {
        // The circle's direction of travel at this ring.
        const score = dir * (Math.cos(bearing) * inX + Math.sin(bearing) * inZ) + ahead - distance / 20000;
        if (score > bestScore) {
          bestScore = score;
          startBearing = bearing;
          direction = dir;
        }
      }
    }

    const positions: Vector3[] = [];
    for (let i = 0; i < goal.count; i++) {
      const bearing = startBearing + direction * (i / goal.count) * Math.PI * 2 * 0.9;
      const x = island.x + Math.sin(bearing) * goal.radius;
      const z = island.z - Math.cos(bearing) * goal.radius;
      const wave = Math.sin(i * 1.3) * goal.altitude * 0.25; // a little up and down to keep it fun
      const ground = Math.max(this.terrain.heightAt(x, z), SEA_LEVEL);
      positions.push(new Vector3(x, Math.max(goal.altitude + wave, ground + RING_CLEARANCE), z));
    }

    const geometry = new TorusGeometry(RING_RADIUS, 1.8, 10, 40);
    positions.forEach((position, i) => {
      // Each ring faces along the path: from the previous ring towards the next.
      const prev = positions[Math.max(i - 1, 0)];
      const next = positions[Math.min(i + 1, positions.length - 1)];
      const ring = new Mesh(geometry, new MeshStandardMaterial({ color: 0xffffff, transparent: true }));
      ring.position.copy(position);
      ring.lookAt(position.clone().add(next.clone().sub(prev)));
      this.rings.push(ring);
      this.group.add(ring);
    });
  }

  /** Fires in the island's woods, well apart, away from its airport. */
  private buildFires(goal: Extract<Goal, { kind: 'fire' }>): void {
    const island = ISLANDS.find((i) => i.name === goal.island)!;
    const rand = mulberry32(island.x * 7 + island.z);
    const flame = new MeshBasicMaterial({ color: 0xff8c1a, transparent: true, opacity: 0.85 });
    const core = new MeshBasicMaterial({ color: 0xffd54a });
    const scorch = new MeshBasicMaterial({ color: 0x2b2420, transparent: true, opacity: 0.8, depthWrite: false });
    for (let tries = 0; tries < 500 && this.fires.length < goal.fires; tries++) {
      const angle = rand() * Math.PI * 2;
      const r = island.radius * (0.2 + rand() * 0.5);
      const x = island.x + Math.cos(angle) * r;
      const z = island.z + Math.sin(angle) * r;
      const y = this.terrain.heightAt(x, z);
      const steep = Math.abs(this.terrain.heightAt(x + 20, z) - this.terrain.heightAt(x - 20, z)) / 40;
      const nearAirport = this.terrain.airports.some((a) => a.flattenWeight(x, z) > 0.05);
      const crowded = this.fires.some((f) => Math.hypot(f.position.x - x, f.position.z - z) < FIRE_SPACING);
      if (y < 15 || y > 200 || steep > 0.4 || nearAirport || crowded) continue;
      const flames = new Group();
      flames.position.set(x, y, z);
      for (let k = 0; k < 5; k++) {
        const size = 4 + rand() * 5;
        const cone = new Mesh(new ConeGeometry(size * 0.5, size * 2.2, 7), k % 2 ? core : flame);
        cone.position.set((rand() - 0.5) * 22, size, (rand() - 0.5) * 22);
        flames.add(cone);
      }
      const burnt = new Mesh(new CircleGeometry(30, 20).rotateX(-Math.PI / 2), scorch);
      burnt.position.set(x, y + 0.4, z);
      this.group.add(flames, burnt);
      this.fires.push({ position: new Vector3(x, y, z), strength: 1, flames });
    }
  }

  private buildBoat(x: number, z: number): void {
    const boat = new Group();
    const red = new MeshStandardMaterial({ color: 0xe63946, flatShading: true });
    const white = new MeshStandardMaterial({ color: 0xf8f9fa, flatShading: true });
    const hull = new Mesh(new BoxGeometry(4, 1.4, 11), red);
    const cabin = new Mesh(new BoxGeometry(3, 2, 4), white);
    cabin.position.set(0, 1.6, 1);
    const mast = new Mesh(new CylinderGeometry(0.12, 0.12, 6, 6), white);
    mast.position.set(0, 3.5, -2.5);
    const flag = new Mesh(new BoxGeometry(0.05, 1.2, 2), new MeshStandardMaterial({ color: 0xffd166, emissive: 0xffd166, emissiveIntensity: 0.6 }));
    flag.position.set(0, 5.8, -1.4);
    for (const mesh of [hull, cabin, mast, flag]) {
      mesh.castShadow = true;
      boat.add(mesh);
    }
    boat.position.set(x, SEA_LEVEL, z);
    boat.rotation.y = 0.7;
    this.boat = boat;
    this.group.add(boat);
  }

  /** Highlights the next ring and hides the ones already flown through; shows only fires still burning. */
  private refreshVisuals(): void {
    for (const fire of this.fires) fire.flames.visible = fire.strength > 0;
    for (const target of this.targets) target.paint.opacity = target.hit ? 0.35 : 1;
    this.rings.forEach((ring, i) => {
      const material = ring.material as MeshStandardMaterial;
      ring.visible = i >= this.nextRing;
      const current = i === this.nextRing;
      material.color.setHex(current ? 0xff8c42 : 0xffffff);
      material.emissive.setHex(current ? 0xff8c42 : 0x000000);
      material.emissiveIntensity = current ? 0.8 : 0;
      material.opacity = current ? 1 : 0.45;
    });
  }

  /** Rings are their own markers; every other goal gets a tall glowing beacon over it. */
  private placeBeacon(from: Vector3): void {
    let point = this.goal.kind === 'rings' || this.finished ? null : this.targetPoint(from);
    // Close to a fire its own smoke shows the way, and the beacon would hide the flames.
    const aiming = this.goal.kind === 'fire' || this.goal.kind === 'parcels';
    if (point && aiming && Math.hypot(point.x - from.x, point.z - from.z) < AIMING_RANGE) point = null;
    this.beacon.visible = point !== null;
    if (!point) return;
    const ground = Math.max(this.terrain.heightAt(point.x, point.z), SEA_LEVEL);
    this.beacon.position.set(point.x, ground + BEACON_HEIGHT / 2, point.z);
  }
}

/** One step of a dropped parcel: free fall at first, then drifting down under its parachute with the wind. */
function stepParcel(position: Vector3, velocity: Vector3, age: number, dt: number, wind: Vector3): void {
  if (age < CHUTE_DELAY) {
    velocity.y -= 9.81 * dt;
  } else {
    const brake = 1 - Math.exp(-2 * dt);
    velocity.y += (-CHUTE_SINK - velocity.y) * brake;
    const drift = 1 - Math.exp(-0.9 * dt);
    velocity.x += (wind.x - velocity.x) * drift;
    velocity.z += (wind.z - velocity.z) * drift;
  }
  position.addScaledVector(velocity, dt);
}

/** Red and white rings with a bull's-eye, fading out at the edge. */
function targetTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const rings = ['#e63946', '#ffffff', '#e63946', '#ffffff', '#e63946'];
  rings.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(128, 128, 120 - i * 24, 0, Math.PI * 2);
    ctx.fill();
  });
  return new CanvasTexture(canvas);
}
