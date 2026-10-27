// Browser acceptance: run via /scripts/verify-mass-cg.html on the local Vite server.
const output = document.querySelector('#results');
const assert = (value, message) => { if (!value) throw new Error(message); };
const near = (a, b, eps = 1e-6) => assert(Math.abs(a - b) < eps, `${a} != ${b}`);
document.querySelector('#run').onclick = async () => {
  const results = [];
  const win = document.querySelector('#sim').contentWindow;
  const s = win.simulator;
  try {
    assert(s?.loadingPanel, 'Wait for simulator startup');
    win.requestAnimationFrame = () => 0;
    s.demoDirector.stop(); s.gameFlow.enterFlight();
    s.setPreset('runway'); s.controls.clearVirtualInputs();
    s.controls.setVirtualInput('brakes', 1);
    s.stepSimulation(3);
    assert(s.telemetry.onGround && !s.isCrashed, 'ground settle');
    s.applyLoading({ fuelKg: 7000, payloadKg: { forward: 6000, aft: 3000 } });
    near(s.aero.mass, 57413);
    near(s.telemetry.massKg, s.takeoff.massKg);
    assert(s.pfdCanvas.takeoff === s.takeoff && s.cduCanvas.takeoff === s.takeoff, 'atomic cockpit snapshot');
    assert(s.takeoff.v1 === null && s.takeoff.status === 'estimate', 'honest speed labels');
    const saved = JSON.stringify(s.aero.massProperties);
    try { s.applyLoading({ fuelKg: -1 }); } catch { /* expected */ }
    assert(JSON.stringify(s.aero.massProperties) === saved, 'invalid LMC is atomic');
    results.push({ check: 'LMC + PFD/CDU synchronization', mass: s.aero.mass, cg: { ...s.aero.cg }, vr: s.takeoff.vr });
    const massBefore = s.aero.mass;
    s.stepSimulation(10);
    assert(s.aero.mass < massBefore && s.telemetry.onGround && !s.isCrashed, 'ground fuel burn/hold');
    near(s.aero.mass, s.aero.massProperties.zeroFuelMassKg + s.engines.fuelKg);
    results.push({ check: '10-second loaded ground hold', speed: s.linearVelocity.length(), mass: s.aero.mass });
    s.setPreset('cruise'); s.controls.clearVirtualInputs();
    const start = { altitude: s.position.y, speed: s.linearVelocity.length(), mass: s.aero.mass };
    const cruise = [];
    for (let second = 1; second <= 30; second++) {
      s.stepSimulation(1);
      assert(!s.isCrashed && Number.isFinite(s.position.length() + s.angularVelocity.length()), 'finite cruise');
      assert(Math.abs(s.telemetry.rollDeg) < 5 && Math.abs(s.telemetry.gForce - 1) < 0.2, 'hands-off cruise stability');
      if (second % 10 === 0) cruise.push({ second, pitch: s.telemetry.pitchDeg, g: s.telemetry.gForce, altitude: s.position.y });
    }
    assert(Math.abs(s.position.y - start.altitude) < 30, 'cruise altitude drift <30m in 30s');
    assert(s.aero.mass < start.mass, 'cruise burns ledger fuel');
    const flightSaved = JSON.stringify(s.aero.massProperties);
    try { s.applyLoading({ fuelKg: 5000 }); } catch { /* expected */ }
    assert(JSON.stringify(s.aero.massProperties) === flightSaved, 'airborne LMC rejected');
    results.push({ check: '30-second hands-off cruise + airborne LMC rejection', start, samples: cruise });
    s.setPreset('runway'); s.controls.clearVirtualInputs(); s.controls.setVirtualInput('brakes', 1);
    s.stepSimulation(3);
    near(s.aero.massProperties.zeroFuelMassKg, 51800);
    assert(s.telemetry.onGround && !s.isCrashed, 'runway reset after cruise');
    s.applyLoading({ fuelKg: 7000, payloadKg: { forward: 6000, aft: 3000 } });
    s.loadingPanel.button.click(); s.loadingPanel.update();
    results.push({ check: 'reset restores original loading', zfw: 51800 });
    output.textContent = 'PASS\n' + JSON.stringify(results, null, 2);
  } catch (error) {
    output.textContent = 'FAIL: ' + error.stack + '\n' + JSON.stringify(results, null, 2);
  }
};
