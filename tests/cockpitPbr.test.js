import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

import { Cockpit } from '../src/aircraft/Cockpit.js';
import { PFDCanvas } from '../src/aircraft/PFDCanvas.js';
import { NDCanvas } from '../src/aircraft/NDCanvas.js';
import { EICASCanvas } from '../src/aircraft/EICASCanvas.js';
import { MCPCanvas } from '../src/aircraft/MCPCanvas.js';
import { ISFDCanvas } from '../src/aircraft/ISFDCanvas.js';
import { CDUCanvas } from '../src/aircraft/CDUCanvas.js';

describe('Cockpit PBR & Real-Photo Texture Enhancement System', () => {
  it('should initialize Cockpit with complete PBR group hierarchy and texture references', () => {
    const pfd = new PFDCanvas(256, 256);
    const nd = new NDCanvas(256, 256);
    const eicas = new EICASCanvas(256, 256);
    const mcp = new MCPCanvas(512, 64);
    const isfd = new ISFDCanvas(128, 128);
    const cdu = new CDUCanvas(256, 256);

    const cockpit = new Cockpit(pfd, nd, eicas, mcp, isfd, cdu);

    assert.ok(cockpit.group instanceof THREE.Group, 'Cockpit root must be a THREE.Group');
    assert.ok(cockpit.captainEyePos instanceof THREE.Vector3, 'Captain eye position must exist');
    assert.strictEqual(cockpit.captainEyePos.x, -0.48);

    // Verify Texture objects are instantiated safely
    assert.ok(cockpit.overheadTex instanceof THREE.Texture);
    assert.ok(cockpit.mipTex instanceof THREE.Texture);
    assert.ok(cockpit.pedestalTex instanceof THREE.Texture);
    assert.ok(cockpit.yokeTex instanceof THREE.Texture);
    assert.ok(cockpit.mcpTex instanceof THREE.Texture);
  });

  it('should construct dual control yokes with pitch and roll groups and clipboard', () => {
    const pfd = new PFDCanvas(256, 256);
    const nd = new NDCanvas(256, 256);
    const eicas = new EICASCanvas(256, 256);
    const cockpit = new Cockpit(pfd, nd, eicas);

    assert.ok(cockpit.captainYoke, 'Captain yoke must exist');
    assert.ok(cockpit.captainYoke.root instanceof THREE.Group);
    assert.ok(cockpit.captainYoke.pitchGroup instanceof THREE.Group);
    assert.ok(cockpit.captainYoke.handleGroup instanceof THREE.Group);

    assert.ok(cockpit.foYoke, 'First officer yoke must exist');
    assert.ok(cockpit.foYoke.root instanceof THREE.Group);
  });

  it('should construct throttle quadrant with molded levers, flap lever, spoiler, and trim wheels', () => {
    const pfd = new PFDCanvas(256, 256);
    const nd = new NDCanvas(256, 256);
    const eicas = new EICASCanvas(256, 256);
    const cockpit = new Cockpit(pfd, nd, eicas);

    assert.ok(cockpit.throttle1 instanceof THREE.Group, 'Left throttle lever must exist');
    assert.ok(cockpit.throttle2 instanceof THREE.Group, 'Right throttle lever must exist');
    assert.ok(cockpit.flapLever instanceof THREE.Group, 'Flap selector lever must exist');
    assert.ok(cockpit.spoilerLever instanceof THREE.Group, 'Speedbrake lever must exist');
    assert.ok(cockpit.trimWheelL instanceof THREE.Group, 'Left trim wheel must exist');
    assert.ok(cockpit.trimWheelR instanceof THREE.Group, 'Right trim wheel must exist');
    assert.ok(cockpit.cduScreenL instanceof THREE.Mesh, 'Captain CDU screen must exist');
    assert.ok(cockpit.cduScreenR instanceof THREE.Mesh, 'FO CDU screen must exist');
  });

  it('should construct landing gear lever, 3-green annunciator lights, and flap gauge needle', () => {
    const pfd = new PFDCanvas(256, 256);
    const nd = new NDCanvas(256, 256);
    const eicas = new EICASCanvas(256, 256);
    const cockpit = new Cockpit(pfd, nd, eicas);

    assert.ok(cockpit.gearLever instanceof THREE.Group, 'Landing gear lever must exist');
    assert.strictEqual(cockpit.gearLights.length, 3, 'Must have 3 gear annunciator lights (Nose, L, R)');
    assert.ok(cockpit.gearLightMats, 'Gear light materials (green, amber, off) must exist');
    assert.ok(cockpit.flapGaugeNeedle instanceof THREE.Group, 'Flap gauge needle must exist');
  });

  it('should animate controls dynamically across full range in updateControls', () => {
    const pfd = new PFDCanvas(256, 256);
    const nd = new NDCanvas(256, 256);
    const eicas = new EICASCanvas(256, 256);
    const cockpit = new Cockpit(pfd, nd, eicas);

    // Initial state
    const flightState = {
      elevator: 0.8,
      aileron: -0.5,
      rudder: 0.6,
      throttle: 0.9,
      flapIndex: 4, // Flaps 15
      gearState: 1.0, // Down and locked
      spoilers: 0.75,
      pitchTrimRate: 1.5
    };

    cockpit.updateControls(flightState);

    // 1. Yoke deflections
    assert.ok(cockpit.captainYoke.pitchGroup.rotation.x > 0.1, 'Elevator pitch deflection must tilt yoke back');
    assert.ok(cockpit.captainYoke.handleGroup.rotation.z > 0.2, 'Negative aileron roll must rotate yoke right');
    assert.strictEqual(cockpit.captainYoke.pitchGroup.rotation.x, cockpit.foYoke.pitchGroup.rotation.x);

    // 2. Rudder pedals
    assert.ok(cockpit.pedalLeft.position.z < 0);
    assert.ok(cockpit.pedalRight.position.z > 0);

    // 3. Throttle levers
    assert.ok(cockpit.throttle1.rotation.x > 0.2, 'Throttle lever must rotate forward with throttle');
    assert.strictEqual(cockpit.throttle1.rotation.x, cockpit.throttle2.rotation.x);

    // 4. Flap lever & flap dial needle
    assert.ok(cockpit.flapGaugeNeedle.rotation.z < -2.0, 'Flap needle must rotate clockwise to flap degree');

    // 5. Gear lever & 3-green lights
    assert.strictEqual(cockpit.gearLever.rotation.x, 0.35, 'Gear lever down');
    assert.strictEqual(cockpit.gearLights[0].material, cockpit.gearLightMats.green, 'Lights must be green when gear down');

    // Test gear transit amber
    cockpit.updateControls({ gearState: 0.5 });
    assert.strictEqual(cockpit.gearLights[0].material, cockpit.gearLightMats.amber, 'Lights must be amber during transit');

    // Test gear up
    cockpit.updateControls({ gearState: 0.0 });
    assert.strictEqual(cockpit.gearLever.rotation.x, -0.35, 'Gear lever tilted up when gear retracted');
    assert.strictEqual(cockpit.gearLights[0].material, cockpit.gearLightMats.off, 'Lights off when gear up');

    // 6. Spoiler lever
    cockpit.updateControls({ spoilers: 0.8 });
    assert.ok(cockpit.spoilerLever.rotation.x > 0, 'Spoiler lever pulled back when deployed');

    // 7. Trim wheels rotation
    const initRot = cockpit.trimWheelL.rotation.x;
    cockpit.updateControls({ pitchTrimRate: 2.0 });
    assert.ok(cockpit.trimWheelL.rotation.x > initRot, 'Trim wheel must rotate when trimming');
  });

  it('should verify all 5 photo-based cockpit PBR texture files exist in public/textures/cockpit/', () => {
    const requiredTextures = [
      'b737_overhead.jpg',
      'b737_mip.jpg',
      'b737_pedestal.jpg',
      'b737_yoke.jpg',
      'b737_mcp.jpg'
    ];

    for (const file of requiredTextures) {
      const filePath = path.resolve(process.cwd(), 'public/textures/cockpit', file);
      assert.ok(fs.existsSync(filePath), `Texture ${file} must exist in public/textures/cockpit/`);

      const stats = fs.statSync(filePath);
      assert.ok(stats.size > 200 * 1024, `${file} must be at least 200KB for high resolution`);
      assert.ok(stats.size < 2 * 1024 * 1024, `${file} must be under 2MB for browser efficiency`);
    }
  });
});
