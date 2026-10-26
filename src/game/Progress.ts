/**
 * What the player has achieved, kept in the browser between visits: best landing per
 * airport, best result per mission and which islands have been discovered.
 */

const KEY = 'niko-leti-progress';

interface Saved {
  landings: Record<string, number>; // airport name → best stars
  missions: Record<string, number>; // mission id → best stars
  islands: string[]; // discovered island names
}

export class Progress {
  private data: Saved = load();

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

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Storage can be blocked (private mode); progress then lasts for this visit only.
    }
  }
}

function load(): Saved {
  const empty: Saved = { landings: {}, missions: {}, islands: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null;
    return { ...empty, ...saved };
  } catch {
    return empty;
  }
}
