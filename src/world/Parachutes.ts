import { Color, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3, type Scene } from 'three';
import { SEA_LEVEL, type Ground } from '../physics/FlightModel';

/**
 * The crew of a plane that was shot down, floating safely down on their parachutes: a short fall,
 * the canopy pops open, and they drift down swaying until they land (and are picked up).
 */

const OPEN_AFTER = 1.2; // s of free fall before the canopy opens
const SINK = 5; // m/s under the canopy
const STAY = 6; // s a landed parachutist stays before being picked up
const CANOPY_COLORS = [0xf77f00, 0xffffff, 0xe63946, 0x2a9df4, 0xffd166];

interface Jumper {
  object: Group;
  canopy: Mesh;
  velocity: Vector3;
  age: number;
  landedAt: number | null;
  sway: number;
}

export class Parachutes {
  private readonly jumpers: Jumper[] = [];
  private readonly person = new MeshStandardMaterial({ color: 0x4f5d2f, roughness: 0.8 });

  constructor(
    private readonly scene: Scene,
    private readonly ground: Ground,
  ) {}

  /** `count` people jumping out at `at`, carried along by the plane's `velocity`. */
  jump(at: Vector3, velocity: Vector3, count: number): void {
    for (let i = 0; i < count; i++) {
      const object = new Group();
      const body = new Mesh(new CylinderGeometry(0.25, 0.25, 1.4, 6), this.person);
      const head = new Mesh(new SphereGeometry(0.22, 8, 6), new MeshStandardMaterial({ color: 0xf2c9a0 }));
      head.position.y = 0.9;
      const canopy = new Mesh(
        new SphereGeometry(3.2, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1).translate(0, 5.5, 0),
        new MeshStandardMaterial({ color: new Color(CANOPY_COLORS[(i + this.jumpers.length) % CANOPY_COLORS.length]), roughness: 0.7, side: DoubleSide }),
      );
      canopy.visible = false;
      object.add(body, head, canopy);
      object.position.copy(at).add(new Vector3((i - (count - 1) / 2) * 4, -2, 0));
      object.traverse((o) => (o.castShadow = true));
      this.scene.add(object);
      this.jumpers.push({
        object,
        canopy,
        velocity: velocity.clone().multiplyScalar(0.3).add(new Vector3((Math.random() - 0.5) * 6, 2, (Math.random() - 0.5) * 6)),
        age: -i * 0.6, // one after another
        landedAt: null,
        sway: Math.random() * 6,
      });
    }
  }

  update(dt: number): void {
    for (let i = this.jumpers.length - 1; i >= 0; i--) {
      const j = this.jumpers[i];
      j.age += dt;
      if (j.landedAt !== null) {
        if (j.age - j.landedAt > STAY) {
          this.scene.remove(j.object);
          this.jumpers.splice(i, 1);
        }
        continue;
      }
      const open = j.age > OPEN_AFTER;
      j.canopy.visible = open;
      if (open) {
        // Under the canopy: the air quickly slows them to a gentle sink.
        j.velocity.multiplyScalar(Math.exp(-2 * dt));
        j.velocity.y = Math.max(j.velocity.y - 9.81 * dt, -SINK);
        j.object.rotation.z = Math.sin(j.age * 1.3 + j.sway) * 0.15;
      } else {
        j.velocity.y -= 9.81 * dt;
      }
      j.object.position.addScaledVector(j.velocity, dt);
      const floor = Math.max(this.ground.heightAt(j.object.position.x, j.object.position.z), SEA_LEVEL);
      if (j.object.position.y < floor + 0.7) {
        j.object.position.y = floor + 0.7;
        j.object.rotation.z = 0;
        j.canopy.visible = false;
        j.landedAt = j.age;
      }
    }
  }
}
