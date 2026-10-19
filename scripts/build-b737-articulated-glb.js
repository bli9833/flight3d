import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

// Polyfill FileReader for Node.js GLTFExporter binary export
global.self = global;
class FileReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = buf;
      if (this.onloadend) this.onloadend({ target: this });
    });
  }
}
global.FileReader = FileReader;

const CACHE_DIR = path.resolve(process.cwd(), '.tmp/gear-sources');
const OUTPUT_FULL_GLB = path.resolve(process.cwd(), 'public/models/b737-800.glb');
const OUTPUT_GEAR_GLB = path.resolve(process.cwd(), 'public/models/b737-landing-gear.glb');

async function ensureSources() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const sources = [
    { name: 'nosegear.ac', url: 'https://raw.githubusercontent.com/soitanen/737-800/master/Models/nosegear.ac' },
    { name: 'LWing.ac', url: 'https://raw.githubusercontent.com/soitanen/737-800/master/Models/LWing.ac' },
    { name: 'RWing.ac', url: 'https://raw.githubusercontent.com/soitanen/737-800/master/Models/RWing.ac' },
    { name: '737-800.ac', url: 'https://raw.githubusercontent.com/soitanen/737-800/master/Models/737-800.ac' },
    { name: 'HorzStab.ac', url: 'https://raw.githubusercontent.com/soitanen/737-800/master/Models/HorzStab.ac' },
    { name: 'VertStab.ac', url: 'https://raw.githubusercontent.com/soitanen/737-800/master/Models/VertStab.ac' },
    { name: 'winglet.ac', url: 'https://raw.githubusercontent.com/soitanen/737-800/master/Models/winglet.ac' }
  ];

  for (const src of sources) {
    const filePath = path.join(CACHE_DIR, src.name);
    if (!fs.existsSync(filePath)) {
      console.log(`Downloading ${src.name}...`);
      const res = await fetch(src.url);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(filePath, buf);
    }
  }
}

function parseAC3D(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split('\n');
  const objects = {};
  let currentObj = null;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith('name "')) {
      currentObj = l.substring(6, l.length - 1);
      objects[currentObj] = { verts: [], surfaces: [] };
    } else if (l.startsWith('numvert ') && currentObj) {
      const n = parseInt(l.substring(8));
      for (let j = 0; j < n; j++) {
        i++;
        objects[currentObj].verts.push(lines[i].trim().split(/\s+/).map(Number));
      }
    } else if (l.startsWith('numsurf ') && currentObj) {
      const n = parseInt(l.substring(8));
      for (let s = 0; s < n; s++) {
        i++; // SURF
        i++; // mat
        const matIdx = parseInt(lines[i].trim().split(/\s+/)[1]) || 0;
        i++; // refs
        const refsCount = parseInt(lines[i].trim().split(/\s+/)[1]);
        const refs = [];
        const uvs = [];
        for (let r = 0; r < refsCount; r++) {
          i++;
          const rp = lines[i].trim().split(/\s+/);
          refs.push(parseInt(rp[0]));
          uvs.push([parseFloat(rp[1]), parseFloat(rp[2])]);
        }
        objects[currentObj].surfaces.push({ mat: matIdx, refs, uvs });
      }
    }
  }
  return objects;
}

function createMeshFromAC(data, material, transformFn = null) {
  if (!data || !data.verts.length || !data.surfaces.length) return null;
  const geom = new THREE.BufferGeometry();
  const positions = [];
  const indices = [];

  for (let v = 0; v < data.verts.length; v++) {
    let pt = [data.verts[v][0], data.verts[v][1], data.verts[v][2]];
    if (transformFn) pt = transformFn(pt);
    positions.push(pt[0], pt[1], pt[2]);
  }

  for (const s of data.surfaces) {
    if (s.refs.length === 3) {
      indices.push(s.refs[0], s.refs[1], s.refs[2]);
    } else if (s.refs.length === 4) {
      indices.push(s.refs[0], s.refs[1], s.refs[2]);
      indices.push(s.refs[0], s.refs[2], s.refs[3]);
    }
  }

  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  return new THREE.Mesh(geom, material);
}

function mergeObjectsMesh(dataMap, objectNames, material, transformFn = null) {
  const mergedGeom = new THREE.BufferGeometry();
  const positions = [];
  const indices = [];
  let vertOffset = 0;

  for (const name of objectNames) {
    const data = dataMap[name];
    if (!data || !data.verts.length || !data.surfaces.length) continue;

    for (let v = 0; v < data.verts.length; v++) {
      let pt = [data.verts[v][0], data.verts[v][1], data.verts[v][2]];
      if (transformFn) pt = transformFn(pt);
      positions.push(pt[0], pt[1], pt[2]);
    }

    for (const s of data.surfaces) {
      if (s.refs.length === 3) {
        indices.push(vertOffset + s.refs[0], vertOffset + s.refs[1], vertOffset + s.refs[2]);
      } else if (s.refs.length === 4) {
        indices.push(vertOffset + s.refs[0], vertOffset + s.refs[1], vertOffset + s.refs[2]);
        indices.push(vertOffset + s.refs[0], vertOffset + s.refs[2], vertOffset + s.refs[3]);
      }
    }
    vertOffset += data.verts.length;
  }

  if (positions.length === 0) return null;
  mergedGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  mergedGeom.setIndex(indices);
  mergedGeom.computeVertexNormals();

  return new THREE.Mesh(mergedGeom, material);
}

async function buildFullModel() {
  await ensureSources();

  console.log('Parsing AC3D sources...');
  const fuseData = parseAC3D(path.join(CACHE_DIR, '737-800.ac'));
  const lWingData = parseAC3D(path.join(CACHE_DIR, 'LWing.ac'));
  const rWingData = parseAC3D(path.join(CACHE_DIR, 'RWing.ac'));
  const hStabData = parseAC3D(path.join(CACHE_DIR, 'HorzStab.ac'));
  const vStabData = parseAC3D(path.join(CACHE_DIR, 'VertStab.ac'));
  const wingletData = parseAC3D(path.join(CACHE_DIR, 'winglet.ac'));
  const noseData = parseAC3D(path.join(CACHE_DIR, 'nosegear.ac'));

  // Coordinate conversion: AC3D (x=aft, y=up, z=left) to Three.js standard (x=right, y=up, z=aft)
  // X_three = -z_ac
  // Y_three = y_ac
  // Z_three = x_ac
  const toThree = ([x, y, z]) => [-z, y, x];

  // -------------------------------------------------------------
  // PBR MATERIALS
  // -------------------------------------------------------------
  const fuselageMat = new THREE.MeshStandardMaterial({
    color: 0xfafbfc,
    roughness: 0.28,
    metalness: 0.12,
    name: 'Aircraft_FuselageWhite'
  });

  const wingMat = new THREE.MeshStandardMaterial({
    color: 0xd4d9e0,
    roughness: 0.38,
    metalness: 0.18,
    name: 'Aircraft_WingGrey'
  });

  const liveryBlueMat = new THREE.MeshStandardMaterial({
    color: 0x004da8,
    roughness: 0.25,
    metalness: 0.25,
    name: 'Aircraft_LiveryBlue'
  });

  const windowMat = new THREE.MeshStandardMaterial({
    color: 0x0f141a,
    roughness: 0.08,
    metalness: 0.92,
    name: 'Aircraft_Glass'
  });

  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xf5f8fa,
    roughness: 0.10,
    metalness: 0.95,
    name: 'Aircraft_ChromeAlloy'
  });

  const darkTurbineMat = new THREE.MeshStandardMaterial({
    color: 0x242830,
    roughness: 0.30,
    metalness: 0.85,
    name: 'Aircraft_TurbineTitanium'
  });

  const strutMat = new THREE.MeshStandardMaterial({
    color: 0x98a2ad,
    metalness: 0.70,
    roughness: 0.35,
    name: 'LandingGear_StrutGrey'
  });

  const chromePistonMat = new THREE.MeshStandardMaterial({
    color: 0xf8faff,
    metalness: 0.98,
    roughness: 0.08,
    name: 'LandingGear_ChromePiston'
  });

  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x181a1d,
    roughness: 0.88,
    metalness: 0.08,
    name: 'LandingGear_TireRubber'
  });

  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xdde3ea,
    metalness: 0.82,
    roughness: 0.25,
    name: 'LandingGear_RimAlloy'
  });

  const doorExtMat = new THREE.MeshStandardMaterial({
    color: 0xf4f7fa,
    roughness: 0.28,
    metalness: 0.18,
    name: 'LandingGear_DoorExterior'
  });

  const brakeMat = new THREE.MeshStandardMaterial({
    color: 0x2b2e34,
    metalness: 0.85,
    roughness: 0.50,
    name: 'LandingGear_BrakeCarbon'
  });

  const root = new THREE.Group();
  root.name = 'B737_Aircraft';

  // -------------------------------------------------------------
  // 1. FUSELAGE & EMPENNAGE
  // -------------------------------------------------------------
  const fuseGroup = new THREE.Group();
  fuseGroup.name = 'FuselageGroup';

  const fuseParts = [
    'fuselage', 'Circle.006', 'doorLF', 'doorLF.001', 'doorLR', 'doorRF', 'doorRR',
    'doorlhaft', 'doorlhaft.001', 'doorlhaft.002', 'doorlhaft.003', 'doorlhaft.004',
    'doorlhfwd', 'doorlhfwd.001', 'doorlhfwd.002', 'doorrhrear', 'dorrhfront', 'dorrhfront_0', 'dorrhfront.005',
    'cargodoorF', 'cargodoorR', 'EexitLF', 'EexitLR', 'EexitRF', 'EexitRR', 'apuexht', 'ngww'
  ];
  const fuseMesh = mergeObjectsMesh(fuseData, fuseParts, fuselageMat, toThree);
  if (fuseMesh) { fuseMesh.name = 'FuselageBody'; fuseGroup.add(fuseMesh); }

  const winParts = ['windowslh', 'windowsrh', 'windows'];
  const winMesh = mergeObjectsMesh(fuseData, winParts, windowMat, toThree);
  if (winMesh) { winMesh.name = 'FuselageWindows'; fuseGroup.add(winMesh); }

  // Vertical Fin
  const vFinMesh = mergeObjectsMesh(vStabData, ['vstab', 'vstable'], fuselageMat, toThree);
  if (vFinMesh) { vFinMesh.name = 'VerticalFin'; fuseGroup.add(vFinMesh); }

  // Horizontal Stabilizer Fins
  const hStabMesh = mergeObjectsMesh(hStabData, ['lhstab', 'rhstab'], wingMat, toThree);
  if (hStabMesh) { hStabMesh.name = 'HorizontalStabilizers'; fuseGroup.add(hStabMesh); }

  root.add(fuseGroup);

  // -------------------------------------------------------------
  // 2. FIXED WINGS & ENGINES
  // -------------------------------------------------------------
  const wingsGroup = new THREE.Group();
  wingsGroup.name = 'WingsGroup';

  // Left Fixed Wing
  const lWingFixedNames = [
    'winginbd', 'obwing', 'ible', 'oble', 'panel1upper', 'panelupperob', 'lowerpanel', 'lowerpanel1',
    'fairing1', 'fairing2', 'fairing3', 'flapfairing', 'flapfairing.001', 'ibflapfairing', 'lhfairing',
    'fwdpylon.001', 'fwdpylon.002', 'fwdpylon.003', 'fwdpylon.004', 'fwdpylon.005', 'lhww'
  ];
  const lWingMesh = mergeObjectsMesh(lWingData, lWingFixedNames, wingMat, toThree);
  if (lWingMesh) { lWingMesh.name = 'Wing_Fixed_L'; wingsGroup.add(lWingMesh); }

  // Right Fixed Wing
  const rWingFixedNames = [
    'winginbd.001', 'obwing.001', 'iblerh', 'rhoble', 'rhpanel1upper', 'panelupperob.001', 'rhlowerpanel', 'lowerpanel1.001',
    'fairing4', 'fairing5', 'fairing6', 'flapfairing.002', 'flapfairing.003', 'ibflapfairing.001', 'rhwtobfairing',
    'fwdpylon', 'fwdpylon.006', 'fwdpylon.007', 'fwdpylon.008', 'fwdpylon.009', 'rhww'
  ];
  const rWingMesh = mergeObjectsMesh(rWingData, rWingFixedNames, wingMat, toThree);
  if (rWingMesh) { rWingMesh.name = 'Wing_Fixed_R'; wingsGroup.add(rWingMesh); }

  // Winglets
  const wingletMesh = mergeObjectsMesh(wingletData, ['WingletL', 'a-light1'], liveryBlueMat, toThree);
  if (wingletMesh) { wingletMesh.name = 'Winglets'; wingsGroup.add(wingletMesh); }

  // Left Engine Nacelle & Core
  const lEngNames = ['engnose', 'engnose.001', 'engcore', 'ductinner', 'tailpipe', 'lreverserib', 'lreverserib_0', 'lreverserib_1'];
  const lEngMesh = mergeObjectsMesh(lWingData, lEngNames, liveryBlueMat, toThree);
  if (lEngMesh) { lEngMesh.name = 'EngineNacelle_L'; wingsGroup.add(lEngMesh); }

  // Right Engine Nacelle & Core
  const rEngNames = ['engnose.003', 'engcore.001', 'No2engfancase', 'ductinner.001', 'tailpipe.001', 'No2reverser', 'No2reverser_0', 'No2reverser_1'];
  const rEngMesh = mergeObjectsMesh(rWingData, rEngNames, liveryBlueMat, toThree);
  if (rEngMesh) { rEngMesh.name = 'EngineNacelle_R'; wingsGroup.add(rEngMesh); }

  // Left Engine Fan (name 'tur_01' for test & code compatibility)
  const lFanMesh = createMeshFromAC(lWingData['fan'], darkTurbineMat, ([x, y, z]) => {
    // Relative to engine fan hub (-5.06, -1.95, -5.22)
    // Fan in AC: x_ac = -5.169, y_ac = -1.216, z_ac = 5.187 -> Three: [-5.187, -1.216, -5.169]
    return [-(z - 5.06), y - (-1.95), x - (-5.22)];
  });
  if (lFanMesh) {
    const lFanGroup = new THREE.Group();
    lFanGroup.name = 'tur_01';
    lFanGroup.position.set(-5.06, -1.95, -5.22);
    lFanGroup.add(lFanMesh);
    wingsGroup.add(lFanGroup);
  }

  // Right Engine Fan (name 'turbs' for test & code compatibility)
  const rFanMesh = createMeshFromAC(rWingData['fan2'], darkTurbineMat, ([x, y, z]) => {
    return [-(z - (-5.06)), y - (-1.95), x - (-5.22)];
  });
  if (rFanMesh) {
    const rFanGroup = new THREE.Group();
    rFanGroup.name = 'turbs';
    rFanGroup.position.set(5.06, -1.95, -5.22);
    rFanGroup.add(rFanMesh);
    wingsGroup.add(rFanGroup);
  }

  root.add(wingsGroup);

  // -------------------------------------------------------------
  // 3. ARTICULATED CONTROL SURFACES
  // -------------------------------------------------------------
  const ctrlGroup = new THREE.Group();
  ctrlGroup.name = 'ControlSurfacesGroup';

  // Left Aileron (Pivot at x=-10.58, y=0.42, z=2.46)
  const aileronLPivot = new THREE.Group();
  aileronLPivot.name = 'Aileron_L';
  aileronLPivot.position.set(-10.58, 0.42, 2.46);
  const aileronLMesh = mergeObjectsMesh(lWingData, ['lhaileron', 'ailerontablh'], wingMat, ([x, y, z]) => {
    return [-(z - 10.58), y - 0.42, x - 2.46];
  });
  if (aileronLMesh) aileronLPivot.add(aileronLMesh);
  ctrlGroup.add(aileronLPivot);

  // Right Aileron (Pivot at x=10.58, y=0.42, z=2.46)
  const aileronRPivot = new THREE.Group();
  aileronRPivot.name = 'Aileron_R';
  aileronRPivot.position.set(10.58, 0.42, 2.46);
  const aileronRMesh = mergeObjectsMesh(rWingData, ['rhaileron', 'ailerontabrh'], wingMat, ([x, y, z]) => {
    return [-(z - (-10.58)), y - 0.42, x - 2.46];
  });
  if (aileronRMesh) aileronRPivot.add(aileronRMesh);
  ctrlGroup.add(aileronRPivot);

  // Left Flaps (Pivot at x=-5.62, y=-0.19, z=0.68)
  const flapLPivot = new THREE.Group();
  flapLPivot.name = 'Flap_L';
  flapLPivot.position.set(-5.62, -0.19, 0.68);
  const flapLNames = ['flapI/B', 'aftflapI/B', 'flapO/B', 'aftflapO/B', 'flap1', 'flap2'];
  const flapLMesh = mergeObjectsMesh(lWingData, flapLNames, wingMat, ([x, y, z]) => {
    return [-(z - 5.62), y - (-0.19), x - 0.68];
  });
  if (flapLMesh) flapLPivot.add(flapLMesh);
  ctrlGroup.add(flapLPivot);

  // Right Flaps (Pivot at x=5.62, y=-0.19, z=0.68)
  const flapRPivot = new THREE.Group();
  flapRPivot.name = 'Flap_R';
  flapRPivot.position.set(5.62, -0.19, 0.68);
  const flapRNames = ['rhflapI/B', 'rhaftflapI/B', 'rhflapO/B', 'rhaftflapO/B', 'flap3', 'flap4'];
  const flapRMesh = mergeObjectsMesh(rWingData, flapRNames, wingMat, ([x, y, z]) => {
    return [-(z - (-5.62)), y - (-0.19), x - 0.68];
  });
  if (flapRMesh) flapRPivot.add(flapRMesh);
  ctrlGroup.add(flapRPivot);

  // Left Spoilers (Pivot at x=-7.63, y=0.19, z=1.26)
  const spLPivot = new THREE.Group();
  spLPivot.name = 'Spoilers_L';
  spLPivot.position.set(-7.63, 0.19, 1.26);
  const spLNames = ['spoiler1', 'spoiler2', 'spoiler3', 'spoiler4', 'spoiler5', 'spoiler6'];
  const spLMesh = mergeObjectsMesh(lWingData, spLNames, wingMat, ([x, y, z]) => {
    return [-(z - 7.63), y - 0.19, x - 1.26];
  });
  if (spLMesh) spLPivot.add(spLMesh);
  ctrlGroup.add(spLPivot);

  // Right Spoilers (Pivot at x=7.63, y=0.19, z=1.26)
  const spRPivot = new THREE.Group();
  spRPivot.name = 'Spoilers_R';
  spRPivot.position.set(7.63, 0.19, 1.26);
  const spRNames = ['spoiler7', 'spoiler8', 'spoiler9', 'spoiler10', 'spoiler11', 'spoiler12'];
  const spRMesh = mergeObjectsMesh(rWingData, spRNames, wingMat, ([x, y, z]) => {
    return [-(z - (-7.63)), y - 0.19, x - 1.26];
  });
  if (spRMesh) spRPivot.add(spRMesh);
  ctrlGroup.add(spRPivot);

  // Left Elevator (Pivot at x=-0.36, y=1.64, z=17.13)
  const elevLPivot = new THREE.Group();
  elevLPivot.name = 'Elevator_L';
  elevLPivot.position.set(-0.36, 1.64, 17.13);
  const elevLMesh = mergeObjectsMesh(hStabData, ['lhelevator', 'lhelevatortab'], wingMat, ([x, y, z]) => {
    return [-(z - 0.36), y - 1.64, x - 17.13];
  });
  if (elevLMesh) elevLPivot.add(elevLMesh);
  ctrlGroup.add(elevLPivot);

  // Right Elevator (Pivot at x=0.36, y=1.64, z=17.13)
  const elevRPivot = new THREE.Group();
  elevRPivot.name = 'Elevator_R';
  elevRPivot.position.set(0.36, 1.64, 17.13);
  const elevRMesh = mergeObjectsMesh(hStabData, ['rhelevator', 'rhelevatortab'], wingMat, ([x, y, z]) => {
    return [-(z - (-0.36)), y - 1.64, x - 17.13];
  });
  if (elevRMesh) elevRPivot.add(elevRMesh);
  ctrlGroup.add(elevRPivot);

  // Rudder (Pivot at x=0, y=2.2, z=16.20)
  const rudderPivot = new THREE.Group();
  rudderPivot.name = 'Rudder';
  rudderPivot.position.set(0, 2.2, 16.20);
  const rudderMesh = mergeObjectsMesh(vStabData, ['rudder', 'rudder.001'], fuselageMat, ([x, y, z]) => {
    return [-z, y - 2.2, x - 16.20];
  });
  if (rudderMesh) rudderPivot.add(rudderMesh);
  ctrlGroup.add(rudderPivot);

  root.add(ctrlGroup);

  // -------------------------------------------------------------
  // 4. ARTICULATED LANDING GEAR
  // -------------------------------------------------------------
  function buildLandingGearTree() {
    const gearRoot = new THREE.Group();
    gearRoot.name = 'B737_LandingGear';

    // NOSE GEAR
    const noseRoot = new THREE.Group();
    noseRoot.name = 'NoseGear';
    noseRoot.position.set(0, -0.85, -12.5);

    const noseStrutUpper = new THREE.Group();
    noseStrutUpper.name = 'NoseStrutUpper';
    const nOuter = createMeshFromAC(noseData['nouterstrut'], strutMat, ([x, y, z]) => [-z, (y - (-1.23)) * 0.9 - 0.2, (x - (-15.5)) * 0.8]);
    const nCollar = createMeshFromAC(noseData['collar'], strutMat, ([x, y, z]) => [-z, (y - (-1.80)) * 0.9 - 0.7, (x - (-15.5)) * 0.8]);
    const nSteerL = createMeshFromAC(noseData['lhsteercyl'], strutMat, ([x, y, z]) => [-z, (y - (-1.80)) * 0.9 - 0.7, (x - (-15.5)) * 0.8]);
    const nSteerR = createMeshFromAC(noseData['rhsteercyl'], strutMat, ([x, y, z]) => [-z, (y - (-1.80)) * 0.9 - 0.7, (x - (-15.5)) * 0.8]);
    if (nOuter) noseStrutUpper.add(nOuter);
    if (nCollar) noseStrutUpper.add(nCollar);
    if (nSteerL) noseStrutUpper.add(nSteerL);
    if (nSteerR) noseStrutUpper.add(nSteerR);
    noseRoot.add(noseStrutUpper);

    const noseTruck = new THREE.Group();
    noseTruck.name = 'NoseTruck';
    noseTruck.position.set(0, 0, 0);

    const nLower = createMeshFromAC(noseData['nlowerstrut'], chromePistonMat, ([x, y, z]) => [-z, (y - (-2.485)) * 1.48 - 2.42, (x - (-15.5)) * 0.8]);
    if (nLower) noseTruck.add(nLower);

    const noseWheelGroup = new THREE.Group();
    noseWheelGroup.name = 'NoseWheelGroup';
    noseWheelGroup.position.set(0, -2.42, 0);

    const nTireL = createMeshFromAC(noseData['ngtyrelh'], tireMat, ([x, y, z]) => [-(z - 0.24) - 0.28, (y - (-2.485)) * 0.95, (x - (-15.5)) * 0.95]);
    const nTireR = createMeshFromAC(noseData['ngtyrerh'], tireMat, ([x, y, z]) => [-(z - (-0.24)) + 0.28, (y - (-2.485)) * 0.95, (x - (-15.5)) * 0.95]);
    const nRimL = createMeshFromAC(noseData['ngrimlh'], rimMat, ([x, y, z]) => [-(z - 0.24) - 0.28, (y - (-2.485)) * 0.95, (x - (-15.5)) * 0.95]);
    const nRimR = createMeshFromAC(noseData['ngrimrh'], rimMat, ([x, y, z]) => [-(z - (-0.24)) + 0.28, (y - (-2.485)) * 0.95, (x - (-15.5)) * 0.95]);
    const nAxle = createMeshFromAC(noseData['noseaxle'], strutMat, ([x, y, z]) => [-z, (y - (-2.485)) * 0.95, (x - (-15.5)) * 0.95]);
    if (nTireL) noseWheelGroup.add(nTireL);
    if (nTireR) noseWheelGroup.add(nTireR);
    if (nRimL) noseWheelGroup.add(nRimL);
    if (nRimR) noseWheelGroup.add(nRimR);
    if (nAxle) noseWheelGroup.add(nAxle);
    noseTruck.add(noseWheelGroup);

    const nLinkUp = createMeshFromAC(noseData['nlinkupper'], strutMat, ([x, y, z]) => [-z, (y - (-1.97)) * 0.8 - 1.55, (x - (-15.26)) * 0.8 - 0.12]);
    const nLinkLow = createMeshFromAC(noseData['nlinklower'], strutMat, ([x, y, z]) => [-z, (y - (-2.32)) * 0.8 - 1.95, (x - (-15.26)) * 0.8 - 0.12]);
    if (nLinkUp) { nLinkUp.name = 'NoseScissorsUpper'; noseTruck.add(nLinkUp); }
    if (nLinkLow) { nLinkLow.name = 'NoseScissorsLower'; noseTruck.add(nLinkLow); }
    noseRoot.add(noseTruck);

    const noseDoorL = new THREE.Group();
    noseDoorL.name = 'NoseDoorL';
    noseDoorL.position.set(-0.48, -1.03, 0.0);
    const nDoorLMesh = createMeshFromAC(noseData['lhngdoor'], doorExtMat, ([x, y, z]) => [-(z - 0.48), y - (-1.09), (x - (-16.55)) * 0.8]);
    if (nDoorLMesh) noseDoorL.add(nDoorLMesh);

    const noseDoorR = new THREE.Group();
    noseDoorR.name = 'NoseDoorR';
    noseDoorR.position.set(0.48, -1.03, 0.0);
    const nDoorRMesh = createMeshFromAC(noseData['rhngdoor'], doorExtMat, ([x, y, z]) => [-(z - (-0.48)), y - (-1.09), (x - (-16.55)) * 0.8]);
    if (nDoorRMesh) noseDoorR.add(nDoorRMesh);
    noseRoot.add(noseDoorL, noseDoorR);

    gearRoot.add(noseRoot);

    // MAIN GEAR
    function makeMainGear(isLeft) {
      const sideSign = isLeft ? -1 : 1;
      const gearData = isLeft ? lWingData : rWingData;
      const xPos = sideSign * 3.2;

      const mainRoot = new THREE.Group();
      mainRoot.name = isLeft ? 'MainGearL' : 'MainGearR';
      mainRoot.position.set(xPos, -0.9, 1.8);

      const mainStrutUpper = new THREE.Group();
      mainStrutUpper.name = isLeft ? 'MainStrutUpperL' : 'MainStrutUpperR';

      const outerStrutName = isLeft ? 'mgouterstrut' : 'mgrhouterstrut';
      const sideLName = isLeft ? 'sidestrutl' : 'rhsidestrutl';
      const sideUName = isLeft ? 'sidestrutu' : 'rhsidestrutu';
      const dragName = isLeft ? 'lhdragstrut' : 'rhdragstrut';

      const xFn = (z) => sideSign * (-(z - (isLeft ? 2.88 : -2.88)));

      const mOuterMesh = createMeshFromAC(gearData[outerStrutName], strutMat, ([x, y, z]) => {
        return [xFn(z), (y - (-0.60)) * 0.95 - 0.2, (x - 0.30) * 0.85];
      });
      const mSideL = createMeshFromAC(gearData[sideLName], strutMat, ([x, y, z]) => {
        return [xFn(z), (y - (-1.09)) * 0.95 - 0.7, (x - 0.43) * 0.85];
      });
      const mSideU = createMeshFromAC(gearData[sideUName], strutMat, ([x, y, z]) => {
        return [xFn(z), (y - (-0.59)) * 0.95 - 0.2, (x - 0.43) * 0.85];
      });
      const mDrag = createMeshFromAC(gearData[dragName], strutMat, ([x, y, z]) => {
        return [xFn(z), (y - (-0.85)) * 0.95 - 0.5, (x - 0.03) * 0.85];
      });

      if (mOuterMesh) mainStrutUpper.add(mOuterMesh);
      if (mSideL) mainStrutUpper.add(mSideL);
      if (mSideU) mainStrutUpper.add(mSideU);
      if (mDrag) mainStrutUpper.add(mDrag);
      mainRoot.add(mainStrutUpper);

      const mainTruck = new THREE.Group();
      mainTruck.name = isLeft ? 'MainTruckL' : 'MainTruckR';

      // Oleo piston
      const mPiston = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 1.5, 16), chromePistonMat);
      mPiston.position.set(0, -1.65, 0);
      mPiston.name = isLeft ? 'MainPistonL' : 'MainPistonR';
      mainTruck.add(mPiston);

      const wheelGroupName = isLeft ? 'MainWheelGroupL' : 'MainWheelGroupR';
      const mainWheelGroup = new THREE.Group();
      mainWheelGroup.name = wheelGroupName;
      mainWheelGroup.position.set(0, -2.40, 0);

      const tireLName = isLeft ? 'mglhtyrelh' : 'mgrhtyrelh';
      const tireRName = isLeft ? 'mglhtyrerh' : 'mgrhtyrerh';
      const rimLName = isLeft ? 'mglhrimlh' : 'mgrhrimlh';
      const rimRName = isLeft ? 'mglhrimrh' : 'mgrhrimrh';
      const axleName = isLeft ? 'mglhaxle' : 'mgrhaxle';

      const mTireL = createMeshFromAC(gearData[tireLName], tireMat, ([x, y, z]) => {
        return [-(z - (isLeft ? 2.88 : -2.88)), y - (-2.50), (x - 0.30) * 0.85];
      });
      const mTireR = createMeshFromAC(gearData[tireRName], tireMat, ([x, y, z]) => {
        return [-(z - (isLeft ? 2.88 : -2.88)), y - (-2.50), (x - 0.30) * 0.85];
      });
      const mRimL = createMeshFromAC(gearData[rimLName], rimMat, ([x, y, z]) => {
        return [-(z - (isLeft ? 2.88 : -2.88)), y - (-2.50), (x - 0.30) * 0.85];
      });
      const mRimR = createMeshFromAC(gearData[rimRName], rimMat, ([x, y, z]) => {
        return [-(z - (isLeft ? 2.88 : -2.88)), y - (-2.50), (x - 0.30) * 0.85];
      });
      const mAxle = createMeshFromAC(gearData[axleName], strutMat, ([x, y, z]) => {
        return [-(z - (isLeft ? 2.88 : -2.88)), y - (-2.50), (x - 0.30) * 0.85];
      });

      const brakeLGeo = new THREE.CylinderGeometry(0.30, 0.30, 0.08, 16);
      brakeLGeo.rotateZ(Math.PI * 0.5);
      const mBrakeL = new THREE.Mesh(brakeLGeo, brakeMat);
      mBrakeL.position.set(-0.18, 0, 0);

      const brakeRGeo = new THREE.CylinderGeometry(0.30, 0.30, 0.08, 16);
      brakeRGeo.rotateZ(Math.PI * 0.5);
      const mBrakeR = new THREE.Mesh(brakeRGeo, brakeMat);
      mBrakeR.position.set(0.18, 0, 0);

      if (mTireL) mainWheelGroup.add(mTireL);
      if (mTireR) mainWheelGroup.add(mTireR);
      if (mRimL) mainWheelGroup.add(mRimL);
      if (mRimR) mainWheelGroup.add(mRimR);
      if (mAxle) mainWheelGroup.add(mAxle);
      mainWheelGroup.add(mBrakeL, mBrakeR);
      mainTruck.add(mainWheelGroup);

      const upLinkName = isLeft ? 'mglhlinkupper' : 'mgrhlinkupper';
      const lowLinkName = isLeft ? 'mglhlinklower' : 'mgrhlinklower';
      const mLinkUp = createMeshFromAC(gearData[upLinkName], strutMat, ([x, y, z]) => {
        return [xFn(z), (y - (-2.05)) * 0.85 - 1.55, (x - 0.04) * 0.85 - 0.15];
      });
      const mLinkLow = createMeshFromAC(gearData[lowLinkName], strutMat, ([x, y, z]) => {
        return [xFn(z), (y - (-2.33)) * 0.85 - 1.95, (x - 0.04) * 0.85 - 0.15];
      });
      if (mLinkUp) { mLinkUp.name = isLeft ? 'MainScissorsUpperL' : 'MainScissorsUpperR'; mainTruck.add(mLinkUp); }
      if (mLinkLow) { mLinkLow.name = isLeft ? 'MainScissorsLowerL' : 'MainScissorsLowerR'; mainTruck.add(mLinkLow); }
      mainRoot.add(mainTruck);

      const doorName = isLeft ? 'MainDoorL' : 'MainDoorR';
      const mainDoor = new THREE.Group();
      mainDoor.name = doorName;
      mainDoor.position.set(-sideSign * 1.0, -0.95, 0.0);

      const doorMeshName = isLeft ? 'geardoor' : 'geardoorrh';
      const mDoorMesh = createMeshFromAC(gearData[doorMeshName], doorExtMat, ([x, y, z]) => {
        return [xFn(z), (y - (-1.0)) * 0.9, (x - 0.15) * 0.85];
      });
      if (mDoorMesh) mainDoor.add(mDoorMesh);
      mainRoot.add(mainDoor);

      return mainRoot;
    }

    const mainGearL = makeMainGear(true);
    const mainGearR = makeMainGear(false);
    gearRoot.add(mainGearL, mainGearR);

    return gearRoot;
  }

  const landingGearTree = buildLandingGearTree();
  root.add(landingGearTree);

  // -------------------------------------------------------------
  // EXPORT GLB FILES
  // -------------------------------------------------------------
  const exporter = new GLTFExporter();

  console.log('Exporting full articulated aircraft GLB...');
  await new Promise((resolve, reject) => {
    exporter.parse(
      root,
      (glb) => {
        fs.writeFileSync(OUTPUT_FULL_GLB, Buffer.from(glb));
        console.log(`Saved ${OUTPUT_FULL_GLB} (${(glb.byteLength / 1024).toFixed(1)} KB)`);
        resolve();
      },
      reject,
      { binary: true }
    );
  });

  console.log('Exporting standalone landing gear GLB...');
  // Clone landing gear tree for standalone export
  const standaloneGear = buildLandingGearTree();
  await new Promise((resolve, reject) => {
    exporter.parse(
      standaloneGear,
      (glb) => {
        fs.writeFileSync(OUTPUT_GEAR_GLB, Buffer.from(glb));
        console.log(`Saved ${OUTPUT_GEAR_GLB} (${(glb.byteLength / 1024).toFixed(1)} KB)`);
        resolve();
      },
      reject,
      { binary: true }
    );
  });

  console.log('Done!');
}

buildFullModel().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
