import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';

/**
 * The sky: a dome that travels with the camera, blue overhead fading to the fog colour at the
 * horizon, with a glow around the sun and the sun's (or at night the moon's) disc. The sea
 * reflects the same sky, so both share these uniforms and the GLSL below.
 */

const DOME_RADIUS = 11000; // m, beyond the stars but inside the camera's far plane

export const skyUniforms = {
  skyTop: { value: new Color(0x3b8be0) },
  skyHorizon: { value: new Color(0x9dd8f0) },
  sunDirection: { value: new Vector3(0, 1, 0) },
  sunGlow: { value: new Color(0xffffff) }, // colour × strength of the haze around the sun
  sunDisc: { value: new Color(0xffffff) }, // colour × strength of the disc itself, black = hidden
  sunSize: { value: 0.035 }, // rad, a lot bigger than the real sun so it reads as a sun
};

/** `vec3 skyColor(vec3 dir)`: the sky seen in direction `dir` (world space, normalised). */
export const SKY_GLSL = /* glsl */ `
uniform vec3 skyTop;
uniform vec3 skyHorizon;
uniform vec3 sunDirection;
uniform vec3 sunGlow;
uniform vec3 sunDisc;
uniform float sunSize;

vec3 skyColor(vec3 dir) {
  float up = max(dir.y, 0.0);
  vec3 color = mix(skyHorizon, skyTop, pow(smoothstep(0.0, 0.7, up), 0.6));
  float toSun = max(dot(dir, sunDirection), 0.0);
  // A wide soft haze near the horizon and a tighter halo right around the disc.
  color += sunGlow * (0.45 * pow(toSun, 6.0) * (1.0 - 0.6 * smoothstep(0.0, 0.5, up)) + 0.6 * pow(toSun, 120.0));
  color += sunDisc * smoothstep(cos(sunSize), cos(sunSize * 0.85), toSun);
  return color;
}
`;

export class SkyDome {
  readonly mesh: Mesh;

  constructor() {
    const material = new ShaderMaterial({
      uniforms: skyUniforms,
      vertexShader: /* glsl */ `
        varying vec3 vDirection;
        void main() {
          vDirection = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${SKY_GLSL}
        varying vec3 vDirection;
        void main() {
          gl_FragColor = vec4(skyColor(normalize(vDirection)), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false, // the sky is drawn in the fog colour at the horizon already
    });
    this.mesh = new Mesh(new SphereGeometry(DOME_RADIUS, 32, 16), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000; // drawn first, behind everything
  }
}
