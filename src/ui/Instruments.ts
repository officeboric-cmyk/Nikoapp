import { Vector3 } from 'three';
import type { FlightModel } from '../physics/FlightModel';

/** What the top pill shows: a name, and an arrow and distance when it is a place. */
export interface Target {
  name: string;
  x?: number;
  z?: number;
}

const COMPASS = ['S', 'SI', 'I', 'JI', 'J', 'JZ', 'Z', 'SZ']; // sjever, sjeveroistok, istok, …

const forward = new Vector3();
const right = new Vector3();

/**
 * Flight instruments: an artificial horizon with the compass direction under it, and a
 * big arrow at the top of the screen pointing to where the player should fly.
 */
export class Instruments {
  private readonly horizon = document.getElementById('hud-horizon') as HTMLCanvasElement;
  private readonly ctx = this.horizon.getContext('2d')!;
  private readonly heading = document.getElementById('hud-heading')!;
  private readonly targetBox = document.getElementById('target')!;
  private readonly targetArrow = document.getElementById('target-arrow')!;
  private readonly targetText = document.getElementById('target-text')!;
  private lastText = '';

  update(model: FlightModel, target: Target | null): void {
    forward.set(0, 0, -1).applyQuaternion(model.quaternion);
    right.set(1, 0, 0).applyQuaternion(model.quaternion);
    const pitch = Math.asin(Math.max(-1, Math.min(1, forward.y)));
    const bank = Math.asin(Math.max(-1, Math.min(1, -right.y))); // + = right wing down
    this.drawHorizon(pitch, bank);

    // Compass bearing: 0 = north (-Z), 90 = east (+X).
    const bearing = Math.atan2(forward.x, -forward.z);
    const degrees = (Math.round((bearing * 180) / Math.PI) + 360) % 360;
    this.setText(this.heading, `${COMPASS[Math.round(degrees / 45) % 8]} ${degrees}°`);

    if (!target) {
      this.targetBox.classList.add('hidden');
      return;
    }
    this.targetBox.classList.remove('hidden');
    const place = target.x !== undefined && target.z !== undefined;
    this.targetArrow.classList.toggle('hidden', !place);
    let text = target.name;
    if (place) {
      const dx = target.x! - model.position.x;
      const dz = target.z! - model.position.z;
      const turn = Math.atan2(dx, -dz) - bearing; // how far to turn, + = to the right
      this.targetArrow.style.transform = `rotate(${turn}rad)`;
      text += ` · ${(Math.hypot(dx, dz) / 1000).toFixed(1).replace('.', ',')} km`;
    }
    if (text !== this.lastText) {
      this.targetText.textContent = text;
      this.lastText = text;
    }
  }

  /** Sky above, sea below, tilted with the bank and shifted with the pitch; the plane stays fixed. */
  private drawHorizon(pitch: number, bank: number): void {
    const { ctx } = this;
    const size = this.horizon.width;
    const r = size / 2;
    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(r, r, r - 1, 0, Math.PI * 2);
    ctx.clip();

    ctx.translate(r, r);
    ctx.rotate(-bank);
    const shift = Math.max(-r, Math.min(r, pitch * r * 1.6)); // nose up → horizon moves down
    ctx.fillStyle = '#5bb8f5';
    ctx.fillRect(-size, -size * 2 + shift, size * 2, size * 2);
    ctx.fillStyle = '#7cc35a';
    ctx.fillRect(-size, shift, size * 2, size * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-size, shift);
    ctx.lineTo(size, shift);
    ctx.stroke();
    ctx.restore();

    // The little plane in the middle never moves.
    ctx.strokeStyle = '#ff8c42';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(r - r * 0.55, r);
    ctx.lineTo(r - r * 0.15, r);
    ctx.lineTo(r, r + r * 0.12);
    ctx.lineTo(r + r * 0.15, r);
    ctx.lineTo(r + r * 0.55, r);
    ctx.stroke();
  }

  private setText(el: HTMLElement, text: string): void {
    if (el.textContent !== text) el.textContent = text;
  }
}
