import type { FlightModel } from '../physics/FlightModel';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return node as T;
}

/**
 * The on-screen gauges plus a single message bubble. A flash (event message) wins
 * over a hint until it expires; hints are re-evaluated every frame by the game.
 */
export class HUD {
  private readonly speed = el('hud-speed');
  private readonly alt = el('hud-alt');
  private readonly throttle = el('hud-throttle');
  private readonly message = el('message');
  private readonly help = el('help');
  private readonly gearGauge = el('hud-gear-gauge');
  private readonly gearIcon = el('hud-gear');

  private flashText = '';
  private flashWarn = false;
  private flashUntil = 0;

  /** `altitude` is metres above whatever is below the plane (hill or sea). */
  update(model: FlightModel, now: number, altitude: number): void {
    this.speed.textContent = String(Math.round(model.speed * 3.6));
    this.alt.textContent = String(Math.max(0, Math.round(altitude)));
    this.throttle.style.width = `${Math.round(model.throttle * 100)}%`;
    this.updateGear(model);
    if (now < this.flashUntil) this.show(this.flashText, this.flashWarn);
  }

  /** Shows an event message for `seconds`, hiding any hint meanwhile. */
  flash(text: string, now: number, seconds = 2.5, warn = false): void {
    this.flashText = text;
    this.flashWarn = warn;
    this.flashUntil = now + seconds;
    this.show(text, warn);
  }

  /** Shows a hint unless a flash is active. Pass null to clear. */
  hint(text: string | null, now: number, warn = false): void {
    if (now < this.flashUntil) return;
    if (text) this.show(text, warn);
    else this.message.classList.remove('visible');
  }

  /** Wheels down / moving / up, only for planes whose wheels fold away. */
  private updateGear(model: FlightModel): void {
    this.gearGauge.classList.toggle('hidden', !model.spec.retractableGear);
    if (!model.spec.retractableGear) return;
    const state = model.gear >= 0.99 ? 'down' : model.gear <= 0.01 ? 'up' : 'moving';
    for (const name of ['down', 'up', 'moving']) this.gearGauge.classList.toggle(name, name === state);
    const icon = state === 'down' ? '⬇' : state === 'up' ? '⬆' : '↕';
    if (this.gearIcon.textContent !== icon) this.gearIcon.textContent = icon;
  }

  toggleHelp(): void {
    this.help.classList.toggle('hidden');
  }

  hideHelp(): void {
    this.help.classList.add('hidden');
  }

  private show(text: string, warn: boolean): void {
    if (this.message.textContent !== text) this.message.textContent = text;
    this.message.classList.add('visible');
    this.message.classList.toggle('warn', warn);
  }
}
