import { Color, PerspectiveCamera, Scene, Timer, Vector3 } from 'three';
import { Aircraft } from './aircraft/Aircraft';
import { airlineById } from './aircraft/airlines';
import { AIRCRAFT } from './aircraft/catalog';
import { Radio, windWords } from './audio/Radio';
import { Sound } from './audio/Sound';
import { CAMERA_NAMES, CameraRig } from './camera/CameraRig';
import { AutoQuality } from './core/AutoQuality';
import { Graphics } from './core/Graphics';
import { Input, PAD_A } from './core/Input';
import { Autopilot, type AutopilotRefusal } from './game/Autopilot';
import { Balloons } from './game/Balloons';
import { BACK_AFTER, Dogfight, HEALTH, SLOT_COLORS, type DogfightEvent } from './game/Dogfight';
import { Room, type RoomError } from './net/Room';
import { newBadges } from './game/badges';
import { AMMO, Gun } from './game/Gun';
import { collision, planeAhead } from './game/collisions';
import { FlightLog } from './game/FlightLog';
import { hillAhead } from './game/hillWarning';
import { scoreLanding, starText } from './game/landing';
import { MissionRun, type MissionResult, type MissionUpdate } from './game/MissionRun';
import { LESSONS, LessonRun, type LessonDef, type Words } from './game/lessons';
import { MISSIONS, type MissionDef } from './game/missions';
import { Progress } from './game/Progress';
import { FlightModel, FUEL_LOW, FUEL_VERY_LOW, SEA_LEVEL, type FlightEvent } from './physics/FlightModel';
import { Cockpit } from './ui/Cockpit';
import { HUD } from './ui/HUD';
import { Instruments, type Target } from './ui/Instruments';
import { Menu, type Choice, type Quality } from './ui/Menu';
import { Minimap } from './ui/Minimap';
import { TouchControls } from './ui/TouchControls';
import { ISLANDS, MAP_HALF_SIZE } from './world/islands';
import { Traffic } from './world/Traffic';
import { Effects } from './world/Effects';
import { Environment, type TimeOfDay, type Weather } from './world/Environment';
import { LandingAids } from './world/LandingAids';
import { World } from './world/World';

const PHYSICS_STEP = 1 / 120; // s, fixed so the flight feels the same at any frame rate
const MAX_FRAME = 0.1; // s, ignore huge gaps (e.g. after switching tabs)
const RESPAWN_DELAY = 2.5; // s after a crash
const SHOW_AIRPORT_BEYOND = 1500; // m, the arrow points to the nearest airport once it is this far
const GEAR_WARNING_HEIGHT = 150; // m, descending below this with the wheels up warns the player

const touch = new TouchControls();
const scene = new Scene();
const camera = new PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.5, 15000);
const world = new World(scene);
const graphics = new Graphics(document.getElementById('app')!, scene, camera, world);
const terrain = world.terrain;
const effects = new Effects(scene);
world.effects = effects;
const traffic = new Traffic(scene, terrain, effects);
const environment = new Environment(scene, world);
const landingAids = new LandingAids(scene, terrain.airports);
// The light on smoke and spray at each time of day.
const SMOKE_LIGHT: Record<TimeOfDay, number> = { day: 0xffffff, sunset: 0xffcfa8, night: 0x46557a };
const input = new Input();
const hud = new HUD();
const sound = new Sound();
const radio = new Radio();
radio.muted = sound.isMuted;
/** Calls from the tower waiting to be made a little later (so they don't cover the start message). */
const pendingCalls: { at: number; kind: string; text: string }[] = [];
const flightLog = new FlightLog();
const autopilot = new Autopilot();
const autopilotButton = document.getElementById('ap-btn')!;
/** The fighter's gun, its trigger on screen, its sight, and balloons to practise on in free flight. */
let gun: Gun | null = null;
let practice: Balloons | null = null;
let practiceBackAt = Infinity;
let touchFiring = false;
let outOfAmmoSaid = false;
let supersonic = false;
const SPEED_OF_SOUND = 343; // m/s
const SIGHT_RANGE = 600; // m ahead where the gunsight shows the rounds arriving
const fireButton = document.getElementById('touch-fire')!;
const gunsight = document.getElementById('gunsight')!;
const sightPoint = new Vector3();
const autoQuality = new AutoQuality();
const REFUEL_RANGE = 900; // m from an airport's middle where a stopped plane is filled up
const REFUEL_BELOW = 0.98; // a tank fuller than this isn't topped up
const STRANDED_DELAY = 4; // s before a plane out of fuel away from any airport goes back to the start
let fuelWarned = 0; // 0 = no warning yet, 1 = "little fuel" given, 2 = "nearly empty" given
let refuelling = false; // standing at an airport filling up (until full or moving off)
const SAVE_EVERY = 10; // s between saves of the records while flying
let nextSave = 0;
const minimap = new Minimap(terrain);
const instruments = new Instruments();
const progress = new Progress();
const rig = new CameraRig(camera, terrain);
scene.add(camera); // the cockpit's panel rides on the camera
const cockpit = new Cockpit(camera);
const timer = new Timer();

let choice: Choice;
let model: FlightModel;
let aircraft: Aircraft | undefined;
let started = false;
let paused = false;
let hasFlown = false;
let respawnAt = Infinity;
let accumulator = 0;
/** The mission or flight-school lesson being flown, if any. */
let mission: MissionRun | LessonRun | null = null;

const menu = new Menu(AIRCRAFT, terrain.airports, MISSIONS, LESSONS, progress, {
  onStart: startFreeFlight,
  onMission: startMission,
  onLesson: startLesson,
  onEnvironment: setEnvironment,
  onControls: setControls,
  onRealism: (realism) => (model.realism = realism),
  onQuality: setQuality,
  onSteering: (tilt) => void setSteering(tilt, true),
  onHostRoom: () => void openRoom(null),
  onJoinRoom: (code) => void openRoom(code),
  onFlyInRoom: () => {
    menu.hide();
    setPaused(false);
  },
  onLeaveRoom: () => {
    leaveRoom();
    menu.setRoom(null);
  },
});
const missionDone = document.getElementById('mission-done')!;
const gearButton = document.getElementById('gear-btn')!;

function startFreeFlight(picked: Choice): void {
  leaveRoom();
  endMission();
  begin(picked);
  if (gun) {
    // Something to aim at: target balloons around the island you start from.
    const island = ISLANDS.find((i) => i.name === picked.airport.name)!;
    practice = new Balloons(scene, effects, terrain, island.x, island.z, 14, island.radius + 900, 5);
  }
  const who = picked.aircraft.liveries ? `${picked.aircraft.name} ${picked.airline.name}` : picked.aircraft.name;
  hud.flash(`${who} je spreman! ${say('Drži R za gas', 'Povuci GAS gore')} 🚀`, timer.getElapsed(), 3);
}

function startMission(def: MissionDef): void {
  leaveRoom();
  endMission();
  const picked: Choice = {
    aircraft: AIRCRAFT.find((a) => a.id === def.aircraft)!,
    airline: airlineById(def.airline),
    airport: terrain.airports.find((a) => a.name === def.start)!,
  };
  begin(picked);
  mission = new MissionRun(def, scene, terrain, picked.airport, effects);
  dropButton.classList.toggle('hidden', !mission.canDrop);
  dropButton.textContent = mission.dropIcon;
  dropButton.setAttribute('aria-label', mission.dropIcon === '📦' ? 'Baci paket' : 'Baci vodu');
  hud.flash(`${def.emoji} ${def.brief}`, timer.getElapsed(), 5);
}

function startLesson(def: LessonDef): void {
  leaveRoom();
  endMission();
  const picked: Choice = {
    aircraft: AIRCRAFT.find((a) => a.id === 'trainer')!,
    airline: airlineById(undefined),
    airport: terrain.airports.find((a) => a.name === def.start)!,
  };
  begin(picked);
  mission = new LessonRun(def, picked.airport);
  respawn(); // lessons in the air start up there
  hud.flash(`${def.emoji} ${def.title}: ${def.brief}`, timer.getElapsed(), 4);
}

/** "Starting over" in the words of what is being flown. */
function againText(): string {
  if (!mission) return 'Idemo opet…';
  return mission instanceof LessonRun ? 'Lekcija kreće ispočetka…' : 'Misija kreće ispočetka…';
}

/** Runs inside the click / key press that started the flight, so the browser lets the sound start. */
function begin(picked: Choice): void {
  sound.start();
  radio.reset();
  pendingCalls.length = 0;
  // Inside the tap that starts the flight, so iPhones and iPads may ask to use the tilt sensor.
  if (touch.enabled && menu.tilt) void setSteering(true, false);
  setup(picked);
  started = true;
  if (model.onGround) {
    const a = picked.airport;
    pendingCalls.push({ at: timer.getElapsed() + 3.5, kind: 'takeoff', text: `Toranj ${a.name}, pista ${a.runwayNumber()}, ${windWords(environment.wind.x, environment.wind.z)}. Slobodno za polijetanje!` });
  }
  setPaused(false);
  if (touch.enabled) goFullscreen();
}

function setEnvironment(time: TimeOfDay, weather: Weather): void {
  environment.set(time, weather);
  effects.setLight(new Color(SMOKE_LIGHT[time]));
  sound.setRain(weather === 'rain');
  model.wind.copy(environment.wind);
  model.turbulence = environment.turbulence;
}

function endMission(): void {
  mission?.dispose();
  mission = null;
  practice?.dispose();
  practice = null;
  practiceBackAt = Infinity;
  dropButton.classList.add('hidden');
  missionDone.classList.add('hidden');
}

function applyMission(update: MissionUpdate | null, now: number): void {
  if (!update) return;
  if (update.message) hud.flash(update.message, now, 2.5, update.warn);
  if (update.done) completeMission(update.done);
}

function completeMission(result: MissionResult): void {
  const def = mission!.def;
  const record = progress.recordMission(def.id, result.stars);
  checkBadges();
  document.getElementById('md-title')!.textContent = `${def.emoji} ${def.title}`;
  document.getElementById('md-stars')!.textContent = starText(result.stars);
  document.getElementById('md-detail')!.textContent = record ? `${result.detail} · Novi rekord!` : result.detail;
  missionDone.classList.remove('hidden');
  setPaused(true);
  sound.reward();
}

document.getElementById('md-again')!.addEventListener('click', () => {
  if (mission instanceof LessonRun) startLesson(mission.def);
  else if (mission) startMission(mission.def);
});
document.getElementById('md-missions')!.addEventListener('click', backToList);

/** From the "mission done" card back to the list it came from. */
function backToList(): void {
  const tab = mission instanceof LessonRun ? 'school' : 'missions';
  endMission();
  menu.show(tab);
}
document.getElementById('md-free')!.addEventListener('click', () => {
  // Carry on flying freely from where the mission ended.
  dropFocus();
  endMission();
  setPaused(false);
});

/** Real-plane controls (pull back = nose up) or the simpler "up is up". */
function setControls(real: boolean): void {
  input.realControls = touch.realControls = real;
  const [upKeys, downKeys] = real ? ['<kbd>S</kbd> / <kbd>↓</kbd>', '<kbd>W</kbd> / <kbd>↑</kbd>'] : ['<kbd>W</kbd> / <kbd>↑</kbd>', '<kbd>S</kbd> / <kbd>↓</kbd>'];
  document.getElementById('help-pitch')!.innerHTML = `${upKeys} nos gore &nbsp; ${downKeys} nos dolje`;
  updateStickHelp();
}

function updateStickHelp(): void {
  const real = input.realControls;
  document.getElementById('help-stick')!.textContent = touch.tilt.active
    ? `Naginji uređaj kao volan; vrh ${real ? 'prema sebi' : 'od sebe'} = nos gore. ⟳ = ravno`
    : real
      ? 'Desno: palica prema sebi = nos gore, od sebe = nos dolje'
      : 'Desno: palica gore = nos gore, dolje = nos dolje';
}

/** How to lift or lower the nose with the current controls, for tips on screen. */
function nose(): { upKeys: string; downKeys: string; upStick: string; downStick: string } {
  const tilt = touch.tilt.active;
  return input.realControls
    ? {
        upKeys: 'S ili ↓',
        downKeys: 'W ili ↑',
        upStick: tilt ? 'nagni vrh uređaja prema sebi' : 'povuci palicu prema sebi',
        downStick: tilt ? 'nagni vrh uređaja od sebe' : 'gurni palicu od sebe',
      }
    : {
        upKeys: 'W ili ↑',
        downKeys: 'S ili ↓',
        upStick: tilt ? 'nagni vrh uređaja od sebe' : 'gurni palicu gore',
        downStick: tilt ? 'nagni vrh uređaja prema sebi' : 'povuci palicu dolje',
      };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Picks the keyboard or the touch wording for a tip. */
function say(keys: string, fingers: string): string {
  return touch.enabled ? fingers : keys;
}

/** On phones: use the whole screen, sideways (works on Android; iPhones ignore it). */
function goFullscreen(): void {
  const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  document.documentElement
    .requestFullscreen?.()
    .then(() => orientation.lock?.('landscape'))
    .catch(() => {
      // Not allowed or not supported: the game still works in the normal page.
    });
}

/** Puts the chosen plane on the chosen airport's runway. */
function setup(picked: Choice): void {
  choice = picked;
  const airline = picked.aircraft.liveries ? picked.airline : undefined;
  if (aircraft?.type !== picked.aircraft || aircraft.airline !== airline) {
    if (aircraft) scene.remove(aircraft.object);
    aircraft = new Aircraft(picked.aircraft, airline);
    scene.add(aircraft.object);
    model = new FlightModel(picked.aircraft.spec);
    model.realism = menu.realism;
    model.wind.copy(environment.wind);
    model.turbulence = environment.turbulence;
    rig.distance = picked.aircraft.camera.distance;
    rig.height = picked.aircraft.camera.height;
    rig.cockpit.fromArray(picked.aircraft.camera.cockpit);
    cockpit.setStick(picked.aircraft.id === 'jet' || picked.aircraft.id === 'fighter');
    gun?.dispose(scene);
    gun = picked.aircraft.gun ? new Gun(scene, effects, new Vector3(...picked.aircraft.gun)) : null;
    fireButton.classList.toggle('hidden', !gun);
    document.getElementById('help-gun')!.classList.toggle('hidden', !gun);
    gearButton.classList.toggle('hidden', !picked.aircraft.spec.retractableGear);
    sound.setEngine(picked.aircraft.engine);
    effects.setExhausts(picked.aircraft.exhausts ?? []);
  }
  respawn();
}

function respawn(): void {
  model.reset(choice.airport.spawnPoint(), choice.airport.heading);
  progress.discover(choice.airport.name); // the island you start on doesn't need discovering
  mission?.restart();
  if (mission instanceof LessonRun) mission.placeStart(model);
  aircraft!.update(model, 0);
  aircraft!.object.visible = true; // it hides while its pilot floats down after being shot down
  dogfight?.restart();
  rig.snap(model);
  touch.reset();
  flightLog.reset();
  setAutopilot(false);
  gun?.reload();
  outOfAmmoSaid = false;
  supersonic = false;
  fuelWarned = 0;
  refuelling = false;
  respawnAt = Infinity;
  accumulator = 0;
}

/**
 * Tilt steering on or off. If the device can't tell its tilt (or the player says no), it
 * falls back to the stick; `explain` says so on screen.
 */
async function setSteering(tilt: boolean, explain: boolean): Promise<void> {
  const ok = await touch.useTilt(tilt);
  updateStickHelp();
  if (tilt && ok) {
    // A device without the sensor accepts but never reports a tilt.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (touch.tilt.working) return;
    await touch.useTilt(false);
    updateStickHelp();
  }
  if (tilt) {
    menu.setTilt(false);
    if (explain) hud.flash('📱 Ovaj uređaj ne može upravljati naginjanjem — koristi palicu', timer.getElapsed(), 4, true);
  }
}

function setQuality(quality: Quality): void {
  graphics.setQuality(quality);
  world.setQuality(quality);
  effects.setViewport(graphics.pixelHeight);
  autoQuality.restart();
}

/** Steps the picture down when the device can't keep the game smooth (unless the player chose a setting). */
function checkSmoothness(realDt: number, now: number): void {
  if (menu.qualityChosen) return;
  const step = autoQuality.update(realDt, graphics.level);
  if (step === 'fast') {
    setQuality('fast');
    menu.autoQuality('fast');
    hud.flash('⚡ Slika je prebačena na „Brzo" da igra teče glatko (možeš promijeniti u izborniku)', now, 4);
  } else if (step === 'lower') {
    graphics.lowerResolution();
    effects.setViewport(graphics.pixelHeight);
  }
}

function setPaused(value: boolean): void {
  paused = value;
  if (paused) radio.silence();
  sound.setPaused(paused);
}

setup(menu.choice); // show the plane on its runway behind the menu
setEnvironment(menu.time, menu.weather);
setQuality(menu.quality);
setControls(menu.realControls);

document.getElementById('menu-btn')!.addEventListener('click', toggleMenu);
document.getElementById('cam-btn')!.addEventListener('click', cycleCamera);
document.getElementById('flaps-btn')!.addEventListener('click', () => {
  dropFocus();
  if (started && !menu.visible && !paused) cycleFlaps();
});

function cycleFlaps(): void {
  const stage = model.cycleFlaps();
  const text = stage === 0 ? '🛬 Zakrilca uvučena' : stage < 1 ? '🛬 Zakrilca: pola' : '🛬 Zakrilca: skroz — za sporo slijetanje';
  hud.flash(text, timer.getElapsed(), 2);
  sound.flaps();
}

gearButton.addEventListener('click', () => {
  dropFocus();
  if (started && !menu.visible && !paused) toggleGear();
});

/** Switches the autopilot on (keeping the height, heading and speed of the moment) or off. */
function toggleAutopilot(): void {
  const now = timer.getElapsed();
  if (autopilot.engaged) return setAutopilot(false, '🤖 Autopilot isključen');
  if (mission instanceof LessonRun) return hud.flash('U školi letiš sam! 🙂', now, 2.5);
  const ground = Math.max(terrain.heightAt(model.position.x, model.position.z), SEA_LEVEL);
  const refusal = autopilot.engage(model, model.position.y - model.spec.gearHeight - ground);
  if (refusal) {
    const why: Record<AutopilotRefusal, string> = {
      ground: 'Autopilot radi samo u zraku — prvo poleti!',
      low: 'Prenisko za autopilot — popni se iznad 60 m',
      stall: 'Presporo za autopilot — prvo dodaj gas i spusti nos',
      engine: 'Bez motora autopilot ne može letjeti',
    };
    return hud.flash(`🤖 ${why[refusal]}`, now, 2.5, true);
  }
  const target = mission ? currentTarget() : null;
  setAutopilot(
    true,
    target?.x !== undefined
      ? `🤖 Autopilot vodi do cilja: ${target.name} (pomakni palicu za preuzimanje)`
      : `🤖 Autopilot drži visinu ${Math.round(model.position.y)} m i brzinu ${Math.round(model.speed * 3.6)} km/h`,
  );
}

function setAutopilot(on: boolean, message?: string): void {
  if (!on) autopilot.disengage();
  autopilotButton.classList.toggle('on', on);
  if (message) hud.flash(message, timer.getElapsed(), 3);
  if (message) sound.gear();
}

/** The autopilot lets go when it can't fly on, and says when it has brought the plane to the target. */
function checkAutopilot(now: number): void {
  if (!autopilot.engaged) return;
  if (model.crashed || model.onGround) return setAutopilot(false);
  if (model.stalled) return setAutopilot(false, '🤖 Autopilot isključen: presporo! Spusti nos i dodaj gas');
  if (!model.engineRunning) return setAutopilot(false, '🤖 Autopilot isključen: nema goriva');
  if (autopilot.arrived) {
    autopilot.arrived = false;
    hud.flash('🤖 Stigli smo do cilja! Autopilot leti ravno — preuzmi kad želiš', now, 4);
    sound.reward();
  }
}

function toggleGear(): void {
  const result = model.toggleGear();
  const messages = {
    up: '🛞 Kotači se uvlače…',
    down: '🛞 Kotači se izvlače…',
    fixed: model.spec.floats ? 'Plovke se ne mogu uvući.' : 'Ovaj avion ima fiksne kotače.',
    'on-ground': 'Kotači se mogu uvući tek u zraku.',
  };
  hud.flash(messages[result], timer.getElapsed(), 2);
  if (result === 'up' || result === 'down') sound.gear();
}
// The 🔫 button fires while held.
const setTouchFiring = (on: boolean) => {
  touchFiring = on;
  fireButton.classList.toggle('firing', on);
};
fireButton.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  setTouchFiring(true);
});
for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) fireButton.addEventListener(type, () => setTouchFiring(false));
autopilotButton.addEventListener('click', () => {
  (autopilotButton as HTMLButtonElement).blur();
  if (started && !paused && !menu.visible) toggleAutopilot();
});
const dropButton = document.getElementById('drop-btn')!;
dropButton.addEventListener('click', () => {
  dropFocus();
  if (started && !paused && !menu.visible) dropLoad(timer.getElapsed());
});

/** Lets go of what the mission carries (water on a fire). */
function dropLoad(now: number): void {
  if (mission && !model.crashed) applyMission(mission.drop(model), now);
}

document.getElementById('pause-btn')!.addEventListener('click', () => {
  dropFocus();
  if (dogfight) return noPause();
  if (started && !menu.visible) setPaused(!paused);
});

/** Drops focus so a later Space (brake) can't "click" a button again. */
function dropFocus(): void {
  (document.activeElement as HTMLElement | null)?.blur();
}

function cycleCamera(): void {
  dropFocus();
  hud.flash(`Kamera: ${CAMERA_NAMES[rig.cycle(model)]}`, timer.getElapsed(), 1.5);
}

function toggleMenu(): void {
  dropFocus();
  if (!missionDone.classList.contains('hidden')) {
    backToList();
  } else if (!menu.visible) {
    setPaused(true);
    menu.show();
  } else if (started) {
    // Closing without changing anything carries on with the same flight.
    menu.hide();
    setPaused(false);
  }
}

window.addEventListener('keydown', (e) => {
  // Starting from a key press (not the frame loop) keeps it a user gesture, which the sound needs.
  if (menu.freeFlightOpen && e.code === 'Enter') menu.start();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  graphics.resize();
  effects.setViewport(graphics.pixelHeight);
});

function handleEvents(events: FlightEvent[], now: number): void {
  for (const event of events) {
    if (event === 'takeoff') {
      if (!hasFlown) hud.hideHelp(); // out of the way once they've got it; H brings it back
      hud.flash(hasFlown ? 'Opet letiš! ✈️' : 'Bravo, letiš! 🎉', now);
      hasFlown = true;
      sound.takeoff();
      progress.updateStats((s) => s.flights++);
      progress.save();
      checkBadges();
    } else if (event === 'touchdown') {
      effects.touchdown(model);
      const landing = scoreLanding(model, terrain);
      recordLandingStats(landing.stars, landing.airport?.name);
      // Spoken only: the landing's stars are already on screen.
      if (landing.airport && landing.stars > 0) radio.call('landed', `Toranj ${landing.airport.name}: lijepo slijetanje, dobrodošli!`, now);
      const record = landing.airport && progress.recordLanding(landing.airport.name, landing.stars);
      hud.flash(record ? `${landing.text} Novi rekord!` : landing.text, now, 3.5);
      if (record) sound.reward();
      else sound.touchdown();
      if (mission) applyMission(mission.onLanding(landing), now);
    } else if (event === 'belly') {
      hud.flash('Ups, zaboravio si kotače! 🛞 Avion klizi po trbuhu…', now, 4, true);
      sound.scrape();
    } else if (event === 'crash') {
      hud.flash(mission ? `Bum! ${againText()}` : 'Bum! Ništa strašno, idemo opet…', now, RESPAWN_DELAY, true);
      respawnAt = now + RESPAWN_DELAY;
      effects.crash(model);
      sound.crash();
    } else if (event === 'collision') {
      hud.flash(`Bum! Sudar s drugim avionom 💥 ${againText()}`, now, RESPAWN_DELAY, true);
      respawnAt = now + RESPAWN_DELAY;
      effects.crash(model);
      sound.crash();
    } else if (event === 'engine-out') {
      const { airport } = terrain.nearestAirport(model.position.x, model.position.z);
      if (!model.onGround) {
        hud.flash(`⛽ Nema goriva, motor je stao! Kliži prema pisti (${airport.name}) i sleti`, now, 5, true);
        radio.call('engine-out', `Ostali ste bez goriva. Klizite prema aerodromu ${airport.name}.`, now);
      }
    } else if (event === 'splash') {
      hud.flash(`Pljus! 🌊 Ovaj avion ne zna plivati. ${againText()}`, now, RESPAWN_DELAY, true);
      respawnAt = now + RESPAWN_DELAY;
      effects.splash(model);
      sound.splash();
    }
  }
}

/**
 * Fuel (not in arcade): warnings as the tank empties, filling up standing still at an airport,
 * and back to the start when stuck without fuel far from one.
 */
function updateFuel(dt: number, now: number): void {
  if (model.realism === 'arcade' || model.crashed) {
    refuelling = false;
    return;
  }
  const { airport, distance } = terrain.nearestAirport(model.position.x, model.position.z);
  const level = model.fuel < FUEL_VERY_LOW ? 2 : model.fuel < FUEL_LOW ? 1 : 0;
  if (level < fuelWarned) fuelWarned = level; // filled up again
  if (level > fuelWarned && model.fuel > 0) {
    fuelWarned = level;
    if (level === 1) {
      hud.flash(`⛽ Malo goriva! Sleti na aerodrom i stani da natankaš (najbliži: ${airport.name})`, now, 4.5, true);
      radio.call('fuel', `Malo vam je goriva. Najbliži aerodrom je ${airport.name}.`, now, 5);
    } else {
      hud.flash('⛽ Gorivo je skoro potrošeno! Sleti što prije', now, 4, true);
      radio.call('fuel', 'Gorivo pri kraju, sletite odmah!', now, 5);
    }
  }
  const stopped = model.onGround && model.speed < 1 && !model.bellyLanded;
  // Starts once a little fuel is used (the idle engine sips some while standing), then fills right up.
  refuelling = stopped && distance < REFUEL_RANGE && (refuelling || model.fuel < REFUEL_BELOW);
  if (refuelling && model.refuel(dt)) {
    refuelling = false;
    hud.flash('⛽ Pun rezervoar! Možeš opet letjeti', now, 3);
    sound.reward();
  } else if (stopped && !model.engineRunning && distance >= REFUEL_RANGE && respawnAt === Infinity) {
    hud.flash('⛽ Bez goriva, a aerodrom je daleko. Vraćamo te na početak…', now, STRANDED_DELAY, true);
    respawnAt = now + STRANDED_DELAY;
  }
}

// --- Playing with friends: a dogfight in a room (see game/Dogfight.ts and net/Room.ts) ---
let dogfight: Dogfight | null = null;
const FIGHTER = AIRCRAFT.find((a) => a.id === 'fighter')!;
const scoreboard = document.getElementById('scoreboard')!;
let scoreboardHtml = '';

/** Makes a new room (`code` null) or joins a friend's; then everyone flies a fighter in it. */
async function openRoom(code: string | null): Promise<void> {
  // Inside the tap, while the browser still lets the sound start and the screen go full.
  sound.start();
  if (touch.enabled) goFullscreen();
  const { name, avatar } = progress.profile;
  menu.setRoomStatus(code ? `Spajam se na sobu ${code}…` : 'Otvaram sobu…');
  try {
    const room = code ? await Room.join(code, name, avatar) : await Room.host(name, avatar);
    startDogfight(room);
  } catch (error) {
    const why: Record<RoomError, string> = {
      'not-found': `Soba ${code} ne postoji (ili je zatvorena). Provjeri kod.`,
      full: 'Ta soba je puna (6 pilota).',
      network: 'Spajanje nije uspjelo — provjeri internet i pokušaj opet.',
      closed: 'Soba je zatvorena.',
    };
    menu.setRoomStatus(why[error as RoomError] ?? why.network, true);
  }
}

function startDogfight(room: Room): void {
  leaveRoom();
  endMission();
  dogfight = new Dogfight(room, scene, effects, terrain, FIGHTER);
  dogfight.onEvent = onDogfightEvent;
  begin({ aircraft: FIGHTER, airline: airlineById(undefined), airport: terrain.airports[dogfight.startAirport()] });
  menu.hide();
  updateRoomInMenu();
  hud.flash(
    room.isHost
      ? `👥 Soba ${room.code} je otvorena! Reci prijateljima kod ${room.code} — oni ga upišu pod „S prijateljima”`
      : `👥 U sobi ${room.code} si! Poleti i nađi protivnike — strelica 🎯 ih pokazuje`,
    timer.getElapsed(),
    6,
  );
}

function leaveRoom(): void {
  if (!dogfight) return;
  dogfight.dispose();
  dogfight = null;
  scoreboard.classList.add('hidden');
  scoreboardHtml = '';
}

function noPause(): void {
  hud.flash('U igri s prijateljima nema pauze — oni lete dalje!', timer.getElapsed(), 2);
}

function updateRoomInMenu(): void {
  if (!dogfight) return menu.setRoom(null);
  menu.setRoom({ code: dogfight.room.code, pilots: dogfight.board.map((b) => b.player.name) });
}

function onDogfightEvent(event: DogfightEvent): void {
  const now = timer.getElapsed();
  switch (event.kind) {
    case 'join':
      hud.flash(`👋 U sobu stiže ${event.name}!`, now, 3);
      updateRoomInMenu();
      break;
    case 'left':
      hud.flash(`👋 ${event.name} više nije u sobi`, now, 3);
      updateRoomInMenu();
      break;
    case 'hit-me':
      hud.flash(`💥 Pogodak od: ${event.by}! (još ${event.health}/${HEALTH})`, now, 1.5, true);
      break;
    case 'down-me':
      // Our pilot bails out; the plane is gone, and in a moment we start again on our runway.
      dogfight!.bailOut(model);
      model.crashed = true;
      aircraft!.object.visible = false;
      setAutopilot(false);
      respawnAt = now + BACK_AFTER;
      hud.flash(`🪂 Oboren si (${event.by})! Iskačeš padobranom — za tren si opet na pisti`, now, BACK_AFTER, true);
      sound.crash();
      break;
    case 'scored':
      hud.flash(`🏆 Pogodak! ${event.victim} iskače padobranom 🪂`, now, 3);
      sound.reward();
      break;
    case 'other-down':
      hud.flash(`💥 ${event.by} 🎯 ${event.victim} — padobran 🪂`, now, 2.5);
      break;
    case 'closed':
      hud.flash('Soba je zatvorena (domaćin je otišao). Letiš dalje bez prijatelja.', now, 4, true);
      leaveRoom();
      menu.setRoom(null);
      break;
  }
}

/** Everyone's score, in their colours, under the instruments. */
function updateScoreboard(): void {
  if (!dogfight) return;
  const rows = dogfight.board
    .map(({ player, score, me }) => {
      const dot = `<span class="dot" style="background:${SLOT_COLORS[player.slot % SLOT_COLORS.length]}"></span>`;
      return `<div class="${me ? 'me' : ''}">${dot}${escapeHtml(player.name)} ${score}</div>`;
    })
    .join('');
  const html = `<div class="code">Soba ${dogfight.room.code}</div>${rows}`;
  if (html !== scoreboardHtml) {
    scoreboardHtml = html;
    scoreboard.innerHTML = html;
  }
  scoreboard.classList.toggle('hidden', !started || menu.visible);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The trigger: X, or Space / the gamepad's A in the air (on the ground they brake), or the 🔫 button. */
function triggerHeld(): boolean {
  const airborne = !model.onGround;
  return input.isHeld('KeyX') || touchFiring || (airborne && (input.isHeld('Space') || input.padHeld(PAD_A)));
}

/** Fires the gun, bursts balloons (counting them for the mission or practice), refills it at airports. */
function updateGun(dt: number, now: number): void {
  practice?.update(dt);
  if (practice && now >= practiceBackAt) {
    practice.reset();
    practiceBackAt = Infinity;
    hud.flash('🎈 Nove mete su gore!', now, 2.5);
  }
  if (!gun) return;
  const balloons = mission instanceof MissionRun ? (mission.balloons ?? null) : practice;
  const { fired, strikes } = gun.update(dt, model, triggerHeld() && !model.onGround, terrain, [balloons, traffic, world, dogfight]);
  if (fired) sound.gunshot();
  const burst = strikes.filter((s) => s.kind === 'balloon').length;
  for (const strike of strikes) {
    if (strike.kind === 'balloon' || !strike.down) continue;
    const messages = {
      plane: '💥 Srušio si avion! Posada je iskočila — padobrani su se otvorili 🪂',
      house: '🏚️ Srušeno! Za minutu-dvije bit će opet sagrađeno',
      parked: '🔥 Pogodio si parkirani avion!',
    };
    hud.flash(messages[strike.kind], now, 3);
    if (strike.kind === 'plane') radio.call('mayday', 'Mayday, mayday! Pogođeni smo, iskačemo!', now, 8);
    else sound.crash();
  }
  if (burst) {
    sound.pop();
    progress.updateStats((s) => (s.balloons += burst));
    if (mission instanceof MissionRun) applyMission(mission.onBurst(burst), now);
    else if (practice) {
      const left = practice.left;
      hud.flash(left ? `🎈 Pogodak! Još ${left} balona` : '🎈 Sve mete pogođene! Bravo! Nove stižu za tren…', now, 2.5);
      if (!left) practiceBackAt = now + 5;
    }
    checkBadges();
  }
  if (fired && gun.ammo === 0 && !outOfAmmoSaid) {
    outOfAmmoSaid = true;
    hud.flash('🔫 Nema više metaka — stani na nekom aerodromu da napuniš', now, 3.5, true);
  }
  // Standing at an airport, the gun is filled again.
  const stopped = model.onGround && model.speed < 1 && !model.crashed;
  if (stopped && gun.ammo < AMMO && terrain.nearestAirport(model.position.x, model.position.z).distance < REFUEL_RANGE) {
    gun.reload();
    outOfAmmoSaid = false;
    hud.flash(`🔫 Mitraljez napunjen (${AMMO} metaka)`, now, 2.5);
  }
}

/** Faster than sound: a double boom and a cloud of vapour round the plane. */
function checkSoundBarrier(now: number): void {
  if (model.crashed) return;
  if (!supersonic && model.speed >= SPEED_OF_SOUND) {
    supersonic = true;
    sound.sonicBoom();
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const ring = new Vector3(Math.cos(a) * 3, Math.sin(a) * 3, 0).applyQuaternion(model.quaternion).add(model.position);
      effects.emit('vapor', ring, model.velocity.clone().multiplyScalar(0.92), 2);
    }
    hud.flash(`💥 Probio si zvučni zid! ${Math.round(model.speed * 3.6)} km/h — brži si od zvuka!`, now, 3.5);
    progress.updateStats((s) => s.supersonic++);
    checkBadges();
  } else if (supersonic && model.speed < SPEED_OF_SOUND * 0.95) {
    supersonic = false;
  }
}

/** The gunsight sits where the rounds would be SIGHT_RANGE metres ahead. */
function updateGunsight(): void {
  const show = !!gun && started && !menu.visible && !model.crashed && !model.onGround;
  if (show) {
    gun!.aimPoint(model, SIGHT_RANGE, sightPoint).project(camera);
    const visible = sightPoint.z < 1 && Math.abs(sightPoint.x) < 1 && Math.abs(sightPoint.y) < 1;
    gunsight.classList.toggle('hidden', !visible);
    if (visible) {
      gunsight.style.left = `${((sightPoint.x + 1) / 2) * window.innerWidth}px`;
      gunsight.style.top = `${((1 - sightPoint.y) / 2) * window.innerHeight}px`;
    }
  } else {
    gunsight.classList.add('hidden');
  }
  hud.setAmmo(gun ? gun.ammo : null);
}

/** Counts a landing towards the records and badges. */
function recordLandingStats(stars: number, airport: string | undefined): void {
  const onWater = terrain.heightAt(model.position.x, model.position.z) < SEA_LEVEL;
  progress.updateStats((s) => {
    if (stars > 0 || onWater) s.landings++;
    if (stars === 3) s.perfectLandings++;
    if (airport && !s.airports.includes(airport)) s.airports.push(airport);
    if (onWater) s.waterLandings++;
    if (environment.time === 'night' && (stars > 0 || onWater)) s.nightLandings++;
    if (stars > 0) s.softestLanding = Math.min(s.softestLanding ?? Infinity, model.lastTouchdown.sink);
  });
  progress.save();
  checkBadges();
}

/** Hands out any badges just earned, one message each. */
function checkBadges(): void {
  const earned = newBadges(progress, { missions: MISSIONS.map((m) => m.id), lessons: LESSONS.map((l) => l.id), airports: terrain.airports.length });
  // A moment after whatever earned them, so that message is read first; one after another.
  earned.forEach((badge, i) => {
    setTimeout(() => {
      hud.flash(`🏅 Nova značka: ${badge.emoji} ${badge.title}!`, timer.getElapsed(), 3.5);
      sound.reward();
    }, 1500 + i * 3600);
  });
}

/** Flying over an island for the first time "discovers" it, like collecting a sticker. */
function checkDiscovery(now: number): void {
  if (model.onGround || model.crashed) return;
  const island = terrain.islandAt(model.position.x, model.position.z);
  if (island && progress.discover(island.name)) {
    hud.flash(`🏝️ Otkrio si: ${island.name}! (${progress.discovered.length}/${ISLANDS.length})`, now, 3.5);
    sound.reward();
    checkBadges();
  }
}

/** Where the arrow at the top points: the mission's goal, or else the nearest airport once it is far enough away. */
function currentTarget(): Target | null {
  if (mission) return mission.target(model);
  if (dogfight) return dogfight.nearestFoe(model.position);
  const { airport, distance } = terrain.nearestAirport(model.position.x, model.position.z);
  if (distance < SHOW_AIRPORT_BEYOND) return null;
  return { name: `✈ ${airport.name}`, x: airport.center.x, z: airport.center.z };
}

/** The tower clears the plane to take off and to land, as at a real airport. */
function talkToTower(now: number, altitude: number): void {
  const due = pendingCalls.findIndex((c) => now >= c.at);
  if (due >= 0) {
    const [c] = pendingCalls.splice(due, 1);
    const text = radio.call(c.kind, c.text, now);
    if (text) hud.flash(`📻 ${text}`, now, 4);
  }
  const lined = landingAids.approachAhead(model);
  if (lined && altitude < 700 && model.velocity.y < 1) {
    const { airport, reverse } = lined.approach;
    const text = radio.call(
      `approach ${airport.name} ${reverse}`,
      `Toranj ${airport.name}, pista ${airport.runwayNumber(reverse)}, ${windWords(environment.wind.x, environment.wind.z)}. Slobodno za slijetanje!`,
      now,
      180,
    );
    if (text) hud.flash(`📻 ${text}`, now, 4);
  }
}

/** Gentle tips for whatever the player is doing right now. */
function updateHint(now: number, altitude: number): void {
  if (!started || menu.visible) return hud.hint(null, now);
  if (paused) return hud.hint(say('Pauza — pritisni P za nastavak', 'Pauza — dodirni ⏸ za nastavak'), now);
  if (model.crashed) return hud.hint(null, now);
  const { upKeys, downKeys, upStick, downStick } = nose();
  if (model.stalled) return hud.hint(say(`Presporo! Dodaj gas (R) i spusti nos (${downKeys})`, `Presporo! Dodaj gas i ${downStick}`), now, true);
  if (hillAhead(model, terrain)) return hud.hint(say(`⛰️ Pazi, brdo! Digni nos (${upKeys})!`, `⛰️ Pazi, brdo! ${capitalize(upStick)}!`), now, true);
  if (!model.onGround && planeAhead(model, traffic.obstacles)) {
    radio.call('traffic', 'Pažnja, promet ispred vas!', now);
    return hud.hint('✈️ Pazi, avion ispred! Skreni ili promijeni visinu', now, true);
  }
  const landingWithoutWheels = model.spec.retractableGear && !model.gearDown && !model.onGround && altitude < GEAR_WARNING_HEIGHT && model.velocity.y < -1;
  if (landingWithoutWheels) {
    radio.call('gear', 'Provjerite kotače!', now);
    return hud.hint(say('🛞 Izvuci kotače (G)!', '🛞 Izvuci kotače (gumb 🛞)!'), now, true);
  }
  if (refuelling) return hud.hint(`⛽ Tankanje… ${Math.floor(model.fuel * 100)} %`, now);
  if (mission instanceof LessonRun) {
    const words: Words = { touch: touch.enabled, noseUp: say(upKeys, upStick), noseDown: say(downKeys, downStick) };
    return hud.hint(mission.tip(words), now);
  }
  if (model.onGround && !hasFlown) {
    if (model.throttle < 0.3 && model.speed < 5) return hud.hint(`${say('Drži R za gas', 'Povuci GAS gore')}! 🚀`, now);
    if (model.speed >= model.spec.rotateSpeed) return hud.hint(say(`Sad drži ${upKeys} i poleti!`, `Sad ${upStick} i poleti!`), now);
    return hud.hint(null, now);
  }
  const { x, z } = model.position;
  if (Math.abs(x) > MAP_HALF_SIZE || Math.abs(z) > MAP_HALF_SIZE) {
    return hud.hint('Kraj karte! Okreni se natrag prema otocima', now);
  }
  hud.hint(null, now);
}

function frame(time: number): void {
  requestAnimationFrame(frame);
  timer.update(time);
  const realDt = timer.getDelta();
  const dt = Math.min(realDt, MAX_FRAME);
  const now = timer.getElapsed();

  input.poll(); // gamepad buttons become key taps
  if (input.wasTapped('KeyH')) hud.toggleHelp();
  if (input.wasTapped('Escape')) toggleMenu();
  const playing = started && !menu.visible && missionDone.classList.contains('hidden');
  if (playing) {
    if (input.wasTapped('KeyC')) cycleCamera();
    if (input.wasTapped('KeyG') && !paused) toggleGear();
    if (input.wasTapped('KeyT') && !paused) toggleAutopilot();
    if (input.wasTapped('KeyV') && !paused) cycleFlaps();
    if (input.wasTapped('KeyB') && !paused) dropLoad(now);
    if (input.wasTapped('KeyP')) {
      if (dogfight) noPause();
      else setPaused(!paused);
    }
    if (input.wasTapped('KeyN')) respawn();
    if (input.wasTapped('KeyM')) {
      radio.muted = sound.toggleMute();
      if (radio.muted) radio.silence();
      hud.flash(radio.muted ? 'Zvuk isključen 🔇' : 'Zvuk uključen 🔊', now, 1.5);
    }
  }

  if (playing && !paused) {
    checkSmoothness(realDt, now);
    const controls = touch.apply(input.controls(dt));
    if (autopilot.engaged && autopilot.pilotTookOver(controls)) setAutopilot(false, '🤖 Autopilot isključen — ti upravljaš');
    const target = autopilot.engaged && mission ? currentTarget() : null;
    const goTo = target?.x !== undefined && target.z !== undefined ? { x: target.x, z: target.z } : null;
    accumulator += dt;
    while (accumulator >= PHYSICS_STEP) {
      const flying = autopilot.engaged ? autopilot.fly(model, controls, PHYSICS_STEP, terrain, goTo) : controls;
      handleEvents(model.step(PHYSICS_STEP, flying, terrain), now);
      accumulator -= PHYSICS_STEP;
    }
    checkAutopilot(now);
    // Flying (or taxiing) into another plane.
    const bumped = model.crashed ? null : collision(model, [...traffic.obstacles, ...world.parked]);
    if (bumped) {
      traffic.knockOut(bumped);
      handleEvents(model.collide(), now);
    }
    // After sliding to a stop on its belly, the plane goes back to the start.
    if (model.bellyLanded && model.speed < 0.5 && respawnAt === Infinity) respawnAt = now + 2;
    if (now >= respawnAt) respawn();
    if (mission instanceof LessonRun && !model.crashed) {
      const ground = Math.max(terrain.heightAt(model.position.x, model.position.z), SEA_LEVEL);
      applyMission(mission.update(dt, model, model.position.y - model.spec.gearHeight - ground), now);
    } else if (mission && !model.crashed) applyMission(mission.update(dt, model), now);
    checkDiscovery(now);
    updateFuel(dt, now);
    updateGun(dt, now);
    checkSoundBarrier(now);
    const trick = flightLog.update(dt, model, progress.stats);
    if (trick) {
      progress.updateStats((s) => (trick === 'loop' ? s.loops++ : s.rolls++));
      hud.flash(trick === 'loop' ? '🔄 Looping! Bravo!' : '🌀 Valjak! Bravo!', now, 2.5);
      sound.reward();
      checkBadges();
    }
    if (now >= nextSave) {
      nextSave = now + SAVE_EVERY;
      progress.save();
      checkBadges(); // height, speed and distance badges
    }
    // The physics moves in fixed steps, so the plane's position is up to one step behind "now", by a
    // varying amount each frame (at a fighter's 1200 km/h, nearly 3 m): drawn as it is, it would shake.
    // Draw it (and aim the camera) where it is at this very moment.
    const lead = model.crashed || model.onGround ? 0 : accumulator;
    model.position.addScaledVector(model.velocity, lead);
    aircraft!.update(model, dt);
    rig.update(model, dt);
    model.position.addScaledVector(model.velocity, -lead);
    sound.update(model);
  }
  input.endFrame();
  if (!paused) traffic.update(dt);
  // The others fly on even while our menu is open: keep drawing them and telling them where we are.
  if (dogfight) {
    dogfight.update(dt, model, triggerHeld() && !model.onGround && !paused);
    updateScoreboard();
  }
  // A shot-down plane hitting the ground close by is heard.
  for (const crash of traffic.crashes.splice(0)) if (crash.distanceTo(model.position) < 2500) sound.crash();

  const below = Math.max(terrain.heightAt(model.position.x, model.position.z), SEA_LEVEL);
  const altitude = model.position.y - model.spec.gearHeight - below;
  world.update(model.position, camera.position, paused ? 0 : dt);
  environment.update(paused ? 0 : dt, camera.position);
  effects.update(paused ? 0 : dt, model, terrain);
  // Guide rings for beginners; the PAPI lights help in every mode.
  landingAids.update(model, started && model.realism !== 'realistic');
  if (started && !paused && !menu.visible) talkToTower(now, altitude);
  updateHint(now, altitude);
  hud.update(model, now, altitude);
  const target = started ? currentTarget() : null;
  minimap.update(model, traffic.positions, mission ? target : null, dogfight?.foes);
  instruments.update(model, target);
  touch.update(model.throttle);
  updateGunsight();
  cockpit.update(model, started && rig.mode === 'cockpit', paused ? 0 : dt);
  graphics.render();
}
requestAnimationFrame(frame);
