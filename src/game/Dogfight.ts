import { CanvasTexture, Quaternion, Sprite, SpriteMaterial, Vector3, type Scene } from 'three';
import { Aircraft } from '../aircraft/Aircraft';
import type { AircraftType } from '../aircraft/catalog';
import { FlightModel } from '../physics/FlightModel';
import type { Message, PlaneState, PlayerInfo, Room } from '../net/Room';
import type { Effects } from '../world/Effects';
import { Parachutes } from '../world/Parachutes';
import type { Terrain } from '../world/Terrain';
import type { Target } from '../ui/Instruments';
import { AMMO, Gun, passesNear, type Shootable, type Strike } from './Gun';

/**
 * A dogfight with friends: everyone flies a fighter in the same sky. Each player's game flies only
 * its own plane and sends where it is several times a second; the others' planes are drawn where
 * they were last seen, carried on at their speed. A player's rounds that pass close to another plane
 * tell that player they were hit; after enough hits that player's plane is shot down (it says so
 * itself, so everyone agrees on the score): the pilot floats down on a parachute and starts again on
 * the runway. Cartoon fighting: nobody is ever hurt.
 */

export const HEALTH = 10; // hits a fighter takes
export const BACK_AFTER = 4; // s after being shot down before starting again
const SEND_EVERY = 1 / 15; // s between our plane's updates to the others
const SAFE_AFTER_START = 5; // s after starting again during which hits don't count (no picking off planes on the runway)
const HIT_RADIUS = 6.5; // m: a round this close to a plane hits it (a little help with aiming)
const SMOOTHING = 12; // how quickly a drawn plane catches up with where it should be
const SNAP = 250; // m: further off than this, a drawn plane jumps straight there
const SMOKING = 4; // hits left below which a plane trails smoke
export const SLOT_COLORS = ['#ff595e', '#1982c4', '#8ac926', '#ffb703', '#9d4edd', '#ff7f11'];

/** Things happening in the fight, for the game to show and play. */
export type DogfightEvent =
  | { kind: 'join' | 'left'; name: string }
  | { kind: 'hit-me'; by: string; health: number }
  | { kind: 'down-me'; by: string }
  | { kind: 'scored'; victim: string }
  | { kind: 'other-down'; victim: string; by: string }
  | { kind: 'closed'; reason: string };

interface Remote {
  info: PlayerInfo;
  state: PlaneState | null;
  received: number; // s (game time) the last state arrived
  hp: number;
  puppet: FlightModel; // stands in for their flight model, for drawing their plane
  aircraft: Aircraft;
  label: Sprite;
  gun: Gun;
  smoke: number;
}

const target = new Vector3();
const turn = new Quaternion();

export class Dogfight implements Shootable {
  health = HEALTH;
  down = false;
  readonly scores = new Map<string, number>();
  onEvent: (event: DogfightEvent) => void = () => {};
  private readonly remotes = new Map<string, Remote>();
  private readonly parachutes: Parachutes;
  private time = 0;
  private sendTimer = 0;
  private safeUntil = 0;
  private smoke = 0;

  constructor(
    readonly room: Room,
    private readonly scene: Scene,
    private readonly effects: Effects,
    private readonly terrain: Terrain,
    private readonly fighter: AircraftType,
  ) {
    this.parachutes = new Parachutes(scene, terrain);
    for (const player of room.players.values()) {
      this.scores.set(player.id, 0);
      if (player.id !== room.me.id) this.addRemote(player);
    }
    room.onMessage = (message) => this.receive(message);
    room.onClosed = (reason) => this.onEvent({ kind: 'closed', reason });
  }

  get me(): PlayerInfo {
    return this.room.me;
  }

  /** The airport this player starts from: everyone a different one. */
  startAirport(): number {
    return this.me.slot % this.terrain.airports.length;
  }

  /** Back on the runway after being shot down (or at the start): full health, safe for a moment. */
  restart(): void {
    this.health = HEALTH;
    this.down = false;
    this.safeUntil = this.time + SAFE_AFTER_START;
  }

  private addRemote(info: PlayerInfo): void {
    const puppet = new FlightModel(this.fighter.spec);
    puppet.onGround = false;
    const aircraft = new Aircraft(this.fighter);
    aircraft.object.visible = false;
    const label = new Sprite(new SpriteMaterial({ map: nameTag(info), depthTest: false, sizeAttenuation: false }));
    label.scale.set(0.22, 0.055, 1);
    label.visible = false;
    this.scene.add(aircraft.object, label);
    const gun = new Gun(this.scene, this.effects, new Vector3(...(this.fighter.gun ?? [0, 0, -4])));
    this.remotes.set(info.id, { info, state: null, received: 0, hp: HEALTH, puppet, aircraft, label, gun, smoke: 0 });
    if (!this.scores.has(info.id)) this.scores.set(info.id, 0);
  }

  private removeRemote(id: string): void {
    const remote = this.remotes.get(id);
    if (!remote) return;
    this.scene.remove(remote.aircraft.object, remote.label);
    remote.gun.dispose(this.scene);
    this.remotes.delete(id);
  }

  private nameOf(id: string): string {
    return this.room.players.get(id)?.name ?? this.remotes.get(id)?.info.name ?? 'Pilot';
  }

  private receive(message: Message): void {
    switch (message.t) {
      case 'join':
        this.addRemote(message.player);
        this.onEvent({ kind: 'join', name: message.player.name });
        break;
      case 'left': {
        const name = this.remotes.get(message.id)?.info.name ?? 'Pilot';
        this.removeRemote(message.id);
        this.scores.delete(message.id);
        this.onEvent({ kind: 'left', name });
        break;
      }
      case 'state': {
        const remote = this.remotes.get(message.id);
        if (!remote) break;
        const first = remote.state === null;
        remote.state = message;
        remote.received = this.time;
        remote.hp = message.hp;
        if (first) {
          remote.puppet.position.fromArray(message.p);
          remote.puppet.quaternion.fromArray(message.q);
        }
        break;
      }
      case 'hit':
        if (message.to === this.me.id && !this.down && this.time >= this.safeUntil) {
          this.health--;
          if (this.health > 0) {
            this.onEvent({ kind: 'hit-me', by: this.nameOf(message.from), health: this.health });
          } else {
            // Shot down: we say so ourselves, so everyone counts it once.
            this.down = true;
            this.scores.set(message.from, (this.scores.get(message.from) ?? 0) + 1);
            this.room.send({ t: 'down', id: this.me.id, by: message.from });
            this.onEvent({ kind: 'down-me', by: this.nameOf(message.from) });
          }
        }
        break;
      case 'down': {
        this.scores.set(message.by, (this.scores.get(message.by) ?? 0) + 1);
        const remote = this.remotes.get(message.id);
        if (remote) {
          const at = remote.puppet.position;
          this.effects.burst('crash', at, 24, new Vector3(0, 3, 0), 6);
          this.effects.burst('flame', at, 14, remote.puppet.velocity.clone().multiplyScalar(0.4), 4);
          this.parachutes.jump(at, remote.puppet.velocity, 1);
          remote.aircraft.object.visible = false;
          if (remote.state) remote.state.down = true;
        }
        if (message.by === this.me.id) this.onEvent({ kind: 'scored', victim: this.nameOf(message.id) });
        else this.onEvent({ kind: 'other-down', victim: this.nameOf(message.id), by: this.nameOf(message.by) });
        break;
      }
    }
  }

  /** Sends our plane to the others now and then, and moves and draws theirs. */
  update(dt: number, model: FlightModel, firing: boolean): void {
    this.time += dt;
    this.parachutes.update(dt);
    this.sendTimer -= dt;
    if (this.sendTimer <= 0) {
      this.sendTimer = SEND_EVERY;
      const p = model.position;
      const v = model.velocity;
      const q = model.quaternion;
      this.room.send({
        t: 'state',
        id: this.me.id,
        p: [round(p.x), round(p.y), round(p.z)],
        q: [q.x, q.y, q.z, q.w],
        v: [round(v.x), round(v.y), round(v.z)],
        thr: model.power,
        gear: model.gear,
        fire: firing && !this.down,
        down: this.down,
        hp: this.health,
      });
    }

    // Our own plane smokes when badly hit, as theirs do.
    this.smoke -= dt;
    if (!this.down && this.health <= SMOKING && this.smoke <= 0) {
      this.smoke = 0.08;
      this.effects.emit('crash', model.position, new Vector3(0, 1, 0), 1);
    }

    for (const remote of this.remotes.values()) {
      const { state, puppet, aircraft, label } = remote;
      const visible = state !== null && !state.down;
      aircraft.object.visible = visible;
      label.visible = visible;
      if (!state || !visible) continue;
      // Where it should be now: its last position carried on at its speed.
      const age = Math.min(this.time - remote.received, 1);
      target.fromArray(state.p).addScaledVector(puppet.velocity.fromArray(state.v), age);
      if (puppet.position.distanceTo(target) > SNAP) puppet.position.copy(target);
      else puppet.position.lerp(target, 1 - Math.exp(-SMOOTHING * dt));
      puppet.quaternion.slerp(turn.fromArray(state.q), 1 - Math.exp(-SMOOTHING * dt));
      puppet.throttle = state.thr;
      puppet.gear = state.gear;
      puppet.speed = puppet.velocity.length();
      aircraft.update(puppet, dt);
      label.position.copy(puppet.position).y += 6;
      // Their gun: just the tracers to see (their game decides what they hit).
      remote.gun.ammo = AMMO;
      remote.gun.update(dt, puppet, state.fire, this.terrain, []);
      // A badly hit plane trails smoke.
      remote.smoke -= dt;
      if (remote.hp <= SMOKING && remote.smoke <= 0) {
        remote.smoke = 0.08;
        this.effects.emit('crash', puppet.position, new Vector3(0, 1, 0), 1);
      }
    }
  }

  /** Our round passing close to another plane: tell its player it was hit. */
  strike(a: Vector3, b: Vector3): Strike | null {
    for (const remote of this.remotes.values()) {
      if (!remote.state || remote.state.down || !passesNear(a, b, remote.puppet.position, HIT_RADIUS)) continue;
      this.room.send({ t: 'hit', from: this.me.id, to: remote.info.id });
      return { kind: 'plane', down: false };
    }
    return null;
  }

  /** Bailing out of our own plane: the parachute, smoke and flames where it was. */
  bailOut(model: FlightModel): void {
    this.effects.burst('crash', model.position, 24, new Vector3(0, 3, 0), 6);
    this.effects.burst('flame', model.position, 14, model.velocity.clone().multiplyScalar(0.4), 4);
    this.parachutes.jump(model.position, model.velocity, 1);
  }

  /** The nearest other plane, for the arrow. */
  nearestFoe(from: Vector3): Target | null {
    let best: Remote | null = null;
    let bestDistance = Infinity;
    for (const remote of this.remotes.values()) {
      if (!remote.state || remote.state.down) continue;
      const d = remote.puppet.position.distanceTo(from);
      if (d < bestDistance) {
        best = remote;
        bestDistance = d;
      }
    }
    return best ? { name: `🎯 ${best.info.avatar} ${best.info.name}`, x: best.puppet.position.x, z: best.puppet.position.z } : null;
  }

  /** The others' planes on the map, in their colours. */
  get foes(): { x: number; z: number; color: string }[] {
    return [...this.remotes.values()]
      .filter((r) => r.state && !r.state.down)
      .map((r) => ({ x: r.puppet.position.x, z: r.puppet.position.z, color: SLOT_COLORS[r.info.slot % SLOT_COLORS.length] }));
  }

  /** Everyone in the room with their score, best first. */
  get board(): { player: PlayerInfo; score: number; me: boolean }[] {
    return [...this.room.players.values()]
      .map((player) => ({ player, score: this.scores.get(player.id) ?? 0, me: player.id === this.me.id }))
      .sort((a, b) => b.score - a.score || a.player.slot - b.player.slot);
  }

  dispose(): void {
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    this.room.onMessage = () => {};
    this.room.onClosed = () => {};
    this.room.leave();
  }
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** A player's name floating over their plane, in their colour. */
function nameTag(player: PlayerInfo): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 34px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  const text = `${player.avatar} ${player.name}`;
  ctx.strokeText(text, 128, 34);
  ctx.fillStyle = SLOT_COLORS[player.slot % SLOT_COLORS.length];
  ctx.fillText(text, 128, 34);
  return new CanvasTexture(canvas);
}
