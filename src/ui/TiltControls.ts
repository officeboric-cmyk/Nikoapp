import { MathUtils } from 'three';

/**
 * Steering by tilting the phone or tablet, held sideways like a steering wheel: turn it
 * left or right to bank, tip the top edge towards you to lift the nose (away from you to
 * lower it). "Straight" is however the device is held when the flight starts, or when
 * the ⟳ button is tapped.
 */

const ROLL_FULL = MathUtils.degToRad(30); // turning the device this far = full stick
const PITCH_FULL = MathUtils.degToRad(20);
const DEADZONE = MathUtils.degToRad(3); // small wobbles of the hands do nothing
const SMOOTH = 0.25; // share of the way towards each new reading (sensors jitter)

type PermissionRequest = () => Promise<'granted' | 'denied' | 'prompt'>;

export class TiltControls {
  /** Steering by tilting is switched on (and allowed). */
  active = false;
  pitch = 0; // -1..1, + = nose up (with real controls)
  roll = 0; // -1..1, + = bank right
  realControls = true;
  private rollAngle = 0;
  private pitchAngle = 0;
  private neutralPitch: number | null = null;
  private seen = false;
  private readonly listener = (e: DeviceOrientationEvent) => this.read(e);

  /** Phones and tablets that can tell how they are tilted. */
  static get supported(): boolean {
    return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  }

  /**
   * Switches tilting on. iPhones and iPads ask the player first, which only works inside a
   * tap, so call this from one. Resolves to whether tilting is now on.
   */
  async enable(): Promise<boolean> {
    if (!TiltControls.supported) return false;
    const request = (DeviceOrientationEvent as unknown as { requestPermission?: PermissionRequest }).requestPermission;
    if (request) {
      try {
        // Only a clear "no" stops us; whether readings really arrive is checked by `working`.
        if ((await request()) === 'denied') return false;
      } catch {
        return false;
      }
    }
    if (!this.active) window.addEventListener('deviceorientation', this.listener);
    this.active = true;
    this.calibrate();
    return true;
  }

  disable(): void {
    window.removeEventListener('deviceorientation', this.listener);
    this.active = false;
    this.pitch = this.roll = 0;
  }

  /** Whether the device has actually reported a tilt (a desktop with the event but no sensor never does). */
  get working(): boolean {
    return this.seen;
  }

  /** The way the device is held right now becomes "straight and level". */
  calibrate(): void {
    this.neutralPitch = null;
  }

  private read(e: DeviceOrientationEvent): void {
    if (e.beta === null || e.gamma === null) return;
    this.seen = true;
    const beta = MathUtils.degToRad(e.beta);
    const gamma = MathUtils.degToRad(e.gamma);
    // "Up" (away from the ground) in the device's own frame: x right, y up and z out of the
    // screen, as when held upright in portrait.
    const ux = -Math.cos(beta) * Math.sin(gamma);
    const uy = Math.sin(beta);
    const uz = Math.cos(beta) * Math.cos(gamma);
    // ...and in the frame of the screen as the player sees it (turned for landscape).
    const angle = MathUtils.degToRad(screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0);
    const sx = ux * Math.cos(angle) + uy * Math.sin(angle);
    const sy = -ux * Math.sin(angle) + uy * Math.cos(angle);
    // Turned clockwise like a wheel, "up" leans towards the screen's left (measured in the
    // screen's plane, so it doesn't matter how far the device is tipped back).
    const roll = Math.atan2(-sx, Math.max(sy, 0.2));
    // Tipping the top edge towards you makes the screen face the sky more.
    const pitch = Math.atan2(uz, sy);
    this.rollAngle += (roll - this.rollAngle) * SMOOTH;
    this.pitchAngle += (pitch - this.pitchAngle) * SMOOTH;
    if (this.neutralPitch === null) {
      this.neutralPitch = pitch;
      this.pitchAngle = pitch;
    }
    this.roll = shape(this.rollAngle, ROLL_FULL);
    const nose = shape(this.pitchAngle - this.neutralPitch, PITCH_FULL);
    this.pitch = this.realControls ? nose : -nose;
  }
}

/** An angle to a -1..1 stick position, with a small dead zone around the middle. */
function shape(angle: number, full: number): number {
  const a = Math.abs(angle);
  if (a < DEADZONE) return 0;
  return Math.sign(angle) * MathUtils.clamp((a - DEADZONE) / (full - DEADZONE), 0, 1);
}
