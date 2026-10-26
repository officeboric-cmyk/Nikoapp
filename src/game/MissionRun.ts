import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Scene,
  TorusGeometry,
  Vector3,
} from 'three';
import { SEA_LEVEL, type FlightModel } from '../physics/FlightModel';
import type { Target } from '../ui/Instruments';
import type { Airport } from '../world/Airport';
import { ISLANDS } from '../world/islands';
import type { Terrain } from '../world/Terrain';
import type { LandingResult } from './landing';
import { formatTime, timeStars, type Goal, type MissionDef } from './missions';

const RING_RADIUS = 22; // m, generous so kids get through
const RING_CLEARANCE = 60; // m kept between a ring and the ground under it
const SPLASHDOWN_RADIUS = 250; // m from the spot that counts as "next to it"
const STOPPED = 4; // m/s, slow enough to count as stopped on the water
const BEACON_HEIGHT = 600; // m, tall enough to see from far away

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

  constructor(
    readonly def: MissionDef,
    private readonly scene: Scene,
    private readonly terrain: Terrain,
    private readonly start: Airport,
  ) {
    this.beacon = new Mesh(
      new CylinderGeometry(14, 14, BEACON_HEIGHT, 20, 1, true),
      new MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.35, side: DoubleSide, depthWrite: false, blending: AdditiveBlending }),
    );
    this.group.add(this.beacon);

    const goal = def.goal;
    if (goal.kind === 'rings') this.buildRings(goal);
    if (goal.kind === 'splashdown' && goal.boat) this.buildBoat(goal.x, goal.z);
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
    }
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
      if (ring.position.distanceTo(model.position) < RING_RADIUS + 4) {
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

    if (goal.kind === 'splashdown' && model.onGround && model.speed < STOPPED) {
      const onWater = this.terrain.heightAt(model.position.x, model.position.z) < SEA_LEVEL;
      const near = Math.hypot(model.position.x - goal.x, model.position.z - goal.z) < SPLASHDOWN_RADIUS;
      if (onWater && near) return this.finish(timeStars(this.elapsed, goal.par), `Vrijeme: ${formatTime(this.elapsed)}`);
    }
    return null;
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

  /** Rings evenly around the island, starting on the side the plane comes from and going clockwise. */
  private buildRings(goal: Extract<Goal, { kind: 'rings' }>): void {
    const island = ISLANDS.find((i) => i.name === goal.around)!;
    const fromX = this.start.center.x - island.x;
    const fromZ = this.start.center.z - island.z;
    // Starting on the island itself: put the first ring straight ahead of the runway.
    const startBearing =
      Math.hypot(fromX, fromZ) < goal.radius ? -this.start.heading : Math.atan2(fromX, -fromZ);

    const positions: Vector3[] = [];
    for (let i = 0; i < goal.count; i++) {
      const bearing = startBearing + (i / goal.count) * Math.PI * 2 * 0.9;
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

  /** Highlights the next ring and hides the ones already flown through. */
  private refreshVisuals(): void {
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
    const point = this.goal.kind === 'rings' || this.finished ? null : this.targetPoint(from);
    this.beacon.visible = point !== null;
    if (!point) return;
    const ground = Math.max(this.terrain.heightAt(point.x, point.z), SEA_LEVEL);
    this.beacon.position.set(point.x, ground + BEACON_HEIGHT / 2, point.z);
  }
}
