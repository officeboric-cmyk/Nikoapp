import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { FlightModel } from '../physics/FlightModel';

/**
 * The inside of the cockpit, seen in the cockpit (FPV) view: an instrument panel with four
 * round gauges (speed, artificial horizon, height, compass) and warning lamps, plus the
 * control column (a yoke, or a stick in the jet) and the throttle lever, which move with
 * the controls. It rides on the camera, so it is always in the same place on screen.
 */

const DISTANCE = 0.62; // m in front of the eye
const PANEL_WIDTH = 1.3;
const PANEL_HEIGHT = 0.26;
const PANEL_Y = -0.3; // m below the eye
const CANVAS = { width: 1024, height: 256 };
const REDRAW = 1 / 30; // s between gauge redraws
const COMPASS = ['S', 'I', 'J', 'Z']; // sjever, istok, jug, zapad

const tmp = new Vector3();

export class Cockpit {
  private readonly root = new Group();
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private readonly column = new Group(); // yoke or stick
  private readonly lever = new Group(); // throttle
  private yoke!: Group;
  private stick!: Group;
  private sinceDraw = REDRAW;

  constructor(private readonly camera: PerspectiveCamera) {
    this.canvas.width = CANVAS.width;
    this.canvas.height = CANVAS.height;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.anisotropy = 4;
    this.build();
    // Drawn last and over everything: the eye sits so close to the fuselage that its skin
    // would otherwise poke in front of the panel.
    let order = 1000;
    this.root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.renderOrder = order++;
      for (const material of [object.material].flat()) {
        material.depthTest = false;
        material.transparent = true; // drawn with (after) the see-through things too, like the canopy glass
      }
    });
    this.root.visible = false;
    camera.add(this.root);
  }

  private build(): void {
    const panelPaint = new MeshStandardMaterial({ color: 0x2d3238, roughness: 0.85 });
    const trim = new MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.6 });
    const metal = new MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.6 });
    const grip = new MeshStandardMaterial({ color: 0x222428, roughness: 0.7 });

    // The panel, tipped back a little towards the pilot, with a glare shield along its top.
    const panel = new Group();
    panel.rotation.x = -0.25;
    const board = new Mesh(new BoxGeometry(PANEL_WIDTH + 1.4, PANEL_HEIGHT + 0.1, 0.05), panelPaint);
    board.position.z = -0.03;
    const face = new Mesh(new PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT), new MeshBasicMaterial({ map: this.texture, transparent: true }));
    face.position.z = 0.001;
    const shield = new Mesh(new BoxGeometry(PANEL_WIDTH + 1.4, 0.04, 0.16), trim);
    shield.position.set(0, PANEL_HEIGHT / 2 + 0.06, 0.04);
    // Below the panel the cockpit carries on down to the floor (nothing of the outside shows there).
    const lower = new Mesh(new BoxGeometry(PANEL_WIDTH + 1.4, 0.8, 0.05), trim);
    lower.position.set(0, -PANEL_HEIGHT / 2 - 0.4, -0.05);
    panel.add(lower, board, face, shield);
    panel.position.set(0, PANEL_Y, -DISTANCE);
    this.root.add(panel);

    // Control column: a yoke for the propeller planes and the airliner, a stick in the jet.
    this.column.position.set(0, -0.45, -DISTANCE + 0.02);
    this.yoke = new Group();
    const shaft = new Mesh(new CylinderGeometry(0.018, 0.018, 0.28, 10).rotateX(Math.PI / 2), metal);
    shaft.position.z = -0.08;
    const wheel = new Group();
    const bar = new Mesh(new BoxGeometry(0.24, 0.03, 0.03), grip);
    const hub = new Mesh(new CylinderGeometry(0.035, 0.035, 0.05, 12).rotateX(Math.PI / 2), trim);
    wheel.add(bar, hub);
    for (const side of [-1, 1]) {
      const handle = new Mesh(new CylinderGeometry(0.02, 0.02, 0.09, 10), grip);
      handle.position.set(side * 0.12, 0.035, 0);
      wheel.add(handle);
    }
    wheel.position.z = 0.06;
    wheel.name = 'wheel';
    this.yoke.add(shaft, wheel);
    this.stick = new Group();
    const rod = new Mesh(new CylinderGeometry(0.014, 0.02, 0.32, 10), metal);
    rod.position.y = 0.16;
    const knob = new Mesh(new SphereGeometry(0.035, 12, 10).scale(1, 1.4, 1), grip);
    knob.position.y = 0.34;
    const boot = new Mesh(new TorusGeometry(0.04, 0.02, 8, 16).rotateX(Math.PI / 2), trim);
    this.stick.add(rod, knob, boot);
    this.stick.position.set(0, -0.2, 0.05);
    this.column.add(this.yoke, this.stick);
    this.root.add(this.column);

    // Throttle lever on the right, sliding forward for more gas.
    const quadrant = new Mesh(new BoxGeometry(0.08, 0.04, 0.22), trim);
    const leverRod = new Mesh(new CylinderGeometry(0.008, 0.008, 0.1, 8), metal);
    leverRod.position.y = 0.05;
    const leverKnob = new Mesh(new SphereGeometry(0.022, 10, 8), new MeshStandardMaterial({ color: 0x111111, roughness: 0.5 }));
    leverKnob.position.y = 0.1;
    this.lever.add(leverRod, leverKnob);
    const throttleBase = new Group();
    throttleBase.position.set(0.56, -0.44, -DISTANCE + 0.04);
    throttleBase.add(quadrant, this.lever);
    this.root.add(throttleBase);
  }

  /** Which column the plane has (the jet flies with a stick). */
  setStick(stick: boolean): void {
    this.yoke.visible = !stick;
    this.stick.visible = stick;
  }

  update(model: FlightModel, visible: boolean, dt: number): void {
    this.root.visible = visible;
    if (!visible) return;
    // On narrow (upright) screens the panel shrinks to fit across, keeping to the bottom edge.
    const halfHeight = DISTANCE * Math.tan(MathUtils.degToRad(this.camera.fov / 2));
    const fit = Math.min(1, (halfHeight * this.camera.aspect * 2) / (PANEL_WIDTH + 0.1));
    this.root.scale.set(fit, fit, 1);
    this.root.position.y = (1 - fit) * (-halfHeight - (PANEL_Y - PANEL_HEIGHT / 2));

    // The controls move as the pilot moves them (the flight model knows the stick's position).
    const s = model.surfaces;
    const wheel = this.yoke.getObjectByName('wheel')!;
    wheel.rotation.z = -s.roll * 0.6;
    this.yoke.position.y = -s.pitch * 0.03; // pulled back towards the pilot (it dips in view) = nose up
    this.yoke.position.z = s.pitch * 0.05;
    this.stick.rotation.set(s.pitch * 0.35, 0, -s.roll * 0.35);
    this.lever.position.z = 0.08 - model.throttle * 0.16;

    this.sinceDraw += dt;
    if (this.sinceDraw >= REDRAW) {
      this.sinceDraw = 0;
      this.draw(model);
      this.texture.needsUpdate = true;
    }
  }

  private draw(model: FlightModel): void {
    const ctx = this.ctx;
    const { width, height } = CANVAS;
    ctx.clearRect(0, 0, width, height);
    const r = 98;
    const y = 150;
    const xs = [140, 395, 650, 900];

    // 1. Airspeed, with a green band where the plane flies well.
    const maxKmh = Math.ceil((model.spec.maxSpeed * 3.6 * 1.25) / 50) * 50;
    const speedAngle = (v: number) => MathUtils.degToRad(-225 + (v / maxKmh) * 270);
    dial(ctx, xs[0], y, r);
    ctx.lineWidth = 9;
    ctx.strokeStyle = '#2ecc71';
    ctx.beginPath();
    ctx.arc(xs[0], y, r - 14, speedAngle(model.currentStallSpeed * 3.6), speedAngle(model.spec.maxSpeed * 3.6));
    ctx.stroke();
    ticks(ctx, xs[0], y, r, 10, -225, 270);
    needle(ctx, xs[0], y, r - 18, speedAngle(model.speed * 3.6), '#fff');
    label(ctx, xs[0], y + 48, `${Math.round(model.speed * 3.6)}`, 'km/h');

    // 2. Artificial horizon.
    tmp.set(0, 0, -1).applyQuaternion(model.quaternion);
    const pitch = Math.asin(MathUtils.clamp(tmp.y, -1, 1));
    tmp.set(1, 0, 0).applyQuaternion(model.quaternion);
    const bank = Math.asin(MathUtils.clamp(-tmp.y, -1, 1));
    ctx.save();
    ctx.beginPath();
    ctx.arc(xs[1], y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(xs[1], y);
    ctx.rotate(-bank);
    const shift = MathUtils.clamp(pitch * 160, -r, r);
    ctx.fillStyle = '#3d8fd6';
    ctx.fillRect(-2 * r, -2 * r + shift, 4 * r, 2 * r);
    ctx.fillStyle = '#9c6b3e';
    ctx.fillRect(-2 * r, shift, 4 * r, 2 * r);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-2 * r, shift);
    ctx.lineTo(2 * r, shift);
    for (const step of [-20, -10, 10, 20]) {
      const py = shift - (step / 57.3) * 160;
      ctx.moveTo(-18, py);
      ctx.lineTo(18, py);
    }
    ctx.stroke();
    ctx.restore();
    rim(ctx, xs[1], y, r);
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(xs[1] - 52, y);
    ctx.lineTo(xs[1] - 16, y);
    ctx.lineTo(xs[1], y + 12);
    ctx.lineTo(xs[1] + 16, y);
    ctx.lineTo(xs[1] + 52, y);
    ctx.stroke();

    // 3. Height (one turn of the needle = 1000 m), with the number underneath.
    dial(ctx, xs[2], y, r);
    ticks(ctx, xs[2], y, r, 10, -90, 360);
    const metres = Math.max(0, model.position.y - model.spec.gearHeight);
    needle(ctx, xs[2], y, r - 30, MathUtils.degToRad(-90 + (metres / 1000) * 360), '#fff', 4);
    needle(ctx, xs[2], y, r - 18, MathUtils.degToRad(-90 + ((metres % 100) / 100) * 360), '#ffd166', 3);
    label(ctx, xs[2], y + 48, `${Math.round(metres)}`, 'm');

    // 4. Compass: the card turns, the nose mark stays on top.
    tmp.set(0, 0, -1).applyQuaternion(model.quaternion);
    const heading = Math.atan2(tmp.x, -tmp.z);
    dial(ctx, xs[3], y, r);
    ctx.save();
    ctx.translate(xs[3], y);
    ctx.rotate(-heading);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    COMPASS.forEach((letter, i) => {
      const a = (i * Math.PI) / 2;
      ctx.fillStyle = i === 0 ? '#ff6b6b' : '#fff';
      ctx.fillText(letter, Math.sin(a) * (r - 30), -Math.cos(a) * (r - 30));
    });
    ctx.restore();
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(xs[3], y - r + 4);
    ctx.lineTo(xs[3] - 10, y - r + 22);
    ctx.lineTo(xs[3] + 10, y - r + 22);
    ctx.fill();

    // Lamps along the top: gas, flaps, wheels and the stall warning.
    const lamps: [string, string][] = [
      [`GAS ${Math.round(model.throttle * 100)}%`, '#9be15d'],
      [`ZAKRILCA ${Math.round(model.flaps * 100)}%`, model.flaps > 0.02 ? '#ffd166' : '#5c636b'],
      [model.spec.retractableGear ? (model.gear > 0.99 ? 'KOTAČI DOLJE' : model.gear < 0.01 ? 'KOTAČI GORE' : 'KOTAČI…') : 'KOTAČI', model.gear > 0.99 ? '#2ecc71' : '#ff9f43'],
      ['GUBITAK UZGONA', model.stalled ? '#ff4d4d' : '#3b4148'],
    ];
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lamps.forEach(([text, color], i) => {
      const x = xs[i];
      ctx.fillStyle = '#16191c';
      ctx.fillRect(x - 95, 6, 190, 30);
      ctx.fillStyle = color;
      ctx.fillText(text, x, 22);
    });
  }
}

function dial(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.fillStyle = '#111417';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  rim(ctx, x, y, r);
}

function rim(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.strokeStyle = '#6b737c';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

function ticks(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, count: number, startDeg: number, sweepDeg: number): void {
  ctx.strokeStyle = '#d9dee3';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i <= count; i++) {
    const a = MathUtils.degToRad(startDeg + (sweepDeg * i) / count);
    ctx.moveTo(x + Math.cos(a) * (r - 4), y + Math.sin(a) * (r - 4));
    ctx.lineTo(x + Math.cos(a) * (r - 16), y + Math.sin(a) * (r - 16));
  }
  ctx.stroke();
}

function needle(ctx: CanvasRenderingContext2D, x: number, y: number, length: number, angle: number, color: string, width = 5): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
  ctx.stroke();
  ctx.fillStyle = '#6b737c';
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.fill();
}

function label(ctx: CanvasRenderingContext2D, x: number, y: number, value: string, unit: string): void {
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(value, x, y);
  ctx.font = '18px sans-serif';
  ctx.fillStyle = '#aab3bc';
  ctx.fillText(unit, x, y + 24);
}
