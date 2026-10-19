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
const OUTPUT_FILE = path.resolve(process.cwd(), 'public/models/b737-landing-gear.glb');

async function ensureSources() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const sources = [
    { name: 'nosegear.ac', url: 'https://raw.githubusercontent.com/soitanen/737-800/master/Models/nosegear.ac' },
    { name: 'LWing.ac', url: 'https://raw.githubusercontent.com/soitanen/737-800/master/Models/LWing.ac' },
    { name: 'RWing.ac', url: 'https://raw.githubusercontent.com/soitanen/737-800/master/Models/RWing.ac' }
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

  const mesh = new THREE.Mesh(geom, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

async function buildLandingGearModel() {
  await ensureSources();

  const noseData = parseAC3D(path.join(CACHE_DIR, 'nosegear.ac'));
  const lWingData = parseAC3D(path.join(CACHE_DIR, 'LWing.ac'));
  const rWingData = parseAC3D(path.join(CACHE_DIR, 'RWing.ac'));

  // Realistic PBR Materials
  const strutMat = new THREE.MeshStandardMaterial({
    color: 0x98a2ad,
    metalness: 0.7,
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

  const doorIntMat = new THREE.MeshStandardMaterial({
    color: 0x7c858f,
    roughness: 0.6,
    metalness: 0.3,
    name: 'LandingGear_DoorInterior'
  });

  const brakeMat = new THREE.MeshStandardMaterial({
    color: 0x2b2e34,
    metalness: 0.85,
    roughness: 0.5,
    name: 'LandingGear_BrakeCarbon'
  });

  const root = new THREE.Group();
  root.name = 'B737_LandingGear';

  // -------------------------------------------------------------
  // 1. NOSE GEAR ASSEMBLY
  // Target root position: (0, -0.85, -12.5)
  // Target uncompressed wheel hub position in truck: (0, -2.42, 0)
  // -------------------------------------------------------------
  const noseRoot = new THREE.Group();
  noseRoot.name = 'NoseGear';
  noseRoot.position.set(0, -0.85, -12.5);

  // Original FlightGear nose gear axle: x = -15.5, y = -2.485, z = 0
  // Mapping FG (x, y, z) to Three local (rel to noseRoot):
  // X_three = -z_fg
  // Y_three = (y_fg - (-2.485)) * scaleY + (-2.42)
  // Z_three = x_fg - (-15.5)
  const noseScaleY = 2.42 / 1.635; // Scale height from strut top (-1.23) to axle (-2.485)
  const noseTopY = -0.75;

  // Upper Strut (Stationary housing + steering)
  const noseStrutUpper = new THREE.Group();
  noseStrutUpper.name = 'NoseStrutUpper';
  const noseOuterMesh = createMeshFromAC(noseData['nouterstrut'], strutMat, ([x, y, z]) => {
    return [-z, (y - (-1.23)) * 0.9 - 0.2, (x - (-15.5)) * 0.8];
  });
  const noseCollarMesh = createMeshFromAC(noseData['collar'], strutMat, ([x, y, z]) => {
    return [-z, (y - (-1.80)) * 0.9 - 0.7, (x - (-15.5)) * 0.8];
  });
  const noseSteerL = createMeshFromAC(noseData['lhsteercyl'], strutMat, ([x, y, z]) => {
    return [-z, (y - (-1.80)) * 0.9 - 0.7, (x - (-15.5)) * 0.8];
  });
  const noseSteerR = createMeshFromAC(noseData['rhsteercyl'], strutMat, ([x, y, z]) => {
    return [-z, (y - (-1.80)) * 0.9 - 0.7, (x - (-15.5)) * 0.8];
  });
  if (noseOuterMesh) noseStrutUpper.add(noseOuterMesh);
  if (noseCollarMesh) noseStrutUpper.add(noseCollarMesh);
  if (noseSteerL) noseStrutUpper.add(noseSteerL);
  if (noseSteerR) noseStrutUpper.add(noseSteerR);
  noseRoot.add(noseStrutUpper);

  // Movable Nose Truck (Sliding oleo piston + wheel group)
  const noseTruck = new THREE.Group();
  noseTruck.name = 'NoseTruck';

  // Oleo chrome piston cylinder
  const nPistonMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 1.5, 16), chromePistonMat);
  nPistonMesh.position.set(0, -1.65, 0);
  nPistonMesh.name = 'NosePiston';
  noseTruck.add(nPistonMesh);

  // Wheel assembly group at y = -2.42 (CRITICAL CONTRACT for physics test!)
  const noseWheelGroup = new THREE.Group();
  noseWheelGroup.name = 'NoseWheelGroup';
  noseWheelGroup.position.set(0, -2.42, 0);

  // Parse nose tires and rims
  const nTireL = createMeshFromAC(noseData['ngtyrelh'], tireMat, ([x, y, z]) => {
    return [-z, y - (-2.485), (x - (-15.5)) * 0.8];
  });
  const nTireR = createMeshFromAC(noseData['ngtyrerh'], tireMat, ([x, y, z]) => {
    return [-z, y - (-2.485), (x - (-15.5)) * 0.8];
  });
  const nRimL = createMeshFromAC(noseData['ngrimlh'], rimMat, ([x, y, z]) => {
    return [-z, y - (-2.485), (x - (-15.5)) * 0.8];
  });
  const nRimR = createMeshFromAC(noseData['ngrimrh'], rimMat, ([x, y, z]) => {
    return [-z, y - (-2.485), (x - (-15.5)) * 0.8];
  });
  const nAxle = createMeshFromAC(noseData['noseaxle'], strutMat, ([x, y, z]) => {
    return [-z, y - (-2.485), (x - (-15.5)) * 0.8];
  });

  if (nTireL) noseWheelGroup.add(nTireL);
  if (nTireR) noseWheelGroup.add(nTireR);
  if (nRimL) noseWheelGroup.add(nRimL);
  if (nRimR) noseWheelGroup.add(nRimR);
  if (nAxle) noseWheelGroup.add(nAxle);
  noseTruck.add(noseWheelGroup);

  // Scissors torque links
  const nLinkUp = createMeshFromAC(noseData['nlinkupper'], strutMat, ([x, y, z]) => {
    return [-z, (y - (-1.97)) * 0.8 - 1.55, (x - (-15.26)) * 0.8 - 0.12];
  });
  const nLinkLow = createMeshFromAC(noseData['nlinklower'], strutMat, ([x, y, z]) => {
    return [-z, (y - (-2.32)) * 0.8 - 1.95, (x - (-15.26)) * 0.8 - 0.12];
  });
  if (nLinkUp) { nLinkUp.name = 'NoseScissorsUpper'; noseTruck.add(nLinkUp); }
  if (nLinkLow) { nLinkLow.name = 'NoseScissorsLower'; noseTruck.add(nLinkLow); }
  noseRoot.add(noseTruck);

  // Nose Gear Doors (Hinged at outer fuselage skin, y = -1.03 relative to noseRoot)
  const noseDoorL = new THREE.Group();
  noseDoorL.name = 'NoseDoorL';
  noseDoorL.position.set(-0.48, -1.03, 0.0);
  const nDoorLMesh = createMeshFromAC(noseData['lhngdoor'], doorExtMat, ([x, y, z]) => {
    return [-(z - 0.48), y - (-1.09), (x - (-16.55)) * 0.8];
  });
  if (nDoorLMesh) noseDoorL.add(nDoorLMesh);

  const noseDoorR = new THREE.Group();
  noseDoorR.name = 'NoseDoorR';
  noseDoorR.position.set(0.48, -1.03, 0.0);
  const nDoorRMesh = createMeshFromAC(noseData['rhngdoor'], doorExtMat, ([x, y, z]) => {
    return [-(z - (-0.48)), y - (-1.09), (x - (-16.55)) * 0.8];
  });
  if (nDoorRMesh) noseDoorR.add(nDoorRMesh);
  noseRoot.add(noseDoorL, noseDoorR);

  root.add(noseRoot);

  // -------------------------------------------------------------
  // 2. MAIN GEAR ASSEMBLY (LEFT & RIGHT)
  // Target root position: (±3.2, -0.9, 1.8)
  // Target uncompressed wheel hub position in truck: (0, -2.40, 0)
  // -------------------------------------------------------------
  function makeMainGear(isLeft) {
    const sideSign = isLeft ? -1 : 1;
    const gearData = isLeft ? lWingData : rWingData;
    const xPos = sideSign * 3.2;

    const mainRoot = new THREE.Group();
    mainRoot.name = isLeft ? 'MainGearL' : 'MainGearR';
    mainRoot.position.set(xPos, -0.9, 1.8);

    // Upper Strut Housing + side stay
    const mainStrutUpper = new THREE.Group();
    mainStrutUpper.name = isLeft ? 'MainStrutUpperL' : 'MainStrutUpperR';

    const outerStrutName = isLeft ? 'mgouterstrut' : 'mgrhouterstrut';
    const sideLName = isLeft ? 'sidestrutl' : 'rhsidestrutl';
    const sideUName = isLeft ? 'sidestrutu' : 'rhsidestrutu';
    const dragName = isLeft ? 'lhdragstrut' : 'rhdragstrut';

    // Center of main gear in FG: X=0.30, Y=-2.50, Z=±2.88
    const fgZCenter = sideSign * -2.88; // Note FG Z sign
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

    // Movable Main Truck (Sliding oleo piston + dual wheels)
    const mainTruck = new THREE.Group();
    mainTruck.name = isLeft ? 'MainTruckL' : 'MainTruckR';

    // Oleo piston
    const mPiston = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 1.5, 16), chromePistonMat);
    mPiston.position.set(0, -1.65, 0);
    mPiston.name = isLeft ? 'MainPistonL' : 'MainPistonR';
    mainTruck.add(mPiston);

    // Wheel assembly group at y = -2.40 (CRITICAL CONTRACT!)
    const mainWheelGroup = new THREE.Group();
    mainWheelGroup.name = isLeft ? 'MainWheelGroupL' : 'MainWheelGroupR';
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

    if (mTireL) mainWheelGroup.add(mTireL);
    if (mTireR) mainWheelGroup.add(mTireR);
    if (mRimL) mainWheelGroup.add(mRimL);
    if (mRimR) mainWheelGroup.add(mRimR);
    if (mAxle) mainWheelGroup.add(mAxle);

    // Carbon brake assemblies on inboard & outboard wheel hubs
    const brakeDiscGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.08, 16);
    brakeDiscGeo.rotateZ(Math.PI * 0.5);
    const brakeL = new THREE.Mesh(brakeDiscGeo, brakeMat);
    brakeL.position.set(-0.18, 0, 0);
    const brakeR = new THREE.Mesh(brakeDiscGeo, brakeMat);
    brakeR.position.set(0.18, 0, 0);
    mainWheelGroup.add(brakeL, brakeR);

    mainTruck.add(mainWheelGroup);

    // Torque scissors links
    const linkUpName = isLeft ? 'mglhlinkupper' : 'mgrhlinkupper';
    const linkLowName = isLeft ? 'mglhlinklower' : 'mgrhlinklower';
    const mLinkUp = createMeshFromAC(gearData[linkUpName], strutMat, ([x, y, z]) => {
      return [xFn(z), (y - (-2.05)) * 0.85 - 1.55, (x - 0.04) * 0.85 - 0.15];
    });
    const mLinkLow = createMeshFromAC(gearData[linkLowName], strutMat, ([x, y, z]) => {
      return [xFn(z), (y - (-2.33)) * 0.85 - 1.95, (x - 0.04) * 0.85 - 0.15];
    });
    if (mLinkUp) { mLinkUp.name = isLeft ? 'MainScissorsUpperL' : 'MainScissorsUpperR'; mainTruck.add(mLinkUp); }
    if (mLinkLow) { mLinkLow.name = isLeft ? 'MainScissorsLowerL' : 'MainScissorsLowerR'; mainTruck.add(mLinkLow); }
    mainRoot.add(mainTruck);

    // Inboard Main Gear Door (Hinged at wing root / belly keel)
    const doorName = isLeft ? 'geardoor' : 'geardoorrh';
    const mainDoor = new THREE.Group();
    mainDoor.name = isLeft ? 'MainDoorL' : 'MainDoorR';
    mainDoor.position.set(sideSign * -1.2, -0.98, 0.0);
    const mDoorMesh = createMeshFromAC(gearData[doorName], doorExtMat, ([x, y, z]) => {
      return [xFn(z), y - (-1.66), (x - 0.28) * 0.85];
    });
    if (mDoorMesh) mainDoor.add(mDoorMesh);
    mainRoot.add(mainDoor);

    return mainRoot;
  }

  const mainL = makeMainGear(true);
  const mainR = makeMainGear(false);
  root.add(mainL, mainR);

  console.log('Exporting landing gear GLB with GLTFExporter...');
  const exporter = new GLTFExporter();
  exporter.parse(
    root,
    (glb) => {
      fs.writeFileSync(OUTPUT_FILE, Buffer.from(glb));
      console.log(`Successfully built and saved: ${OUTPUT_FILE} (${glb.byteLength} bytes)`);
    },
    (err) => {
      console.error('GLTFExporter failed:', err);
      process.exit(1);
    },
    { binary: true }
  );
}

buildLandingGearModel().catch(err => {
  console.error(err);
  process.exit(1);
});
