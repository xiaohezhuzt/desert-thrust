/**
 * Headless level test: an autopilot drives level 1 with the real physics,
 * stunt pieces and campaign rules.   npx tsx scripts/sim-level.ts
 */
import * as THREE from 'three';

// Minimal canvas stub so procedural textures can be created without a browser.
// Every method returns the stub itself, so chained calls (gradients etc.) work too.
const ctxStub: object = new Proxy({}, { get: () => () => ctxStub, set: () => true });
(globalThis as unknown as { document: unknown }).document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub }),
};

const { Physics, loadRapier } = await import('../src/core/Physics');
const { createEmptyActions } = await import('../src/input/InputManager');
const { CarController } = await import('../src/vehicle/CarController');
const { LandingJudge } = await import('../src/vehicle/LandingJudge');
const { CAR_TUNING: T } = await import('../src/config/tuning');
const { LEVELS } = await import('../src/config/levels');
const { Level } = await import('../src/world/Level');
const { Campaign } = await import('../src/modes/Campaign');
const { RacingLine } = await import('../src/ai/RacingLine');
const { AIDriver } = await import('../src/ai/AIDriver');
const { CARS } = await import('../src/config/cars');
const { createOpponentCar, opponentGeometry } = await import('../src/vehicle/OpponentModel');
const { createRng } = await import('../src/core/Random');
type Rig = import('../src/vehicle/CarModelFactory').CarRig;
type WheelRig = import('../src/vehicle/CarModelFactory').WheelRig;
type Renderer = import('../src/core/Renderer').Renderer;

const DT = 1 / 120;
const wheels: WheelRig[] = [];
for (const [front, z, track] of [[true, -T.wheelBase / 2, T.frontTrack], [false, T.wheelBase / 2, T.rearTrack]] as const)
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * track, T.wheelRadius, z);
    wheels.push({ pivot, spin: new THREE.Group(), front, spinSign: side });
  }
const rig: Rig = { root: new THREE.Group(), body: new THREE.Group(), wheels };

const scene = new THREE.Scene();
const { QUALITY } = await import('../src/config/quality');
const fakeRenderer = {
  maxAnisotropy: 1,
  currentQuality: QUALITY.low,
  scene,
  sun: new THREE.DirectionalLight(),
  hemi: new THREE.HemisphereLight(),
  setFog: () => undefined,
} as unknown as Renderer;

const R = await loadRapier();
const physics = new Physics(R);
const levelId = Number(process.argv[2] ?? 1);
const def = LEVELS.find((l) => l.id === levelId)!;
const t0 = performance.now();
const level = new Level(def, physics, fakeRenderer);
console.log(`level built in ${(performance.now() - t0).toFixed(0)} ms, line ${level.line.length.toFixed(0)} m`);

const car = new CarController(physics, rig);
const judge = new LandingJudge();
car.airAssist = true;
car.isSafeSpot = (p) => level.hazardAt(p) === null;
car.onReset = () => judge.reset();
const log: string[] = [];
const line = new RacingLine(level.line, def);
const rng = createRng(Number(process.argv[3] ?? 7));
const drivers = [0, 1, 2, 3, 4, 5].sort(() => rng() - 0.5).slice(0, def.aiCount).map((k) => {
  const cd = CARS[k]!;
  const rig = createOpponentCar(cd, cd.palette[0]!, false, 90);
  const c = new CarController(physics, rig, cd.perf, opponentGeometry(cd.shape));
  c.isSafeSpot = (p) => level.hazardAt(p) === null;
  const drv = new AIDriver(c, line, cd, def.aiSkill, def.aiRubberBand, rng);
  c.onReset = () => log.push(`  AI ${cd.name} respawned at (${c.simPosition.x.toFixed(0)},${c.simPosition.z.toFixed(0)}) t=${campaign.time.toFixed(1)}`);
  return drv;
});
const campaign = new Campaign(
  def,
  line,
  car,
  physics.obstacles,
  {
    banner: (t, s) => log.push(`[${campaign.time.toFixed(1)}s] ${t} — ${s}`),
    finished: (r) => log.push(`FINISHED ${r.time.toFixed(2)}s place ${r.place}/${r.racers} passed=${r.passed} grades=${r.grades.join(',')} retries=${r.retriesUsed}`),
  },
  drivers,
);
const aiLog = new Map<string, string>();
// `npx tsx scripts/sim-level.ts <levelId> <seed> [ai]`: with `ai`, a skill-1.0 AI drives the player for a reference run.
const playerAI = process.argv[4] === 'ai' ? new AIDriver(car, line, CARS[4]!, 1, 0, rng) : null;
campaign.restart();
car.onReset = () => {
  judge.reset();
  // Resume from where the campaign thinks we are on the line.
  idx = Math.max(0, Math.floor(campaign.progress * (pts.length - 1)) - 40);
};

// Pure-pursuit autopilot along the racing line; rolls itself upright in the air.
const input = createEmptyActions();
const pts = level.line.points;
let idx = 0;
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();
let maxInverted = 1;
for (let i = 0; i < 120 * 150 && campaign.phase !== 'finished'; i++) {
  const p = car.renderPosition;
  // Nearest sample ahead of the last one, then aim 14 m further along.
  let best = Infinity;
  const from = idx;
  for (let k = from; k < pts.length; k++) {
    const d = pts[k]!.distanceToSquared(p);
    if (d < best) {
      best = d;
      idx = k;
    }
  }
  const target = pts[Math.min(idx + 14, pts.length - 1)]!;
  fwd.set(0, 0, -1).applyQuaternion(car.renderQuaternion);
  right.set(1, 0, 0).applyQuaternion(car.renderQuaternion);
  up.set(0, 1, 0).applyQuaternion(car.renderQuaternion);
  // The racing line climbs the loop; on the ground, line up with the loop's entry instead.
  const loop = def.stunts.find((st) => st.type === 'invertedHalfLoop');
  const entry = loop ? new THREE.Vector3(...loop.position) : p;
  const dir = loop ? new THREE.Vector3(-Math.sin(loop.heading), 0, -Math.cos(loop.heading)) : fwd;
  const aim = loop && target.y > 0.5 ? entry.clone().addScaledVector(dir, 25) : target;
  if (loop && target.y > 0.5 && p.distanceTo(entry) < 60) aim.copy(entry).addScaledVector(dir, Math.max(5, dir.dot(p.clone().sub(entry)) + 20));
  const to = aim.clone().sub(p).normalize();
  // Brake for the sweep after the jump, like a player would.
  const a = pts[Math.min(idx + 10, pts.length - 1)]!.clone().sub(pts[idx]!).normalize();
  const b = pts[Math.min(idx + 60, pts.length - 1)]!.clone().sub(pts[Math.min(idx + 45, pts.length - 1)]!).normalize();
  const bend = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
  const cap = campaign.currentGate?.name === def.gates[0]!.name ? 999 : bend > 0.25 && !car.onAdhesive ? 21 : 34;
  input.throttle = car.forwardSpeed < cap ? 1 : 0;
  input.brake = car.forwardSpeed > cap + 4 ? 1 : 0;
  input.steer = car.onAdhesive || car.airborne ? 0 : THREE.MathUtils.clamp(to.dot(right) * 3, -1, 1);
  input.roll = 0;
  input.pitch = 0;
  // In the air: roll upright when inverted (like a player would), otherwise let the assist level the car.
  if (car.airborne && up.y < 0) input.roll = right.y > 0 ? 1 : -1;
  maxInverted = Math.min(maxInverted, car.onAdhesive ? up.y : 1);

  if (playerAI && !campaign.controlsLocked) {
    playerAI.update(DT, 0, campaign.racerViews);
    Object.assign(input, playerAI.actions);
    // A player does the 360° roll the gate asks for; the AI never would.
    if (campaign.currentGate?.requires === 'roll360' && car.airborne) {
      // Spin up, let momentum finish the turn, counter-thrust to stop level.
      const rate = Math.abs(car.body.angvel().x * 0 + new THREE.Vector3(...Object.values(car.body.angvel()) as [number, number, number]).dot(new THREE.Vector3(0, 0, -1).applyQuaternion(car.simQuaternion)));
      const coast = rate / 1.5;
      const done = Math.abs(car.airRoll);
      input.roll = done + coast < Math.PI * 2 - 0.15 ? 1 : done < Math.PI * 2 + 0.3 && rate > 0.8 ? -1 : 0;
    }
    // Wall ride: steer up onto the quarter-pipe, then let it bring us back down.
    const wall = def.stunts.find((st) => st.type === 'wallRide');
    if (wall && campaign.currentGate?.requires === 'wall') {
      const z0 = wall.position[2];
      const zc = car.simPosition.z;
      if (zc < z0 - 5 && zc > z0 - wall.params.length * 0.6) input.steer = car.onAdhesive ? 0.25 : 0.7;
    }
  }
  car.step(DT, campaign.controlsLocked ? createEmptyActions() : input);
  for (const d of drivers) {
    if (!campaign.controlsLocked) d.update(DT, campaign.playerDistance, campaign.racerViews);
    d.car.step(DT, campaign.controlsLocked ? createEmptyActions() : d.actions);
  }
  physics.step(DT);
  car.capture();
  car.updateVisual(1);
  for (const d of drivers) {
    d.car.capture();
    d.car.updateVisual(1);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(d.car.simQuaternion);
    if (d.car.onAdhesive && u.y < -0.5 && !aiLog.has(d.def.name + 'inv')) {
      aiLog.set(d.def.name + 'inv', '1');
      log.push(`  AI ${d.def.name} inverted on loop at ${campaign.time.toFixed(1)}s`);
    }
    if (d.finished && !aiLog.has(d.def.name)) {
      aiLog.set(d.def.name, campaign.time.toFixed(1));
      log.push(`  AI ${d.def.name} finished at ${campaign.time.toFixed(1)}s`);
    }
  }
  const landing = judge.update(DT, car);
  if (landing) log.push(`  landing ${landing.grade} ${landing.angle.toFixed(0)}° ${(landing.retention * 100).toFixed(0)}% air ${landing.airTime.toFixed(2)}s @ (${p.x.toFixed(0)},${p.z.toFixed(0)})`);
  campaign.step(DT, landing);
  const hz = level.hazardAt(car.simPosition);
  if (hz === 'fall' || hz === 'deepWater') {
    log.push(`  player lost (${hz}) at (${car.simPosition.x.toFixed(0)},${car.simPosition.y.toFixed(0)},${car.simPosition.z.toFixed(0)})`);
    campaign.carLost(hz === 'fall' ? '坠落！' : '落水！');
  } else if (hz === 'shallowWater') car.applyWaterDrag(DT, level.waterDepthAt(car.simPosition.x, car.simPosition.z));
  for (const d of drivers) {
    const h = level.hazardAt(d.car.simPosition);
    if (h === 'fall' || h === 'deepWater') d.recoverNow();
  }
  if (i % 600 === 0) {
    const st = campaign.standing;
    log.push(`   place ${st.place}/${st.racers} · AI: ${drivers.map((d) => `${d.def.name} ${(d.tracker.progress * 100).toFixed(0)}% ${(d.car.forwardSpeed * 3.6).toFixed(0)}km/h${d.finished ? ' FIN' : ''}`).join(' | ')}`);
  }
  if (i % 600 === 0) log.push(`t=${(i * DT).toFixed(0)} pos=(${p.x.toFixed(0)},${p.y.toFixed(1)},${p.z.toFixed(0)}) ${(car.forwardSpeed * 3.6).toFixed(0)}km/h progress=${(campaign.progress * 100).toFixed(0)}%`);
}
console.log(log.join('\n'));
console.log(`min up.y while on loop: ${maxInverted.toFixed(2)} (≈-1 = fully inverted), phase=${campaign.phase}`);
level.dispose();
