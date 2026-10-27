/**
 * Watches how smoothly the game runs while flying. When the device can't keep up, it says
 * so once per step: first from Pretty to Fast, then (still slow) to an even lower resolution.
 */

const WARMUP = 4; // s of flying before measuring (shaders and textures are still being prepared)
const WINDOW = 5; // s of frames averaged per measurement
const SLOW = { pretty: 28, fast: 20 }; // frames per second below which the picture steps down
const GAP = 2; // s: a longer frame means the tab was hidden or the game stalled, so start over

export type QualityStep = 'fast' | 'lower';

export class AutoQuality {
  private warm = 0;
  private time = 0;
  private frames = 0;

  /** Call every frame while flying with the real frame time; returns a step down when one is needed. */
  update(realDt: number, quality: 'pretty' | 'fast' | 'lowest'): QualityStep | null {
    if (quality === 'lowest') return null;
    if (realDt > GAP) {
      this.restart();
      return null;
    }
    this.warm += realDt;
    if (this.warm < WARMUP) return null;
    this.time += realDt;
    this.frames++;
    if (this.time < WINDOW) return null;
    const fps = this.frames / this.time;
    this.time = this.frames = 0;
    if (fps >= SLOW[quality]) return null;
    this.restart();
    return quality === 'pretty' ? 'fast' : 'lower';
  }

  /** Measures afresh (a new picture setting, or back from a pause). */
  restart(): void {
    this.warm = this.time = this.frames = 0;
  }
}
