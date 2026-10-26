import { MathUtils } from 'three';
import type { FlightModel } from '../physics/FlightModel';

/**
 * All game audio, synthesised with the Web Audio API so there are no sound files to
 * download. Browsers only allow audio after a click or key press, so start() must be
 * called from one.
 */

const MUTE_KEY = 'niko-leti-muted';
const SMOOTH = 0.08; // s, time constant for continuous sounds following the plane

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineOsc!: OscillatorNode;
  private engineSub!: OscillatorNode;
  private engineFilter!: BiquadFilterNode;
  private engineGain!: GainNode;
  private propLfo!: OscillatorNode;
  private propDepth!: GainNode;
  private roarGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private rumbleGain!: GainNode;
  private stallGain!: GainNode;
  private noise!: AudioBuffer;

  private engine: 'prop' | 'jet' = 'prop';
  private muted = loadMuted();
  private paused = false;
  private hidden = false;

  get isMuted(): boolean {
    return this.muted;
  }

  start(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;

    const compressor = ctx.createDynamicsCompressor();
    compressor.connect(ctx.destination);
    this.master = gain(ctx, this.muted ? 0 : 1, compressor);

    // Engine: a low sawtooth plus a sub-octave, muffled by a low-pass filter. The propeller
    // "chop" is an LFO wobbling the volume, faster as the throttle opens.
    this.engineGain = gain(ctx, 0, this.master);
    const chop = gain(ctx, 0.75, this.engineGain);
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 2;
    this.engineFilter.connect(chop);
    this.engineOsc = osc(ctx, 'sawtooth', 50, this.engineFilter);
    this.engineSub = osc(ctx, 'square', 25, gain(ctx, 0.5, this.engineFilter));
    this.propDepth = gain(ctx, this.engine === 'prop' ? 0.25 : 0, chop.gain);
    this.propLfo = osc(ctx, 'sine', 8, this.propDepth);

    // Wind and runway rumble share one looping white-noise source.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;

    this.windGain = gain(ctx, 0, this.master);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.7;
    this.windFilter.connect(this.windGain);
    source.connect(this.windFilter);

    // Jet roar: the hiss of air rushing through the engines.
    this.roarGain = gain(ctx, 0, this.master);
    const roarFilter = ctx.createBiquadFilter();
    roarFilter.type = 'highpass';
    roarFilter.frequency.value = 900;
    roarFilter.connect(this.roarGain);
    source.connect(roarFilter);

    this.rumbleGain = gain(ctx, 0, this.master);
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 160;
    rumbleFilter.connect(this.rumbleGain);
    source.connect(rumbleFilter);
    source.start();

    // Stall warning beeper, switched on and off in update().
    this.stallGain = gain(ctx, 0, this.master);
    osc(ctx, 'square', 880, this.stallGain);

    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden;
      this.applySuspend();
    });
  }

  /** Follows the plane every frame: engine pitch, wind, wheels on the runway, stall beeps. */
  update(model: FlightModel): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const running = !model.crashed;
    const throttle = model.throttle;
    const speed = MathUtils.clamp(model.speed / model.spec.maxSpeed, 0, 1);

    const jet = this.engine === 'jet';
    // A propeller drones low and chops; a jet whines higher and roars.
    const pitch = jet ? 110 + throttle * 220 + speed * 60 : 40 + throttle * 50 + speed * 20;
    this.engineOsc.frequency.setTargetAtTime(pitch, t, SMOOTH);
    this.engineSub.frequency.setTargetAtTime(pitch / 2, t, SMOOTH);
    this.engineFilter.frequency.setTargetAtTime(jet ? 600 + throttle * 2500 : 300 + throttle * 1500, t, SMOOTH);
    const engineVolume = jet ? 0.03 + throttle * 0.06 : 0.05 + throttle * 0.12;
    this.engineGain.gain.setTargetAtTime(running ? engineVolume : 0, t, SMOOTH);
    this.propLfo.frequency.setTargetAtTime(8 + throttle * 20, t, SMOOTH);
    this.roarGain.gain.setTargetAtTime(running && jet ? 0.04 + throttle * 0.18 : 0, t, SMOOTH);

    this.windFilter.frequency.setTargetAtTime(300 + speed * 1500, t, SMOOTH);
    this.windGain.gain.setTargetAtTime(running ? speed * speed * 0.25 : 0, t, SMOOTH);

    const rolling = running && model.onGround ? Math.min(model.speed / 25, 1) : 0;
    this.rumbleGain.gain.setTargetAtTime(rolling * 0.35, t, SMOOTH);

    const beepOn = model.stalled && t % 0.25 < 0.125;
    this.stallGain.gain.setTargetAtTime(beepOn ? 0.04 : 0, t, 0.005);
  }

  /** Happy rising arpeggio. */
  takeoff(): void {
    this.chime([523.25, 659.25, 783.99]);
  }

  /** Two friendly notes coming down. */
  touchdown(): void {
    this.chime([783.99, 523.25]);
  }

  /** Switches between a propeller drone and a jet whine (when the player picks another plane). */
  setEngine(engine: 'prop' | 'jet'): void {
    this.engine = engine;
    if (this.ctx) this.propDepth.gain.setTargetAtTime(engine === 'prop' ? 0.25 : 0, this.ctx.currentTime, 0.05);
  }

  /** "Bloop" plus a wash of spray for landing in the sea with a plane that can't. */
  splash(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const bloopGain = gain(ctx, 0, this.master);
    bloopGain.gain.setValueAtTime(0.25, t);
    bloopGain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    const bloop = osc(ctx, 'sine', 600, bloopGain, t);
    bloop.frequency.exponentialRampToValueAtTime(180, t + 0.3);
    bloop.stop(t + 0.3);
    this.noiseBurst('bandpass', 1000, 0.45, 1.1);
  }

  /** A soft, cartoonish "bump" rather than anything scary. */
  crash(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;

    const thumpGain = gain(ctx, 0, this.master);
    thumpGain.gain.setValueAtTime(0.5, t);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    const thump = osc(ctx, 'sine', 140, thumpGain, t);
    thump.frequency.exponentialRampToValueAtTime(40, t + 0.5);
    thump.stop(t + 0.6);
    this.noiseBurst('lowpass', 500, 0.35, 0.7);
  }

  private noiseBurst(type: BiquadFilterType, frequency: number, volume: number, seconds: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const env = gain(ctx, 0, this.master);
    env.gain.setValueAtTime(volume, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.connect(env);
    const burst = ctx.createBufferSource();
    burst.buffer = this.noise;
    burst.connect(filter);
    burst.start(t);
    burst.stop(t + seconds);
  }

  /** Flips mute on/off, remembers it for next time and returns the new state. */
  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      // Storage can be blocked (private mode); muting still works for this visit.
    }
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.02);
    return this.muted;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.applySuspend();
  }

  private applySuspend(): void {
    if (!this.ctx) return;
    if (this.paused || this.hidden) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  private chime(notes: number[]): void {
    const ctx = this.ctx;
    if (!ctx) return;
    notes.forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.12;
      const env = gain(ctx, 0, this.master);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.15, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc(ctx, 'triangle', freq, env, t).stop(t + 0.5);
    });
  }
}

function gain(ctx: AudioContext, value: number, destination: AudioNode | AudioParam): GainNode {
  const node = ctx.createGain();
  node.gain.value = value;
  if (destination instanceof AudioParam) node.connect(destination);
  else node.connect(destination);
  return node;
}

function osc(ctx: AudioContext, type: OscillatorType, frequency: number, destination: AudioNode, when = 0): OscillatorNode {
  const node = ctx.createOscillator();
  node.type = type;
  node.frequency.value = frequency;
  node.connect(destination);
  node.start(when);
  return node;
}

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}
