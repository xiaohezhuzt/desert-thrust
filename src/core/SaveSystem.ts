import { isQualityTier } from './DeviceProfile';
import type { QualityTier } from '../config/quality';

export type QualityLock = QualityTier | 'auto';
export type SpeedUnit = 'kmh' | 'mph';

export interface Settings {
  qualityLock: QualityLock;
  units: SpeedUnit;
  /** null = device default (on for phones/tablets). */
  autoThrottle: boolean | null;
  /** Airborne auto-right assist; null = device default (on for touch). */
  airAssist: boolean | null;
  /** touch scheme A (virtual stick) or B (tilt to steer) */
  controlScheme: 'stick' | 'tilt';
  tiltSensitivity: number;
  tiltDeadzone: number;
  sfxVolume: number;
  musicVolume: number;
  /** slow-motion orbit camera after PERFECT landings */
  slowMo: boolean;
  /** nickname for online races */
  playerName: string;
}

/** Best result per level. */
export interface LevelRecord {
  stars: number;
  bestTime: number | null;
  bestPlace: number | null;
}

export interface Progress {
  /** highest level id the player may start */
  unlocked: number;
  levels: Record<string, LevelRecord>;
  /** best 0–60 mph time in Drag Run, seconds */
  dragBest: number | null;
}

const SETTINGS_KEY = 'desert-thrust.settings.v1';
const PROGRESS_KEY = 'desert-thrust.progress.v1';

function emptyProgress(): Progress {
  return { unlocked: 1, levels: {}, dragBest: null };
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const DEFAULT_SETTINGS: Settings = {
  qualityLock: 'auto',
  units: 'kmh',
  autoThrottle: null,
  airAssist: null,
  controlScheme: 'stick',
  tiltSensitivity: 1,
  tiltDeadzone: 0.06,
  sfxVolume: 0.8,
  musicVolume: 0.5,
  slowMo: true,
  playerName: '',
};

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / storage blocked: settings just won't persist.
  }
}

export const SaveSystem = {
  loadSettings(): Settings {
    const data = readJson(SETTINGS_KEY);
    const s: Settings = { ...DEFAULT_SETTINGS };
    if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>;
      if (d.qualityLock === 'auto' || isQualityTier(d.qualityLock)) s.qualityLock = d.qualityLock;
      if (d.units === 'kmh' || d.units === 'mph') s.units = d.units;
      if (typeof d.autoThrottle === 'boolean') s.autoThrottle = d.autoThrottle;
      if (typeof d.airAssist === 'boolean') s.airAssist = d.airAssist;
      if (d.controlScheme === 'stick' || d.controlScheme === 'tilt') s.controlScheme = d.controlScheme;
      const clamp = (v: unknown, lo: number, hi: number, dflt: number): number =>
        typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
      s.tiltSensitivity = clamp(d.tiltSensitivity, 0.4, 2.5, s.tiltSensitivity);
      s.tiltDeadzone = clamp(d.tiltDeadzone, 0, 0.3, s.tiltDeadzone);
      s.sfxVolume = clamp(d.sfxVolume, 0, 1, s.sfxVolume);
      s.musicVolume = clamp(d.musicVolume, 0, 1, s.musicVolume);
      if (typeof d.slowMo === 'boolean') s.slowMo = d.slowMo;
      if (typeof d.playerName === 'string') s.playerName = d.playerName.slice(0, 16);
    }
    return s;
  },

  saveSettings(settings: Settings): void {
    writeJson(SETTINGS_KEY, settings);
  },

  loadProgress(): Progress {
    const data = readJson(PROGRESS_KEY);
    const p = emptyProgress();
    if (!data || typeof data !== 'object') return p;
    const d = data as Record<string, unknown>;
    p.unlocked = Math.max(1, Math.floor(num(d.unlocked) ?? 1));
    p.dragBest = num(d.dragBest);
    if (d.levels && typeof d.levels === 'object') {
      for (const [id, rec] of Object.entries(d.levels as Record<string, unknown>)) {
        if (!rec || typeof rec !== 'object') continue;
        const r = rec as Record<string, unknown>;
        p.levels[id] = {
          stars: Math.max(0, Math.min(3, Math.floor(num(r.stars) ?? 0))),
          bestTime: num(r.bestTime),
          bestPlace: num(r.bestPlace),
        };
      }
    }
    return p;
  },

  saveProgress(progress: Progress): void {
    writeJson(PROGRESS_KEY, progress);
  },

  resetProgress(): Progress {
    const p = emptyProgress();
    writeJson(PROGRESS_KEY, p);
    return p;
  },
};
