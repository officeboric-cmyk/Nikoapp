import { ACESFilmicToneMapping, PCFShadowMap, PerspectiveCamera, Scene, Timer, Vector3, WebGLRenderer } from 'three';
import { Aircraft } from './aircraft/Aircraft';
import { ChaseCamera } from './camera/ChaseCamera';
import { Input } from './core/Input';
import { FlightModel } from './physics/FlightModel';
import { HUD } from './ui/HUD';
import { RUNWAY, World } from './world/World';

const PHYSICS_STEP = 1 / 120; // s, fixed so the flight feels the same at any frame rate
const MAX_FRAME = 0.1; // s, ignore huge gaps (e.g. after switching tabs)
const RESPAWN_DELAY = 2.5; // s after a crash
const FAR_AWAY = 6000; // m from the airport before we suggest heading back

const SPAWN = new Vector3(0, 0, RUNWAY.startZ - 25);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
renderer.toneMapping = ACESFilmicToneMapping;
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new Scene();
const camera = new PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.5, 8000);
const world = new World(scene);
const input = new Input();
const hud = new HUD();
const model = new FlightModel();
const aircraft = new Aircraft();
const chase = new ChaseCamera(camera);
scene.add(aircraft.object);

let started = false;
let paused = false;
let hasFlown = false;
let respawnAt = Infinity;
let accumulator = 0;
const timer = new Timer();

function respawn(): void {
  model.reset(SPAWN, 0);
  aircraft.update(model, 0);
  chase.snap(model);
  respawnAt = Infinity;
  accumulator = 0;
}
respawn();

function start(): void {
  if (started) return;
  started = true;
  document.getElementById('start')!.classList.add('hidden');
  hud.flash('Drži R za gas! 🚀', timer.getElapsed(), 3);
}
document.getElementById('start-btn')!.addEventListener('click', start);
window.addEventListener('keydown', (e) => {
  if (!started && (e.code === 'Enter' || e.code === 'Space')) start();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function handleEvents(events: string[], now: number): void {
  for (const event of events) {
    if (event === 'takeoff') {
      if (!hasFlown) hud.hideHelp(); // out of the way once they've got it; H brings it back
      hud.flash(hasFlown ? 'Opet letiš! ✈️' : 'Bravo, letiš! 🎉', now);
      hasFlown = true;
    } else if (event === 'touchdown') {
      hud.flash('Sletio si! 👍', now);
    } else if (event === 'crash') {
      hud.flash('Bum! Ništa strašno, idemo opet…', now, RESPAWN_DELAY, true);
      respawnAt = now + RESPAWN_DELAY;
    }
  }
}

/** Gentle tips for whatever the player is doing right now. */
function updateHint(now: number): void {
  if (paused) return hud.hint('Pauza — pritisni P za nastavak', now);
  if (model.crashed) return hud.hint(null, now);
  if (model.stalled) return hud.hint('Presporo! Dodaj gas (R) i spusti nos', now, true);
  if (model.onGround && !hasFlown) {
    if (model.throttle < 0.3 && model.speed < 5) return hud.hint('Drži R za gas! 🚀', now);
    if (model.speed >= model.spec.rotateSpeed) return hud.hint('Sad drži W ili ↑ i poleti!', now);
    return hud.hint(null, now);
  }
  const distance = Math.hypot(model.position.x - SPAWN.x, model.position.z - SPAWN.z);
  if (distance > FAR_AWAY) return hud.hint('Daleko si! Okreni se natrag prema pisti', now);
  hud.hint(null, now);
}

function frame(time: number): void {
  requestAnimationFrame(frame);
  timer.update(time);
  const dt = Math.min(timer.getDelta(), MAX_FRAME);
  const now = timer.getElapsed();

  if (input.wasTapped('KeyH')) hud.toggleHelp();
  if (started) {
    if (input.wasTapped('KeyP')) paused = !paused;
    if (input.wasTapped('KeyN')) respawn();
  }

  if (started && !paused) {
    const controls = input.controls();
    accumulator += dt;
    while (accumulator >= PHYSICS_STEP) {
      handleEvents(model.step(PHYSICS_STEP, controls), now);
      accumulator -= PHYSICS_STEP;
    }
    if (now >= respawnAt) respawn();
    aircraft.update(model, dt);
    chase.update(model, dt);
  }
  input.endFrame();

  world.update(model.position);
  updateHint(now);
  hud.update(model, now);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
