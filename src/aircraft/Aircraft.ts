import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Material,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';
import type { FlightModel } from '../physics/FlightModel';

/**
 * A chunky, toy-like low-poly plane built from primitives so it needs no model files.
 * Nose points to -Z, wheels touch y = -1.4 (matches TRAINER.gearHeight).
 */
export class Aircraft {
  readonly object = new Group();
  private readonly propeller = new Group();

  constructor() {
    const red = mat(0xe63946);
    const white = mat(0xf1faee);
    const yellow = mat(0xffc93c);
    const dark = mat(0x264653);
    const glass = new MeshStandardMaterial({ color: 0x8ecae6, metalness: 0.2, roughness: 0.1, flatShading: true });

    // Fuselage: thick at the nose, tapering to the tail.
    const body = new CylinderGeometry(0.75, 0.35, 7, 10);
    body.rotateX(-Math.PI / 2);
    this.add(body, red);

    const spinner = new ConeGeometry(0.4, 0.8, 10);
    spinner.rotateX(-Math.PI / 2);
    this.add(spinner, yellow, 0, 0, -3.9);

    const canopy = new SphereGeometry(0.6, 10, 8);
    canopy.scale(1, 0.75, 1.8);
    this.add(canopy, glass, 0, 0.55, -0.9);

    this.add(new BoxGeometry(10, 0.2, 1.7), white, 0, -0.15, -0.8); // wings
    this.add(new BoxGeometry(1.2, 0.22, 1.72), red, 4.4, -0.15, -0.8); // wing tips
    this.add(new BoxGeometry(1.2, 0.22, 1.72), red, -4.4, -0.15, -0.8);
    this.add(new BoxGeometry(3.6, 0.14, 0.9), white, 0, 0.15, 3.1); // tailplane
    this.add(new BoxGeometry(0.14, 1.5, 1.1), yellow, 0, 0.9, 3.15); // fin

    // Landing gear: nose wheel + two main wheels, bottoms at y = -1.4.
    const wheel = new CylinderGeometry(0.3, 0.3, 0.22, 12);
    wheel.rotateZ(Math.PI / 2);
    for (const x of [-1.2, 1.2]) {
      this.add(wheel, dark, x, -1.1, -0.6);
      this.add(new BoxGeometry(0.1, 0.9, 0.1), dark, x * 0.75, -0.75, -0.6);
    }
    this.add(wheel, dark, 0, -1.1, -2.8);
    this.add(new BoxGeometry(0.1, 0.8, 0.1), dark, 0, -0.75, -2.8);

    // Two-blade propeller in front of the spinner.
    const blade = new Mesh(new BoxGeometry(0.16, 2.6, 0.06), dark);
    blade.castShadow = true;
    this.propeller.add(blade);
    this.propeller.position.set(0, 0, -3.75);
    this.object.add(this.propeller);
  }

  private add(geometry: BufferGeometry, material: Material, x = 0, y = 0, z = 0): void {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    this.object.add(mesh);
  }

  update(model: FlightModel, dt: number): void {
    this.object.position.copy(model.position);
    this.object.quaternion.copy(model.quaternion);
    if (!model.crashed) this.propeller.rotation.z += (4 + model.throttle * 40) * dt;
  }
}

function mat(color: number): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness: 0.6, flatShading: true });
}
