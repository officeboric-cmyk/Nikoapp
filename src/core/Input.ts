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

export class Input {
  /**
   * Like a real plane: ↓ / S (stick pulled back) lifts the nose. Turned off, ↑ / W lifts it,
   * which some younger kids find easier.
   */
  realControls = true;
  private held = new Set<string>();
  private tapped = new Set<string>();

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

  controls(): Controls {
    return {
      pitch: this.axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']) * (this.realControls ? -1 : 1),
      roll: this.axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']),
      yaw: this.axis(['KeyE'], ['KeyQ']),
      throttle: this.axis(['KeyR', 'Equal', 'NumpadAdd'], ['KeyF', 'Minus', 'NumpadSubtract']),
      brake: this.held.has('Space'),
    };
  }

  /** True once per physical key press; cleared by endFrame(). */
  wasTapped(code: string): boolean {
    return this.tapped.has(code);
  }

  endFrame(): void {
    this.tapped.clear();
  }
}
