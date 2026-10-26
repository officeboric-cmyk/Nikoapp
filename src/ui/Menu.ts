import { AIRLINES, airlineById, type Airline } from '../aircraft/airlines';
import type { AircraftType } from '../aircraft/catalog';
import { starText } from '../game/landing';
import type { MissionDef } from '../game/missions';
import type { Progress } from '../game/Progress';
import type { Airport } from '../world/Airport';
import { ISLANDS } from '../world/islands';

export interface Choice {
  aircraft: AircraftType;
  airline: Airline; // only used by planes that wear airline colours
  airport: Airport;
}

const CHOICE_KEY = 'niko-leti-choice';

type Tab = 'missions' | 'free';

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

  constructor(
    aircraftTypes: AircraftType[],
    airports: Airport[],
    private readonly missions: MissionDef[],
    private readonly progress: Progress,
    private readonly onStart: (choice: Choice) => void,
    private readonly onMission: (mission: MissionDef) => void,
  ) {
    const saved = loadChoice();
    this.tab = saved?.tab === 'free' ? 'free' : 'missions';
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
        this.save();
        this.onMission(mission);
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
    this.save();
    this.onStart(this.choice);
  }

  private save(): void {
    (document.activeElement as HTMLElement | null)?.blur();
    try {
      const saved = { aircraft: this.aircraft.id, airline: this.airline.id, airport: this.airport.name, tab: this.tab };
      localStorage.setItem(CHOICE_KEY, JSON.stringify(saved));
    } catch {
      // Storage can be blocked (private mode); the choice still works for this visit.
    }
  }

  private render(): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.tab')) {
      button.classList.toggle('selected', button.dataset.tab === this.tab);
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

function loadChoice(): { aircraft?: string; airline?: string; airport?: string; tab?: string } | null {
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
