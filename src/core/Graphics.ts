import { ACESFilmicToneMapping, HalfFloatType, PCFShadowMap, Vector2, WebGLRenderTarget, WebGLRenderer, type PerspectiveCamera, type Scene } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Quality } from '../ui/Menu';
import type { World } from '../world/World';

/**
 * The renderer and the picture quality. Fast draws straight to the screen at a modest
 * resolution. Pretty renders at full sharpness with sharper shadows, then adds bloom: a soft
 * glow around the sun, its glints on the sea and every light at night.
 */

const SETTINGS: Record<Quality, { pixelRatio: number; shadowMap: number; bloom: boolean }> = {
  fast: { pixelRatio: 1.25, shadowMap: 1024, bloom: false },
  pretty: { pixelRatio: 2, shadowMap: 2048, bloom: true },
};

const LOWEST_PIXEL_RATIO = 0.75; // the step below fast: a slightly soft picture that most devices can draw smoothly

const BLOOM = { strength: 0.45, radius: 0.5, threshold: 0.9 };

export class Graphics {
  readonly renderer = new WebGLRenderer({ antialias: true });
  private readonly composer: EffectComposer;
  private quality: Quality = 'fast';
  /** Fast and still too slow for the device: an even lower resolution. */
  private lowest = false;

  constructor(
    container: HTMLElement,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    private readonly world: World,
  ) {
    const r = this.renderer;
    r.shadowMap.enabled = true;
    r.shadowMap.type = PCFShadowMap;
    r.toneMapping = ACESFilmicToneMapping;
    container.appendChild(r.domElement);

    // Bloom needs the picture before tone mapping (bright things stay brighter than white);
    // the output pass then tone-maps it just as the renderer would. 4× multisampling keeps edges smooth.
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(new UnrealBloomPass(new Vector2(256, 256), BLOOM.strength, BLOOM.radius, BLOOM.threshold));
    this.composer.addPass(new OutputPass());
  }

  /** Device pixels from the top of the canvas to the bottom. */
  get pixelHeight(): number {
    return window.innerHeight * this.renderer.getPixelRatio();
  }

  /** 'lowest' once the fast setting has been stepped down further. */
  get level(): Quality | 'lowest' {
    return this.lowest && this.quality === 'fast' ? 'lowest' : this.quality;
  }

  setQuality(quality: Quality): void {
    this.quality = quality;
    this.lowest = false;
    const settings = SETTINGS[quality];
    const shadow = this.world.sun.shadow;
    if (shadow.mapSize.x !== settings.shadowMap) {
      shadow.mapSize.set(settings.shadowMap, settings.shadowMap);
      shadow.map?.dispose();
      shadow.map = null; // made again at the new size on the next frame
    }
    this.resize();
  }

  /** Steps below fast: fewer pixels, for devices that struggle even then. */
  lowerResolution(): void {
    this.lowest = true;
    this.resize();
  }

  resize(): void {
    const ratio = Math.min(window.devicePixelRatio, this.lowest ? LOWEST_PIXEL_RATIO : SETTINGS[this.quality].pixelRatio);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  render(): void {
    if (SETTINGS[this.quality].bloom) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
