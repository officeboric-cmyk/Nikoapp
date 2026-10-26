import { AdditiveBlending, BufferGeometry, CanvasTexture, Float32BufferAttribute, Points, PointsMaterial, Vector3 } from 'three';

/**
 * Night lights drawn as glowing dots of a fixed size on screen, so a runway or a plane's
 * lights stay visible from far away. They ignore fog on purpose.
 */

let glow: CanvasTexture | undefined;

/** A soft round spot, white in the middle and fading out. */
function glowTexture(): CanvasTexture {
  if (glow) return glow;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  glow = new CanvasTexture(canvas);
  return glow;
}

/** `size` is in pixels on screen. */
export function lightMaterial(color: number, size: number): PointsMaterial {
  return new PointsMaterial({
    color,
    size,
    sizeAttenuation: false,
    map: typeof document === 'undefined' ? null : glowTexture(), // no canvas outside a browser (tests)
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
  });
}

export function lightPoints(positions: Vector3[], material: PointsMaterial): Points {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions.flatMap((p) => [p.x, p.y, p.z]), 3));
  return new Points(geometry, material);
}

/** Shared by every plane, so night / day switches them all at once. Hidden until night. */
export const NAV_LIGHTS = {
  left: lightMaterial(0xff2a2a, 10), // red on the left wing tip
  right: lightMaterial(0x2aff5a, 10), // green on the right wing tip
  strobe: lightMaterial(0xffffff, 12), // white, blinking on the tail
};
for (const material of Object.values(NAV_LIGHTS)) material.visible = false;
