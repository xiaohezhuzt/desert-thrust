/**
 * Headless handling test: runs the real CarController on Rapier without rendering.
 *   npx tsx scripts/sim.ts
 */
import * as THREE from 'three';
import { Physics, loadRapier } from '../src/core/Physics';
import { createEmptyActions } from '../src/input/InputManager';
import { CarController } from '../src/vehicle/CarController';
import type { CarRig, WheelRig } from '../src/vehicle/CarModelFactory';
import { CAR_TUNING as T } from '../src/config/tuning';
import { addTestFeatures } from '../src/world/TestGround';
import { LandingJudge } from '../src/vehicle/LandingJudge';

const DT = 1 / 120;

function fakeRig(): CarRig {
  const root = new THREE.Group();
  const wheels: WheelRig[] = [];
  for (const [front, z, track] of [
    [true, -T.wheelBase / 2, T.frontTrack],
    [false, T.wheelBase / 2, T.rearTrack],
  ] as const) {
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * track, T.wheelRadius, z);
      wheels.push({ pivot, spin: new THREE.Group(), front, spinSign: side });
    }
  }
  return { root, body: new THREE.Group(), wheels };
}

async function main(): Promise<void> {
  const R = await loadRapier();
  const physics = new Physics(R);
  const g = physics.world.createCollider(R.ColliderDesc.cuboid(2000, 1, 2000).setTranslation(0, -1, 0).setFriction(0.9));
  physics.setSurface(g, 'asphalt');
  addTestFeatures(new THREE.Group(), physics);

  const car = new CarController(physics, fakeRig());
  const judge = new LandingJudge();
  const grades: string[] = [];
  car.onReset = () => judge.reset();
  const input = createEmptyActions();
  let time = 0;
  const step = (): void => {
    car.step(DT, input);
    physics.step(DT);
    car.capture();
    car.updateVisual(1);
    const g = judge.update(DT, car);
    if (g) grades.push(`${g.grade}(${g.angle.toFixed(0)}°,${Math.round(g.retention * 100)}%,${g.airTime.toFixed(1)}s)`);
    time += DT;
  };
  const run = (seconds: number, until?: () => boolean): void => {
    const end = time + seconds;
    while (time < end && !(until?.() ?? false)) step();
  };
  const p = (): string => car.renderPosition.toArray().map((v) => v.toFixed(2)).join(', ');
  const kmh = (): number => car.forwardSpeed * 3.6;

  // 1. Settle.
  car.setSpawn(new THREE.Vector3(0, 0, 1500), 0);
  run(2);
  console.log(`settle: y=${car.renderPosition.y.toFixed(3)} grounded=${car.groundedWheels}`);

  // 2. 0-100 and top speed on flat ground.
  input.throttle = 1;
  const t0 = time;
  run(10, () => kmh() >= 100);
  console.log(`0-100 km/h: ${(time - t0).toFixed(2)} s`);
  run(25);
  console.log(`speed after 25 s more: ${kmh().toFixed(0)} km/h`);

  // 3. Braking 100-0.
  car.setSpawn(new THREE.Vector3(0, 0, 1500), 0);
  run(1);
  run(10, () => kmh() >= 100);
  input.throttle = 0;
  input.brake = 1;
  const zb = car.renderPosition.z;
  run(10, () => kmh() <= 0.5);
  console.log(`100-0 braking distance: ${Math.abs(car.renderPosition.z - zb).toFixed(1)} m`);
  input.brake = 0;

  // 4. Cornering: steady full-lock at 80 km/h, check it doesn't roll over.
  car.setSpawn(new THREE.Vector3(0, 0, 1500), 0);
  input.throttle = 1;
  run(1);
  run(10, () => kmh() >= 80);
  input.throttle = 0.35;
  input.steer = 1;
  let minUp = 1;
  const upv = new THREE.Vector3();
  run(6, () => {
    upv.set(0, 1, 0).applyQuaternion(car.renderQuaternion);
    minUp = Math.min(minUp, upv.y);
    return false;
  });
  console.log(`full-lock turn: speed ${kmh().toFixed(0)} km/h, min up.y ${minUp.toFixed(3)} (1 = flat)`);
  input.steer = 0;

  // 5. Handbrake drift.
  input.throttle = 0.6;
  input.steer = 0.7;
  input.handbrake = true;
  const yawRate = (): number => car.body.angvel().y;
  run(1.2);
  console.log(`handbrake: yaw rate ${yawRate().toFixed(2)} rad/s, speed ${kmh().toFixed(0)} km/h`);
  input.handbrake = false;
  input.steer = 0;

  // 6. Bumps at ~100 km/h (z 175 -> 120), then kicker at z=-150.
  car.setSpawn(new THREE.Vector3(0, 0, 450), 0);
  input.throttle = 1;
  run(1);
  run(15, () => car.renderPosition.z < 185);
  input.throttle = 0.6;
  let maxPitch = 0;
  run(6, () => {
    upv.set(0, 1, 0).applyQuaternion(car.renderQuaternion);
    maxPitch = Math.max(maxPitch, Math.acos(Math.min(1, upv.y)));
    return car.renderPosition.z < 100;
  });
  console.log(`bumps @ ${kmh().toFixed(0)} km/h: max tilt ${THREE.MathUtils.radToDeg(maxPitch).toFixed(1)}°`);

  input.throttle = 1;
  run(15, () => car.renderPosition.z < -140);
  const launch = kmh();
  let airTime = 0;
  let maxY = 0;
  let landed = false;
  run(8, () => {
    if (car.airborne) airTime += DT;
    maxY = Math.max(maxY, car.renderPosition.y);
    if (airTime > 0.2 && car.groundedWheels === 4) landed = true;
    return landed && car.renderPosition.z < -200;
  });
  upv.set(0, 1, 0).applyQuaternion(car.renderQuaternion);
  console.log(
    `kicker @ ${launch.toFixed(0)} km/h: air ${airTime.toFixed(2)} s, peak y ${maxY.toFixed(2)} m, landed upright ${upv.y > 0.9} (${p()})`,
  );

  console.log(`kicker grades: ${grades.join(' ')}`);
  grades.length = 0;

  const reset = (z: number): void => {
    input.throttle = 0; input.brake = 0; input.steer = 0; input.boost = false; input.jump = false;
    input.roll = 0; input.pitch = 0; input.handbrake = false;
    car.setSpawn(new THREE.Vector3(0, 0, z), 0);
    run(1.5);
  };

  // 7. Standing jump height.
  reset(1500);
  input.jump = true;
  step();
  input.jump = false;
  let apex = 0;
  run(3, () => {
    apex = Math.max(apex, car.renderPosition.y);
    return false;
  });
  console.log(`jump apex: ${apex.toFixed(2)} m, grades: ${grades.join(' ') || '-'}`);
  grades.length = 0;

  // 8. Boost 0-100.
  reset(1500);
  input.throttle = 1;
  input.boost = true;
  const tb = time;
  run(5, () => kmh() >= 100);
  console.log(`0-100 with boost: ${(time - tb).toFixed(2)} s, energy left ${car.energy.toFixed(0)}`);
  run(6);
  console.log(`boost top speed: ${kmh().toFixed(0)} km/h (energy ${car.energy.toFixed(0)})`);

  // 9. Hover flight: jump, hold, boost forward.
  reset(1500);
  input.jump = true;
  input.boost = true;
  input.throttle = 1;
  let peak = 0;
  run(4, () => {
    peak = Math.max(peak, car.renderPosition.y);
    return car.energy <= 0;
  });
  console.log(`hover flight: ${(time % 1000).toFixed(1)} peak ${peak.toFixed(1)} m, energy ${car.energy.toFixed(0)}, speed ${kmh().toFixed(0)} km/h`);
  input.jump = false;
  input.boost = false;
  run(5, () => car.groundedWheels === 4);

  // 10. 360° air roll off the big kicker (z=-420).
  reset(-250);
  input.throttle = 1;
  run(12, () => car.airborne && car.renderPosition.z < -428);
  const rollStart = time;
  let rolled = 0;
  let lastRight = new THREE.Vector3(1, 0, 0).applyQuaternion(car.renderQuaternion);
  input.roll = 1;
  run(4, () => {
    const r = new THREE.Vector3(1, 0, 0).applyQuaternion(car.renderQuaternion);
    rolled += r.angleTo(lastRight);
    lastRight = r;
    // Roll carries momentum: release early, then counter-thrust to stop level.
    const w = car.body.angvel();
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(car.renderQuaternion);
    const rate = Math.abs(w.x * f.x + w.y * f.y + w.z * f.z);
    input.roll = rolled + rate / 1.5 < Math.PI * 2 - 0.15 ? 1 : rolled < Math.PI * 2 + 0.3 && rate > 0.8 ? -1 : 0;
    return !car.airborne && time - rollStart > 0.3;
  });
  run(1);
  console.log(`air roll: ${THREE.MathUtils.radToDeg(rolled).toFixed(0)}° in ${(time - rollStart).toFixed(2)} s, grades: ${grades.join(' ') || '-'}`);
}

void main();
