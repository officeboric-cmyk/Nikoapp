import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { mulberry32 } from './noise';

/**
 * Small textures painted once at start-up on canvases (no image files to download): plaster walls with
 * windows and shutters, roof tiles, asphalt, concrete, corrugated metal, glass façades.
 */

function paint(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat = true): CanvasTexture {
  // Outside a browser (the physics tests build the islands too) there is nothing to paint on.
  if (typeof document === 'undefined') return new CanvasTexture(undefined as unknown as HTMLCanvasElement);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  if (repeat) texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
}

/** Speckles of lighter and darker dots over the whole canvas: grain for plaster, stone and asphalt. */
function grain(ctx: CanvasRenderingContext2D, width: number, height: number, count: number, strength: number, seed: number): void {
  const rand = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const light = rand() < 0.5;
    ctx.fillStyle = light ? `rgba(255,255,255,${rand() * strength})` : `rgba(0,0,0,${rand() * strength})`;
    const size = 1 + rand() * 2.5;
    ctx.fillRect(rand() * width, rand() * height, size, size);
  }
}

/**
 * A house wall, two floors high (the bottom half is one floor): white plaster for tinting, windows with
 * green shutters, stone corners. The emissive twin lights only the windows at night.
 */
export function houseWall(): { map: CanvasTexture; glow: CanvasTexture } {
  const W = 256;
  const H = 256;
  const windows: [number, number, number, number][] = [];
  for (const floor of [0, 1]) {
    for (const col of [0, 1, 2]) {
      const x = 34 + col * 80;
      const y = floor === 0 ? 150 : 34;
      // The ground floor has a door in the middle instead of a window.
      if (floor === 0 && col === 1) windows.push([x + 2, 140, 40, 116]);
      else windows.push([x + 6, y + 6, 30, 52]);
    }
  }
  const map = paint(W, H, (ctx) => {
    ctx.fillStyle = '#f2ede4';
    ctx.fillRect(0, 0, W, H);
    grain(ctx, W, H, 2600, 0.12, 3);
    // Patches of weathered plaster and stone showing through.
    const rand = mulberry32(9);
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(140,120,95,${0.05 + rand() * 0.07})`;
      ctx.beginPath();
      ctx.ellipse(rand() * W, rand() * H, 10 + rand() * 25, 6 + rand() * 14, rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Stone quoins at the corners.
    ctx.fillStyle = '#cfc4b0';
    for (let y = 0; y < H; y += 18) {
      const long = (y / 18) % 2 === 0;
      ctx.fillRect(0, y, long ? 20 : 12, 16);
      ctx.fillRect(W - (long ? 20 : 12), y, long ? 20 : 12, 16);
    }
    // A plinth of darker stone along the bottom.
    ctx.fillStyle = '#b8ab95';
    ctx.fillRect(0, H - 14, W, 14);
    for (const [x, y, w, h] of windows) {
      const door = h > 100;
      ctx.fillStyle = '#d9cfbd'; // stone frame
      ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
      ctx.fillStyle = door ? '#6b4a2f' : '#3a4650';
      ctx.fillRect(x, y, w, h);
      if (door) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        for (let k = 1; k < 4; k++) ctx.fillRect(x + (k * w) / 4, y, 1.5, h);
      } else {
        ctx.fillStyle = '#c9d6dc'; // glazing bars catch the light
        ctx.fillRect(x + w / 2 - 1, y, 2, h);
        ctx.fillRect(x, y + h / 2 - 1, w, 2);
        // Green shutters, open against the wall.
        ctx.fillStyle = '#4f7a4a';
        ctx.fillRect(x - 18, y, 13, h);
        ctx.fillRect(x + w + 5, y, 13, h);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        for (let k = 6; k < h; k += 7) {
          ctx.fillRect(x - 18, y + k, 13, 1.5);
          ctx.fillRect(x + w + 5, y + k, 13, 1.5);
        }
      }
    }
  });
  const glow = paint(W, H, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    for (const [x, y, w, h] of windows) if (h < 100) ctx.fillRect(x, y, w, h);
  });
  return { map, glow };
}

/** Terracotta roof tiles in rows (the curved Mediterranean kind), for tinting. */
export function roofTiles(): CanvasTexture {
  return paint(128, 128, (ctx) => {
    ctx.fillStyle = '#c9c9c9';
    ctx.fillRect(0, 0, 128, 128);
    const rand = mulberry32(5);
    for (let col = 0; col < 8; col++) {
      for (let row = 0; row < 8; row++) {
        const x = col * 16;
        const y = row * 16;
        const shade = 190 + rand() * 60;
        const grad = ctx.createLinearGradient(x, 0, x + 16, 0);
        grad.addColorStop(0, `rgb(${shade * 0.7},${shade * 0.7},${shade * 0.7})`);
        grad.addColorStop(0.5, `rgb(${shade},${shade},${shade})`);
        grad.addColorStop(1, `rgb(${shade * 0.6},${shade * 0.6},${shade * 0.6})`);
        ctx.fillStyle = grad;
        ctx.fillRect(x + 1, y, 14, 15);
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; // the shadow under each row's lower edge
        ctx.fillRect(x, y + 13, 16, 3);
      }
    }
    grain(ctx, 128, 128, 600, 0.15, 6);
  });
}

/** Weathered asphalt with a little grain; tyre marks darken the middle. One repeat is 30 × 120 m. */
export function asphalt(): CanvasTexture {
  return paint(128, 512, (ctx) => {
    ctx.fillStyle = '#5a5d63';
    ctx.fillRect(0, 0, 128, 512);
    grain(ctx, 128, 512, 9000, 0.18, 11);
    const rand = mulberry32(12);
    // Faint patches of newer and older asphalt.
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = `rgba(${rand() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + rand() * 0.04})`;
      ctx.fillRect(rand() * 100, rand() * 512, 20 + rand() * 60, 30 + rand() * 120);
    }
    // Tyre marks along the middle.
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `rgba(20,20,22,${0.08 + rand() * 0.12})`;
      ctx.fillRect(40 + rand() * 48, rand() * 512, 2 + rand() * 4, 40 + rand() * 160);
    }
  });
}

/** Concrete slabs with joints, for the apron. One repeat is 10 × 10 m (two slabs each way). */
export function concrete(): CanvasTexture {
  return paint(256, 256, (ctx) => {
    ctx.fillStyle = '#a7a9ab';
    ctx.fillRect(0, 0, 256, 256);
    const rand = mulberry32(21);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = `rgba(${rand() < 0.5 ? '0,0,0' : '255,255,255'},${0.02 + rand() * 0.03})`;
      ctx.fillRect((i % 2) * 128, Math.floor(i / 2) * 128, 128, 128);
    }
    grain(ctx, 256, 256, 5000, 0.12, 22);
    ctx.fillStyle = 'rgba(40,40,40,0.22)';
    for (const p of [0, 128]) {
      ctx.fillRect(p, 0, 2, 256);
      ctx.fillRect(0, p, 256, 2);
    }
    // A few oil stains.
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = `rgba(30,30,30,${0.08 + rand() * 0.08})`;
      ctx.beginPath();
      ctx.ellipse(rand() * 256, rand() * 256, 6 + rand() * 14, 4 + rand() * 9, rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Corrugated metal sheeting: light and dark ridges running one way. */
export function corrugated(): CanvasTexture {
  return paint(64, 64, (ctx) => {
    for (let x = 0; x < 64; x++) {
      const v = 175 + 45 * Math.sin((x / 64) * Math.PI * 2 * 8);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, 0, 1, 64);
    }
    grain(ctx, 64, 64, 200, 0.08, 31);
  });
}

/** A hangar's front: big sliding doors in panels with a strip of windows above. */
export function hangarDoors(): CanvasTexture {
  return paint(256, 128, (ctx) => {
    ctx.fillStyle = '#c4c8cc';
    ctx.fillRect(0, 0, 256, 128);
    for (let x = 0; x < 256; x += 32) {
      ctx.fillStyle = (x / 32) % 2 ? '#b4b9be' : '#bfc4c9';
      ctx.fillRect(x + 1, 30, 30, 98);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(x, 30, 1.5, 98);
    }
    ctx.fillStyle = '#5d6d78';
    for (let x = 8; x < 248; x += 20) ctx.fillRect(x, 10, 14, 12);
    grain(ctx, 256, 128, 1200, 0.08, 32);
  }, false);
}

/** A terminal's glass front: tinted panes between metal mullions, a concrete band at the top. */
export function glassFacade(): { map: CanvasTexture; glow: CanvasTexture } {
  const draw = (ctx: CanvasRenderingContext2D, lit: boolean) => {
    ctx.fillStyle = lit ? '#000' : '#d8dcdf';
    ctx.fillRect(0, 0, 256, 128);
    for (let x = 0; x < 256; x += 32) {
      for (let y = 26; y < 120; y += 47) {
        if (lit) {
          ctx.fillStyle = '#fff';
        } else {
          const grad = ctx.createLinearGradient(x, y, x + 30, y + 45);
          grad.addColorStop(0, '#5f7f93');
          grad.addColorStop(1, '#2e4656');
          ctx.fillStyle = grad;
        }
        ctx.fillRect(x + 2, y, 28, 44);
      }
    }
  };
  return { map: paint(256, 128, (ctx) => draw(ctx, false)), glow: paint(256, 128, (ctx) => draw(ctx, true)) };
}

/** Rough limestone blocks, for the bell tower and the lighthouse keeper's house. */
export function stoneBlocks(): CanvasTexture {
  return paint(128, 128, (ctx) => {
    ctx.fillStyle = '#d6ccb8';
    ctx.fillRect(0, 0, 128, 128);
    const rand = mulberry32(41);
    for (let row = 0; row < 8; row++) {
      let x = row % 2 ? -10 : 0;
      while (x < 128) {
        const w = 18 + rand() * 18;
        const v = 190 + rand() * 40;
        ctx.fillStyle = `rgb(${v},${v * 0.95},${v * 0.86})`;
        ctx.fillRect(x + 1, row * 16 + 1, w - 2, 14);
        x += w;
      }
    }
    grain(ctx, 128, 128, 900, 0.12, 42);
  });
}

/** The top of a bell tower: stone with an arched opening for the bells on each side. */
export function belfry(): CanvasTexture {
  return paint(128, 128, (ctx) => {
    ctx.fillStyle = '#d8cfbc';
    ctx.fillRect(0, 0, 128, 128);
    grain(ctx, 128, 128, 900, 0.12, 43);
    ctx.fillStyle = '#2c2a28';
    ctx.beginPath();
    ctx.moveTo(40, 112);
    ctx.lineTo(40, 50);
    ctx.arc(64, 50, 24, Math.PI, 0);
    ctx.lineTo(88, 112);
    ctx.fill();
    ctx.fillStyle = '#c9bea8'; // the sill and cornice
    ctx.fillRect(30, 110, 68, 6);
    ctx.fillRect(0, 0, 128, 8);
  }, false);
}

/** A control tower's cab: dark tinted panes between white frames, all the way round. */
export function towerGlass(): CanvasTexture {
  return paint(256, 64, (ctx) => {
    ctx.fillStyle = '#eef0f2';
    ctx.fillRect(0, 0, 256, 64);
    for (let x = 0; x < 256; x += 32) {
      const grad = ctx.createLinearGradient(0, 4, 0, 60);
      grad.addColorStop(0, '#3d5566');
      grad.addColorStop(1, '#1b2a33');
      ctx.fillStyle = grad;
      ctx.fillRect(x + 3, 4, 26, 56);
    }
  });
}

/** The airport's name in big letters, for the terminal's roof. */
export function nameSign(text: string): CanvasTexture {
  return paint(1024, 128, (ctx) => {
    ctx.clearRect(0, 0, 1024, 128);
    ctx.font = 'bold 84px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#1d3557';
    ctx.fillText(text.toUpperCase(), 512, 66);
  }, false);
}

/** A white wall with a row of small windows, for the back of the terminal and the tower's base. */
export function officeWall(): CanvasTexture {
  return paint(128, 64, (ctx) => {
    ctx.fillStyle = '#e9ebec';
    ctx.fillRect(0, 0, 128, 64);
    grain(ctx, 128, 64, 300, 0.06, 51);
    for (let x = 8; x < 128; x += 30) {
      ctx.fillStyle = '#41586a';
      ctx.fillRect(x, 20, 18, 22);
    }
  });
}
