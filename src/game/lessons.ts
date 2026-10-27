import { MathUtils, Vector3 } from 'three';
import type { FlightModel } from '../physics/FlightModel';
import type { Target } from '../ui/Instruments';
import type { Airport } from '../world/Airport';
import type { LandingResult } from './landing';
import type { MissionResult, MissionUpdate } from './MissionRun';

/**
 * The flight school: short lessons, one small step at a time. Each step says what to do
 * (with a tip for keys or touch) and is ticked off as soon as the plane does it. Stars:
 * ⭐⭐⭐ without starting over, one less for each restart (and the landing lesson's
 * landing counts too).
 */

/** How to move the nose, in the player's own controls (keys or touch, real or simple). */
export interface Words {
  touch: boolean;
  noseUp: string; // e.g. "S ili ↓" or "povuci palicu prema sebi"
  noseDown: string;
}

interface StepState {
  time: number; // s on this step
  steady: number; // s the step's condition has held without a break
  turned: number; // degrees of heading change since the step began (+ = right)
  lastHeading: number;
}

interface StepInfo {
  model: FlightModel;
  altitude: number; // m above the ground or sea
  state: StepState;
  airport: Airport;
}

interface Step {
  title: string;
  tip(words: Words): string;
  done(info: StepInfo): boolean;
  /** Ticked off by touching down instead (the landing lesson). */
  onTouchdown?: boolean;
}

export interface LessonDef {
  id: string;
  emoji: string;
  title: string;
  brief: string;
  start: string; // airport
  /** Starts in the air: this far before the runway's start end, this high, this fast. */
  air?: { back: number; height: number; speed: number; throttle: number; flaps?: number };
  steps: Step[];
}

const deg = MathUtils.radToDeg;
const keyOr = (words: Words, keys: string, touch: string) => (words.touch ? touch : keys);
const bank = (m: FlightModel) => deg(Math.asin(MathUtils.clamp(-new Vector3(1, 0, 0).applyQuaternion(m.quaternion).y, -1, 1)));
const kmh = (m: FlightModel) => m.speed * 3.6;
/** Compass heading in degrees (0 = north, + = clockwise). */
const headingOf = (m: FlightModel) => {
  const nose = new Vector3(0, 0, -1).applyQuaternion(m.quaternion);
  return deg(Math.atan2(nose.x, -nose.z));
};
/** True once `ok` has held for `seconds` in a row. */
const holds = (info: StepInfo, ok: boolean, seconds: number) => (info.state.steady = ok ? info.state.steady : 0) >= seconds;

export const LESSONS: LessonDef[] = [
  {
    id: 'school-takeoff',
    emoji: '🛫',
    title: '1. Polijetanje',
    brief: 'Gas, zalet po pisti i prvi uspon.',
    start: 'Sunčani otok',
    steps: [
      { title: 'Daj pun gas', tip: (w) => keyOr(w, 'Drži R dok traka gasa ne bude puna', 'Povuci klizač GAS skroz gore'), done: (i) => i.model.throttle > 0.95 },
      { title: 'Ubrzaj po pisti', tip: () => 'Avion ubrzava sam… gledaj brzinu: trebaš oko 90 km/h', done: (i) => i.model.speed >= i.model.spec.rotateSpeed },
      { title: 'Podigni nos i poleti', tip: (w) => `Nos gore: ${w.noseUp}`, done: (i) => !i.model.onGround && i.altitude > 5 },
      { title: 'Popni se na 100 m', tip: () => 'Drži nos malo iznad obzora i gledaj visinu', done: (i) => i.altitude >= 100 },
      { title: 'Smanji gas na pola', tip: (w) => keyOr(w, 'Pritišći F dok traka gasa nije na pola', 'Spusti GAS na pola'), done: (i) => i.model.throttle <= 0.6 },
    ],
  },
  {
    id: 'school-turns',
    emoji: '↪️',
    title: '2. Zaokreti',
    brief: 'Nagni krila i avion skreće. Lijevo, desno i ravno.',
    start: 'Sunčani otok',
    air: { back: 3000, height: 300, speed: 45, throttle: 0.6 },
    steps: [
      { title: 'Nagni se udesno (30°)', tip: (w) => keyOr(w, 'D ili → dok nagib nije oko 30° (gledaj umjetni horizont)', 'Palica desno dok nagib nije oko 30°'), done: (i) => bank(i.model) >= 25 },
      { title: 'Okreni se za pola kruga', tip: (w) => `Drži nagib i gledaj kako se nos okreće. Malo nos gore (${w.noseUp}) da ne gubiš visinu`, done: (i) => i.state.turned >= 170 },
      { title: 'Izravnaj krila', tip: (w) => keyOr(w, 'A ili ← dok krila nisu ravno', 'Palica lijevo dok krila nisu ravno'), done: (i) => holds(i, Math.abs(bank(i.model)) < 6, 1) },
      { title: 'Sad ulijevo, natrag', tip: (w) => keyOr(w, 'A ili ←, nagib oko 30°, pa drži dok se ne okreneš', 'Palica lijevo, nagib oko 30°, pa drži'), done: (i) => i.state.turned <= -170 },
      { title: 'Opet ravno', tip: () => 'Izravnaj krila i leti ravno', done: (i) => holds(i, Math.abs(bank(i.model)) < 6, 1.5) },
    ],
  },
  {
    id: 'school-climb',
    emoji: '⛰️',
    title: '3. Gore i dolje',
    brief: 'Penjanje, spuštanje i držanje visine.',
    start: 'Sunčani otok',
    air: { back: 3000, height: 200, speed: 45, throttle: 0.7 },
    steps: [
      { title: 'Popni se na 350 m', tip: (w) => `Gas do kraja i nos gore (${w.noseUp})`, done: (i) => i.altitude >= 350 },
      { title: 'Spusti se na 150 m', tip: (w) => `Malo gasa i nos dolje (${w.noseDown})`, done: (i) => i.altitude <= 150 },
      { title: 'Drži 150 m (10 sekundi)', tip: () => 'Mali pomaci nosa: ostani između 125 i 175 m', done: (i) => holds(i, Math.abs(i.altitude - 150) < 25, 10) },
    ],
  },
  {
    id: 'school-flaps',
    emoji: '🛬',
    title: '4. Zakrilca i spori let',
    brief: 'Zakrilca daju više uzgona: avion može letjeti sporije.',
    start: 'Sunčani otok',
    air: { back: 3000, height: 300, speed: 50, throttle: 0.6 },
    steps: [
      { title: 'Uspori na 120 km/h', tip: (w) => `${keyOr(w, 'F', 'GAS dolje')} – manje gasa, a nos lagano gore da ne padaš`, done: (i) => kmh(i.model) <= 125 },
      { title: 'Izvuci zakrilca do kraja', tip: (w) => keyOr(w, 'Pritisni V dvaput (pola, pa puno)', 'Dodirni 🛬 dvaput (pola, pa puno)'), done: (i) => i.model.flaps >= 0.99 },
      { title: 'Leti sporo 10 sekundi', tip: () => 'Ispod 125 km/h, bez gubitka uzgona: malo gasa, nos lagano gore', done: (i) => holds(i, kmh(i.model) < 125 && !i.model.stalled && !i.model.onGround, 10) },
      { title: 'Uvuci zakrilca, dodaj gas', tip: (w) => keyOr(w, 'V dok zakrilca nisu uvučena, pa R', 'Dodirni 🛬 dok nisu uvučena, pa GAS gore'), done: (i) => i.model.flaps < 0.01 && i.model.throttle > 0.7 },
    ],
  },
  {
    id: 'school-landing',
    emoji: '🏁',
    title: '5. Slijetanje',
    brief: 'Prilaz kroz plave krugove, PAPI svjetla i meko slijetanje.',
    start: 'Sunčani otok',
    air: { back: 2200, height: 120, speed: 36, throttle: 0.3, flaps: 0.5 },
    steps: [
      {
        title: 'Prati plave krugove',
        tip: () => 'Leti kroz krugove. PAPI svjetla lijevo od piste: 2 bijela + 2 crvena = taman',
        done: (i) => distanceToThreshold(i) < 250,
      },
      { title: 'Iznad piste: gas na nulu', tip: (w) => keyOr(w, 'Drži F dok gas nije na nuli', 'Spusti GAS skroz dolje'), done: (i) => i.model.throttle < 0.05 || i.model.onGround },
      { title: 'Lagano podigni nos i sleti', tip: (w) => `Tik iznad piste malo nos gore (${w.noseUp}) da avion meko dotakne pistu`, done: () => false, onTouchdown: true },
      { title: 'Zakoči i stani', tip: (w) => keyOr(w, 'Drži razmak (kočnica)', 'Drži STOP'), done: (i) => i.model.onGround && i.model.speed < 2 },
    ],
  },
];

/** Metres still to fly to the runway's start end, measured along the runway. */
function distanceToThreshold(info: StepInfo): number {
  const a = info.airport;
  const threshold = a.pointAt(-a.length / 2, 0);
  const along = a.pointAt(1, 0).sub(a.pointAt(0, 0));
  return threshold.sub(info.model.position).setY(0).dot(along);
}

/** One go at a lesson. Plays the same part as a MissionRun in the game. */
export class LessonRun {
  elapsed = 0;
  readonly canDrop = false;
  private step = 0;
  private restarts = -1; // the first start (a restart() too) isn't a repeat
  private finished = false;
  private landingStars = 3;
  private readonly state: StepState = { time: 0, steady: 0, turned: 0, lastHeading: 0 };
  private headingKnown = false;

  constructor(
    readonly def: LessonDef,
    private readonly airport: Airport,
  ) {}

  restart(): void {
    this.step = 0;
    this.finished = false;
    this.elapsed = 0;
    this.restarts++;
    this.headingKnown = false;
    this.resetState();
  }

  dispose(): void {}

  /** Puts the plane where the lesson starts (lessons in the air don't begin on the runway). */
  placeStart(model: FlightModel): void {
    const air = this.def.air;
    if (!air) return;
    const a = this.airport;
    const spot = a.pointAt(-a.length / 2 - air.back, 0);
    model.position.set(spot.x, a.center.y + air.height + model.spec.gearHeight, spot.z);
    model.onGround = false;
    model.speed = air.speed;
    model.velocity.set(0, 0, -air.speed).applyQuaternion(model.quaternion);
    model.throttle = air.throttle;
    if (air.flaps) {
      model.cycleFlaps(); // to half, already out
      model.flaps = air.flaps;
    }
  }

  get currentStep(): Step | null {
    return this.finished ? null : this.def.steps[this.step];
  }

  /** The line with the arrow: "🎓 2/5 Ubrzaj po pisti". */
  objective(): string {
    const step = this.currentStep;
    return step ? `🎓 ${this.step + 1}/${this.def.steps.length} ${step.title}` : '🎓 Gotovo!';
  }

  /** What to press right now. */
  tip(words: Words): string | null {
    return this.currentStep?.tip(words) ?? null;
  }

  target(_model: FlightModel): Target | null {
    // The landing lesson points at its runway; the others only show the step.
    const landing = this.def.id === 'school-landing';
    return { name: this.objective(), x: landing ? this.airport.center.x : undefined, z: landing ? this.airport.center.z : undefined };
  }

  update(dt: number, model: FlightModel, altitude = 0): MissionUpdate | null {
    const step = this.currentStep;
    if (!step || model.crashed) return null;
    this.elapsed += dt;
    const s = this.state;
    s.time += dt;
    s.steady += dt;
    const heading = headingOf(model);
    if (!this.headingKnown) {
      s.lastHeading = heading;
      this.headingKnown = true;
    }
    let change = heading - s.lastHeading;
    if (change > 180) change -= 360;
    if (change < -180) change += 360;
    s.turned += change;
    s.lastHeading = heading;
    if (step.onTouchdown || !step.done({ model, altitude, state: s, airport: this.airport })) return null;
    return this.advance();
  }

  onLanding(landing: LandingResult): MissionUpdate | null {
    const step = this.currentStep;
    if (!step?.onTouchdown) return null;
    this.landingStars = Math.max(1, landing.stars);
    const next = this.advance();
    return { ...next, message: next.message ? `${landing.text} ${next.message}` : landing.text };
  }

  drop(_model?: FlightModel): MissionUpdate | null {
    return null;
  }

  private advance(): MissionUpdate {
    this.step++;
    this.resetState();
    if (this.step < this.def.steps.length) return { message: `✅ Bravo! Sad: ${this.def.steps[this.step].title}` };
    this.finished = true;
    const stars = Math.max(1, Math.min(3 - this.restarts, this.landingStars));
    const result: MissionResult = { stars, detail: this.restarts === 0 ? 'Bez ijednog ponavljanja!' : `Ponavljanja: ${this.restarts}` };
    return { done: result };
  }

  /** A fresh start for the next step (the heading carries on, so turns count from here). */
  private resetState(): void {
    Object.assign(this.state, { time: 0, steady: 0, turned: 0 });
  }
}
