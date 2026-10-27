import { Vector3 } from 'three';
import type { FlightModel } from '../physics/FlightModel';
import type { Target } from './Instruments';
import { MAP_HALF_SIZE } from '../world/islands';
import type { Terrain } from '../world/Terrain';

const forward = new Vector3();

/** A small map of all islands with the plane's position and heading, other planes and the mission goal. */
export class Minimap {
  private readonly canvas = document.getElementById('minimap') as HTMLCanvasElement;
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly background: HTMLCanvasElement;

  constructor(terrain: Terrain) {
    // The islands never change, so paint them once.
    const size = this.canvas.width;
    this.background = document.createElement('canvas');
    this.background.width = this.background.height = size;
    const bg = this.background.getContext('2d')!;
    const image = bg.createImageData(size, size);
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const [x, z] = this.toWorld(px + 0.5, py + 0.5);
        const [r, g, b] = mapColor(terrain.heightAt(x, z));
        const k = (py * size + px) * 4;
        image.data[k] = r;
        image.data[k + 1] = g;
        image.data[k + 2] = b;
        image.data[k + 3] = 255;
      }
    }
    bg.putImageData(image, 0, 0);

    // Runways as short white strokes.
    bg.strokeStyle = '#ffffff';
    bg.lineWidth = 2;
    for (const airport of terrain.airports) {
      const half = airport.length / 2;
      const dx = -Math.sin(airport.heading) * half;
      const dz = -Math.cos(airport.heading) * half;
      const [x1, y1] = this.toMap(airport.center.x - dx, airport.center.z - dz);
      const [x2, y2] = this.toMap(airport.center.x + dx, airport.center.z + dz);
      bg.beginPath();
      bg.moveTo(x1, y1);
      bg.lineTo(x2, y2);
      bg.stroke();
    }
  }

  /** `others` are the other planes in the sky (small white dots); `goal` is the mission's goal (orange ring). */
  update(model: FlightModel, others: Vector3[] = [], goal: Target | null = null): void {
    const ctx = this.ctx;
    ctx.drawImage(this.background, 0, 0);

    if (goal && goal.x !== undefined && goal.z !== undefined) {
      const [gx, gy] = this.toMap(goal.x, goal.z);
      ctx.strokeStyle = '#ff8c42';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(gx, gy, 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1d3557';
    ctx.lineWidth = 1;
    for (const other of others) {
      const [x, y] = this.toMap(other.x, other.z);
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // The plane as an arrow pointing where it flies (north is up).
    forward.set(0, 0, -1).applyQuaternion(model.quaternion);
    const [px, py] = this.toMap(model.position.x, model.position.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.atan2(forward.x, -forward.z));
    ctx.fillStyle = '#ff8c42';
    ctx.strokeStyle = '#1d3557';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(6, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private toMap(x: number, z: number): [number, number] {
    const size = this.canvas.width;
    return [((x + MAP_HALF_SIZE) / (2 * MAP_HALF_SIZE)) * size, ((z + MAP_HALF_SIZE) / (2 * MAP_HALF_SIZE)) * size];
  }

  private toWorld(px: number, py: number): [number, number] {
    const size = this.canvas.width;
    return [(px / size) * 2 * MAP_HALF_SIZE - MAP_HALF_SIZE, (py / size) * 2 * MAP_HALF_SIZE - MAP_HALF_SIZE];
  }
}

function mapColor(h: number): [number, number, number] {
  if (h < 0) return [31, 138, 203];
  if (h < 3) return [242, 227, 160];
  if (h > 520) return [255, 255, 255];
  if (h > 330) return [141, 138, 133];
  if (h > 160) return [79, 125, 58];
  return [120, 190, 85];
}
