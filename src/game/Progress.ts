/**
 * What each pilot has achieved, kept in the browser between visits: best landing per
 * airport, best result per mission and lesson, discovered islands, records and badges.
 * Several children can share a device: each has a profile with their own progress.
 */

const PROFILES_KEY = 'niko-leti-profiles';
const PROGRESS_KEY = 'niko-leti-progress'; // + ":" + profile id (the first profile also reads the old key)
const AVATARS = ['🧑‍✈️', '👧', '👦', '🐻', '🦊', '🐼', '🐯', '🐸'];

/** Running totals and bests, for records and badges. */
export interface Stats {
  flights: number; // take-offs
  landings: number;
  perfectLandings: number;
  airports: string[]; // landed on at least once
  waterLandings: number;
  nightLandings: number;
  softestLanding: number | null; // m/s sink, lowest
  maxAltitude: number; // m above the sea
  maxSpeed: number; // km/h
  distance: number; // km flown
  loops: number;
  rolls: number;
  balloons: number; // target balloons burst with the gun
  supersonic: number; // times through the sound barrier
}

interface Saved {
  landings: Record<string, number>; // airport name → best stars
  missions: Record<string, number>; // mission or lesson id → best stars
  islands: string[]; // discovered island names
  stats: Stats;
  badges: string[]; // earned badge ids
}

export interface Profile {
  id: string;
  name: string;
  avatar: string;
}

interface Profiles {
  current: string;
  list: Profile[];
}

export class Progress {
  private profiles: Profiles = loadProfiles();
  private data: Saved = load(this.profiles.current);

  get profile(): Profile {
    return this.profiles.list.find((p) => p.id === this.profiles.current)!;
  }

  get allProfiles(): readonly Profile[] {
    return this.profiles.list;
  }

  /** Switches to another pilot's progress. */
  useProfile(id: string): void {
    if (!this.profiles.list.some((p) => p.id === id)) return;
    this.profiles.current = id;
    saveProfiles(this.profiles);
    this.data = load(id);
  }

  /** Adds a pilot and switches to them. */
  addProfile(name: string): Profile {
    const ids = this.profiles.list.map((p) => Number(p.id.slice(1)));
    const id = `p${Math.max(0, ...ids) + 1}`;
    const profile = { id, name: name.trim().slice(0, 16) || `Pilot ${id.slice(1)}`, avatar: AVATARS[this.profiles.list.length % AVATARS.length] };
    this.profiles.list.push(profile);
    this.useProfile(id);
    return profile;
  }

  renameProfile(name: string): void {
    const trimmed = name.trim().slice(0, 16);
    if (!trimmed) return;
    this.profile.name = trimmed;
    saveProfiles(this.profiles);
  }

  /** Removes the current pilot (and their progress); there is always at least one. */
  deleteProfile(): void {
    if (this.profiles.list.length < 2) return;
    const id = this.profiles.current;
    this.profiles.list = this.profiles.list.filter((p) => p.id !== id);
    try {
      localStorage.removeItem(`${PROGRESS_KEY}:${id}`);
    } catch {
      // Nothing saved to remove.
    }
    this.useProfile(this.profiles.list[0].id);
  }

  bestLanding(airport: string): number {
    return this.data.landings[airport] ?? 0;
  }

  /** Returns true when this beats the previous best at that airport. */
  recordLanding(airport: string, stars: number): boolean {
    if (stars <= this.bestLanding(airport)) return false;
    this.data.landings[airport] = stars;
    this.save();
    return true;
  }

  missionStars(id: string): number {
    return this.data.missions[id] ?? 0;
  }

  /** Returns true when this beats the previous best for that mission. */
  recordMission(id: string, stars: number): boolean {
    if (stars <= this.missionStars(id)) return false;
    this.data.missions[id] = stars;
    this.save();
    return true;
  }

  get discovered(): readonly string[] {
    return this.data.islands;
  }

  /** Returns true the first time an island is discovered. */
  discover(island: string): boolean {
    if (this.data.islands.includes(island)) return false;
    this.data.islands.push(island);
    this.save();
    return true;
  }

  get stats(): Stats {
    return this.data.stats;
  }

  /** Changes the stats (e.g. counts a landing); call save() after to keep them. */
  updateStats(change: (stats: Stats) => void): void {
    change(this.data.stats);
  }

  get badges(): readonly string[] {
    return this.data.badges;
  }

  /** Returns true the first time a badge is earned. */
  earn(badge: string): boolean {
    if (this.data.badges.includes(badge)) return false;
    this.data.badges.push(badge);
    this.save();
    return true;
  }

  save(): void {
    try {
      localStorage.setItem(`${PROGRESS_KEY}:${this.profiles.current}`, JSON.stringify(this.data));
    } catch {
      // Storage can be blocked (private mode); progress then lasts for this visit only.
    }
  }
}

function emptyStats(): Stats {
  return {
    flights: 0,
    landings: 0,
    perfectLandings: 0,
    airports: [],
    waterLandings: 0,
    nightLandings: 0,
    softestLanding: null,
    maxAltitude: 0,
    maxSpeed: 0,
    distance: 0,
    loops: 0,
    rolls: 0,
    balloons: 0,
    supersonic: 0,
  };
}

function load(profile: string): Saved {
  const empty: Saved = { landings: {}, missions: {}, islands: [], stats: emptyStats(), badges: [] };
  try {
    let raw = localStorage.getItem(`${PROGRESS_KEY}:${profile}`);
    if (raw === null && profile === 'p1') raw = localStorage.getItem(PROGRESS_KEY); // from before profiles
    const saved = JSON.parse(raw ?? 'null') as Partial<Saved> | null;
    return { ...empty, ...saved, stats: { ...emptyStats(), ...saved?.stats } };
  } catch {
    return empty;
  }
}

function loadProfiles(): Profiles {
  const first: Profiles = { current: 'p1', list: [{ id: 'p1', name: 'Pilot', avatar: AVATARS[0] }] };
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILES_KEY) ?? 'null') as Profiles | null;
    if (saved?.list?.length && saved.list.some((p) => p.id === saved.current)) return saved;
  } catch {
    // Fall back to one profile.
  }
  return first;
}

function saveProfiles(profiles: Profiles): void {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  } catch {
    // Profiles then last for this visit only.
  }
}
