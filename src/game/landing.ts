import { SEA_LEVEL, type FlightModel } from '../physics/FlightModel';
import type { Airport } from '../world/Airport';
import type { Terrain } from '../world/Terrain';

export interface LandingResult {
  airport?: Airport; // set when the plane came down on a runway
  stars: number; // 1..3 on a runway, 0 elsewhere
  text: string;
}

const SOFT_SINK = 3.5; // m/s, gentler than this keeps all stars
const HARD_SINK = 6; // m/s, harder than this loses two (7 m/s crashes)
const CENTRELINE = 6; // m off the runway's centre line before losing a star
const LEVEL_WINGS = 0.17; // sin of the bank (~10°) before losing a star

/** Rates the touchdown that just happened: soft, on the centre line and wings level = ⭐⭐⭐. */
export function scoreLanding(model: FlightModel, terrain: Terrain): LandingResult {
  const { x, z } = model.position;
  const airport = terrain.runwayAt(x, z);
  if (!airport) {
    const onSea = terrain.heightAt(x, z) < SEA_LEVEL;
    return { stars: 0, text: onSea ? 'Sletio si na more! 🌊' : 'Sletio si na travu! 👍' };
  }

  const { sink, bank } = model.lastTouchdown;
  const [, across] = airport.toLocal(x, z);
  let stars = 3;
  if (sink > SOFT_SINK) stars--;
  if (sink > HARD_SINK) stars--;
  if (Math.abs(across) > CENTRELINE) stars--;
  if (Math.abs(bank) > LEVEL_WINGS) stars--;
  stars = Math.max(1, stars);

  const praise = stars === 3 ? 'Savršeno slijetanje' : stars === 2 ? 'Dobro slijetanje' : 'Sletio si';
  return { airport, stars, text: `${praise} na ${airport.name}! ${starText(stars)}` };
}

export function starText(stars: number, outOf = 3): string {
  return '⭐'.repeat(stars) + '☆'.repeat(Math.max(0, outOf - stars));
}
