import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { IncheonDepartureScenario, DEPARTURE_GATE } from '../src/director/scenarios/IncheonDepartureScenario.js';
import { DEPARTURE_TAXI_ROUTE, DEPARTURE_LINEUP_ROUTE } from '../src/config/incheonDeparture.js';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';
import { resolveDemoProfile } from '../src/director/demoProfiles.js';

const S = IncheonDepartureScenario.STAGES;
function fixture() {
  const inputs = {};
  const sim = {
    position: new THREE.Vector3(), linearVelocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(), scene: new THREE.Scene(),
    controls: { setVirtualInput: (k,v) => { inputs[k]=v; }, setParkingBrake() {} },
    gear: { onGround: true, cgGroundHeightM: 1.35 },
    aero: { mass: 1000, invIzz: .001, setFlapPosition() {} },
    aircraft: { group: new THREE.Group() }, telemetry: { headingDeg: DEPARTURE_GATE.heading*180/Math.PI, iasKnots: 0 },
    setPreset() {},
  };
  const director = { stageTimer: 0, totalTimer: 0, currentStage: S.GATE,
    setTimeOfDay() {}, updateBanner() {},
    setStage(stage) { this.currentStage = stage; this.stageTimer = 0; scenario.enterStage(stage); },
    stop() { scenario.stop(); },
  };
  const scenario = new IncheonDepartureScenario(director, sim);
  director.setStage(S.GATE);
  return {sim, director, scenario, inputs};
}

test('departure is an explicit Incheon C172 profile; tour remains the default', () => {
  assert.equal(resolveDemoProfile('C172','incheon','incheon-departure').id,'incheon-departure');
  assert.equal(resolveDemoProfile('C172','incheon','invalid').id,'incheon-tour');
  const d = new DemoFlightDirector({currentAircraftId:'C172', activeAirport:'incheon'});
  d.profile='incheon-departure';
  assert.equal(d.getActiveScenario(),d.incheonDepartureScenario);
  d.profile='incheon-tour';
  assert.equal(d.getActiveScenario(),d.incheonCessnaScenario);
});

test('tug applies bounded forces only while connected on the ground', () => {
  const {sim,director,scenario}=fixture();
  assert.equal(scenario.towingForces(),null);
  director.setStage(S.PUSHBACK);
  const force=scenario.towingForces().force;
  const toward=new THREE.Vector3(DEPARTURE_TAXI_ROUTE[0].x-sim.position.x,0,DEPARTURE_TAXI_ROUTE[0].z-sim.position.z);
  assert.ok(force.dot(toward)>0);
  assert.ok(force.length()<=sim.aero.mass*1.5+.001);
  sim.gear.onGround=false;
  assert.equal(scenario.towingForces(),null);
  sim.gear.onGround=true;
  director.setStage(S.DISCONNECT);
  assert.equal(scenario.towingForces(),null);
  scenario.stop();
  assert.equal(sim.scene.getObjectByName('departure-tug'),undefined);
  assert.equal(scenario.result.status,'cancelled');
});

test('pushback waits for a settled position and disconnect removes the tug before taxi', () => {
  const {sim,director,scenario,inputs}=fixture();
  director.stageTimer=7; scenario.update(.1);
  assert.equal(director.currentStage,S.PUSHBACK);
  scenario.update(2);
  assert.equal(director.currentStage,S.PUSHBACK,'timer alone cannot complete pushback');
  sim.position.x=DEPARTURE_TAXI_ROUTE[0].x;sim.position.z=DEPARTURE_TAXI_ROUTE[0].z;
  scenario.update(.6);
  assert.equal(director.currentStage,S.PUSHBACK);
  scenario.update(.6);
  assert.equal(director.currentStage,S.DISCONNECT);
  director.stageTimer=7;scenario.update(.1);
  assert.equal(director.currentStage,S.TAXI);
  assert.equal(sim.scene.getObjectByName('departure-tug'),undefined);
  director.setStage(S.HOLD);scenario.update(.1);
  assert.equal(inputs.brakes,1);assert.equal(inputs.throttle,0);
});

test('lineup cannot authorize takeoff until aligned, stopped, and clearance has been read', () => {
  const {sim,director,scenario,inputs}=fixture();
  director.setStage(S.LINEUP);
  scenario.index=DEPARTURE_LINEUP_ROUTE.length-1;
  Object.assign(sim.position,DEPARTURE_LINEUP_ROUTE.at(-1));
  sim.telemetry.headingDeg=144.68220519241027;
  sim.linearVelocity.set(2,0,0);scenario.update(.1);
  assert.equal(director.currentStage,S.LINEUP);
  sim.linearVelocity.set(0,0,0);scenario.update(.1);
  assert.equal(director.currentStage,S.CLEARANCE);
  director.stageTimer=5;scenario.update(.1);
  assert.equal(inputs.throttle,0);assert.equal(inputs.brakes,1);
  director.stageTimer=7;scenario.update(.1);
  assert.equal(director.currentStage,S.TAKEOFF);
});

test('restart cleans up tug resources and resets route progress; completion requires flight', () => {
  const {sim,director,scenario}=fixture();
  const old=scenario.tug;
  scenario.index=50;
  director.setStage(S.GATE);
  assert.equal(old.parent,null);
  assert.equal(sim.scene.children.filter(n=>n.name==='departure-tug').length,1);
  assert.equal(scenario.index,0);
  director.setStage(S.TAKEOFF);
  sim.position.y=100;scenario.update(.1);
  assert.equal(scenario.result.airborne,false,'height alone with grounded gear cannot complete');
  sim.gear.onGround=false;scenario.update(.1);
  assert.equal(scenario.result.status,'completed');
});
