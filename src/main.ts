import { Color, PerspectiveCamera, Scene, Timer } from 'three';
import { Aircraft } from './aircraft/Aircraft';
import { airlineById } from './aircraft/airlines';
import { AIRCRAFT } from './aircraft/catalog';
import { Sound } from './audio/Sound';
import { CAMERA_NAMES, CameraRig } from './camera/CameraRig';
import { Graphics } from './core/Graphics';
import { Input } from './core/Input';
import { hillAhead } from './game/hillWarning';
import { scoreLanding, starText } from './game/landing';
import { MissionRun, type MissionResult, type MissionUpdate } from './game/MissionRun';
import { MISSIONS, type MissionDef } from './game/missions';
import { Progress } from './game/Progress';
import { FlightModel, SEA_LEVEL, type FlightEvent } from './physics/FlightModel';
import { HUD } from './ui/HUD';
import { Instruments, type Target } from './ui/Instruments';
import { Menu, type Choice, type Quality } from './ui/Menu';
import { Minimap } from './ui/Minimap';
import { TouchControls } from './ui/TouchControls';
import { ISLANDS, MAP_HALF_SIZE } from './world/islands';
import { Traffic } from './world/Traffic';
import { Effects } from './world/Effects';
import { Environment, type TimeOfDay, type Weather } from './world/Environment';
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
const traffic = new Traffic(scene, terrain);
const environment = new Environment(scene, world);
const effects = new Effects(scene);
// The light on smoke and spray at each time of day.
const SMOKE_LIGHT: Record<TimeOfDay, number> = { day: 0xffffff, sunset: 0xffcfa8, night: 0x46557a };
const input = new Input();
const hud = new HUD();
const sound = new Sound();
const minimap = new Minimap(terrain);
const instruments = new Instruments();
const progress = new Progress();
const rig = new CameraRig(camera, terrain);
const timer = new Timer();

let choice: Choice;
let model: FlightModel;
let aircraft: Aircraft | undefined;
let started = false;
let paused = false;
let hasFlown = false;
let respawnAt = Infinity;
let accumulator = 0;
let mission: MissionRun | null = null;

const menu = new Menu(AIRCRAFT, terrain.airports, MISSIONS, progress, {
  onStart: startFreeFlight,
  onMission: startMission,
  onEnvironment: setEnvironment,
  onControls: setControls,
  onRealism: (realism) => (model.realism = realism),
  onQuality: setQuality,
});
const missionDone = document.getElementById('mission-done')!;
const gearButton = document.getElementById('gear-btn')!;

function startFreeFlight(picked: Choice): void {
  endMission();
  begin(picked);
  const who = picked.aircraft.liveries ? `${picked.aircraft.name} ${picked.airline.name}` : picked.aircraft.name;
  hud.flash(`${who} je spreman! ${say('Drži R za gas', 'Povuci GAS gore')} 🚀`, timer.getElapsed(), 3);
}

function startMission(def: MissionDef): void {
  endMission();
  const picked: Choice = {
    aircraft: AIRCRAFT.find((a) => a.id === def.aircraft)!,
    airline: airlineById(def.airline),
    airport: terrain.airports.find((a) => a.name === def.start)!,
  };
  begin(picked);
  mission = new MissionRun(def, scene, terrain, picked.airport);
  hud.flash(`${def.emoji} ${def.brief}`, timer.getElapsed(), 5);
}

/** Runs inside the click / key press that started the flight, so the browser lets the sound start. */
function begin(picked: Choice): void {
  sound.start();
  setup(picked);
  started = true;
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
  document.getElementById('md-title')!.textContent = `${def.emoji} ${def.title}`;
  document.getElementById('md-stars')!.textContent = starText(result.stars);
  document.getElementById('md-detail')!.textContent = record ? `${result.detail} · Novi rekord!` : result.detail;
  missionDone.classList.remove('hidden');
  setPaused(true);
  sound.reward();
}

document.getElementById('md-again')!.addEventListener('click', () => startMission(mission!.def));
document.getElementById('md-missions')!.addEventListener('click', () => {
  endMission();
  menu.show('missions');
});
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
  document.getElementById('help-stick')!.textContent = real
    ? 'Desno: palica prema sebi = nos gore, od sebe = nos dolje'
    : 'Desno: palica gore = nos gore, dolje = nos dolje';
}

/** How to lift or lower the nose with the current controls, for tips on screen. */
function nose(): { upKeys: string; downKeys: string; upStick: string; downStick: string } {
  return input.realControls
    ? { upKeys: 'S ili ↓', downKeys: 'W ili ↑', upStick: 'povuci palicu prema sebi', downStick: 'gurni palicu od sebe' }
    : { upKeys: 'W ili ↑', downKeys: 'S ili ↓', upStick: 'gurni palicu gore', downStick: 'povuci palicu dolje' };
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
  aircraft!.update(model, 0);
  rig.snap(model);
  touch.reset();
  respawnAt = Infinity;
  accumulator = 0;
}

function setQuality(quality: Quality): void {
  graphics.setQuality(quality);
  effects.setViewport(graphics.pixelHeight);
}

function setPaused(value: boolean): void {
  paused = value;
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
document.getElementById('pause-btn')!.addEventListener('click', () => {
  dropFocus();
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
    endMission();
    menu.show('missions');
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
    } else if (event === 'touchdown') {
      effects.touchdown(model);
      const landing = scoreLanding(model, terrain);
      const record = landing.airport && progress.recordLanding(landing.airport.name, landing.stars);
      hud.flash(record ? `${landing.text} Novi rekord!` : landing.text, now, 3.5);
      if (record) sound.reward();
      else sound.touchdown();
      if (mission) applyMission(mission.onLanding(landing), now);
    } else if (event === 'belly') {
      hud.flash('Ups, zaboravio si kotače! 🛞 Avion klizi po trbuhu…', now, 4, true);
      sound.scrape();
    } else if (event === 'crash') {
      hud.flash(mission ? 'Bum! Misija kreće ispočetka…' : 'Bum! Ništa strašno, idemo opet…', now, RESPAWN_DELAY, true);
      respawnAt = now + RESPAWN_DELAY;
      effects.crash(model);
      sound.crash();
    } else if (event === 'splash') {
      hud.flash(`Pljus! 🌊 Ovaj avion ne zna plivati. ${mission ? 'Misija kreće ispočetka…' : 'Idemo opet…'}`, now, RESPAWN_DELAY, true);
      respawnAt = now + RESPAWN_DELAY;
      effects.splash(model);
      sound.splash();
    }
  }
}

/** Flying over an island for the first time "discovers" it, like collecting a sticker. */
function checkDiscovery(now: number): void {
  if (model.onGround || model.crashed) return;
  const island = terrain.islandAt(model.position.x, model.position.z);
  if (island && progress.discover(island.name)) {
    hud.flash(`🏝️ Otkrio si: ${island.name}! (${progress.discovered.length}/${ISLANDS.length})`, now, 3.5);
    sound.reward();
  }
}

/** Where the arrow at the top points: the mission's goal, or else the nearest airport once it is far enough away. */
function currentTarget(): Target | null {
  if (mission) return mission.target(model);
  const { airport, distance } = terrain.nearestAirport(model.position.x, model.position.z);
  if (distance < SHOW_AIRPORT_BEYOND) return null;
  return { name: `✈ ${airport.name}`, x: airport.center.x, z: airport.center.z };
}

/** Gentle tips for whatever the player is doing right now. */
function updateHint(now: number, altitude: number): void {
  if (!started || menu.visible) return hud.hint(null, now);
  if (paused) return hud.hint(say('Pauza — pritisni P za nastavak', 'Pauza — dodirni ⏸ za nastavak'), now);
  if (model.crashed) return hud.hint(null, now);
  const { upKeys, downKeys, upStick, downStick } = nose();
  if (model.stalled) return hud.hint(say(`Presporo! Dodaj gas (R) i spusti nos (${downKeys})`, `Presporo! Dodaj gas i ${downStick}`), now, true);
  if (hillAhead(model, terrain)) return hud.hint(say(`⛰️ Pazi, brdo! Digni nos (${upKeys})!`, `⛰️ Pazi, brdo! ${capitalize(upStick)}!`), now, true);
  const landingWithoutWheels = model.spec.retractableGear && !model.gearDown && !model.onGround && altitude < GEAR_WARNING_HEIGHT && model.velocity.y < -1;
  if (landingWithoutWheels) return hud.hint(say('🛞 Izvuci kotače (G)!', '🛞 Izvuci kotače (gumb 🛞)!'), now, true);
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
  const dt = Math.min(timer.getDelta(), MAX_FRAME);
  const now = timer.getElapsed();

  input.poll(); // gamepad buttons become key taps
  if (input.wasTapped('KeyH')) hud.toggleHelp();
  if (input.wasTapped('Escape')) toggleMenu();
  const playing = started && !menu.visible && missionDone.classList.contains('hidden');
  if (playing) {
    if (input.wasTapped('KeyC')) cycleCamera();
    if (input.wasTapped('KeyG') && !paused) toggleGear();
    if (input.wasTapped('KeyV') && !paused) cycleFlaps();
    if (input.wasTapped('KeyP')) setPaused(!paused);
    if (input.wasTapped('KeyN')) respawn();
    if (input.wasTapped('KeyM')) hud.flash(sound.toggleMute() ? 'Zvuk isključen 🔇' : 'Zvuk uključen 🔊', now, 1.5);
  }

  if (playing && !paused) {
    const controls = touch.apply(input.controls(dt));
    accumulator += dt;
    while (accumulator >= PHYSICS_STEP) {
      handleEvents(model.step(PHYSICS_STEP, controls, terrain), now);
      accumulator -= PHYSICS_STEP;
    }
    // After sliding to a stop on its belly, the plane goes back to the start.
    if (model.bellyLanded && model.speed < 0.5 && respawnAt === Infinity) respawnAt = now + 2;
    if (now >= respawnAt) respawn();
    if (mission && !model.crashed) applyMission(mission.update(dt, model), now);
    checkDiscovery(now);
    aircraft!.update(model, dt);
    rig.update(model, dt);
    sound.update(model);
  }
  input.endFrame();
  if (!paused) traffic.update(dt);

  const below = Math.max(terrain.heightAt(model.position.x, model.position.z), SEA_LEVEL);
  const altitude = model.position.y - model.spec.gearHeight - below;
  world.update(model.position, paused ? 0 : dt);
  environment.update(paused ? 0 : dt, camera.position);
  effects.update(paused ? 0 : dt, model, terrain);
  updateHint(now, altitude);
  hud.update(model, now, altitude);
  const target = started ? currentTarget() : null;
  minimap.update(model, traffic.positions, mission ? target : null);
  instruments.update(model, target);
  touch.update(model.throttle);
  graphics.render();
}
requestAnimationFrame(frame);
