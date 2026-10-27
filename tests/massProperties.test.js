import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MassProperties } from '../src/physics/MassProperties.js';
import { BOEING_737_800 as B738, CESSNA_172, F16_FALCON } from '../src/config/aircraftConfigs.js';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { EngineModel } from '../src/physics/EngineModel.js';
import { solveTrim } from '../src/physics/TrimSolver.js';
import { takeoffPerformance } from '../src/physics/TakeoffPerformance.js';
import { stallSpeedEstimate } from '../src/physics/stallSpeedEstimate.js';
import { rebaseCgVelocity, translateModelOrigin } from '../src/physics/massKinematics.js';
import { LandingGear } from '../src/physics/LandingGear.js';
import { constrainBodyContact } from '../src/physics/bodyContactConstraint.js';

const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

describe('mass ledger and state transitions', () => {
  it('rejects malformed tank geometry and priorities instead of silently losing fuel', () => {
    for (const patch of [{ priority: 2 }, { position: { x: NaN, y: 0, z: 0 } }, { capacityKg: 0 }]) {
      assert.throws(() => new MassProperties({ ...B738, massDistribution: { ...B738.massDistribution,
        tanks: B738.massDistribution.tanks.map((t, i) => i === 0 ? { ...t, ...patch } : t) } }));
    }
  });
  it('never burns more fuel than supplied and removes combustion thrust at exhaustion', () => {
    const a = new Aerodynamics(), e = new EngineModel(); e.bindMassProperties(a.massProperties);
    e.fuelKg = 0.0001; const mass = a.massProperties.massKg;
    e.setThrottle(1); e.settleSpool();
    const tick = e.update(1 / 120, 0, 80, 1);
    near(tick.fuelKg, 0);
    near(a.massProperties.massKg, mass - 0.0001);
    near(e.fuelFlow.reduce((x, y) => x + y, 0) / 3600 / 120, 0.0001);
    const dry = e.update(1 / 120, 0, 80, 1);
    near(dry.totalThrust, 0); near(dry.engine1.fuelFlow, 0);
    e.refuel(a); near(a.mass, 66000);
  });
  it('reproduces reference mass, zero CG, and loaded body inertia for every aircraft', () => {
    for (const c of [B738, CESSNA_172, F16_FALCON]) {
      const m = new MassProperties(c);
      near(m.massKg, c.massProperties.currentMassKg);
      near(m.cg.x, 0); near(m.cg.y, 0); near(m.cg.z, 0);
      near(m.inertia.x, c.massProperties.Iyy);
      near(m.inertia.y, c.massProperties.Izz);
      near(m.inertia.z, c.massProperties.Ixx);
    }
  });
  it('drains center first, carries a boundary remainder to both wings, reduces roll inertia', () => {
    const m = new MassProperties(B738), initialRoll = m.inertia.z;
    near(m.consume(7300), 7300);
    near(m.tanks[0].massKg, 0);
    near(m.tanks[1].massKg, 3450); near(m.tanks[2].massKg, 3450);
    near(m.massKg, 58700); near(m.cg.x, 0);
    assert.ok(m.cg.z > 0);
    assert.ok(m.inertia.z < initialRoll);
    near(m.consume(20000), 6900); near(m.fuelKg, 0);
    near(m.consume(20), 0);
    m.reset(); near(m.massKg, 66000); near(m.cg.z, 0);
  });
  it('moves payload at constant gross mass and rejects an invalid LMC atomically', () => {
    const m = new MassProperties(B738), before = m.massKg;
    m.setLoading({ payloadKg: { forward: 6193.5, aft: 4193.5 } });
    near(m.massKg, before); near(m.cg.z, -12000 / before);
    const saved = JSON.stringify(m);
    for (const invalid of [{ fuelKg: NaN }, { fuelKg: -1 }, { payloadKg: { aft: 20000 } }, { payloadKg: { typo: 1 } }]) {
      assert.throws(() => m.setLoading(invalid));
      assert.equal(JSON.stringify(m), saved);
    }
  });
  it('models Lukla 43t without full tanks or negative payload across reset and burn', () => {
    const aero = new Aerodynamics({ ...B738,
      massDistribution: { ...B738.massDistribution, initialFuelKg: 1587, initialPayloadKg: 0 } });
    const engine = new EngineModel(B738);
    engine.refuel(aero);
    near(aero.mass, 43000); near(engine.fuelKg, 1587);
    for (let i = 0; i < 1200; i++) engine.update(1 / 120, 0, 0, 1);
    aero.syncMassProperties();
    near(aero.mass, 41413 + engine.fuelKg);
    engine.refuel(aero); near(aero.mass, 43000); near(engine.fuelKg, 1587);
  });
  it('moves already-accounted gear/flap mass continuously and returns without drift', () => {
    const m = new MassProperties(B738), initial = { ...m.inertia };
    for (let i = 0; i <= 100; i++) {
      m.setConfiguration(1 - i / 100, i / 100);
      near(m.massKg, 66000); assert.ok(Number.isFinite(m.cg.y));
    }
    assert.notEqual(m.inertia.x, initial.x);
    m.setConfiguration(1, 0); near(m.cg.y, 0); near(m.inertia.x, initial.x);
  });
});

describe('CG force, contact and geometry consistency', () => {
  it('does not invent tail lift or singular drag at zero airspeed with thrust', () => {
    const a = new Aerodynamics(); a.pitchTrim = 10;
    const r = a.computeAero(0, new THREE.Object3D(), new THREE.Vector3(), new THREE.Vector3(), 0, 1000, 200000, 0);
    near(r.lift, 0); near(r.drag, 0); near(r.tailForce, 0);
    near(r.momentBody.x, 200000 * 0.32);
  });
  it('rotates the origin about CG without moving the CG', () => {
    const pos = new THREE.Vector3(), velocity = new THREE.Vector3();
    const oldQ = new THREE.Quaternion(), newQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5);
    const cg = new THREE.Vector3(0, 0, 2);
    translateModelOrigin(pos, velocity, oldQ, newQ, cg, 1);
    near(pos.clone().add(cg.clone().applyQuaternion(newQ)).distanceTo(cg), 0);
  });
  it('preserves structural point velocity when re-labelling the instantaneous CG', () => {
    const omega = new THREE.Vector3(0.2, -0.1, 0.3), v = new THREE.Vector3(10, 5, -80);
    const q = new THREE.Quaternion(), old = new THREE.Vector3(), next = new THREE.Vector3(0, 0.1, -0.4);
    const original = v.clone();
    rebaseCgVelocity(v, omega, q, old, next);
    near(v.clone().add(omega.clone().cross(next.clone().negate())).distanceTo(original), 0);
  });
  it('shifts pure force moments by -CG cross force, including thrust', () => {
    const aero = new Aerodynamics(), mesh = new THREE.Object3D();
    const velocity = new THREE.Vector3(0, 0, -100), rates = new THREE.Vector3();
    const base = aero.computeAero(0, mesh, velocity, rates, 0, 1000, 20000, 0);
    Object.assign(aero.cg, { x: 0.3, y: -0.2, z: -0.4 });
    const shifted = aero.computeAero(0, mesh, velocity, rates, 0, 1000, 20000, 0);
    const change = new THREE.Vector3().copy(aero.cg).cross(base.forceWorld.clone().add(new THREE.Vector3(0, 0, -20000))).negate();
    near(shifted.momentBody.clone().sub(base.momentBody).distanceTo(change), 0, 1e-6);
    assert.ok(shifted.momentBody.x < base.momentBody.x);
  });
  it('shifts wheel/support moments without moving geometry at zero angular rate', () => {
    const mesh = new THREE.Object3D(); mesh.position.y = 3.5; mesh.updateMatrixWorld();
    const v = new THREE.Vector3(0, -0.2, 0), w = new THREE.Vector3();
    const a = new LandingGear(), b = new LandingGear();
    const cg = new THREE.Vector3(0, 0, -0.3);
    const r0 = a.update(1 / 120, mesh, v, w, () => 0);
    const r1 = b.update(1 / 120, mesh, v, w, () => 0, null, null, cg);
    near(r1.forces.distanceTo(r0.forces), 0);
    const expected = r0.moments.clone().sub(cg.clone().cross(r0.forces));
    near(r1.moments.distanceTo(expected), 0, 1e-6);
  });
  it('contact impulse uses CG arm, leaves a point through CG without spin', () => {
    const p = new THREE.Vector3(0, -0.1, 0), q = new THREE.Quaternion();
    const v = new THREE.Vector3(0, -2, 0), w = new THREE.Vector3();
    const cg = new THREE.Vector3(0, 0, 2);
    constrainBodyContact(p, q, v, w, 100, { x: 0.01, y: 0.01, z: 0.01 }, () => 0, null,
      [{ id: 'test', position: [0, 0, 2] }], cg);
    near(w.length(), 0); near(v.y, 0);
  });
});

describe('CG trim and performance', () => {
  it('forward CG adds restoring pitch stiffness at the same fixed controls', () => {
    const a = new Aerodynamics(), mesh = new THREE.Object3D(), v = new THREE.Vector3(0, 0, -100);
    const moment = (cgZ, alpha) => {
      a.cg.z = cgZ; mesh.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), alpha);
      return a.computeAero(0, mesh, v, new THREE.Vector3(), 0, 10000, 30000, 0).momentBody.x;
    };
    const forwardSlope = (moment(-0.4, 0.06) - moment(-0.4, 0.05)) / 0.01;
    const aftSlope = (moment(0.4, 0.06) - moment(0.4, 0.05)) / 0.01;
    assert.ok(forwardSlope < aftSlope && forwardSlope < 0);
  });
  it('lowers the 1g stall estimate with mass and raises it with forward CG', () => {
    const a = new Aerodynamics();
    const original = stallSpeedEstimate(a);
    a.mass *= 0.81;
    near(stallSpeedEstimate(a), original * 0.9);
    a.cg.z = -0.4; const forward = stallSpeedEstimate(a);
    a.cg.z = 0.4; const aft = stallSpeedEstimate(a);
    assert.ok(forward > aft);
  });
  it('forward CG requires more downforce, more trim and drag at the same mass and speed', () => {
    const a = new Aerodynamics(), e = new EngineModel();
    const state = { iasKnots: 180, altitudeMeters: 1000, flapsIndex: 2 };
    a.cg.z = -0.35; const f = solveTrim(a, e, state);
    a.cg.z = 0.35; const r = solveTrim(a, e, state);
    assert.ok(f.feasible && r.feasible);
    assert.ok(f.handsOffTrimDegRaw > r.handsOffTrimDegRaw);
    assert.ok(f.tailForce < r.tailForce); assert.ok(f.cd > r.cd);
  });
  it('returns live force and pitch residuals near zero across CG offsets', () => {
    for (const z of [-0.4, 0, 0.4]) {
      const a = new Aerodynamics(), e = new EngineModel(); a.cg.z = z;
      const state = { iasKnots: 190, altitudeMeters: 1000, flapsIndex: 2 };
      const t = solveTrim(a, e, state); assert.ok(t.feasible && t.handsOffFeasible);
      a.setFlapPosition(2); a.currentFlapAngle = a.flapAngles[2]; a.pitchTrim = t.handsOffTrimDeg;
      const mesh = new THREE.Object3D(); mesh.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), t.alphaDeg * Math.PI / 180);
      const result = a.computeAero(0, mesh, new THREE.Vector3(0, 0, -t.tas), new THREE.Vector3(), 1000, 10000, t.thrustN, 0);
      const force = result.forceWorld.add(new THREE.Vector3(0, 0, -t.thrustN).applyQuaternion(mesh.quaternion));
      near(force.y, a.mass * 9.80665, 0.1); near(force.z, 0, 0.1); near(result.momentBody.x, 0, 0.1);
    }
  });
  it('publishes one loading revision and leaves unsupported V1 empty', () => {
    const a = new Aerodynamics(), e = new EngineModel();
    const p = takeoffPerformance(a, e, { flapsIndex: 2 });
    assert.equal(p.status, 'estimate'); assert.equal(p.v1, null);
    assert.ok(p.v2 > p.vr); assert.equal(p.revision, a.massProperties.revision);
    a.massProperties.setLoading({ payloadKg: { forward: 0, aft: 0 } }); a.syncMassProperties();
    const lighter = takeoffPerformance(a, e, { flapsIndex: 2 });
    assert.equal(lighter.status, 'estimate'); assert.ok(lighter.vr < p.vr);
    e.failed[0] = true;
    assert.equal(takeoffPerformance(a, e).status, 'unavailable', 'no engine-out performance claim');
  });
});
