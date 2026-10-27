import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ATLAS_SIZE = 256;

/**
 * Procedural Synthwave Texture Atlas
 * Generates dark metallic facade textures with vibrant neon-lit window strips
 * (Cyan, Magenta, Amber, Purple) entirely via Uint8Array DataTextures
 * so it runs deterministically in both Node.js tests and browser WebGL.
 */
function createNeonAtlas() {
  const colorData = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
  const emissiveData = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);

  const neonColors = [
    [0, 240, 255],   // Electric Cyan
    [255, 0, 128],   // Hot Magenta / Neon Pink
    [255, 184, 0],   // Warm Amber / Sun Gold
    [185, 45, 255],  // Electric Purple
  ];

  for (let y = 0; y < ATLAS_SIZE; y++) {
    for (let x = 0; x < ATLAS_SIZE; x++) {
      const idx = (y * ATLAS_SIZE + x) * 4;
      const quadX = Math.floor(x / (ATLAS_SIZE / 2));
      const quadY = Math.floor(y / (ATLAS_SIZE / 2));
      const colorScheme = (quadX + quadY * 2) % neonColors.length;

      // Window grid pattern
      const winX = x % 16;
      const winY = y % 24;
      const isWindow = (winX >= 3 && winX <= 12) && (winY >= 4 && winY <= 18);
      const isLedge = winY === 19;

      if (isWindow) {
        // High percentage of glowing neon windows
        const lit = ((Math.floor(x / 16) * 13 + Math.floor(y / 24) * 7) % 7) < 5;
        if (lit) {
          const [r, g, b] = neonColors[colorScheme];
          colorData[idx] = r;
          colorData[idx + 1] = g;
          colorData[idx + 2] = b;
          colorData[idx + 3] = 255;

          emissiveData[idx] = r;
          emissiveData[idx + 1] = g;
          emissiveData[idx + 2] = b;
          emissiveData[idx + 3] = 255;
        } else {
          // Unlit dark tint
          colorData[idx] = 18;
          colorData[idx + 1] = 22;
          colorData[idx + 2] = 34;
          colorData[idx + 3] = 255;
        }
      } else if (isLedge) {
        // Faint neon trim under window bands
        const [r, g, b] = neonColors[colorScheme];
        colorData[idx] = Math.floor(r * 0.4);
        colorData[idx + 1] = Math.floor(g * 0.4);
        colorData[idx + 2] = Math.floor(b * 0.4);
        colorData[idx + 3] = 255;
      } else {
        // Dark metallic obsidian wall
        colorData[idx] = 14;
        colorData[idx + 1] = 16;
        colorData[idx + 2] = 24;
        colorData[idx + 3] = 255;
      }
    }
  }

  const map = new THREE.DataTexture(colorData, ATLAS_SIZE, ATLAS_SIZE, THREE.RGBAFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.needsUpdate = true;

  const emissiveMap = new THREE.DataTexture(emissiveData, ATLAS_SIZE, ATLAS_SIZE, THREE.RGBAFormat);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.wrapS = THREE.RepeatWrapping;
  emissiveMap.wrapT = THREE.RepeatWrapping;
  emissiveMap.needsUpdate = true;

  return { map, emissiveMap };
}

/**
 * Procedural Retro Synthwave Sun Texture
 * Creates the iconic giant sun with a fiery yellow-orange-magenta vertical gradient
 * and horizontal retro grill slits across the lower half.
 */
function createRetroSunTexture() {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  const center = size / 2;
  const radius = 118;

  for (let y = 0; y < size; y++) {
    const dy = y - center;
    const normY = y / size; // 0 (top) to 1 (bottom)

    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dist = Math.hypot(dx, dy);
      const idx = (y * size + x) * 4;

      if (dist <= radius) {
        // Horizontal synthwave grill bars: cut out horizontal slits in the lower half
        let inSlit = false;
        if (normY > 0.48) {
          const slicePos = (normY - 0.48) / 0.52; // 0 to 1
          const barIndex = Math.floor(slicePos * 12);
          const barFrac = (slicePos * 12) - barIndex;
          // Gaps widen towards the bottom
          const slitWidth = 0.22 + barIndex * 0.045;
          if (barFrac < slitWidth) {
            inSlit = true;
          }
        }

        if (inSlit) {
          data[idx + 3] = 0;
        } else {
          // Color gradient: Top bright golden yellow -> mid fiery orange -> bottom hot magenta
          let r, g, b;
          if (normY < 0.45) {
            const t = normY / 0.45;
            r = 255;
            g = Math.floor(245 * (1 - t) + 160 * t);
            b = Math.floor(70 * (1 - t) + 15 * t);
          } else {
            const t = (normY - 0.45) / 0.55;
            r = 255;
            g = Math.floor(160 * (1 - t) + 20 * t);
            b = Math.floor(15 * (1 - t) + 140 * t);
          }

          // Edge antialiasing / subtle rim glow
          const edgeFade = THREE.MathUtils.clamp((radius - dist) / 2.5, 0, 1);
          data[idx] = r;
          data[idx + 1] = g;
          data[idx + 2] = b;
          data[idx + 3] = Math.floor(255 * edgeFade);
        }
      } else {
        data[idx + 3] = 0;
      }
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * NeonCity: A sprawling 80s Synthwave / Outrun Metropolis designed for
 * thrilling Cessna low-altitude canyon flight between massive glowing skyscrapers.
 */
export class NeonCity {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'neon-metropolis';
    this.elevation = 0.0;
    this.buildingData = [];
    this.strobes = [];

    // Terrain interface required by Flight3d engine
    this.terrain = {
      mesh: this.group,
      isLoaded: true,
      getHeight: (x, z) => this.getHeight(x, z),
      getNormal: (x, z) => this.getNormal(x, z),
    };

    // Airport interface required by Flight3d engine
    this.airport = {
      group: this.group,
      elevation: this.elevation,
      isOnRunway: (x, z) => this.isOnRunway(x, z),
      isRunwaySafetyArea: (x, z) => this.isRunwaySafetyArea(x, z),
      controlTowerData: { x: 300, y: 0, z: 220, radius: 16, height: 260 },
      update: (dt, pos, time) => this.update(dt, pos, time),
    };

    this.initGroundAndRoads();
    this.initStreetLightingAndGantries();
    this.initSkyscrapers();
    this.initRetroSun();
  }

  getHeight(x, z) {
    return 0.0;
  }

  getNormal(x, z) {
    return new THREE.Vector3(0, 1, 0);
  }

  isOnRunway(x, z) {
    // 60m wide, 4200m long runway/highway along X (-2400 to +1800)
    return x >= -2400 && x <= 1800 && Math.abs(z) <= 30;
  }

  isRunwaySafetyArea(x, z) {
    return x >= -2500 && x <= 1900 && Math.abs(z) <= 50;
  }

  initGroundAndRoads() {
    // 1. Sprawling dark reflective ground grid
    const groundGeo = new THREE.PlaneGeometry(24000, 24000, 1, 1);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x0a0c14,
      roughness: 0.35,
      metalness: 0.6,
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.name = 'neon-ground';
    groundMesh.receiveShadow = true;
    this.group.add(groundMesh);

    // 2. Neon Highway / Runway (aligned with X axis, width 60m, length 4200m)
    const roadGeo = new THREE.PlaneGeometry(4200, 60);
    roadGeo.rotateX(-Math.PI / 2);
    roadGeo.translate(-300, 0.04, 0);
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x141824,
      roughness: 0.25,
      metalness: 0.5,
    });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    this.group.add(roadMesh);

    // 3. Glowing neon road borders (Magenta) & centerline dashes (Cyan)
    const roadMarkings = [];

    // Left & Right Glowing Road Edge Strips (Magenta)
    const edgeL = new THREE.PlaneGeometry(4200, 1.2);
    edgeL.rotateX(-Math.PI / 2);
    edgeL.translate(-300, 0.08, -28.5);
    roadMarkings.push(edgeL);

    const edgeR = new THREE.PlaneGeometry(4200, 1.2);
    edgeR.rotateX(-Math.PI / 2);
    edgeR.translate(-300, 0.08, 28.5);
    roadMarkings.push(edgeR);

    // Merged neon magenta strips
    const edgeMesh = new THREE.Mesh(
      mergeGeometries(roadMarkings),
      new THREE.MeshBasicMaterial({ color: 0xff0088 })
    );
    this.group.add(edgeMesh);

    // Centerline dashes (Cyan)
    const dashes = [];
    for (let x = -2350; x <= 1750; x += 50) {
      const dash = new THREE.PlaneGeometry(28, 1.5);
      dash.rotateX(-Math.PI / 2);
      dash.translate(x, 0.09, 0);
      dashes.push(dash);
    }
    const dashMesh = new THREE.Mesh(
      mergeGeometries(dashes),
      new THREE.MeshBasicMaterial({ color: 0x00f5ff })
    );
    this.group.add(dashMesh);

    // Runway threshold marker bars
    const thresholds = [];
    for (let z = -22; z <= 22; z += 5) {
      const bar = new THREE.PlaneGeometry(40, 2.2);
      bar.rotateX(-Math.PI / 2);
      bar.translate(-2370, 0.1, z);
      thresholds.push(bar);
    }
    const threshMesh = new THREE.Mesh(
      mergeGeometries(thresholds),
      new THREE.MeshBasicMaterial({ color: 0x00f5ff })
    );
    this.group.add(threshMesh);
  }

  initStreetLightingAndGantries() {
    // Overhead highway gantries spanning across the avenue (inspired by the reference photo)
    const gantryPositions = [-1200, -400, 400, 1200, 2000, 2800];
    const gantryParts = [];

    for (const gx of gantryPositions) {
      // Horizontal truss
      const beam = new THREE.BoxGeometry(2.5, 3.5, 68);
      beam.translate(gx, 18, 0);
      gantryParts.push(beam);

      // Support legs on both sides
      const legL = new THREE.BoxGeometry(2.5, 18, 2.5);
      legL.translate(gx, 9, -32);
      gantryParts.push(legL);

      const legR = new THREE.BoxGeometry(2.5, 18, 2.5);
      legR.translate(gx, 9, 32);
      gantryParts.push(legR);

      // 3 Overhead rectangular traffic signs
      for (const sz of [-18, 0, 18]) {
        const sign = new THREE.BoxGeometry(0.8, 5, 14);
        sign.translate(gx - 1.5, 18, sz);
        gantryParts.push(sign);
      }
    }

    const gantryMesh = new THREE.Mesh(
      mergeGeometries(gantryParts),
      new THREE.MeshStandardMaterial({ color: 0x181a20, metalness: 0.8, roughness: 0.3 })
    );
    gantryMesh.castShadow = true;
    this.group.add(gantryMesh);

    // Streetlights along both sides of the main canyon avenue (Warm golden/yellow)
    const lightPosts = [];
    const lightHeads = [];

    for (let x = -2000; x <= 3200; x += 120) {
      for (const z of [-34, 34]) {
        const post = new THREE.CylinderGeometry(0.5, 0.7, 16, 6);
        post.translate(x, 8, z);
        lightPosts.push(post);

        const head = new THREE.SphereGeometry(1.6, 8, 8);
        head.translate(x, 16, z);
        lightHeads.push(head);
      }
    }

    const postMesh = new THREE.Mesh(
      mergeGeometries(lightPosts),
      new THREE.MeshStandardMaterial({ color: 0x222630, metalness: 0.7, roughness: 0.4 })
    );
    this.group.add(postMesh);

    const headMesh = new THREE.Mesh(
      mergeGeometries(lightHeads),
      new THREE.MeshBasicMaterial({ color: 0xffd060 })
    );
    this.group.add(headMesh);
  }

  /**
   * Generates towering skyscrapers with synthwave facade materials and
   * wide urban flight canyons tailored for high-speed Cessna slalom runs.
   */
  initSkyscrapers() {
    const atlas = createNeonAtlas();
    const facadeMat = new THREE.MeshStandardMaterial({
      map: atlas.map,
      emissiveMap: atlas.emissiveMap,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 1.6,
      roughness: 0.25,
      metalness: 0.75,
    });

    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x12151e,
      roughness: 0.8,
      metalness: 0.3,
    });

    const beaconGeo = new THREE.SphereGeometry(2.5, 8, 8);
    this.strobeMat = new THREE.MeshBasicMaterial({ color: 0xff1030 });

    const towerGeometries = [];
    const roofGeometries = [];
    const beaconPositions = [];

    // Deterministic pseudo-random generator
    let seed = 42;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    /**
     * Urban Grid Layout:
     * - Central Avenue / Flight Canyon: Z = -90 to +90 (Width 180m!)
     *   Plentiful room for a Cessna 172 (11m wingspan) to bank 45°, dive, and weave.
     * - Tower Blocks:
     *   North: Z = 110 to 1400 (3 avenue lanes)
     *   South: Z = -110 to -1400 (3 avenue lanes)
     *   Along X: from 400 to 3800, with cross avenues every 320m (width 100m)
     */
    const xBlocks = [500, 850, 1200, 1550, 1900, 2250, 2600, 2950, 3300, 3650];
    const zBlocks = [
      -1150, -850, -550, -260, -110, // South blocks
      110, 260, 550, 850, 1150       // North blocks
    ];

    for (const bx of xBlocks) {
      for (const bz of zBlocks) {
        // Distance to central avenue (Z = 0) and city center
        const distFromCenterZ = Math.abs(bz);
        const distFromCenterX = Math.abs(bx - 2000);

        // Tower footprint
        const width = 60 + rng() * 40;
        const depth = 60 + rng() * 40;

        // Heights: Megatowers near the core, taller along the main canyon
        let height;
        if (distFromCenterZ <= 280 && distFromCenterX < 1000) {
          // Central Megatowers (320m - 460m)
          height = 320 + rng() * 140;
        } else if (distFromCenterZ <= 600) {
          // High-rise towers (220m - 340m)
          height = 220 + rng() * 120;
        } else {
          // Mid-rise perimeter skyscrapers (130m - 220m)
          height = 130 + rng() * 90;
        }

        const posX = bx + (rng() - 0.5) * 25;
        const posZ = bz + (rng() - 0.5) * 25;

        // 1. Main tower body
        const towerGeo = new THREE.BoxGeometry(width, height, depth);
        towerGeo.translate(posX, height / 2, posZ);

        // Adjust UV mapping so window repeats look crisp and consistent
        const uv = towerGeo.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
          uv.setXY(i, uv.getX(i) * (width / 24), uv.getY(i) * (height / 28));
        }
        towerGeometries.push(towerGeo);

        // 2. Rooftop equipment & spires
        const roofGeo = new THREE.BoxGeometry(width * 0.7, 8, depth * 0.7);
        roofGeo.translate(posX, height + 4, posZ);
        roofGeometries.push(roofGeo);

        // Supertall towers get needle spires on top
        if (height > 320) {
          const spireHeight = 35 + rng() * 30;
          const spire = new THREE.CylinderGeometry(0.8, 2.5, spireHeight, 8);
          spire.translate(posX, height + 8 + spireHeight / 2, posZ);
          roofGeometries.push(spire);

          // Aviation strobe on spire tip
          beaconPositions.push(new THREE.Vector3(posX, height + 8 + spireHeight, posZ));
        } else {
          beaconPositions.push(new THREE.Vector3(posX, height + 8, posZ));
        }

        // Register exact physical bounding volume for 6-DOF collision detection
        this.buildingData.push({
          x: posX,
          y: 0,
          z: posZ,
          width,
          height: height + 8,
          visualY: 0,
          depth,
          localWidth: width,
          localDepth: depth,
          rotationY: 0,
        });
      }
    }

    // Merge tower bodies into a single high-performance draw call
    const mergedTowers = mergeGeometries(towerGeometries);
    const towerMesh = new THREE.Mesh(mergedTowers, facadeMat);
    towerMesh.castShadow = true;
    towerMesh.receiveShadow = true;
    this.group.add(towerMesh);

    // Merge roofs into single draw call
    const mergedRoofs = mergeGeometries(roofGeometries);
    const roofMesh = new THREE.Mesh(mergedRoofs, roofMat);
    roofMesh.castShadow = true;
    roofMesh.receiveShadow = true;
    this.group.add(roofMesh);

    // Instanced flashing aviation warning beacons on skyscraper rooftops
    this.strobeMesh = new THREE.InstancedMesh(beaconGeo, this.strobeMat, beaconPositions.length);
    const dummy = new THREE.Object3D();
    beaconPositions.forEach((pos, i) => {
      dummy.position.copy(pos);
      dummy.updateMatrix();
      this.strobeMesh.setMatrixAt(i, dummy.matrix);
    });
    this.strobeMesh.instanceMatrix.needsUpdate = true;
    this.group.add(this.strobeMesh);
  }

  /**
   * Iconic Giant Retro Synthwave Sun positioned right on the horizon
   * straight down the runway/avenue axis (looking towards +X).
   */
  initRetroSun() {
    const sunTexture = createRetroSunTexture();
    const sunGeo = new THREE.CircleGeometry(850, 48);
    const sunMat = new THREE.MeshBasicMaterial({
      map: sunTexture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    sunMesh.name = 'retro-synthwave-sun';
    // Positioned at X = 7200, Y = 320, Z = 0 facing towards the incoming aircraft (-X)
    sunMesh.position.set(7200, 320, 0);
    sunMesh.rotation.y = -Math.PI / 2;
    this.group.add(sunMesh);
  }

  update(dt, playerPos, totalTime = 0) {
    // Pulse the rooftop aviation red warning strobes (1.2 Hz flash)
    if (this.strobeMat) {
      const flash = (totalTime * 3.5) % 1.0 > 0.65;
      this.strobeMat.color.setHex(flash ? 0xff1030 : 0x330005);
    }
  }
}
