/** Control axes in the range -1..1 that the flight model reads each frame. */
export interface Controls {
  pitch: number; // +1 = nose up
  roll: number; // +1 = roll right
  yaw: number; // +1 = yaw right
  throttle: number; // +1 = more gas, -1 = less gas
  throttleSet?: number; // touch slider: go to this throttle (0..1) instead
  brake: boolean;
}

// Keys whose default browser behaviour (scrolling) we don't want while flying.
const BLOCKED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

const KEY_RAMP = 5; // per second: a key moves the stick from centre to full in 0.2 s, not instantly
const PAD_DEADZONE = 0.12;

/**
 * Gamepad buttons (standard layout, e.g. Xbox / PlayStation) act like these keys, so the game
 * only has to listen for keys: X / ◻ wheels, Y / △ camera, B / ○ flaps, d-pad down drop (missions),
 * Start pause, Back menu.
 */
const PAD_BUTTONS: Record<number, string> = { 1: 'KeyV', 2: 'KeyG', 3: 'KeyC', 8: 'Escape', 9: 'KeyP', 13: 'KeyB' };
const PAD_BRAKE = 0; // A / ✕
const PAD_GAS_DOWN = 6; // left trigger
const PAD_GAS_UP = 7; // right trigger
const PAD_RUDDER_LEFT = 4; // left bumper
const PAD_RUDDER_RIGHT = 5; // right bumper

export class Input {
  /**
   * Like a real plane: ↓ / S (stick pulled back) lifts the nose. Turned off, ↑ / W lifts it,
   * which some younger kids find easier.
   */
  realControls = true;
  private held = new Set<string>();
  private tapped = new Set<string>();
  private readonly smoothed = { pitch: 0, roll: 0, yaw: 0 };
  private padPressed: boolean[] = [];

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (BLOCKED.has(e.code)) e.preventDefault();
      if (!e.repeat) this.tapped.add(e.code);
      this.held.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    // Releasing keys while the window is unfocused would otherwise leave them stuck.
    window.addEventListener('blur', () => this.held.clear());
  }

  private axis(positive: string[], negative: string[]): number {
    const pos = positive.some((k) => this.held.has(k)) ? 1 : 0;
    const neg = negative.some((k) => this.held.has(k)) ? 1 : 0;
    return pos - neg;
  }

  /** Reads the gamepad's buttons once per frame, turning presses into key taps. Call before wasTapped(). */
  poll(): void {
    const pad = this.gamepad();
    if (!pad) return;
    for (const [index, code] of Object.entries(PAD_BUTTONS)) {
      const i = Number(index);
      const pressed = pad.buttons[i]?.pressed ?? false;
      if (pressed && !this.padPressed[i]) this.tapped.add(code);
      this.padPressed[i] = pressed;
    }
  }

  /** The stick and buttons for this frame; keys ease the stick over `dt` seconds, a gamepad moves it directly. */
  controls(dt: number): Controls {
    const sign = this.realControls ? -1 : 1;
    const keys = {
      pitch: this.axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']) * sign,
      roll: this.axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']),
      yaw: this.axis(['KeyE'], ['KeyQ']),
    };
    for (const name of ['pitch', 'roll', 'yaw'] as const) {
      const step = KEY_RAMP * dt;
      this.smoothed[name] += Math.max(-step, Math.min(step, keys[name] - this.smoothed[name]));
    }

    const controls: Controls = {
      pitch: this.smoothed.pitch,
      roll: this.smoothed.roll,
      yaw: this.smoothed.yaw,
      throttle: this.axis(['KeyR', 'Equal', 'NumpadAdd'], ['KeyF', 'Minus', 'NumpadSubtract']),
      brake: this.held.has('Space'),
    };

    const pad = this.gamepad();
    if (pad) {
      // Stick pulled back (towards you) is +y, which lifts the nose with real controls.
      controls.pitch = clamp(controls.pitch + deadzone(pad.axes[1] ?? 0) * -sign);
      controls.roll = clamp(controls.roll + deadzone(pad.axes[0] ?? 0));
      const value = (i: number) => pad.buttons[i]?.value ?? 0;
      controls.yaw = clamp(controls.yaw + value(PAD_RUDDER_RIGHT) - value(PAD_RUDDER_LEFT));
      controls.throttle = clamp(controls.throttle + value(PAD_GAS_UP) - value(PAD_GAS_DOWN));
      controls.brake ||= pad.buttons[PAD_BRAKE]?.pressed ?? false;
    }
    return controls;
  }

  /** True once per key press (or gamepad button press); cleared by endFrame(). */
  wasTapped(code: string): boolean {
    return this.tapped.has(code);
  }

  endFrame(): void {
    this.tapped.clear();
  }

  private gamepad(): Gamepad | null {
    if (!navigator.getGamepads) return null;
    for (const pad of navigator.getGamepads()) if (pad?.connected) return pad;
    return null;
  }
}

function deadzone(v: number): number {
  const a = Math.abs(v);
  return a < PAD_DEADZONE ? 0 : (Math.sign(v) * (a - PAD_DEADZONE)) / (1 - PAD_DEADZONE);
}

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}
