import type { LevelDef } from '../config/levels';
import type { Progress } from '../core/SaveSystem';
import type { RunResult } from './Campaign';

export interface StarCheck {
  readonly label: string;
  readonly met: boolean;
}

export interface Rating {
  readonly stars: number;
  readonly checks: readonly StarCheck[];
}

/**
 * ★ pass the level (place + stunt requirements)
 * ★ finish first
 * ★ every stunt PERFECT, no retries, inside par time
 */
export function rateRun(def: LevelDef, r: RunResult): Rating {
  const first = r.place === 1;
  const flawless = r.grades.every((g) => g === 'PERFECT') && r.retriesUsed === 0 && r.time <= def.parTime;
  const checks: StarCheck[] = [
    { label: `过关（名次 ≤ ${def.requiredPlace}，特技 ≥ ${def.requiredLandingGrade}）`, met: r.passed },
    { label: '获得第 1 名', met: r.passed && first },
    { label: `特技全 PERFECT · 无重试 · 用时 ≤ ${def.parTime}s`, met: r.passed && flawless },
  ];
  const stars = r.passed ? 1 + (first ? 1 : 0) + (flawless ? 1 : 0) : 0;
  return { stars, checks };
}

export interface RecordOutcome {
  readonly newBestTime: boolean;
  readonly unlockedNext: boolean;
}

/** Merge a run into saved progress (mutates `progress`). */
export function recordRun(progress: Progress, def: LevelDef, r: RunResult, stars: number, lastLevelId: number): RecordOutcome {
  const key = String(def.id);
  const rec = progress.levels[key] ?? { stars: 0, bestTime: null, bestPlace: null };
  let newBestTime = false;
  if (r.passed) {
    if (rec.bestTime === null || r.time < rec.bestTime) {
      rec.bestTime = r.time;
      newBestTime = true;
    }
    rec.bestPlace = rec.bestPlace === null ? r.place : Math.min(rec.bestPlace, r.place);
    rec.stars = Math.max(rec.stars, stars);
  }
  progress.levels[key] = rec;
  let unlockedNext = false;
  if (r.passed && def.id < lastLevelId && progress.unlocked < def.id + 1) {
    progress.unlocked = def.id + 1;
    unlockedNext = true;
  }
  return { newBestTime, unlockedNext };
}
