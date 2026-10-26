import { ACESFilmicToneMapping, PCFShadowMap, PerspectiveCamera, Scene, Timer, WebGLRenderer } from 'three';
import { Aircraft } from './aircraft/Aircraft';
import { AIRCRAFT } from './aircraft/catalog';
import { Sound } from './audio/Sound';
import { CAMERA_NAMES, CameraRig } from './camera/CameraRig';
import { Input } from './core/Input';
import { scoreLanding } from './game/landing';
import { Progress } from './game/Progress';
import { FlightModel, SEA_LEVEL, type FlightEvent } from './physics/FlightModel';
import { HUD } from './ui/HUD';
import { Instruments, type Target } from './ui/Instruments';
import { Menu, type Choice } from './ui/Menu';
import { Minimap } from './ui/Minimap';
import { TouchControls } from './ui/TouchControls';
import { ISLANDS, MAP_HALF_SIZE } from './world/islands';
import { World } from './world/World';

const PHYSICS_STEP = 1 / 120; // s, fixed so the flight feels the same at any frame rate
const MAX_FRAME = 0.1; // s, ignore huge gaps (e.g. after switching tabs)
const RESPAWN_DELAY = 2.5; // s after a crash
const SHOW_AIRPORT_BEYOND = 1500; // m, the arrow points to the nearest airport once it is this far

const touch = new TouchControls();
const renderer = new WebGLRenderer({ antialias: true });
// Phones and tablets get a slightly lighter picture so the game stays smooth.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, touch.enabled ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
renderer.toneMapping = ACESFilmicToneMapping;
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new Scene();
const camera = new PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.5, 15000);
const world = new World(scene, touch.enabled ? 1024 : 2048);
const terrain = world.terrain;
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

const menu = new Menu(AIRCRAFT, terrain.airports, (picked) => {
  // Runs inside the click / key press, so the browser lets the sound start.
  sound.start();
  setup(picked);
  started = true;
  setPaused(false);
  hud.flash(`${picked.aircraft.name} je spreman! ${say('Drži R za gas', 'Povuci GAS gore')} 🚀`, timer.getElapsed(), 3);
  if (touch.enabled) goFullscreen();
});

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
  if (aircraft?.type !== picked.aircraft) {
    if (aircraft) scene.remove(aircraft.object);
    aircraft = new Aircraft(picked.aircraft);
    scene.add(aircraft.object);
    model = new FlightModel(picked.aircraft.spec);
    rig.distance = picked.aircraft.camera.distance;
    rig.height = picked.aircraft.camera.height;
    rig.cockpit.fromArray(picked.aircraft.camera.cockpit);
    sound.setEngine(picked.aircraft.engine);
  }
  respawn();
}

function respawn(): void {
  model.reset(choice.airport.spawnPoint(), choice.airport.heading);
  progress.discover(choice.airport.name); // the island you start on doesn't need discovering
  aircraft!.update(model, 0);
  rig.snap(model);
  touch.reset();
  respawnAt = Infinity;
  accumulator = 0;
}

function setPaused(value: boolean): void {
  paused = value;
  sound.setPaused(paused);
}

setup(menu.choice); // show the plane on its runway behind the menu

document.getElementById('menu-btn')!.addEventListener('click', toggleMenu);
document.getElementById('cam-btn')!.addEventListener('click', cycleCamera);
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
  if (!menu.visible) {
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
  if (menu.visible && e.code === 'Enter') menu.start();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function handleEvents(events: FlightEvent[], now: number): void {
  for (const event of events) {
    if (event === 'takeoff') {
      if (!hasFlown) hud.hideHelp(); // out of the way once they've got it; H brings it back
      hud.flash(hasFlown ? 'Opet letiš! ✈️' : 'Bravo, letiš! 🎉', now);
      hasFlown = true;
      sound.takeoff();
    } else if (event === 'touchdown') {
      const landing = scoreLanding(model, terrain);
      const record = landing.airport && progress.recordLanding(landing.airport.name, landing.stars);
      hud.flash(record ? `${landing.text} Novi rekord!` : landing.text, now, 3.5);
      if (record) sound.reward();
      else sound.touchdown();
    } else if (event === 'crash') {
      hud.flash('Bum! Ništa strašno, idemo opet…', now, RESPAWN_DELAY, true);
      respawnAt = now + RESPAWN_DELAY;
      sound.crash();
    } else if (event === 'splash') {
      hud.flash('Pljus! 🌊 Ovaj avion ne zna plivati. Idemo opet…', now, RESPAWN_DELAY, true);
      respawnAt = now + RESPAWN_DELAY;
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

/** Where the arrow at the top points: the nearest airport, once it is far enough away to need finding. */
function currentTarget(): Target | null {
  const { airport, distance } = terrain.nearestAirport(model.position.x, model.position.z);
  if (distance < SHOW_AIRPORT_BEYOND) return null;
  return { name: `✈ ${airport.name}`, x: airport.center.x, z: airport.center.z };
}

/** Gentle tips for whatever the player is doing right now. */
function updateHint(now: number): void {
  if (!started || menu.visible) return hud.hint(null, now);
  if (paused) return hud.hint(say('Pauza — pritisni P za nastavak', 'Pauza — dodirni ⏸ za nastavak'), now);
  if (model.crashed) return hud.hint(null, now);
  if (model.stalled) return hud.hint(say('Presporo! Dodaj gas (R) i spusti nos', 'Presporo! Dodaj gas i spusti nos'), now, true);
  if (model.onGround && !hasFlown) {
    if (model.throttle < 0.3 && model.speed < 5) return hud.hint(`${say('Drži R za gas', 'Povuci GAS gore')}! 🚀`, now);
    if (model.speed >= model.spec.rotateSpeed) return hud.hint(say('Sad drži W ili ↑ i poleti!', 'Sad gurni palicu gore i poleti!'), now);
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

  if (input.wasTapped('KeyH')) hud.toggleHelp();
  if (input.wasTapped('Escape')) toggleMenu();
  const playing = started && !menu.visible;
  if (playing) {
    if (input.wasTapped('KeyC')) cycleCamera();
    if (input.wasTapped('KeyP')) setPaused(!paused);
    if (input.wasTapped('KeyN')) respawn();
    if (input.wasTapped('KeyM')) hud.flash(sound.toggleMute() ? 'Zvuk isključen 🔇' : 'Zvuk uključen 🔊', now, 1.5);
  }

  if (playing && !paused) {
    const controls = touch.apply(input.controls());
    accumulator += dt;
    while (accumulator >= PHYSICS_STEP) {
      handleEvents(model.step(PHYSICS_STEP, controls, terrain), now);
      accumulator -= PHYSICS_STEP;
    }
    if (now >= respawnAt) respawn();
    checkDiscovery(now);
    aircraft!.update(model, dt);
    rig.update(model, dt);
    sound.update(model);
  }
  input.endFrame();

  const below = Math.max(terrain.heightAt(model.position.x, model.position.z), SEA_LEVEL);
  world.update(model.position);
  updateHint(now);
  hud.update(model, now, model.position.y - model.spec.gearHeight - below);
  minimap.update(model);
  instruments.update(model, started ? currentTarget() : null);
  touch.update(model.throttle);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
