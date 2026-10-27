import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Fog,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Points,
  PointsMaterial,
  Scene,
  Vector3,
} from 'three';
import { NAV_LIGHTS } from './lights';
import { SkyDome, skyUniforms } from './Sky';
import type { World } from './World';

export type TimeOfDay = 'day' | 'sunset' | 'night';
export type Weather = 'clear' | 'windy' | 'rain';

export const TIMES: { id: TimeOfDay; label: string }[] = [
  { id: 'day', label: '☀️ Dan' },
  { id: 'sunset', label: '🌅 Zalazak' },
  { id: 'night', label: '🌙 Noć' },
];

export const WEATHERS: { id: Weather; label: string }[] = [
  { id: 'clear', label: '😎 Vedro' },
  { id: 'windy', label: '💨 Vjetar' },
  { id: 'rain', label: '🌧️ Kiša' },
];

/** How the sky and light look at a time of day. */
interface Look {
  skyTop: number; // overhead
  sky: number; // at the horizon, also the fog
  sunGlow: number; // haze around the sun (or moon)
  sunGlowStrength: number;
  sunDisc: number;
  sunDiscStrength: number;
  sunColor: number;
  sunIntensity: number;
  sunOffset: [number, number, number]; // sun direction (relative to the plane): low = long shadows
  skyLight: number;
  groundLight: number;
  ambient: number;
  clouds: number; // cloud glow colour
  cloudGlow: number;
  windows: number; // houses' window glow, 0 = off
  lightsOn: boolean;
}

const LOOKS: Record<TimeOfDay, Look> = {
  day: {
    skyTop: 0x1a6bd0,
    sky: 0x9dd8f0,
    sunGlow: 0xfff4d6,
    sunGlowStrength: 0.5,
    sunDisc: 0xfffbe8,
    sunDiscStrength: 1.6,
    sunColor: 0xffffff,
    sunIntensity: 2.2,
    sunOffset: [80, 150, 60],
    skyLight: 0xdff6ff,
    groundLight: 0x5a8f3c,
    ambient: 1.4,
    clouds: 0xffffff,
    cloudGlow: 0.35,
    windows: 0,
    lightsOn: false,
  },
  sunset: {
    skyTop: 0x4a5fa8,
    sky: 0xf4a261,
    sunGlow: 0xff8a3d,
    sunGlowStrength: 1,
    sunDisc: 0xffd27a,
    sunDiscStrength: 1.6,
    sunColor: 0xffb070,
    sunIntensity: 2,
    sunOffset: [180, 40, 40],
    // Only lightly tinted: strongly orange light would turn the blue sea almost black.
    skyLight: 0xffe6d2,
    groundLight: 0x8a6a4a,
    ambient: 1.25,
    clouds: 0xffb38a,
    cloudGlow: 0.35,
    windows: 0.15,
    lightsOn: true,
  },
  night: {
    skyTop: 0x030914,
    sky: 0x0e2245,
    sunGlow: 0x6f86c0, // the moon's halo
    sunGlowStrength: 0.25,
    sunDisc: 0xf1f4ff,
    sunDiscStrength: 1.1,
    sunColor: 0x9db4ff, // moonlight
    sunIntensity: 0.45,
    sunOffset: [-60, 140, -80],
    skyLight: 0x3a4f7a,
    groundLight: 0x111a22,
    ambient: 0.55,
    clouds: 0x4a5878,
    cloudGlow: 0.1,
    windows: 0.45,
    lightsOn: true,
  },
};

/** Weather: wind (m/s, blowing towards +X = east), bumps, and how far you can see. */
const WEATHER: Record<Weather, { wind: number; turbulence: number; fogScale: number; grey: number }> = {
  clear: { wind: 0, turbulence: 0, fogScale: 1, grey: 0 },
  windy: { wind: 6, turbulence: 0.6, fogScale: 0.9, grey: 0.1 },
  rain: { wind: 3, turbulence: 0.3, fogScale: 0.45, grey: 0.45 },
};

const FOG = { near: 2500, far: 12000 };
const GREY = new Color(0x7d8a96);
const STAR_COUNT = 1500;
const STAR_DISTANCE = 9000; // m, inside the camera's far plane
const RAIN_DROPS = 2500;
const RAIN_BOX = { half: 60, height: 80 }; // m around the camera
const RAIN_SPEED = 30; // m/s
const STROBE_PERIOD = 1.2; // s

/** Time of day and weather: sky, sun, fog, stars, night lights, rain and wind. */
export class Environment {
  time: TimeOfDay = 'day';
  weather: Weather = 'clear';
  readonly wind = new Vector3();
  turbulence = 0;
  private readonly sky = new SkyDome();
  private readonly stars: Points;
  private readonly rain: LineSegments;
  private readonly rainPositions: Float32Array;
  private clock = 0;

  constructor(
    private readonly scene: Scene,
    private readonly world: World,
  ) {
    // Stars on a big dome that travels with the camera, so they look infinitely far away.
    const starPositions: number[] = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      const azimuth = Math.random() * Math.PI * 2;
      const elevation = Math.asin(Math.random() * 0.95 + 0.05);
      starPositions.push(
        Math.cos(azimuth) * Math.cos(elevation) * STAR_DISTANCE,
        Math.sin(elevation) * STAR_DISTANCE,
        Math.sin(azimuth) * Math.cos(elevation) * STAR_DISTANCE,
      );
    }
    const starGeometry = new BufferGeometry();
    starGeometry.setAttribute('position', new Float32BufferAttribute(starPositions, 3));
    this.stars = new Points(starGeometry, new PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false }));
    this.stars.frustumCulled = false;

    // Rain: short streaks in a box around the camera, recycled as they fall out of it.
    this.rainPositions = new Float32Array(RAIN_DROPS * 6);
    for (let i = 0; i < RAIN_DROPS; i++) {
      const x = MathUtils.randFloatSpread(RAIN_BOX.half * 2);
      const y = Math.random() * RAIN_BOX.height - RAIN_BOX.height / 2;
      const z = MathUtils.randFloatSpread(RAIN_BOX.half * 2);
      this.rainPositions.set([x, y, z, x, y - 1.2, z], i * 6);
    }
    const rainGeometry = new BufferGeometry();
    rainGeometry.setAttribute('position', new BufferAttribute(this.rainPositions, 3)); // shares the array, so moving drops shows
    this.rain = new LineSegments(rainGeometry, new LineBasicMaterial({ color: 0xbfd7ea, transparent: true, opacity: 0.55 }));
    this.rain.frustumCulled = false;

    scene.add(this.sky.mesh, this.stars, this.rain);
    this.set('day', 'clear');
  }

  set(time: TimeOfDay, weather: Weather): void {
    this.time = time;
    this.weather = weather;
    const look = LOOKS[time];
    const w = WEATHER[weather];

    const grey = w.grey * (time === 'night' ? 0.3 : 1);
    const sky = new Color(look.sky).lerp(GREY, grey);
    this.scene.background = sky;
    this.scene.fog = new Fog(sky, FOG.near * w.fogScale, FOG.far * w.fogScale);
    skyUniforms.skyHorizon.value.copy(sky);
    skyUniforms.skyTop.value.setHex(look.skyTop).lerp(GREY, Math.min(grey * 1.7, 1)); // overcast all over
    skyUniforms.sunDirection.value.set(...look.sunOffset).normalize();
    // Clouds hide the disc in the rain and soften the glow.
    skyUniforms.sunGlow.value.setHex(look.sunGlow).multiplyScalar(look.sunGlowStrength * (1 - w.grey));
    skyUniforms.sunDisc.value.setHex(look.sunDisc).multiplyScalar(weather === 'rain' ? 0 : look.sunDiscStrength);
    skyUniforms.sunSize.value = time === 'night' ? 0.03 : 0.035;

    const { sun, sky: skyLight, cloudMaterial, windowsMaterial, nightOnly, sunOffset } = this.world;
    sun.color.setHex(look.sunColor);
    sun.intensity = look.sunIntensity * (1 - w.grey * 0.6);
    sunOffset.set(...look.sunOffset);
    skyLight.color.setHex(look.skyLight);
    skyLight.groundColor.setHex(look.groundLight);
    skyLight.intensity = look.ambient;
    cloudMaterial.emissive.setHex(look.clouds);
    cloudMaterial.emissiveIntensity = look.cloudGlow;
    cloudMaterial.color.setHex(weather === 'rain' ? 0x9aa5b1 : 0xffffff);
    windowsMaterial.emissive.setHex(0xffc46b);
    windowsMaterial.emissiveIntensity = look.windows;

    for (const object of nightOnly) object.visible = look.lightsOn;
    for (const material of Object.values(NAV_LIGHTS)) material.visible = look.lightsOn;
    this.stars.visible = time === 'night' && weather !== 'rain';
    this.rain.visible = weather === 'rain';

    this.wind.set(w.wind, 0, 0);
    this.turbulence = w.turbulence;
    for (const airport of this.world.terrain.airports) airport.pointWindsock(this.wind.x || 1, this.wind.z);
  }

  update(dt: number, cameraPosition: Vector3): void {
    this.clock += dt;
    this.stars.position.copy(cameraPosition);
    this.sky.mesh.position.copy(cameraPosition);

    // Strobes flash briefly once per period.
    NAV_LIGHTS.strobe.opacity = this.clock % STROBE_PERIOD < 0.12 ? 1 : 0;

    if (this.rain.visible) {
      this.rain.position.copy(cameraPosition);
      const p = this.rainPositions;
      const fall = RAIN_SPEED * dt;
      for (let i = 0; i < p.length; i += 6) {
        p[i + 1] -= fall;
        p[i + 4] -= fall;
        if (p[i + 1] < -RAIN_BOX.height / 2) {
          p[i + 1] += RAIN_BOX.height;
          p[i + 4] += RAIN_BOX.height;
        }
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
  }
}
