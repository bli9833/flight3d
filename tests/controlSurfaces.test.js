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

describe('Boeing737 Articulated Control Surfaces & Unified Model', () => {
  it('should verify b737-800.glb contains articulated control surface and landing gear nodes', () => {
    const glbPath = path.resolve(process.cwd(), 'public/models/b737-800.glb');
    assert.ok(fs.existsSync(glbPath), 'b737-800.glb must exist');

    const buf = fs.readFileSync(glbPath);
    const jsonLen = buf.readUInt32LE(12);
    const jsonBuf = buf.subarray(20, 20 + jsonLen);
    const gltf = JSON.parse(jsonBuf.toString('utf8'));

    const nodeNames = new Set(gltf.nodes.map(n => n.name).filter(Boolean));
    const requiredNodes = [
      'B737_Aircraft',
      'FuselageGroup',
      'WingsGroup',
      'ControlSurfacesGroup',
      'Aileron_L', 'Aileron_R',
      'Flap_L', 'Flap_R',
      'Spoilers_L', 'Spoilers_R',
      'Elevator_L', 'Elevator_R',
      'Rudder',
      'tur_01', 'turbs',
      'B737_LandingGear',
      'NoseGear', 'MainGearL', 'MainGearR'
    ];

    for (const name of requiredNodes) {
      assert.ok(nodeNames.has(name), `b737-800.glb must contain node '${name}'`);
    }
  });

  it('should bind GLTF control surfaces upon loading', () => {
    const aircraft = new Boeing737(new PFDCanvas(64, 64), new NDCanvas(64, 64), new EICASCanvas(64, 64));

    // Construct mock GLTF scene matching b737-800.glb
    const mockScene = new THREE.Group();
    mockScene.name = 'B737_Aircraft';
    const ctrlGroup = new THREE.Group();
    ctrlGroup.name = 'ControlSurfacesGroup';

    const aileronL = new THREE.Group(); aileronL.name = 'Aileron_L';
    const aileronR = new THREE.Group(); aileronR.name = 'Aileron_R';
    const flapL = new THREE.Group(); flapL.name = 'Flap_L'; flapL.position.set(-5.62, -0.19, 0.68);
    const flapR = new THREE.Group(); flapR.name = 'Flap_R'; flapR.position.set(5.62, -0.19, 0.68);
    const spL = new THREE.Group(); spL.name = 'Spoilers_L';
    const spR = new THREE.Group(); spR.name = 'Spoilers_R';
    const elevL = new THREE.Group(); elevL.name = 'Elevator_L';
    const elevR = new THREE.Group(); elevR.name = 'Elevator_R';
    const rudder = new THREE.Group(); rudder.name = 'Rudder';

    ctrlGroup.add(aileronL, aileronR, flapL, flapR, spL, spR, elevL, elevR, rudder);
    mockScene.add(ctrlGroup);

    // Simulate model load completion
    let onLoadCallback;
    const origLoad = GLTFLoader.prototype.load;
    GLTFLoader.prototype.load = function(_url, onLoad) {
      onLoadCallback = onLoad;
    };
    const prevWindow = globalThis.window;
    globalThis.window = {};

    try {
      aircraft.loadGltfModel('/test-b737.glb');
      onLoadCallback({ scene: mockScene });

      assert.strictEqual(aircraft.gltfAileronL, aileronL, 'gltfAileronL must be bound');
      assert.strictEqual(aircraft.gltfAileronR, aileronR, 'gltfAileronR must be bound');
      assert.strictEqual(aircraft.gltfFlapL, flapL, 'gltfFlapL must be bound');
      assert.strictEqual(aircraft.gltfFlapR, flapR, 'gltfFlapR must be bound');
      assert.strictEqual(aircraft.gltfSpoilersL, spL, 'gltfSpoilersL must be bound');
      assert.strictEqual(aircraft.gltfSpoilersR, spR, 'gltfSpoilersR must be bound');
      assert.strictEqual(aircraft.gltfElevatorL, elevL, 'gltfElevatorL must be bound');
      assert.strictEqual(aircraft.gltfElevatorR, elevR, 'gltfElevatorR must be bound');
      assert.strictEqual(aircraft.gltfRudder, rudder, 'gltfRudder must be bound');
    } finally {
      GLTFLoader.prototype.load = origLoad;
      if (prevWindow === undefined) delete globalThis.window;
      else globalThis.window = prevWindow;
    }
  });

  it('should articulate all GLTF control surfaces dynamically with flight controls', () => {
    const aircraft = new Boeing737(new PFDCanvas(64, 64), new NDCanvas(64, 64), new EICASCanvas(64, 64));

    // Manually assign test nodes
    aircraft.gltfAileronL = new THREE.Group();
    aircraft.gltfAileronR = new THREE.Group();
    aircraft.gltfFlapL = new THREE.Group();
    aircraft.gltfFlapL.position.set(-5.62, -0.19, 0.68);
    aircraft.gltfFlapLInitY = -0.19;
    aircraft.gltfFlapLInitZ = 0.68;
    aircraft.gltfFlapR = new THREE.Group();
    aircraft.gltfFlapR.position.set(5.62, -0.19, 0.68);
    aircraft.gltfFlapRInitY = -0.19;
    aircraft.gltfFlapRInitZ = 0.68;
    aircraft.gltfSpoilersL = new THREE.Group();
    aircraft.gltfSpoilersR = new THREE.Group();
    aircraft.gltfElevatorL = new THREE.Group();
    aircraft.gltfElevatorR = new THREE.Group();
    aircraft.gltfRudder = new THREE.Group();

    // 1. Roll right: right aileron up (-), left aileron down (+)
    aircraft.update(0.016, { aileron: 0.8 });
    assert.strictEqual(aircraft.gltfAileronL.rotation.x, 0.8 * 0.35);
    assert.strictEqual(aircraft.gltfAileronR.rotation.x, -0.8 * 0.35);

    // 2. Pitch up: elevator up (+)
    aircraft.update(0.016, { elevator: 0.75 });
    assert.strictEqual(aircraft.gltfElevatorL.rotation.x, 0.75 * 0.45);
    assert.strictEqual(aircraft.gltfElevatorR.rotation.x, 0.75 * 0.45);

    // 3. Yaw right: rudder right (+)
    aircraft.update(0.016, { rudder: 0.6 });
    assert.strictEqual(aircraft.gltfRudder.rotation.y, 0.6 * 0.45);

    // 4. Deploy flaps to 30 degrees
    aircraft.update(0.016, { flapDegree: 30 });
    const rad30 = THREE.MathUtils.degToRad(30);
    assert.ok(Math.abs(aircraft.gltfFlapL.rotation.x - rad30) < 1e-6);
    assert.ok(aircraft.gltfFlapL.position.y < -0.19, 'Flaps must translate downward when extending');
    assert.ok(aircraft.gltfFlapL.position.z > 0.68, 'Flaps must translate aft when extending');

    // 5. Deploy flight spoilers / speedbrakes
    aircraft.update(0.016, { spoilers: 1.0 });
    assert.strictEqual(aircraft.gltfSpoilersL.rotation.x, THREE.MathUtils.degToRad(-50.0));
    assert.strictEqual(aircraft.gltfSpoilersR.rotation.x, THREE.MathUtils.degToRad(-50.0));
  });
});
