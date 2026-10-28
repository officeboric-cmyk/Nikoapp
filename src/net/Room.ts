import Peer, { type DataConnection, type PeerOptions } from 'peerjs';

/**
 * A room for playing with friends over the internet, with no server of our own: the browsers
 * talk to each other directly (WebRTC, through PeerJS). The free public PeerJS server only
 * introduces them. One player hosts and gets a four-digit code; the others join with it.
 * Everything goes through the host, who passes each message on to everyone else.
 */

export const MAX_PLAYERS = 6;
const PREFIX = 'niko-leti-soba-'; // the room's peer id on the PeerJS server: PREFIX + code
const CODE_TRIES = 5; // codes tried before giving up, if the first ones are taken

export interface PlayerInfo {
  id: string;
  name: string;
  avatar: string;
  slot: number; // 0..MAX_PLAYERS-1: colour and starting airport
}

/** What a plane looks like this moment, sent several times a second. */
export interface PlaneState {
  p: [number, number, number]; // position
  q: [number, number, number, number]; // orientation
  v: [number, number, number]; // velocity
  thr: number; // throttle 0..1 (the afterburner shows near 1)
  gear: number; // 1 = wheels down
  fire: boolean; // the gun is firing
  down: boolean; // shot down, waiting to start again
  hp: number; // hits it can still take (a badly hit plane smokes)
}

export type Message =
  | { t: 'hello'; name: string; avatar: string }
  | { t: 'welcome'; you: string; players: PlayerInfo[] }
  | { t: 'join'; player: PlayerInfo }
  | { t: 'left'; id: string }
  | { t: 'full' }
  | ({ t: 'state'; id: string } & PlaneState)
  | { t: 'hit'; from: string; to: string }
  | { t: 'down'; id: string; by: string };

export type RoomError = 'not-found' | 'full' | 'network' | 'closed';

/** For testing on a local PeerJS server: `?peer=localhost:9000` in the page's address. */
function serverOptions(): PeerOptions {
  const custom = new URLSearchParams(location.search).get('peer');
  if (!custom) return { debug: 0 };
  const [host, port] = custom.split(':');
  return { host, port: Number(port) || 9000, path: '/', secure: false, debug: 0 };
}

export class Room {
  readonly players = new Map<string, PlayerInfo>();
  /** Called for every message from the others (already applied to `players`). */
  onMessage: (message: Message) => void = () => {};
  /** Called once when the room can't go on (the host left, the network failed). */
  onClosed: (reason: RoomError) => void = () => {};
  private readonly connections = new Map<string, DataConnection>(); // host: one per guest; guest: just the host
  private closed = false;

  private constructor(
    private readonly peer: Peer,
    readonly code: string,
    readonly isHost: boolean,
    public me: PlayerInfo,
  ) {}

  /** Opens a new room and waits for friends. */
  static async host(name: string, avatar: string): Promise<Room> {
    for (let attempt = 0; attempt < CODE_TRIES; attempt++) {
      const code = String(1000 + Math.floor(Math.random() * 9000));
      const peer = new Peer(PREFIX + code, serverOptions());
      const opened = await new Promise<boolean | RoomError>((resolve) => {
        peer.once('open', () => resolve(true));
        peer.once('error', (error) => resolve(error.type === 'unavailable-id' ? false : 'network'));
      });
      if (opened === true) {
        const room = new Room(peer, code, true, { id: peer.id, name, avatar, slot: 0 });
        room.players.set(peer.id, room.me);
        room.listen();
        return room;
      }
      peer.destroy();
      if (opened === 'network') throw 'network' satisfies RoomError;
    }
    throw 'network' satisfies RoomError;
  }

  /** Joins a friend's room by its code. */
  static async join(code: string, name: string, avatar: string): Promise<Room> {
    const peer = new Peer(serverOptions());
    await new Promise<void>((resolve, reject) => {
      peer.once('open', () => resolve());
      peer.once('error', () => reject('network' satisfies RoomError));
    });
    const connection = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    const welcome = await new Promise<Message & { t: 'welcome' }>((resolve, reject) => {
      const timer = setTimeout(() => reject('not-found' satisfies RoomError), 12000);
      peer.once('error', (error) => {
        clearTimeout(timer);
        reject((error.type === 'peer-unavailable' ? 'not-found' : 'network') satisfies RoomError);
      });
      connection.once('open', () => connection.send({ t: 'hello', name, avatar } satisfies Message));
      connection.on('data', (data) => {
        const message = data as Message;
        if (message.t === 'full') {
          clearTimeout(timer);
          reject('full' satisfies RoomError);
        }
        if (message.t === 'welcome') {
          clearTimeout(timer);
          resolve(message);
        }
      });
    }).catch((error) => {
      peer.destroy();
      throw error;
    });
    const me = welcome.players.find((p) => p.id === welcome.you)!;
    const room = new Room(peer, code, false, me);
    for (const player of welcome.players) room.players.set(player.id, player);
    room.connections.set('host', connection);
    connection.on('data', (data) => room.receive(data as Message, connection));
    connection.on('close', () => room.close('closed'));
    peer.on('disconnected', () => peer.reconnect());
    return room;
  }

  /** Host: takes guests in, gives each a free slot, and tells everyone who is there. */
  private listen(): void {
    this.peer.on('connection', (connection) => {
      connection.on('data', (data) => this.receive(data as Message, connection));
      connection.on('close', () => {
        const id = connection.peer;
        if (!this.connections.has(id)) return;
        this.connections.delete(id);
        this.players.delete(id);
        const left: Message = { t: 'left', id };
        this.broadcast(left);
        this.onMessage(left);
      });
    });
    // The PeerJS server dropping us doesn't end the games already running; just get back on it.
    this.peer.on('disconnected', () => this.peer.reconnect());
  }

  private receive(message: Message, from: DataConnection): void {
    if (this.closed) return;
    if (this.isHost && message.t === 'hello') {
      const used = new Set([...this.players.values()].map((p) => p.slot));
      const slot = [...Array(MAX_PLAYERS).keys()].find((s) => !used.has(s));
      if (slot === undefined) {
        from.send({ t: 'full' } satisfies Message);
        setTimeout(() => from.close(), 500);
        return;
      }
      const player: PlayerInfo = { id: from.peer, name: message.name.slice(0, 16), avatar: message.avatar, slot };
      this.players.set(player.id, player);
      from.send({ t: 'welcome', you: player.id, players: [...this.players.values()] } satisfies Message);
      const join: Message = { t: 'join', player };
      this.broadcast(join, from.peer);
      this.connections.set(from.peer, from);
      this.onMessage(join);
      return;
    }
    if (message.t === 'join') this.players.set(message.player.id, message.player);
    if (message.t === 'left') this.players.delete(message.id);
    // The host passes everything from a guest on to all the others.
    if (this.isHost) this.broadcast(message, from.peer);
    this.onMessage(message);
  }

  /** Sends to everyone else in the room. */
  send(message: Message): void {
    if (this.closed) return;
    if (this.isHost) this.broadcast(message);
    else this.connections.get('host')?.send(message);
  }

  private broadcast(message: Message, except?: string): void {
    for (const [id, connection] of this.connections) if (id !== except && connection.open) connection.send(message);
  }

  /** Leaves the room (the host leaving closes it for everyone). */
  leave(): void {
    this.close('closed', false);
  }

  private close(reason: RoomError, tell = true): void {
    if (this.closed) return;
    this.closed = true;
    for (const connection of this.connections.values()) connection.close();
    this.connections.clear();
    this.peer.destroy();
    if (tell) this.onClosed(reason);
  }
}
