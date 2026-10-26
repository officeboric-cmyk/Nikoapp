/**
 * The archipelago: 12 islands, 6 of them with an airport. Coordinates are metres;
 * north is -Z and east is +X. Headings are compass degrees (0 = north, 90 = east).
 */

export interface AirportDef {
  heading: number; // compass direction of take-off
  length: number; // m
  elevation: number; // m above sea level, the ground is flattened to this
  offset?: [number, number]; // m from the island centre (x, z)
}

export interface IslandDef {
  name: string;
  x: number;
  z: number;
  radius: number; // m, rough coastline radius
  peak: number; // m, highest point
  shape?: 'hills' | 'cone'; // cone = volcano-like
  stretch?: [number, number]; // scale [along, across] the `rotation` direction
  rotation?: number; // compass direction of the island's long axis
  snowLine?: number; // m above which there is snow (default 520)
  lighthouse?: boolean;
  airport?: AirportDef;
}

export const MAP_HALF_SIZE = 11000; // m, the playable map is 22 × 22 km

export const ISLANDS: IslandDef[] = [
  { name: 'Sunčani otok', x: 0, z: 0, radius: 1500, peak: 90, airport: { heading: 0, length: 1100, elevation: 6 } },
  { name: 'Zeleni otok', x: 5200, z: -2600, radius: 1300, peak: 150, airport: { heading: 60, length: 900, elevation: 10 } },
  {
    name: 'Planinski otok',
    x: -5400,
    z: -1800,
    radius: 2000,
    peak: 520,
    airport: { heading: 90, length: 1000, elevation: 12, offset: [0, 1150] },
  },
  { name: 'Pješčani otok', x: 1800, z: 5600, radius: 1100, peak: 18, airport: { heading: 120, length: 900, elevation: 4 } },
  { name: 'Vulkan', x: -1500, z: -6500, radius: 1000, peak: 560, shape: 'cone' },
  { name: 'Gusarski otok', x: 3200, z: -7200, radius: 500, peak: 40 },
  { name: 'Otok dupina', x: 7400, z: 1800, radius: 450, peak: 25 },
  { name: 'Borov otok', x: -4600, z: 4600, radius: 1300, peak: 200, airport: { heading: 30, length: 900, elevation: 14 } },
  { name: 'Kameni otok', x: 8200, z: -6000, radius: 700, peak: 160 },
  { name: 'Ledeni otok', x: -8800, z: -7200, radius: 1300, peak: 750, snowLine: 260 },
  { name: 'Otok svjetionika', x: -8600, z: 900, radius: 350, peak: 20, lighthouse: true },
  {
    name: 'Dugi otok',
    x: 7600,
    z: 7600,
    radius: 1300,
    peak: 60,
    stretch: [2.2, 0.5],
    rotation: 60,
    airport: { heading: 60, length: 1100, elevation: 6 },
  },
];
