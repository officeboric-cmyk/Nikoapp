import { ISLANDS } from '../world/islands';
import type { Progress } from './Progress';

/** Badges to collect, each earned once by doing something special. */
export interface Badge {
  id: string;
  emoji: string;
  title: string;
  description: string;
  earned(progress: Progress, all: { missions: string[]; lessons: string[]; airports: number }): boolean;
}

export const BADGES: Badge[] = [
  { id: 'first-flight', emoji: '🛫', title: 'Prvi let', description: 'Poleti prvi put', earned: (p) => p.stats.flights >= 1 },
  { id: 'first-landing', emoji: '🛬', title: 'Prvo slijetanje', description: 'Sleti na pistu', earned: (p) => p.stats.landings >= 1 },
  { id: 'perfect', emoji: '⭐', title: 'Savršeno!', description: 'Sleti s tri zvjezdice', earned: (p) => p.stats.perfectLandings >= 1 },
  { id: 'landings-10', emoji: '🥉', title: '10 slijetanja', description: 'Sleti 10 puta', earned: (p) => p.stats.landings >= 10 },
  { id: 'landings-50', emoji: '🥈', title: '50 slijetanja', description: 'Sleti 50 puta', earned: (p) => p.stats.landings >= 50 },
  { id: 'landings-100', emoji: '🥇', title: '100 slijetanja', description: 'Sleti 100 puta', earned: (p) => p.stats.landings >= 100 },
  { id: 'all-airports', emoji: '🗺️', title: 'Svi aerodromi', description: 'Sleti na svaki aerodrom', earned: (p, all) => p.stats.airports.length >= all.airports },
  { id: 'all-islands', emoji: '🏝️', title: 'Istraživač', description: 'Otkrij svih 12 otoka', earned: (p) => p.discovered.length >= ISLANDS.length },
  { id: 'loop', emoji: '🔄', title: 'Looping', description: 'Cijeli krug nosom gore (realistično)', earned: (p) => p.stats.loops >= 1 },
  { id: 'roll', emoji: '🌀', title: 'Valjak', description: 'Okreni avion oko sebe (realistično)', earned: (p) => p.stats.rolls >= 1 },
  { id: 'high', emoji: '☁️', title: 'Iznad oblaka', description: 'Popni se iznad 1500 m', earned: (p) => p.stats.maxAltitude >= 1500 },
  { id: 'fast', emoji: '⚡', title: 'Munja', description: 'Leti brže od 450 km/h', earned: (p) => p.stats.maxSpeed >= 450 },
  { id: 'distance', emoji: '🧭', title: 'Dugi put', description: 'Preleti ukupno 100 km', earned: (p) => p.stats.distance >= 100 },
  { id: 'water', emoji: '🌊', title: 'Na vodi', description: 'Sleti hidroavionom na more', earned: (p) => p.stats.waterLandings >= 1 },
  { id: 'night', emoji: '🌙', title: 'Noćni pilot', description: 'Sleti noću', earned: (p) => p.stats.nightLandings >= 1 },
  { id: 'supersonic', emoji: '💥', title: 'Brži od zvuka', description: 'Probij zvučni zid lovcem', earned: (p) => p.stats.supersonic >= 1 },
  { id: 'sharpshooter', emoji: '🎈', title: 'Strijelac', description: 'Pogodi 50 balona', earned: (p) => p.stats.balloons >= 50 },
  { id: 'firefighter', emoji: '🚒', title: 'Vatrogasac', description: 'Ugasi požar na Borovom otoku', earned: (p) => p.missionStars('fire-pine') >= 1 },
  { id: 'school', emoji: '🎓', title: 'Diploma', description: 'Završi sve lekcije škole letenja', earned: (p, all) => all.lessons.every((id) => p.missionStars(id) >= 1) },
  { id: 'missions', emoji: '🎖️', title: 'Sve misije', description: 'Završi svaku misiju', earned: (p, all) => all.missions.every((id) => p.missionStars(id) >= 1) },
];

/** Badges earned just now (not before). */
export function newBadges(progress: Progress, all: { missions: string[]; lessons: string[]; airports: number }): Badge[] {
  return BADGES.filter((badge) => !progress.badges.includes(badge.id) && badge.earned(progress, all) && progress.earn(badge.id));
}
