import { MathUtils } from 'three';
import type { Controls } from '../core/Input';

const DEADZONE = 0.12; // fraction of the joystick's radius that does nothing
const KNOB_TRAVEL = 0.55; // fraction of the radius the knob can move

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return node;
}

/** True on phones and tablets (a finger is the main way to point). */
export function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

/**
 * On-screen controls for phones and tablets: a gas slider on the left, a joystick on
 * the right (push up = nose up, like the ↑ key) and a hold-to-brake button.
 * Several fingers can be used at once.
 */
export class TouchControls {
  readonly enabled = isTouchDevice();
  private pitch = 0;
  private roll = 0;
  private brake = false;
  private throttleSet: number | undefined;
  private readonly stick = el('touch-stick');
  private readonly knob = el('touch-knob');
  private readonly slider = el('touch-throttle');
  private readonly sliderFill = el('touch-throttle-fill');

  constructor() {
    if (!this.enabled) return;
    document.body.classList.add('touch');
    this.bindStick();
    this.bindSlider();
    this.bindBrake();
  }

  /** Adds the touch input to the keyboard's. */
  apply(keys: Controls): Controls {
    if (!this.enabled) return keys;
    if (keys.throttle !== 0) this.throttleSet = undefined; // R / F take over again
    return {
      pitch: MathUtils.clamp(keys.pitch + this.pitch, -1, 1),
      roll: MathUtils.clamp(keys.roll + this.roll, -1, 1),
      yaw: keys.yaw,
      throttle: keys.throttle,
      throttleSet: this.throttleSet,
      brake: keys.brake || this.brake,
    };
  }

  /** The slider shows the plane's real throttle, which follows the finger smoothly. */
  update(throttle: number): void {
    if (this.enabled) this.sliderFill.style.height = `${Math.round(throttle * 100)}%`;
  }

  /** After a respawn the plane starts with no gas, so forget the old slider position. */
  reset(): void {
    this.throttleSet = undefined;
  }

  private bindStick(): void {
    let finger: number | null = null;
    const move = (e: PointerEvent) => {
      const rect = this.stick.getBoundingClientRect();
      const radius = rect.width / 2;
      let x = (e.clientX - rect.left - radius) / radius;
      let y = (e.clientY - rect.top - radius) / radius;
      const length = Math.hypot(x, y);
      if (length > 1) {
        x /= length;
        y /= length;
      }
      this.knob.style.transform = `translate(${x * radius * KNOB_TRAVEL}px, ${y * radius * KNOB_TRAVEL}px)`;
      this.roll = deadzone(x);
      this.pitch = deadzone(-y); // screen y grows downwards; pushing up lifts the nose
    };
    const release = (e: PointerEvent) => {
      if (e.pointerId !== finger) return;
      finger = null;
      this.pitch = this.roll = 0;
      this.knob.style.transform = '';
    };
    this.stick.addEventListener('pointerdown', (e) => {
      finger = e.pointerId;
      this.stick.setPointerCapture(e.pointerId);
      move(e);
    });
    this.stick.addEventListener('pointermove', (e) => {
      if (e.pointerId === finger) move(e);
    });
    this.stick.addEventListener('pointerup', release);
    this.stick.addEventListener('pointercancel', release);
  }

  private bindSlider(): void {
    let finger: number | null = null;
    const move = (e: PointerEvent) => {
      const rect = this.slider.getBoundingClientRect();
      const value = MathUtils.clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1);
      this.throttleSet = value < 0.05 ? 0 : value;
    };
    this.slider.addEventListener('pointerdown', (e) => {
      finger = e.pointerId;
      this.slider.setPointerCapture(e.pointerId);
      move(e);
    });
    this.slider.addEventListener('pointermove', (e) => {
      if (e.pointerId === finger) move(e);
    });
    // Letting go keeps the gas where it is, like a real throttle lever.
    const release = (e: PointerEvent) => {
      if (e.pointerId === finger) finger = null;
    };
    this.slider.addEventListener('pointerup', release);
    this.slider.addEventListener('pointercancel', release);
  }

  private bindBrake(): void {
    const button = el('touch-brake');
    button.addEventListener('pointerdown', (e) => {
      button.setPointerCapture(e.pointerId);
      this.brake = true;
    });
    for (const type of ['pointerup', 'pointercancel'] as const) {
      button.addEventListener(type, () => (this.brake = false));
    }
  }
}

function deadzone(v: number): number {
  const a = Math.abs(v);
  return a < DEADZONE ? 0 : (Math.sign(v) * (a - DEADZONE)) / (1 - DEADZONE);
}
