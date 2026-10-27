import { AIRLINES, airlineById, type Airline } from '../aircraft/airlines';
import type { AircraftType } from '../aircraft/catalog';
import type { Realism } from '../physics/FlightModel';
import { starText } from '../game/landing';
import type { MissionDef } from '../game/missions';
import type { Progress } from '../game/Progress';
import type { Airport } from '../world/Airport';
import { TIMES, WEATHERS, type TimeOfDay, type Weather } from '../world/Environment';
import { ISLANDS } from '../world/islands';

export interface Choice {
  aircraft: AircraftType;
  airline: Airline; // only used by planes that wear airline colours
  airport: Airport;
}

const CHOICE_KEY = 'niko-leti-choice';

type Tab = 'missions' | 'free';

/** What the menu asks the game to do. */
export interface MenuHandlers {
  onStart(choice: Choice): void;
  onMission(mission: MissionDef): void;
  /** Called at once on a change, so the scene behind the menu shows it. */
  onEnvironment(time: TimeOfDay, weather: Weather): void;
  onControls(realControls: boolean): void;
  onRealism(realism: Realism): void;
  onQuality(quality: Quality): void;
}

/** Fast: sharp enough and smooth on any phone. Pretty: glow around lights and the sun, crisper shadows. */
export type Quality = 'fast' | 'pretty';

const QUALITIES: { id: Quality; label: string }[] = [
  { id: 'fast', label: '⚡ Brzo' },
  { id: 'pretty', label: '✨ Lijepo' },
];

const REALISM: { id: Realism; label: string }[] = [
  { id: 'arcade', label: '🧸 Arkadno' },
  { id: 'normal', label: '✈️ Normalno' },
  { id: 'realistic', label: '🎓 Realistično' },
];

const CONTROL_STYLES = [
  { id: 'real', label: '✈️ Kao u avionu' },
  { id: 'simple', label: '⬆️ Gore = gore' },
];

/**
 * The start screen, also opened with ☰ / Esc. Two tabs: missions to pick from, or free
 * flight with a plane, airline and airport of your choice.
 */
export class Menu {
  private aircraft: AircraftType;
  private airline: Airline;
  private airport: Airport;
  private readonly root = document.getElementById('menu')!;
  private readonly airlineBox = document.getElementById('menu-airline-box')!;
  private tab: Tab;
  time: TimeOfDay;
  weather: Weather;
  /** Pulling back (↓ / S) lifts the nose, as in a real plane. */
  realControls: boolean;
  /** How true to life the flying is (see FlightModel). */
  realism: Realism;
  quality: Quality;

  constructor(
    aircraftTypes: AircraftType[],
    airports: Airport[],
    private readonly missions: MissionDef[],
    private readonly progress: Progress,
    private readonly handlers: MenuHandlers,
  ) {
    const saved = loadChoice();
    this.tab = saved?.tab === 'free' ? 'free' : 'missions';
    this.time = TIMES.find((t) => t.id === saved?.time)?.id ?? 'day';
    this.weather = WEATHERS.find((w) => w.id === saved?.weather)?.id ?? 'clear';
    this.realControls = saved?.controls !== 'simple';
    this.realism = REALISM.find((r) => r.id === saved?.realism)?.id ?? 'normal';
    // Phones and tablets start on the fast setting; computers can afford the pretty one.
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    this.quality = QUALITIES.find((q) => q.id === saved?.quality)?.id ?? (coarse ? 'fast' : 'pretty');

    // Time of day and weather apply straight away, so the scene behind the menu shows them.
    const pick = () => {
      this.save();
      this.render();
      this.handlers.onEnvironment(this.time, this.weather);
    };
    for (const { id, label } of TIMES) {
      pill(document.getElementById('env-time')!, id, label, () => {
        this.time = id;
        pick();
      });
    }
    for (const { id, label } of WEATHERS) {
      pill(document.getElementById('env-weather')!, id, label, () => {
        this.weather = id;
        pick();
      });
    }
    for (const { id, label } of REALISM) {
      pill(document.getElementById('env-realism')!, id, label, () => {
        this.realism = id;
        this.save();
        this.render();
        this.handlers.onRealism(id);
      });
    }
    for (const { id, label } of QUALITIES) {
      pill(document.getElementById('env-quality')!, id, label, () => {
        this.quality = id;
        this.save();
        this.render();
        this.handlers.onQuality(id);
      });
    }
    for (const { id, label } of CONTROL_STYLES) {
      pill(document.getElementById('env-controls')!, id, label, () => {
        this.realControls = id === 'real';
        this.save();
        this.render();
        this.handlers.onControls(this.realControls);
      });
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.tab')) {
      button.addEventListener('click', () => {
        this.tab = button.dataset.tab as Tab;
        this.render();
      });
    }

    const missionList = document.getElementById('menu-missions')!;
    for (const mission of missions) {
      const button = choiceButton(missionList, () => {
        this.hide();
        (document.activeElement as HTMLElement | null)?.blur();
        this.save();
        this.handlers.onMission(mission);
      });
      button.dataset.id = mission.id;
      button.append(span('emoji', mission.emoji), bold(mission.title), span('stars', ''), small(mission.brief));
    }

    this.aircraft = aircraftTypes.find((a) => a.id === saved?.aircraft) ?? aircraftTypes[0];
    this.airline = airlineById(saved?.airline);
    this.airport = airports.find((a) => a.name === saved?.airport) ?? airports[0];

    const planeList = document.getElementById('menu-aircraft')!;
    for (const type of aircraftTypes) {
      const button = choiceButton(planeList, () => {
        this.aircraft = type;
        this.render();
      });
      button.dataset.id = type.id;
      button.append(span('emoji', type.emoji), bold(type.name), small(type.description));
    }

    const airlineList = document.getElementById('menu-airlines')!;
    for (const airline of AIRLINES) {
      const button = choiceButton(airlineList, () => {
        this.airline = airline;
        this.render();
      });
      button.dataset.id = airline.id;
      const swatch = span('swatch', '');
      swatch.style.background = `#${airline.tail.toString(16).padStart(6, '0')}`;
      button.append(swatch, bold(airline.name));
    }

    const airportList = document.getElementById('menu-airports')!;
    for (const airport of airports) {
      const button = choiceButton(airportList, () => {
        this.airport = airport;
        this.render();
      });
      button.dataset.id = airport.name;
      button.append(bold(`✈ ${airport.name}`));
    }

    document.getElementById('start-btn')!.addEventListener('click', () => this.start());
    this.render();
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  get choice(): Choice {
    return { aircraft: this.aircraft, airline: this.airline, airport: this.airport };
  }

  /** True when Enter should start a free flight (the free-flight tab is showing). */
  get freeFlightOpen(): boolean {
    return this.visible && this.tab === 'free';
  }

  show(tab?: Tab): void {
    if (tab) this.tab = tab;
    this.render();
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  start(): void {
    this.hide();
    (document.activeElement as HTMLElement | null)?.blur();
    this.save();
    this.handlers.onStart(this.choice);
  }

  private save(): void {
    try {
      const saved = {
        aircraft: this.aircraft.id,
        airline: this.airline.id,
        airport: this.airport.name,
        tab: this.tab,
        time: this.time,
        weather: this.weather,
        controls: this.realControls ? 'real' : 'simple',
        realism: this.realism,
        quality: this.quality,
      };
      localStorage.setItem(CHOICE_KEY, JSON.stringify(saved));
    } catch {
      // Storage can be blocked (private mode); the choice still works for this visit.
    }
  }

  private render(): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.tab')) {
      button.classList.toggle('selected', button.dataset.tab === this.tab);
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('#env-time .pill')) {
      button.classList.toggle('selected', button.dataset.id === this.time);
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('#env-realism .pill')) {
      button.classList.toggle('selected', button.dataset.id === this.realism);
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('#env-quality .pill')) {
      button.classList.toggle('selected', button.dataset.id === this.quality);
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('#env-controls .pill')) {
      button.classList.toggle('selected', (button.dataset.id === 'real') === this.realControls);
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('#env-weather .pill')) {
      button.classList.toggle('selected', button.dataset.id === this.weather);
    }
    document.getElementById('tab-missions')!.classList.toggle('hidden', this.tab !== 'missions');
    document.getElementById('tab-free')!.classList.toggle('hidden', this.tab !== 'free');

    let stars = 0;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('#menu-missions .choice')) {
      const best = this.progress.missionStars(button.dataset.id!);
      stars += best;
      button.querySelector('.stars')!.textContent = starText(best);
    }
    const islands = this.progress.discovered.length;
    document.getElementById('menu-progress')!.textContent =
      `⭐ ${stars}/${this.missions.length * 3} zvjezdica · 🏝️ ${islands}/${ISLANDS.length} otkrivenih otoka`;

    for (const button of this.root.querySelectorAll<HTMLButtonElement>('#menu-aircraft .choice')) {
      button.classList.toggle('selected', button.dataset.id === this.aircraft.id);
    }
    this.airlineBox.classList.toggle('hidden', !this.aircraft.liveries);
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('#menu-airlines .choice')) {
      button.classList.toggle('selected', button.dataset.id === this.airline.id);
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('#menu-airports .choice')) {
      button.classList.toggle('selected', button.dataset.id === this.airport.name);
    }
  }
}

interface SavedChoice {
  aircraft?: string;
  airline?: string;
  airport?: string;
  tab?: string;
  time?: string;
  weather?: string;
  controls?: string;
  realism?: string;
  quality?: string;
}

function loadChoice(): SavedChoice | null {
  try {
    return JSON.parse(localStorage.getItem(CHOICE_KEY) ?? 'null');
  } catch {
    return null;
  }
}

function choiceButton(parent: HTMLElement, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'choice';
  button.addEventListener('click', onClick);
  parent.append(button);
  return button;
}

function pill(parent: HTMLElement, id: string, label: string, onClick: () => void): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pill';
  button.dataset.id = id;
  button.textContent = label;
  button.addEventListener('click', onClick);
  parent.append(button);
}

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

function bold(text: string): HTMLElement {
  const el = document.createElement('b');
  el.textContent = text;
  return el;
}

function small(text: string): HTMLElement {
  const el = document.createElement('small');
  el.textContent = text;
  return el;
}
