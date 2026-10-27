/**
 * The missions kids can pick in the menu. Each one says which plane to fly, where it
 * starts and what the goal is. Stars: landings are scored like any landing; timed goals
 * give ⭐⭐⭐ within `par` seconds, ⭐⭐ within 1.5 × par, otherwise ⭐.
 */

export type Goal =
  /** Fly through `count` rings in a circle around an island, in order. */
  | { kind: 'rings'; around: string; radius: number; altitude: number; count: number; par: number }
  /** Take off and land on another (or the same) airport's runway. */
  | { kind: 'land'; at: string }
  /** Land on the sea close to a spot and stop there (seaplane only). */
  | { kind: 'splashdown'; x: number; z: number; label: string; boat: boolean; par: number }
  /** Fly over each of these islands, in any order. */
  | { kind: 'tour'; islands: string[]; par: number };

export interface MissionDef {
  id: string;
  emoji: string;
  title: string;
  brief: string; // shown in the menu and when the mission starts
  aircraft: string; // id from the aircraft catalog
  airline?: string; // id from airlines.ts, for passenger flights
  start: string; // airport (island) name
  goal: Goal;
}

export const MISSIONS: MissionDef[] = [
  {
    id: 'first-flight',
    emoji: '🛫',
    title: 'Prvi let',
    brief: 'Poleti, napravi krug oko otoka i sleti natrag na Sunčani otok.',
    aircraft: 'trainer',
    start: 'Sunčani otok',
    goal: { kind: 'land', at: 'Sunčani otok' },
  },
  {
    id: 'rings-sun',
    emoji: '🎯',
    title: 'Prstenovi',
    brief: 'Proleti kroz 8 prstenova oko Sunčanog otoka.',
    aircraft: 'trainer',
    start: 'Sunčani otok',
    goal: { kind: 'rings', around: 'Sunčani otok', radius: 1800, altitude: 120, count: 8, par: 240 },
  },
  {
    id: 'post-green',
    emoji: '✉️',
    title: 'Pošta za Zeleni otok',
    brief: 'Odnesi pisma na Zeleni otok i sleti na njegovu pistu.',
    aircraft: 'trainer',
    start: 'Sunčani otok',
    goal: { kind: 'land', at: 'Zeleni otok' },
  },
  {
    id: 'niko-12',
    emoji: '🧳',
    title: 'Niko Air, let 12',
    brief: 'Odvezi putnike sa Sunčanog otoka na Borov otok.',
    aircraft: 'airliner',
    airline: 'niko',
    start: 'Sunčani otok',
    goal: { kind: 'land', at: 'Borov otok' },
  },
  {
    id: 'rescue',
    emoji: '🛟',
    title: 'Spašavanje mornara',
    brief: 'Brodić je ostao bez goriva! Sleti hidroavionom na more pokraj njega i stani.',
    aircraft: 'seaplane',
    start: 'Pješčani otok',
    goal: { kind: 'splashdown', x: 4600, z: 6000, label: 'Brodić u nevolji', boat: true, par: 150 },
  },
  {
    id: 'galeb-3',
    emoji: '🧳',
    title: 'Galeb Air, let 3',
    brief: 'Putnici sa Zelenog otoka idu na plažu Pješčanog otoka.',
    aircraft: 'airliner',
    airline: 'galeb',
    start: 'Zeleni otok',
    goal: { kind: 'land', at: 'Pješčani otok' },
  },
  {
    id: 'rings-volcano',
    emoji: '🌋',
    title: 'Oko vulkana',
    brief: 'Mlažnjakom proleti kroz 8 prstenova oko Vulkana. Uspori malo da lakše skreneš!',
    aircraft: 'jet',
    start: 'Sunčani otok', // its runway points straight at the volcano, away from any hills
    goal: { kind: 'rings', around: 'Vulkan', radius: 1600, altitude: 260, count: 8, par: 210 },
  },
  {
    id: 'lighthouse',
    emoji: '🗼',
    title: 'Do svjetionika',
    brief: 'Sleti hidroavionom na more pokraj Otoka svjetionika.',
    aircraft: 'seaplane',
    start: 'Borov otok',
    goal: { kind: 'splashdown', x: -7900, z: 1500, label: 'Svjetionik', boat: false, par: 180 },
  },
  {
    id: 'jadran-7',
    emoji: '🧳',
    title: 'Jadran Jet, let 7',
    brief: 'Odvezi planinare s Borovog otoka na Planinski otok.',
    aircraft: 'airliner',
    airline: 'jadran',
    start: 'Borov otok',
    goal: { kind: 'land', at: 'Planinski otok' },
  },
  {
    id: 'tour',
    emoji: '🗺️',
    title: 'Brza tura',
    brief: 'Mlažnjakom preleti Vulkan, Gusarski, Kameni i Zeleni otok — kojim god redom.',
    aircraft: 'jet',
    start: 'Sunčani otok',
    goal: { kind: 'tour', islands: ['Vulkan', 'Gusarski otok', 'Kameni otok', 'Zeleni otok'], par: 240 },
  },
  {
    id: 'otok-5',
    emoji: '🧳',
    title: 'Otok Express, let 5',
    brief: 'Dugi let: s Dugog otoka na Zeleni otok.',
    aircraft: 'airliner',
    airline: 'otok',
    start: 'Dugi otok',
    goal: { kind: 'land', at: 'Zeleni otok' },
  },
];

export function timeStars(seconds: number, par: number): number {
  if (seconds <= par) return 3;
  if (seconds <= par * 1.5) return 2;
  return 1;
}

export function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
