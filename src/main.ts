import { ACESFilmicToneMapping, PCFShadowMap, PerspectiveCamera, Scene, Timer, WebGLRenderer } from 'three';
import { Aircraft } from './aircraft/Aircraft';
import { AIRCRAFT } from './aircraft/catalog';
import { Sound } from './audio/Sound';
import { ChaseCamera } from './camera/ChaseCamera';
import { Input } from './core/Input';
import { FlightModel, SEA_LEVEL, type FlightEvent } from './physics/FlightModel';
import { HUD } from './ui/HUD';
import { Menu, type Choice } from './ui/Menu';
import { Minimap } from './ui/Minimap';
import { MAP_HALF_SIZE } from './world/islands';
import { World } from './world/World';

const PHYSICS_STEP = 1 / 120; // s, fixed so the flight feels the same at any frame rate
const MAX_FRAME = 0.1; // s, ignore huge gaps (e.g. after switching tabs)
const RESPAWN_DELAY = 2.5; // s after a crash

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
renderer.toneMapping = ACESFilmicToneMapping;
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new Scene();
const camera = new PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.5, 15000);
const world = new World(scene);
const terrain = world.terrain;
const input = new Input();
const hud = new HUD();
const sound = new Sound();
const minimap = new Minimap(terrain);
const chase = new ChaseCamera(camera, terrain);
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
  hud.flash(`${picked.aircraft.name} je spreman! Drži R za gas 🚀`, timer.getElapsed(), 3);
});

/** Puts the chosen plane on the chosen airport's runway. */
function setup(picked: Choice): void {
  choice = picked;
  if (aircraft?.type !== picked.aircraft) {
    if (aircraft) scene.remove(aircraft.object);
    aircraft = new Aircraft(picked.aircraft);
    scene.add(aircraft.object);
    model = new FlightModel(picked.aircraft.spec);
    chase.distance = picked.aircraft.camera.distance;
    chase.height = picked.aircraft.camera.height;
    sound.setEngine(picked.aircraft.engine);
  }
  respawn();
}

function respawn(): void {
  model.reset(choice.airport.spawnPoint(), choice.airport.heading);
  aircraft!.update(model, 0);
  chase.snap(model);
  respawnAt = Infinity;
  accumulator = 0;
}

function setPaused(value: boolean): void {
  paused = value;
  sound.setPaused(paused);
}

setup(menu.choice); // show the plane on its runway behind the menu

document.getElementById('menu-btn')!.addEventListener('click', toggleMenu);
function toggleMenu(): void {
  // Drop focus so a later Space (brake) can't "click" a button again.
  (document.activeElement as HTMLElement | null)?.blur();
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
      const runway = terrain.runwayAt(model.position.x, model.position.z);
      const onSea = terrain.heightAt(model.position.x, model.position.z) < SEA_LEVEL;
      hud.flash(runway ? `Sletio si na ${runway.name}! 👍` : onSea ? 'Sletio si na more! 🌊' : 'Sletio si na travu! 👍', now);
      sound.touchdown();
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

/** Gentle tips for whatever the player is doing right now. */
function updateHint(now: number): void {
  if (!started || menu.visible) return hud.hint(null, now);
  if (paused) return hud.hint('Pauza — pritisni P za nastavak', now);
  if (model.crashed) return hud.hint(null, now);
  if (model.stalled) return hud.hint('Presporo! Dodaj gas (R) i spusti nos', now, true);
  if (model.onGround && !hasFlown) {
    if (model.throttle < 0.3 && model.speed < 5) return hud.hint('Drži R za gas! 🚀', now);
    if (model.speed >= model.spec.rotateSpeed) return hud.hint('Sad drži W ili ↑ i poleti!', now);
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
    if (input.wasTapped('KeyP')) setPaused(!paused);
    if (input.wasTapped('KeyN')) respawn();
    if (input.wasTapped('KeyM')) hud.flash(sound.toggleMute() ? 'Zvuk isključen 🔇' : 'Zvuk uključen 🔊', now, 1.5);
  }

  if (playing && !paused) {
    const controls = input.controls();
    accumulator += dt;
    while (accumulator >= PHYSICS_STEP) {
      handleEvents(model.step(PHYSICS_STEP, controls, terrain), now);
      accumulator -= PHYSICS_STEP;
    }
    if (now >= respawnAt) respawn();
    aircraft!.update(model, dt);
    chase.update(model, dt);
    sound.update(model);
  }
  input.endFrame();

  const below = Math.max(terrain.heightAt(model.position.x, model.position.z), SEA_LEVEL);
  world.update(model.position);
  updateHint(now);
  hud.update(model, now, model.position.y - model.spec.gearHeight - below);
  minimap.update(model);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
