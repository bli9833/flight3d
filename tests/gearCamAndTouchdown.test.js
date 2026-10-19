import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

if (typeof document === 'undefined') {
  const noop = () => {};
  const mockCtx = new Proxy({}, {
    get: () => () => ({ addColorStop: noop })
  });
  globalThis.document = {
    createElement: () => ({
      getContext: () => mockCtx,
      width: 64,
      height: 64
    })
  };
}

import { CameraSystem } from '../src/cameras/CameraSystem.js';
import { LandingGear } from '../src/physics/LandingGear.js';
import { TireSmokeSystem } from '../src/effects/TireSmokeSystem.js';
import { Boeing737 } from '../src/aircraft/Boeing737.js';

describe('Landing Gear View & Touchdown Effects', () => {
  describe('CameraSystem (GEAR View & Temporary Auto-Cut)', () => {
    it('should include GEAR and DRONE camera modes in MODES and cycle through 7 views', () => {
      const camera = new THREE.PerspectiveCamera();
      const mockDom = { addEventListener: () => {} };
      const camSystem = new CameraSystem(camera, mockDom);

      assert.strictEqual(CameraSystem.MODES.GEAR, 5, 'GEAR mode index should be 5');
      assert.strictEqual(CameraSystem.MODES.DRONE, 6, 'DRONE mode index should be 6');
      assert.strictEqual(camSystem.mode, CameraSystem.MODES.COCKPIT);

      // Cycle through all modes: 0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 0
      assert.strictEqual(camSystem.cycleMode(), 'CHASE (EXTERIOR)');
      assert.strictEqual(camSystem.cycleMode(), 'WING VIEW');
      assert.strictEqual(camSystem.cycleMode(), 'AIRPORT TOWER');
      assert.strictEqual(camSystem.cycleMode(), 'CINEMATIC FLYBY');
      assert.strictEqual(camSystem.cycleMode(), 'GEAR CAM (BELLY)');
      assert.strictEqual(camSystem.mode, CameraSystem.MODES.GEAR);
      assert.strictEqual(camSystem.cycleMode(), 'DRONE (ORBIT VIEW)');
      assert.strictEqual(camSystem.mode, CameraSystem.MODES.DRONE);
      assert.strictEqual(camSystem.cycleMode(), 'COCKPIT (CAPTAIN)');
    });

    it('should position camera under fuselage facing landing gear in GEAR mode', () => {
      const camera = new THREE.PerspectiveCamera();
      const mockDom = { addEventListener: () => {} };
      const camSystem = new CameraSystem(camera, mockDom);

      const aircraft = new THREE.Object3D();
      aircraft.position.set(0, 14.0, 0);
      aircraft.quaternion.set(0, 0, 0, 1);
      aircraft.updateMatrixWorld(true);

      camSystem.setMode(CameraSystem.MODES.GEAR);
      camSystem.update(0.016, aircraft, { onGround: true, touchdown: false });

      // In GEAR mode, camera should be positioned beneath the fuselage belly (Y < 14.0)
      assert.ok(camera.position.y < 14.0, 'Camera Y position must be below aircraft center');
      assert.ok(camera.position.z > 0, 'Camera Z position should be positioned aft of main gear');
    });

    it('should temporarily switch to gear view and automatically restore previous mode upon timer expiry', () => {
      const camera = new THREE.PerspectiveCamera();
      const mockDom = { addEventListener: () => {} };
      const camSystem = new CameraSystem(camera, mockDom);

      const aircraft = new THREE.Object3D();
      aircraft.position.set(0, 14.0, 0);
      aircraft.updateMatrixWorld(true);

      // Start in COCKPIT mode
      camSystem.setMode(CameraSystem.MODES.COCKPIT);
      assert.strictEqual(camSystem.mode, CameraSystem.MODES.COCKPIT);

      // Trigger temporary gear view cut for 4.0 seconds (e.g. on takeoff or gear transit)
      camSystem.showTemporaryView(CameraSystem.MODES.GEAR, 4.0);
      assert.strictEqual(camSystem.mode, CameraSystem.MODES.GEAR);
      assert.strictEqual(camSystem.temporaryViewTimer, 4.0);

      // Step 2 seconds: should remain in GEAR view
      camSystem.update(2.0, aircraft, { onGround: false });
      assert.strictEqual(camSystem.mode, CameraSystem.MODES.GEAR);
      assert.ok(Math.abs(camSystem.temporaryViewTimer - 2.0) < 0.01);

      // Step another 2.1 seconds: timer expires, should automatically restore COCKPIT view
      camSystem.update(2.1, aircraft, { onGround: false });
      assert.strictEqual(camSystem.mode, CameraSystem.MODES.COCKPIT, 'Camera should revert to COCKPIT view');
      assert.strictEqual(camSystem.temporaryViewTimer, 0);
    });

    it('should cancel temporary view immediately on manual camera cycle or setMode', () => {
      const camera = new THREE.PerspectiveCamera();
      const mockDom = { addEventListener: () => {} };
      const camSystem = new CameraSystem(camera, mockDom);

      camSystem.setMode(CameraSystem.MODES.COCKPIT);
      camSystem.showTemporaryView(CameraSystem.MODES.GEAR, 5.0);
      assert.strictEqual(camSystem.mode, CameraSystem.MODES.GEAR);

      // User manually cycles camera
      camSystem.cycleMode();
      assert.strictEqual(camSystem.temporaryViewTimer, 0, 'Temporary timer must be cleared on manual user action');
    });
  });

  describe('LandingGear (Dynamic Suspension & Touchdown Impact)', () => {
    it('should report touchdownContacts with contact patches and velocities upon touchdown', () => {
      const gear = new LandingGear();
      const aircraft = new THREE.Object3D();
      aircraft.position.set(0, 14.0, 0);
      aircraft.updateMatrixWorld(true);

      const terrainFn = () => 12.0;
      const linVel = new THREE.Vector3(70.0, -2.5, 0); // Forward speed 70 m/s (~136 KT), sink rate 2.5 m/s
      const angVel = new THREE.Vector3(0, 0, 0);

      const res = gear.update(0.016, aircraft, linVel, angVel, terrainFn);

      assert.strictEqual(res.onGround, true);
      assert.strictEqual(res.touchdown, true, 'Touchdown flag should be active on first ground impact');
      assert.ok(res.touchdownContacts.length > 0, 'Touchdown contacts must be reported');

      const contact = res.touchdownContacts[0];
      assert.ok(contact.groundSpeed > 50.0, 'Ground speed must be captured');
      assert.ok(contact.sinkRate > 1.0, 'Sink rate must be captured');
      assert.ok(contact.worldPos instanceof THREE.Vector3, 'World position must be a Vector3');
      assert.ok(res.compressions.mainLeft > 0 || res.compressions.mainRight > 0, 'Strut compression must be positive');
    });
  });

  describe('TireSmokeSystem (Touchdown Rubber Smoke Particles)', () => {
    it('emits braking smoke only from moving grounded main wheels', (t) => {
      t.mock.method(Math, 'random', () => 0);
      const smoke = new TireSmokeSystem(new THREE.Scene());
      const contacts = [
        { id: 'nose', isGrounded: true, worldPos: new THREE.Vector3() },
        { id: 'mainLeft', isGrounded: true, worldPos: new THREE.Vector3() },
        { id: 'mainRight', isGrounded: false, worldPos: new THREE.Vector3() }
      ];
      smoke.spawnBrakingSmoke(contacts, new THREE.Vector3(), 1);
      assert.equal(smoke.particles.length, 0, 'Holding brakes while parked must not emit smoke');
      smoke.spawnBrakingSmoke(contacts, new THREE.Vector3(30, 0, 0), 1);
      assert.equal(smoke.particles.length, 3, 'Only the grounded main wheel emits');
      smoke.update(3);
      smoke.spawnBrakingSmoke(contacts, new THREE.Vector3(), 1);
      assert.equal(smoke.particles.length, 0, 'Smoke dissipates and stays clear after stopping');
    });

    it('should spawn realistic tire smoke particles on touchdown', () => {
      const scene = new THREE.Scene();
      const smokeSystem = new TireSmokeSystem(scene);

      const dummyContacts = [
        {
          id: 'mainLeft',
          worldPos: new THREE.Vector3(-3.2, 12.0, 1.8),
          groundSpeed: 72.0,
          sinkRate: 2.2
        },
        {
          id: 'mainRight',
          worldPos: new THREE.Vector3(3.2, 12.0, 1.8),
          groundSpeed: 72.0,
          sinkRate: 2.2
        }
      ];

      smokeSystem.spawnTouchdownSmoke(dummyContacts, new THREE.Vector3(72.0, -2.2, 0));

      assert.ok(smokeSystem.particles.length > 0, 'Smoke particles should be spawned');
      const p = smokeSystem.particles[0];
      assert.ok(p.sprite instanceof THREE.Sprite);
      assert.ok(p.maxLife > 1.0, 'Smoke particle lifetime should be > 1.0s');
      assert.ok(p.growth > 0, 'Smoke should expand as it billows');

      // Update particles
      smokeSystem.update(0.5);
      assert.ok(p.life >= 0.5);

      // Clear particles
      smokeSystem.clear();
      assert.strictEqual(smokeSystem.particles.length, 0);
    });
  });

  describe('Boeing737 3D Model (Suspension Oleo Articulation)', () => {
    it('keeps visible wheel hubs aligned with physics throughout compression and release', () => {
      const canvas = { getContext: () => null, canvas: {} };
      const aircraft = new Boeing737(canvas, canvas, canvas);
      const gear = new LandingGear();
      const trucks = [aircraft.noseTruck, aircraft.mainTruckL, aircraft.mainTruckR];
      for (const compression of [0, 0.25, 0.7, 0.9, 0.3, 0]) {
        aircraft.update(1 / 120, { gearState: 1, compressions: {
          nose: compression, mainLeft: compression, mainRight: compression
        } });
        aircraft.group.updateMatrixWorld(true);
        trucks.forEach((truck, index) => {
          const wheel = truck.children.find(child => child.isGroup);
          assert.ok(wheel, 'Wheel assembly must exist');
          const hub = wheel.getWorldPosition(new THREE.Vector3());
          assert.ok(Math.abs(hub.y - (gear.contacts[index].localPos.y + compression)) < 1e-9,
            `Visible ${gear.contacts[index].id} hub must follow physics at ${compression}m compression`);
        });
      }
    });

    it('should articulate chrome oleo pistons and trucks upward during touchdown compression', () => {
      const mockCanvas = { getContext: () => null, canvas: {} };
      const aircraft = new Boeing737(mockCanvas, mockCanvas, mockCanvas, mockCanvas, mockCanvas, mockCanvas);

      assert.ok(aircraft.noseTruck, 'noseTruck group must exist');
      assert.ok(aircraft.mainTruckL, 'mainTruckL group must exist');
      assert.ok(aircraft.mainTruckR, 'mainTruckR group must exist');

      // In the air (uncompressed struts)
      aircraft.update(0.016, {
        gearState: 1.0,
        compressions: { nose: 0.0, mainLeft: 0.0, mainRight: 0.0 }
      });
      assert.strictEqual(aircraft.mainTruckL.position.y, 0.0);

      // Heavy touchdown compression ("털썩" 하중 실림)
      aircraft.update(0.016, {
        gearState: 1.0,
        compressions: { nose: 0.25, mainLeft: 0.45, mainRight: 0.45 }
      });

      assert.ok(aircraft.mainTruckL.position.y > 0.2, 'Main gear oleo truck must slide upward into strut housing');
      assert.ok(aircraft.mainTruckR.position.y > 0.2, 'Right main gear oleo truck must slide upward into strut housing');
      assert.ok(aircraft.noseTruck.position.y > 0.1, 'Nose gear oleo truck must slide upward into strut housing');
    });
  });
});
