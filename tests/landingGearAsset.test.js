import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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

import { Boeing737 } from '../src/aircraft/Boeing737.js';
import { PFDCanvas } from '../src/aircraft/PFDCanvas.js';
import { NDCanvas } from '../src/aircraft/NDCanvas.js';
import { EICASCanvas } from '../src/aircraft/EICASCanvas.js';
import { LandingGear } from '../src/physics/LandingGear.js';

describe('Boeing737 Landing Gear Asset & Articulated Doors', () => {
  it('should verify public/models/b737-landing-gear.glb exists within lightweight budget (< 2MB)', () => {
    const glbPath = path.resolve(process.cwd(), 'public/models/b737-landing-gear.glb');
    assert.ok(fs.existsSync(glbPath), 'b737-landing-gear.glb must exist in public/models/');
    const stats = fs.statSync(glbPath);
    assert.ok(stats.size > 50 * 1024, `Asset must be substantial (> 50KB), got ${stats.size}`);
    assert.ok(stats.size < 2 * 1024 * 1024, `Asset must remain under 2MB budget, got ${stats.size}`);
  });

  it('should verify landing gear GLB contains required nodes for nose and main assemblies', () => {
    const glbPath = path.resolve(process.cwd(), 'public/models/b737-landing-gear.glb');
    const buf = fs.readFileSync(glbPath);
    const jsonLen = buf.readUInt32LE(12);
    const jsonBuf = buf.subarray(20, 20 + jsonLen);
    const gltf = JSON.parse(jsonBuf.toString('utf8'));

    const nodeNames = new Set(gltf.nodes.map(n => n.name).filter(Boolean));
    const requiredNodes = [
      'B737_LandingGear',
      'NoseGear', 'NoseStrutUpper', 'NoseTruck', 'NoseDoorL', 'NoseDoorR',
      'MainGearL', 'MainStrutUpperL', 'MainTruckL', 'MainDoorL',
      'MainGearR', 'MainStrutUpperR', 'MainTruckR', 'MainDoorR'
    ];

    for (const name of requiredNodes) {
      assert.ok(nodeNames.has(name), `GLB must contain node '${name}'`);
    }
  });

  it('should initialize Boeing737 with articulated gearDoors and gearScissors', () => {
    const aircraft = new Boeing737(new PFDCanvas(64, 64), new NDCanvas(64, 64), new EICASCanvas(64, 64));
    assert.ok(Array.isArray(aircraft.gearDoors), 'aircraft.gearDoors must be an array');
    assert.strictEqual(aircraft.gearDoors.length, 4, 'Must register 4 gear doors (2 nose doors, 2 main doors)');
    assert.ok(Array.isArray(aircraft.gearScissors), 'aircraft.gearScissors must be an array');
    assert.ok(aircraft.gearScissors.length >= 3, 'Must register scissors links for nose, mainLeft, and mainRight');
  });

  it('should articulate gear doors to flush closed when gear is retracted (gearState = 0)', () => {
    const aircraft = new Boeing737(new PFDCanvas(64, 64), new NDCanvas(64, 64), new EICASCanvas(64, 64));

    // Gear fully down (gearState = 1.0): doors must be open
    aircraft.update(0.016, { gearState: 1.0 });
    for (const doorItem of aircraft.gearDoors) {
      const rot = doorItem.axis === 'z' ? doorItem.obj.rotation.z : doorItem.obj.rotation.x;
      assert.ok(Math.abs(rot) > 0.1, `Door must be open when gear is deployed, rot=${rot}`);
    }

    // Gear fully up / retracted (gearState = 0.0): doors must be flush closed
    aircraft.update(0.016, { gearState: 0.0 });
    for (const doorItem of aircraft.gearDoors) {
      const rot = doorItem.axis === 'z' ? doorItem.obj.rotation.z : doorItem.obj.rotation.x;
      assert.strictEqual(rot, 0, `Door must be flush closed (rotation=0) when gear is up, got ${rot}`);
    }
  });

  it('should open doors during gear transit (0.0 < gearState < 1.0)', () => {
    const aircraft = new Boeing737(new PFDCanvas(64, 64), new NDCanvas(64, 64), new EICASCanvas(64, 64));

    // Halfway through transit (gearState = 0.5)
    aircraft.update(0.016, { gearState: 0.5 });
    for (const doorItem of aircraft.gearDoors) {
      const rot = doorItem.axis === 'z' ? doorItem.obj.rotation.z : doorItem.obj.rotation.x;
      assert.ok(Math.abs(rot) > 0.3, `Door must be wide open during transit, rot=${rot}`);
    }
  });

  it('should articulate scissors torque links proportionally with touchdown compression', () => {
    const aircraft = new Boeing737(new PFDCanvas(64, 64), new NDCanvas(64, 64), new EICASCanvas(64, 64));

    // Uncompressed
    aircraft.update(0.016, { gearState: 1.0, compressions: { nose: 0.0, mainLeft: 0.0, mainRight: 0.0 } });
    for (const item of aircraft.gearScissors) {
      assert.strictEqual(item.upper.rotation.x, 0);
      assert.strictEqual(item.lower.rotation.x, 0);
    }

    // Heavy touchdown compression
    aircraft.update(0.016, { gearState: 1.0, compressions: { nose: 0.3, mainLeft: 0.5, mainRight: 0.5 } });
    for (const item of aircraft.gearScissors) {
      assert.ok(item.upper.rotation.x < -0.1, 'Upper scissors arm must flex backwards during compression');
      assert.ok(item.lower.rotation.x > 0.1, 'Lower scissors arm must flex forwards during compression');
    }
  });

  it('should verify bindGltfLandingGear preserves wheel assembly group and exact hub alignment', () => {
    const aircraft = new Boeing737(new PFDCanvas(64, 64), new NDCanvas(64, 64), new EICASCanvas(64, 64));
    const gear = new LandingGear();

    // Create mock GLTF scene matching b737-landing-gear.glb hierarchy
    const mockScene = new THREE.Group();
    const makeMockGltfGear = (name, x, y, z, posY) => {
      const root = new THREE.Group();
      root.name = name;
      root.position.set(x, y, z);
      const truck = new THREE.Group();
      truck.name = name === 'NoseGear' ? 'NoseTruck' : (name === 'MainGearL' ? 'MainTruckL' : 'MainTruckR');
      const wheelGrp = new THREE.Group();
      wheelGrp.name = name === 'NoseGear' ? 'NoseWheelGroup' : (name === 'MainGearL' ? 'MainWheelGroupL' : 'MainWheelGroupR');
      wheelGrp.position.set(0, posY, 0);
      wheelGrp.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1)));
      truck.add(wheelGrp);
      root.add(truck);
      return root;
    };

    mockScene.add(
      makeMockGltfGear('NoseGear', 0, -0.85, -12.5, -2.42),
      makeMockGltfGear('MainGearL', -3.2, -0.9, 1.8, -2.40),
      makeMockGltfGear('MainGearR', 3.2, -0.9, 1.8, -2.40)
    );

    aircraft.bindGltfLandingGear(mockScene);
    assert.strictEqual(aircraft.landingGearLoaded, true);

    const trucks = [aircraft.noseTruck, aircraft.mainTruckL, aircraft.mainTruckR];
    aircraft.update(1 / 120, { gearState: 1, compressions: { nose: 0.4, mainLeft: 0.6, mainRight: 0.6 } });
    aircraft.group.updateMatrixWorld(true);

    trucks.forEach((truck, index) => {
      const wheel = truck.children.find(c => c.isGroup);
      assert.ok(wheel, `Wheel assembly Group must exist on truck ${index}`);
      const hub = wheel.getWorldPosition(new THREE.Vector3());
      const expectedY = gear.contacts[index].localPos.y + (index === 0 ? 0.4 : 0.6);
      assert.ok(Math.abs(hub.y - expectedY) < 1e-9, `Hub Y must align with physics: got ${hub.y}, expected ${expectedY}`);
    });
  });

  it('should document GPL-2.0 license and FlightGear attribution in CREDITS.md', () => {
    const creditsPath = path.resolve(process.cwd(), 'CREDITS.md');
    assert.ok(fs.existsSync(creditsPath), 'CREDITS.md must exist');
    const content = fs.readFileSync(creditsPath, 'utf8');

    assert.ok(content.includes('b737-landing-gear.glb'), 'Must document b737-landing-gear.glb');
    assert.ok(content.includes('FlightGear'), 'Must attribute FlightGear project');
    assert.ok(content.includes('GPL-2.0'), 'Must document GPL-2.0 license');
  });
});
