import { BoxGeometry, Color, Group, MathUtils, Mesh, MeshBasicMaterial, NormalBlending, PointsMaterial, Scene, TorusGeometry, Vector3 } from 'three';
import type { FlightModel } from '../physics/FlightModel';
import { RUNWAY_WIDTH, type Airport } from './Airport';
import { lightMaterial, lightPoints } from './lights';

/**
 * Help for landing, as at real airports:
 * - PAPI lights: four lights beside each runway end. On the right slope (3°) two are white
 *   and two red; all white = too high, all red = too low.
 * - Guide rings (for beginners): when the plane is lined up with a runway, rings in the air
 *   mark the 3° path down to it.
 */

const GLIDE = MathUtils.degToRad(3);
const PAPI_SETTINGS = [3.5, 3.17, 2.83, 2.5].map((d) => MathUtils.degToRad(d)); // nearest the runway first
const PAPI_FROM_THRESHOLD = 200; // m down the runway
const PAPI_SIDE = 15; // m beyond the runway's edge
const PAPI_GAP = 9; // m between the lights
const PAPI_RANGE = 8000; // m, further away nobody can see them
const AIM_POINT = PAPI_FROM_THRESHOLD; // m past the threshold, where the wheels should touch (by the PAPI lights)
const RING_SPACING = 300; // m
const RING_COUNT = 12;
const RING_RADIUS = 18; // m
const GUIDE_RANGE = 4500; // m from the threshold where the rings start
const GUIDE_LINED_UP = Math.cos(MathUtils.degToRad(40)); // heading within this of the runway
const WHITE = new Color(0xffffff);
const RED = new Color(0xff2b2b);

/** One runway end seen from an approaching plane. */
interface Approach {
  threshold: Vector3; // runway end the plane crosses first, at ground level
  direction: Vector3; // the way the plane lands (flat, unit)
  papi: { position: Vector3; material: MeshBasicMaterial; glow: PointsMaterial }[];
}

const toThreshold = new Vector3();
const flatNose = new Vector3();

export class LandingAids {
  private readonly approaches: Approach[] = [];
  private readonly rings = new Group();

  constructor(scene: Scene, airports: Airport[]) {
    const box = new BoxGeometry(3, 1.6, 1.6);
    for (const airport of airports) {
      const half = airport.length / 2;
      // Landing in the take-off direction crosses the start end first, and the other way round.
      for (const sign of [1, -1]) {
        const threshold = airport.pointAt(-sign * half, 0);
        const direction = airport.pointAt(sign, 0).sub(airport.pointAt(0, 0)).setY(0).normalize();
        const papi = PAPI_SETTINGS.map((_, i) => {
          // On the left of the landing plane: across is to the right of the take-off direction.
          const across = -sign * (RUNWAY_WIDTH / 2 + PAPI_SIDE + i * PAPI_GAP);
          const position = airport.pointAt(-sign * (half - PAPI_FROM_THRESHOLD), across).setY(airport.center.y + 1);
          const material = new MeshBasicMaterial({ color: WHITE.clone() });
          const light = new Mesh(box, material);
          light.position.copy(position);
          light.rotation.y = airport.heading;
          // A glowing dot of fixed size on screen, so the colours can be read from far out.
          const glow = lightMaterial(0xffffff, 10);
          glow.blending = NormalBlending; // a solid dot: red must stay red against bright grass by day
          scene.add(light, lightPoints([position.clone().setY(position.y + 1)], glow));
          return { position, material, glow };
        });
        this.approaches.push({ threshold, direction, papi });
      }
    }

    const ringGeometry = new TorusGeometry(RING_RADIUS, 1.2, 8, 36);
    for (let i = 0; i < RING_COUNT; i++) {
      const ring = new Mesh(ringGeometry, new MeshBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.55, depthWrite: false }));
      this.rings.add(ring);
    }
    this.rings.visible = false;
    scene.add(this.rings);
  }

  /** Sets each PAPI light's colour as seen from the plane, and places the rings if `rings` is on. */
  update(model: FlightModel, rings: boolean): void {
    const eye = model.position;
    for (const approach of this.approaches) {
      const first = approach.papi[0].position;
      const distance = Math.hypot(eye.x - first.x, eye.z - first.z);
      const seen = distance < PAPI_RANGE;
      for (let i = 0; i < approach.papi.length; i++) {
        const light = approach.papi[i];
        light.glow.visible = seen;
        if (!seen) continue;
        const angle = Math.atan2(eye.y - model.spec.gearHeight - light.position.y, Math.hypot(eye.x - light.position.x, eye.z - light.position.z));
        const color = angle > PAPI_SETTINGS[i] ? WHITE : RED;
        light.material.color.copy(color);
        light.glow.color.copy(color);
      }
    }
    this.rings.visible = rings && !model.onGround && this.placeRings(model);
  }

  /** Puts the rings on the 3° path to the runway the plane is lined up with; false if there is none. */
  private placeRings(model: FlightModel): boolean {
    flatNose.set(0, 0, -1).applyQuaternion(model.quaternion).setY(0).normalize();
    for (const approach of this.approaches) {
      toThreshold.copy(approach.threshold).sub(model.position).setY(0);
      const ahead = toThreshold.dot(approach.direction); // m before the threshold
      const aside = Math.abs(toThreshold.x * approach.direction.z - toThreshold.z * approach.direction.x);
      if (ahead < 200 || ahead > GUIDE_RANGE || aside > ahead * 0.35 + 100) continue;
      if (flatNose.dot(approach.direction) < GUIDE_LINED_UP) continue;
      const aim = approach.threshold.clone().addScaledVector(approach.direction, AIM_POINT);
      this.rings.children.forEach((ring, i) => {
        const back = (i + 1) * RING_SPACING;
        ring.visible = back < ahead + AIM_POINT; // only the rings still in front of the plane
        ring.position.copy(aim).addScaledVector(approach.direction, -back);
        ring.position.y = aim.y + model.spec.gearHeight + Math.tan(GLIDE) * back;
        ring.lookAt(ring.position.clone().add(approach.direction));
      });
      return true;
    }
    return false;
  }
}
