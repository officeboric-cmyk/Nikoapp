import { AIRLINES, airlineById, type Airline } from '../aircraft/airlines';
import type { AircraftType } from '../aircraft/catalog';
import type { Realism } from '../physics/FlightModel';
import { starText } from '../game/landing';
import { BADGES } from '../game/badges';
import type { LessonDef } from '../game/lessons';
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

type Tab = 'missions' | 'school' | 'free' | 'badges';

/** What the menu asks the game to do. */
export interface MenuHandlers {
  onStart(choice: Choice): void;
  onMission(mission: MissionDef): void;
  onLesson(lesson: LessonDef): void;
  /** Called at once on a change, so the scene behind the menu shows it. */
  onEnvironment(time: TimeOfDay, weather: Weather): void;
  onControls(realControls: boolean): void;
  onRealism(realism: Realism): void;
  onQuality(quality: Quality): void;
  /** Phones and tablets: steer by tilting (true) or with the on-screen stick. */
  onSteering(tilt: boolean): void;
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

const STEERING = [
  { id: 'stick', label: '👆 Palica' },
  { id: 'tilt', label: '📱 Naginjanje' },
];

const CONTROL_STYLES = [
  { id: 'real', label: '✈️ Kao u avionu' },
  { id: 'simple', label: '⬆️ Gore = gore' },
];

/**
 * The start screen, also opened with ☰ / Esc. Tabs: missions to pick from, flying school,
 * free flight with a plane, airline and airport of your choice, and the pilot's badges.
 * Above them, the pilot picker: each child keeps their own progress.
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
  /** True once the player picked a picture setting themselves: it is then never changed for them. */
  qualityChosen: boolean;
  /** Phones and tablets: steer by tilting the device. */
  tilt: boolean;

  constructor(
    aircraftTypes: AircraftType[],
    airports: Airport[],
    private readonly missions: MissionDef[],
    lessons: LessonDef[],
    private readonly progress: Progress,
    private readonly handlers: MenuHandlers,
  ) {
    const saved = loadChoice();
    this.tab = (['free', 'school', 'badges'] as const).find((t) => t === saved?.tab) ?? 'missions';
    this.time = TIMES.find((t) => t.id === saved?.time)?.id ?? 'day';
    this.weather = WEATHERS.find((w) => w.id === saved?.weather)?.id ?? 'clear';
    this.realControls = saved?.controls !== 'simple';
    this.realism = REALISM.find((r) => r.id === saved?.realism)?.id ?? 'normal';
    // Phones and tablets start on the fast setting; computers can afford the pretty one.
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    this.tilt = saved?.steering === 'tilt';
    this.quality = QUALITIES.find((q) => q.id === saved?.quality)?.id ?? (coarse ? 'fast' : 'pretty');
    this.qualityChosen = saved?.qualityChosen === true;

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
        this.qualityChosen = true;
        this.save();
        this.render();
        this.handlers.onQuality(id);
      });
    }
    for (const { id, label } of STEERING) {
      pill(document.getElementById('env-steering')!, id, label, () => {
        this.setTilt(id === 'tilt');
        this.handlers.onSteering(this.tilt);
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

    this.buildProfiles();

    const lessonList = document.getElementById('menu-lessons')!;
    for (const lesson of lessons) {
      const button = choiceButton(lessonList, () => {
        this.hide();
        (document.activeElement as HTMLElement | null)?.blur();
        this.save();
        this.handlers.onLesson(lesson);
      });
      button.dataset.id = lesson.id;
      button.append(span('emoji', lesson.emoji), bold(lesson.title), span('stars', ''), small(lesson.brief));
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

  /** Switches tilt steering on or off in the menu (e.g. back off when the device can't do it). */
  setTilt(tilt: boolean): void {
    this.tilt = tilt;
    this.save();
    this.render();
  }

  /** The pilot picker: each child has their own stars, islands and badges. */
  private buildProfiles(): void {
    const select = document.getElementById('profile-select') as HTMLSelectElement;
    const fill = () => {
      select.replaceChildren();
      for (const profile of this.progress.allProfiles) select.add(new Option(`${profile.avatar} ${profile.name}`, profile.id));
      select.add(new Option('➕ Novi pilot…', 'new'));
      select.add(new Option('✏️ Promijeni ime…', 'rename'));
      if (this.progress.allProfiles.length > 1) select.add(new Option('🗑️ Obriši ovog pilota…', 'delete'));
      select.value = this.progress.profile.id;
    };
    select.addEventListener('change', () => {
      const value = select.value;
      if (value === 'new') {
        const name = window.prompt('Kako se zove novi pilot?');
        if (name?.trim()) this.progress.addProfile(name);
      } else if (value === 'rename') {
        const name = window.prompt('Novo ime pilota:', this.progress.profile.name);
        if (name) this.progress.renameProfile(name);
      } else if (value === 'delete') {
        if (window.confirm(`Obrisati pilota ${this.progress.profile.name} i sve njegove zvjezdice?`)) this.progress.deleteProfile();
      } else {
        this.progress.useProfile(value);
      }
      fill();
      this.render();
      select.blur();
    });
    fill();
  }

  /** Badges (earned ones bright) and the pilot's records. */
  private renderBadges(): void {
    const grid = document.getElementById('menu-badges')!;
    grid.replaceChildren();
    for (const badge of BADGES) {
      const earned = this.progress.badges.includes(badge.id);
      const item = document.createElement('div');
      item.className = earned ? 'badge earned' : 'badge';
      item.append(span('emoji', earned ? badge.emoji : '🔒'), bold(badge.title), small(badge.description));
      grid.append(item);
    }
    const s = this.progress.stats;
    const rows: [string, string][] = [
      ['🛫 Letova', `${s.flights}`],
      ['🛬 Slijetanja', `${s.landings}`],
      ['⭐ Savršenih slijetanja', `${s.perfectLandings}`],
      ['🪶 Najmekše slijetanje', s.softestLanding === null ? '–' : `${s.softestLanding.toFixed(1)} m/s`],
      ['☁️ Najveća visina', `${Math.round(s.maxAltitude)} m`],
      ['⚡ Najveća brzina', `${Math.round(s.maxSpeed)} km/h`],
      ['🧭 Ukupno preletio', `${s.distance.toFixed(1).replace('.', ',')} km`],
      ['🔄 Loopinga / 🌀 valjaka', `${s.loops} / ${s.rolls}`],
    ];
    const records = document.getElementById('menu-records')!;
    records.replaceChildren(
      ...rows.map(([name, value]) => {
        const row = document.createElement('div');
        row.append(span('record-name', name), bold(value));
        return row;
      }),
    );
  }

  /** The game switched the picture setting itself (the device was too slow). */
  autoQuality(quality: Quality): void {
    this.quality = quality;
    this.save();
    this.render();
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
        qualityChosen: this.qualityChosen,
        steering: this.tilt ? 'tilt' : 'stick',
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
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('#env-steering .pill')) {
      button.classList.toggle('selected', (button.dataset.id === 'tilt') === this.tilt);
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
    document.getElementById('tab-school')!.classList.toggle('hidden', this.tab !== 'school');
    document.getElementById('tab-badges')!.classList.toggle('hidden', this.tab !== 'badges');
    if (this.tab === 'badges') this.renderBadges();
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('#menu-lessons .choice')) {
      button.querySelector('.stars')!.textContent = starText(this.progress.missionStars(button.dataset.id!));
    }
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
  qualityChosen?: boolean;
  steering?: string;
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
