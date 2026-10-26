import type { Biome } from '../config/levels';
import type { LandingGrade } from '../vehicle/LandingJudge';

/** Per-biome music: key root (Hz), scale degrees (semitones), tempo, feel. */
interface MusicStyle {
  readonly root: number;
  readonly scale: readonly number[];
  readonly bpm: number;
  readonly bass: readonly number[];
  readonly drums: 'four' | 'break' | 'half';
  readonly pad: OscillatorType;
}

const MUSIC: Record<Biome | 'menu', MusicStyle> = {
  menu: { root: 110, scale: [0, 3, 5, 7, 10], bpm: 96, bass: [0, 0, 3, 5], drums: 'half', pad: 'triangle' },
  desert: { root: 98, scale: [0, 1, 4, 5, 7, 8, 10], bpm: 112, bass: [0, 0, 1, 0, 5, 4], drums: 'four', pad: 'sawtooth' },
  coast: { root: 130.8, scale: [0, 2, 4, 7, 9], bpm: 118, bass: [0, 4, 5, 4], drums: 'four', pad: 'triangle' },
  mountain: { root: 116.5, scale: [0, 2, 3, 5, 7, 8, 10], bpm: 124, bass: [0, 3, 5, 3], drums: 'break', pad: 'sawtooth' },
  snow: { root: 103.8, scale: [0, 2, 3, 7, 8], bpm: 100, bass: [0, 0, 7, 3], drums: 'half', pad: 'sine' },
  canyon: { root: 87.3, scale: [0, 3, 5, 6, 7, 10], bpm: 128, bass: [0, 3, 0, 5, 6, 5], drums: 'break', pad: 'square' },
  city: { root: 110, scale: [0, 3, 5, 7, 10], bpm: 136, bass: [0, 0, 7, 0, 5, 0, 3, 0], drums: 'four', pad: 'sawtooth' },
};

/** Continuous sound state for one car (player or an opponent). */
export interface CarSoundState {
  speed: number;
  throttle: number;
  boost: number;
  jets: number;
  airborne: boolean;
}

interface Voice {
  osc: OscillatorNode;
  osc2: OscillatorNode;
  gain: GainNode;
  panner: PannerNode | null;
}

/**
 * Procedural Web Audio: electric motor whine, thruster hiss, wind, impacts,
 * landing stingers, positional opponent motors and a small step sequencer
 * for per-biome music. No audio files. Unlocks on the first user gesture (iOS).
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private noise!: AudioBuffer;
  private motor: Voice | null = null;
  private jetGain!: GainNode;
  private jetFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private readonly opponents: Voice[] = [];
  private style: MusicStyle = MUSIC.menu;
  private nextNote = 0;
  private step = 0;
  private sfxVolume = 0.8;
  private musicVolume = 0.5;
  private unlocked = false;

  constructor() {
    const unlock = (): void => {
      this.unlock();
    };
    // iOS: an AudioContext may only start inside a user gesture.
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchend', unlock, { passive: true });
  }

  get ready(): boolean {
    return this.ctx !== null && this.unlocked;
  }

  setVolumes(sfx: number, music: number): void {
    this.sfxVolume = sfx;
    this.musicVolume = music;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfx.gain.setTargetAtTime(sfx, t, 0.05);
    this.music.gain.setTargetAtTime(music * 0.55, t, 0.05);
  }

  private unlock(): void {
    if (this.unlocked && this.ctx?.state === 'running') return;
    try {
      if (!this.ctx) this.build();
      void this.ctx!.resume();
      // Play one silent buffer: the classic iOS unlock.
      const b = this.ctx!.createBufferSource();
      b.buffer = this.ctx!.createBuffer(1, 1, 22050);
      b.connect(this.ctx!.destination);
      b.start();
      this.unlocked = true;
    } catch {
      // Web Audio unavailable: stay silent.
    }
  }

  private build(): void {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxVolume;
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = this.musicVolume * 0.55;
    this.music.connect(this.master);

    // Shared white noise.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.motor = this.voice(null, 0.0);
    // Thruster hiss: band-passed noise.
    const jet = this.loopNoise();
    this.jetFilter = ctx.createBiquadFilter();
    this.jetFilter.type = 'bandpass';
    this.jetFilter.frequency.value = 1800;
    this.jetFilter.Q.value = 0.7;
    this.jetGain = ctx.createGain();
    this.jetGain.gain.value = 0;
    jet.connect(this.jetFilter).connect(this.jetGain).connect(this.sfx);
    // Wind: low-passed noise.
    const wind = this.loopNoise();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(lp).connect(this.windGain).connect(this.sfx);
    this.nextNote = ctx.currentTime + 0.1;
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start();
    return src;
  }

  /** Electric motor: detuned saw + square through a low-pass, optional 3D panner. */
  private voice(panner: PannerNode | null, level: number): Voice {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    const gain = ctx.createGain();
    gain.gain.value = level;
    const mix = ctx.createGain();
    mix.gain.value = 0.12;
    osc.connect(mix);
    osc2.connect(mix);
    mix.connect(lp).connect(gain);
    if (panner) gain.connect(panner).connect(this.sfx);
    else gain.connect(this.sfx);
    osc.start();
    osc2.start();
    return { osc, osc2, gain, panner };
  }

  /** Match the number of positional opponent voices (only the nearest few are heard). */
  setOpponentCount(n: number): void {
    if (!this.ctx) return;
    const want = Math.min(n, 3);
    while (this.opponents.length > want) {
      const v = this.opponents.pop()!;
      v.osc.stop();
      v.osc2.stop();
      v.gain.disconnect();
    }
    while (this.opponents.length < want) {
      const p = this.ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 6;
      p.rolloffFactor = 1.4;
      this.opponents.push(this.voice(p, 0));
    }
  }

  /**
   * Per-frame update. `listener` is the camera pose; `others` the nearest opponents
   * as [x, y, z, speed] tuples (sorted by distance).
   */
  update(
    player: CarSoundState,
    listener: { x: number; y: number; z: number; fx: number; fy: number; fz: number },
    others: readonly (readonly [number, number, number, number])[],
    paused: boolean,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.motor) return;
    const t = ctx.currentTime;
    const k = 0.06;
    const v = Math.abs(player.speed);
    const on = paused ? 0 : 1;
    // Motor pitch climbs with speed; air time lets it spin up.
    const f = 70 + v * 5.2 + (player.airborne ? 60 * player.throttle : 0);
    this.motor.osc.frequency.setTargetAtTime(f, t, k);
    this.motor.osc2.frequency.setTargetAtTime(f * 1.505, t, k);
    this.motor.gain.gain.setTargetAtTime(on * (0.18 + 0.32 * player.throttle) * Math.min(1, 0.4 + v / 30), t, k);
    this.jetGain.gain.setTargetAtTime(on * (player.boost * 0.5 + player.jets * 0.35), t, 0.03);
    this.jetFilter.frequency.setTargetAtTime(900 + player.boost * 2200 + player.jets * 400, t, 0.05);
    this.windGain.gain.setTargetAtTime(on * Math.min(0.45, (v / 70) ** 2 * 0.45), t, 0.1);

    const L = ctx.listener;
    if (L.positionX) {
      L.positionX.setTargetAtTime(listener.x, t, 0.02);
      L.positionY.setTargetAtTime(listener.y, t, 0.02);
      L.positionZ.setTargetAtTime(listener.z, t, 0.02);
      L.forwardX.setTargetAtTime(listener.fx, t, 0.02);
      L.forwardY.setTargetAtTime(listener.fy, t, 0.02);
      L.forwardZ.setTargetAtTime(listener.fz, t, 0.02);
    } else {
      L.setPosition(listener.x, listener.y, listener.z);
      L.setOrientation(listener.fx, listener.fy, listener.fz, 0, 1, 0);
    }
    this.opponents.forEach((voice, i) => {
      const o = others[i];
      if (!o || !voice.panner) {
        voice.gain.gain.setTargetAtTime(0, t, 0.1);
        return;
      }
      const p = voice.panner;
      if (p.positionX) {
        p.positionX.setTargetAtTime(o[0], t, 0.03);
        p.positionY.setTargetAtTime(o[1], t, 0.03);
        p.positionZ.setTargetAtTime(o[2], t, 0.03);
      } else p.setPosition(o[0], o[1], o[2]);
      const fo = 80 + Math.abs(o[3]) * 4.6;
      voice.osc.frequency.setTargetAtTime(fo, t, 0.08);
      voice.osc2.frequency.setTargetAtTime(fo * 1.49, t, 0.08);
      voice.gain.gain.setTargetAtTime(on * 0.5, t, 0.1);
    });

    if (!paused) this.scheduleMusic();
  }

  /** Landing thump scaled by grade, plus a stinger for PERFECT. */
  landing(grade: LandingGrade): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const strength = grade === 'CRASH' ? 1 : grade === 'BAD' ? 0.7 : 0.45;
    this.thump(t, strength);
    this.burst(t, grade === 'CRASH' ? 0.6 : 0.25, grade === 'CRASH' ? 900 : 2500, 0.25);
    if (grade === 'PERFECT') [0, 4, 7, 12].forEach((s, i) => this.blip(t + 0.05 + i * 0.07, 523.25 * 2 ** (s / 12), 0.12));
    if (grade === 'CRASH') this.blip(t, 110, 0.25, 'sawtooth');
  }

  /** Body hitting a wall / car: a thump plus metallic crunch, scaled by impact strength (0..1). */
  impact(strength: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const k = Math.min(Math.max(strength, 0), 1);
    this.thump(t, 0.35 + 0.65 * k);
    this.burst(t, 0.2 + 0.5 * k, 1600 + 1400 * k, 0.12 + 0.25 * k);
    if (k > 0.45) this.blip(t, 85, 0.18, 'sawtooth');
  }

  /** Short UI / event tones. */
  cue(kind: 'count' | 'go' | 'pass' | 'fail' | 'jump'): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (kind === 'count') this.blip(t, 440, 0.12);
    if (kind === 'go') this.blip(t, 880, 0.25);
    if (kind === 'pass') [0, 7, 12].forEach((s, i) => this.blip(t + i * 0.08, 659.25 * 2 ** (s / 12), 0.12));
    if (kind === 'fail') [0, -3, -7].forEach((s, i) => this.blip(t + i * 0.1, 330 * 2 ** (s / 12), 0.14, 'square'));
    if (kind === 'jump') this.burst(t, 0.35, 700, 0.35);
  }

  setMusic(biome: Biome | 'menu'): void {
    this.style = MUSIC[biome];
    this.step = 0;
    if (this.ctx) this.nextNote = this.ctx.currentTime + 0.1;
  }

  /** Visibility / pause: stop the clock entirely in the background. */
  suspend(on: boolean): void {
    if (!this.ctx) return;
    if (on) void this.ctx.suspend();
    else if (this.unlocked) void this.ctx.resume();
  }

  // ---- synthesis helpers ---------------------------------------------------

  private blip(t: number, freq: number, dur: number, type: OscillatorType = 'triangle', dest?: AudioNode): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private thump(t: number, strength: number, dest?: AudioNode): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(strength, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(dest ?? this.sfx);
    o.start(t);
    o.stop(t + 0.35);
  }

  private burst(t: number, level: number, freq: number, dur: number, dest?: AudioNode): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest ?? this.sfx);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  /** Look-ahead step sequencer (16ths): kick/snare/hat, bass line, pad chords. */
  private scheduleMusic(): void {
    const ctx = this.ctx!;
    const st = this.style;
    const sixteenth = 60 / st.bpm / 4;
    while (this.nextNote < ctx.currentTime + 0.15) {
      const t = this.nextNote;
      const s = this.step % 16;
      const bar = Math.floor(this.step / 16);
      const kick = st.drums === 'four' ? s % 4 === 0 : st.drums === 'break' ? s === 0 || s === 6 || s === 10 : s === 0 || s === 8;
      const snare = st.drums === 'half' ? s === 8 : s === 4 || s === 12;
      if (kick) this.thump(t, 0.55, this.music);
      if (snare) this.burst(t, 0.25, 1800, 0.12, this.music);
      if (s % 2 === 1) this.burst(t, 0.06, 8000, 0.04, this.music);
      if (s % 4 === 0) {
        const deg = st.bass[(this.step / 4) % st.bass.length]!;
        this.blip(t, st.root * 2 ** (deg / 12) / 2, sixteenth * 3.5, 'sawtooth', this.music);
      }
      if (s === 0 && bar % 2 === 0) {
        const r = st.bass[(bar / 2) % st.bass.length]!;
        for (const iv of [0, 7, 12 + st.scale[2 % st.scale.length]!]) {
          this.pad(t, st.root * 2 ** ((r + iv) / 12), sixteenth * 30, st.pad);
        }
      }
      if (s % 3 === 0 && Math.random() < 0.35) {
        const deg = st.scale[Math.floor(Math.random() * st.scale.length)]!;
        this.blip(t, st.root * 4 * 2 ** (deg / 12), sixteenth * 1.5, 'triangle', this.music);
      }
      this.nextNote += sixteenth;
      this.step++;
    }
  }

  private pad(t: number, freq: number, dur: number, type: OscillatorType): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.music);
    o.start(t);
    o.stop(t + dur + 0.1);
  }
}
