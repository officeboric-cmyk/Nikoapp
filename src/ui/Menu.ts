import type { AircraftType } from '../aircraft/catalog';
import type { Airport } from '../world/Airport';

export interface Choice {
  aircraft: AircraftType;
  airport: Airport;
}

const CHOICE_KEY = 'niko-leti-choice';

/** The pick-a-plane / pick-an-airport screen, shown at the start and from the ☰ button. */
export class Menu {
  private aircraft: AircraftType;
  private airport: Airport;
  private readonly root = document.getElementById('menu')!;

  constructor(
    aircraftTypes: AircraftType[],
    airports: Airport[],
    private readonly onStart: (choice: Choice) => void,
  ) {
    const saved = loadChoice();
    this.aircraft = aircraftTypes.find((a) => a.id === saved?.aircraft) ?? aircraftTypes[0];
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
    return { aircraft: this.aircraft, airport: this.airport };
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  start(): void {
    this.hide();
    (document.activeElement as HTMLElement | null)?.blur();
    try {
      localStorage.setItem(CHOICE_KEY, JSON.stringify({ aircraft: this.aircraft.id, airport: this.airport.name }));
    } catch {
      // Storage can be blocked (private mode); the choice still works for this visit.
    }
    this.onStart(this.choice);
  }

  private render(): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('#menu-aircraft .choice')) {
      button.classList.toggle('selected', button.dataset.id === this.aircraft.id);
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('#menu-airports .choice')) {
      button.classList.toggle('selected', button.dataset.id === this.airport.name);
    }
  }
}

function loadChoice(): { aircraft?: string; airport?: string } | null {
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
