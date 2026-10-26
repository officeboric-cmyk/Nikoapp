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
  private windFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private rumbleGain!: GainNode;
  private stallGain!: GainNode;
  private noise!: AudioBuffer;

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
    this.propLfo = osc(ctx, 'sine', 8, gain(ctx, 0.25, chop.gain));

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

    const pitch = 40 + throttle * 50 + speed * 20;
    this.engineOsc.frequency.setTargetAtTime(pitch, t, SMOOTH);
    this.engineSub.frequency.setTargetAtTime(pitch / 2, t, SMOOTH);
    this.engineFilter.frequency.setTargetAtTime(300 + throttle * 1500, t, SMOOTH);
    this.engineGain.gain.setTargetAtTime(running ? 0.05 + throttle * 0.12 : 0, t, SMOOTH);
    this.propLfo.frequency.setTargetAtTime(8 + throttle * 20, t, SMOOTH);

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

    const puffGain = gain(ctx, 0, this.master);
    puffGain.gain.setValueAtTime(0.35, t);
    puffGain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    const puffFilter = ctx.createBiquadFilter();
    puffFilter.type = 'lowpass';
    puffFilter.frequency.value = 500;
    puffFilter.connect(puffGain);
    const puff = ctx.createBufferSource();
    puff.buffer = this.noise;
    puff.connect(puffFilter);
    puff.start(t);
    puff.stop(t + 0.7);
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
