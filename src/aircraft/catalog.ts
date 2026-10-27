import { MathUtils, type Group, type Mesh, type MeshBasicMaterial, type BufferGeometry, type Object3D } from 'three';
import type { AircraftSpec } from '../physics/FlightModel';
import type { Airline } from './airlines';
import { buildAirliner, buildJet, buildSeaplane, buildTrainer } from './models';

/** Every plane the player can pick: how it flies, its camera, its sound and its model (see models.ts). */

export interface AircraftModel {
  object: Group;
  propellers: Propeller[];
  gear: Group; // the wheels and their struts, folded away when retracted
  surfaces: ControlSurfaces;
}

/** A propeller: the blades spin around the group's Z axis; at speed a blurred disc shows instead. */
export interface Propeller {
  spinner: Group;
  blades: Object3D;
  disc: Mesh<BufferGeometry, MeshBasicMaterial>;
}

/**
 * The moving parts of the wings and tail. Each is a pivot on its hinge line, the surface trailing
 * behind it (+Z): turning the pivot about X tips the trailing edge up or down, about Y sideways.
 */
export interface ControlSurfaces {
  ailerons: { left: Object3D[]; right: Object3D[] };
  elevators: Object3D[];
  rudders: Object3D[];
  flaps: Object3D[];
}

export interface AircraftType {
  id: string;
  name: string;
  emoji: string;
  description: string;
  spec: AircraftSpec;
  engine: 'prop' | 'jet';
  // cockpit = pilot's eye, placed so the nose fills only the bottom of the FPV view
  camera: { distance: number; height: number; cockpit: [number, number, number] };
  liveries?: boolean; // wears an airline's colours (see airlines.ts)
  exhausts?: [number, number, number][]; // jet engine outlets, where contrails start
  /** `distant`: a lighter model for planes the player only sees from afar (traffic, parked). */
  build(airline?: Airline, distant?: boolean): AircraftModel;
}

export const AIRCRAFT: AircraftType[] = [
  {
    id: 'trainer',
    name: 'Mali avion',
    emoji: '🛩️',
    description: 'Lagan i poslušan. Najbolji za početak!',
    engine: 'prop',
    camera: { distance: 13, height: 4, cockpit: [0, 1.15, -1.6] },
    spec: {
      maxThrust: 6,
      maxSpeed: 60,
      stallSpeed: 20,
      rotateSpeed: 24,
      pitchRate: 0.9,
      rollRate: 1.6,
      yawRate: 0.4,
      groundSteerRate: 0.8,
      turnRate: 0.9,
      gearHeight: 1.4,
      wingspan: 10,
      floats: false,
    },
    build: buildTrainer,
  },
  {
    id: 'jet',
    name: 'Mlažnjak',
    emoji: '⚡',
    description: 'Jako brz! Treba mu duga pista.',
    engine: 'jet',
    camera: { distance: 15, height: 4.5, cockpit: [0, 1.1, -3.6] },
    exhausts: [[0, 0, 5.3]],
    spec: {
      maxThrust: 14,
      maxSpeed: 120,
      stallSpeed: 38,
      rotateSpeed: 45,
      pitchRate: 1.2,
      rollRate: 2.4,
      yawRate: 0.5,
      groundSteerRate: 0.6,
      turnRate: 1.1,
      gearHeight: 1.5,
      wingspan: 10,
      floats: false,
      retractableGear: true,
      bellyHeight: 0.75,
    },
    build: buildJet,
  },
  {
    id: 'seaplane',
    name: 'Hidroavion',
    emoji: '🌊',
    description: 'Ima plovke: smije sletjeti na more!',
    engine: 'prop',
    camera: { distance: 13, height: 4.5, cockpit: [0, 1.0, -2.2] },
    spec: {
      maxThrust: 5,
      maxSpeed: 50,
      stallSpeed: 17,
      rotateSpeed: 20,
      pitchRate: 0.8,
      rollRate: 1.4,
      yawRate: 0.4,
      groundSteerRate: 0.7,
      turnRate: 0.8,
      gearHeight: 1.6,
      wingspan: 11,
      floats: true,
    },
    build: buildSeaplane,
  },
  {
    id: 'airliner',
    name: 'Putnički avion',
    emoji: '✈️',
    description: 'Velik i spor. Vozi putnike!',
    engine: 'jet',
    liveries: true,
    camera: { distance: 40, height: 11, cockpit: [0, 1.85, -12.5] },
    exhausts: [
      [-5.5, -2, 1.4],
      [5.5, -2, 1.4],
    ],
    spec: {
      maxThrust: 5,
      maxSpeed: 85,
      stallSpeed: 32,
      rotateSpeed: 38,
      pitchRate: 0.5,
      rollRate: 0.8,
      yawRate: 0.25,
      groundSteerRate: 0.4,
      turnRate: 0.6,
      gearHeight: 3.2,
      wingspan: 28,
      floats: false,
      retractableGear: true,
      bellyHeight: 2.9, // it ends up resting on its engines
    },
    build: buildAirliner,
  },
];

/** Spins the propellers at `rate` (radians per second); fast enough, the blades blur into a disc. */
export function spinPropellers(propellers: Propeller[], rate: number, dt: number): void {
  const blur = MathUtils.smoothstep(rate, 14, 30);
  for (const { spinner, blades, disc } of propellers) {
    spinner.rotation.z += rate * dt;
    blades.visible = blur < 0.9;
    disc.visible = blur > 0;
    disc.material.opacity = 0.3 * blur;
  }
}
