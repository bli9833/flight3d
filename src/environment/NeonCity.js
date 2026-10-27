import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ATLAS_SIZE = 256;

/**
 * Procedural Soft Night Texture Atlas
 * Generates calm, eye-friendly facade textures with soft warm candlelight,
 * pale ice cyan, and gentle lavender window lights.
 * Designed to be easy on the eyes while capturing a dreamy lofi night skyline.
 */
function createSoftNeonAtlas() {
  const colorData = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
  const emissiveData = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);

  // Soft, soothing pastel window tones
  const softColors = [
    [245, 236, 215], // Soft warm moonlight white / pale amber
    [160, 222, 245], // Soft pale ice cyan / cool glass
    [222, 185, 245], // Soft gentle lavender rose
    [185, 238, 225], // Soft mint white
  ];

  for (let y = 0; y < ATLAS_SIZE; y++) {
    for (let x = 0; x < ATLAS_SIZE; x++) {
      const idx = (y * ATLAS_SIZE + x) * 4;
      const quadX = Math.floor(x / (ATLAS_SIZE / 2));
      const quadY = Math.floor(y / (ATLAS_SIZE / 2));
      const colorScheme = (quadX + quadY * 2) % softColors.length;

      // Clean, elegant vertical window grid pattern
      const winX = x % 16;
      const winY = y % 22;
      const isWindow = (winX >= 4 && winX <= 11) && (winY >= 4 && winY <= 16);
      const isLedge = winY === 17;

      if (isWindow) {
        // Balanced, calming window lighting (~35% lit in organized clusters)
        const lit = ((Math.floor(x / 16) * 11 + Math.floor(y / 22) * 17) % 7) < 3;
        if (lit) {
          const [r, g, b] = softColors[colorScheme];
          colorData[idx] = r;
          colorData[idx + 1] = g;
          colorData[idx + 2] = b;
          colorData[idx + 3] = 255;

          // Soft emissive glow, not blinding
          emissiveData[idx] = Math.floor(r * 0.75);
          emissiveData[idx + 1] = Math.floor(g * 0.75);
          emissiveData[idx + 2] = Math.floor(b * 0.75);
          emissiveData[idx + 3] = 255;
        } else {
          // Unlit dark tint
          colorData[idx] = 20;
          colorData[idx + 1] = 20;
          colorData[idx + 2] = 32;
          colorData[idx + 3] = 255;
        }
      } else if (isLedge) {
        // Faint subtle architectural sill
        colorData[idx] = 28;
        colorData[idx + 1] = 26;
        colorData[idx + 2] = 40;
        colorData[idx + 3] = 255;
      } else {
        // Deep midnight plum/slate wall
        colorData[idx] = 16;
        colorData[idx + 1] = 15;
        colorData[idx + 2] = 25;
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
 * Procedural Soft Dreamy Celestial Moon Texture
 * Creates a majestic full moon with a soft, soothing lunar glow and delicate cloud wisps,
 * completely replacing harsh glaring neon lines with serene night aesthetics.
 */
function createSoftMoonTexture() {
  const size = 512;
  const data = new Uint8Array(size * size * 4);
  const center = size / 2;
  const radius = 160;
  const glowRadius = 248;

  for (let y = 0; y < size; y++) {
    const dy = y - center;

    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dist = Math.hypot(dx, dy);
      const idx = (y * size + x) * 4;

      if (dist <= radius) {
        // Lunar disc: soft gradient from luminous cream center to soft lavender rim
        const t = dist / radius;
        // Subtle delicate cloud layers across the moon surface
        const cloudWisp = Math.sin(x * 0.038 + y * 0.018) * 0.07 + Math.cos(x * 0.018 - y * 0.032) * 0.05;
        const brightness = THREE.MathUtils.clamp(1.0 - t * 0.18 + cloudWisp, 0.72, 1.05);

        // Soft pastel palette: soft luminous moonlight with subtle lavender-cyan warmth
        const r = Math.min(255, Math.floor((252 * (1 - t * 0.25) + 225 * (t * 0.25)) * brightness));
        const g = Math.min(255, Math.floor((246 * (1 - t * 0.45) + 195 * (t * 0.45)) * brightness));
        const b = Math.min(255, Math.floor((255 * (1 - t * 0.12) + 248 * (t * 0.12)) * brightness));

        // Antialiased edge
        const edgeBlend = THREE.MathUtils.clamp((radius - dist) / 2.0, 0, 1);
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = Math.floor(255 * edgeBlend);
      } else if (dist <= glowRadius) {
        // Soft ethereal atmospheric moon halo
        const glowT = (dist - radius) / (glowRadius - radius);
        const falloff = Math.pow(1.0 - glowT, 2.2);

        // Soft lavender-cyan celestial aura
        data[idx] = Math.floor(225 * falloff);
        data[idx + 1] = Math.floor(185 * falloff);
        data[idx + 2] = Math.floor(255 * falloff);
        data[idx + 3] = Math.floor(150 * falloff);
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
 * NeonCity: A serene, aesthetic Synthwave / Lofi Night Metropolis designed for
 * relaxing, smooth Cessna canyon flight between elegant, illuminated skyscrapers.
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
    this.initStarfield();
  }

  getHeight(x, z) {
    return 0.0;
  }

  getNormal(x, z) {
    return new THREE.Vector3(0, 1, 0);
  }

  isOnRunway(x, z) {
    return x >= -2400 && x <= 1800 && Math.abs(z) <= 30;
  }

  isRunwaySafetyArea(x, z) {
    return x >= -2500 && x <= 1900 && Math.abs(z) <= 50;
  }

  initGroundAndRoads() {
    // 1. Sprawling dark matte ground grid
    const groundGeo = new THREE.PlaneGeometry(24000, 24000, 1, 1);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x0c0b16,
      roughness: 0.5,
      metalness: 0.3,
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.name = 'neon-ground';
    groundMesh.receiveShadow = true;
    this.group.add(groundMesh);

    // 2. Highway / Runway (aligned with X axis, width 60m, length 4200m)
    const roadGeo = new THREE.PlaneGeometry(4200, 60);
    roadGeo.rotateX(-Math.PI / 2);
    roadGeo.translate(-300, 0.04, 0);
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x141420,
      roughness: 0.45,
      metalness: 0.25,
    });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    this.group.add(roadMesh);

    // 3. Soft road borders (gentle lavender) & centerline dashes (soft cyan)
    const roadMarkings = [];

    const edgeL = new THREE.PlaneGeometry(4200, 1.0);
    edgeL.rotateX(-Math.PI / 2);
    edgeL.translate(-300, 0.08, -28.5);
    roadMarkings.push(edgeL);

    const edgeR = new THREE.PlaneGeometry(4200, 1.0);
    edgeR.rotateX(-Math.PI / 2);
    edgeR.translate(-300, 0.08, 28.5);
    roadMarkings.push(edgeR);

    // Soft lavender road edge lines
    const edgeMesh = new THREE.Mesh(
      mergeGeometries(roadMarkings),
      new THREE.MeshBasicMaterial({ color: 0x8a52ab })
    );
    this.group.add(edgeMesh);

    // Soft ice-cyan centerline dashes
    const dashes = [];
    for (let x = -2350; x <= 1750; x += 50) {
      const dash = new THREE.PlaneGeometry(28, 1.2);
      dash.rotateX(-Math.PI / 2);
      dash.translate(x, 0.09, 0);
      dashes.push(dash);
    }
    const dashMesh = new THREE.Mesh(
      mergeGeometries(dashes),
      new THREE.MeshBasicMaterial({ color: 0x58b5d4 })
    );
    this.group.add(dashMesh);

    // Runway threshold marker bars
    const thresholds = [];
    for (let z = -22; z <= 22; z += 5) {
      const bar = new THREE.PlaneGeometry(40, 1.8);
      bar.rotateX(-Math.PI / 2);
      bar.translate(-2370, 0.1, z);
      thresholds.push(bar);
    }
    const threshMesh = new THREE.Mesh(
      mergeGeometries(thresholds),
      new THREE.MeshBasicMaterial({ color: 0x60c2e0 })
    );
    this.group.add(threshMesh);
  }

  initStreetLightingAndGantries() {
    const gantryPositions = [-1200, -400, 400, 1200, 2000, 2800];
    const gantryParts = [];

    for (const gx of gantryPositions) {
      const beam = new THREE.BoxGeometry(2.5, 3.5, 68);
      beam.translate(gx, 18, 0);
      gantryParts.push(beam);

      const legL = new THREE.BoxGeometry(2.5, 18, 2.5);
      legL.translate(gx, 9, -32);
      gantryParts.push(legL);

      const legR = new THREE.BoxGeometry(2.5, 18, 2.5);
      legR.translate(gx, 9, 32);
      gantryParts.push(legR);

      for (const sz of [-18, 0, 18]) {
        const sign = new THREE.BoxGeometry(0.8, 5, 14);
        sign.translate(gx - 1.5, 18, sz);
        gantryParts.push(sign);
      }
    }

    const gantryMesh = new THREE.Mesh(
      mergeGeometries(gantryParts),
      new THREE.MeshStandardMaterial({ color: 0x181a24, metalness: 0.6, roughness: 0.5 })
    );
    gantryMesh.castShadow = true;
    this.group.add(gantryMesh);

    // Streetlights along both sides with soft warm-white lanterns
    const lightPosts = [];
    const lightHeads = [];

    for (let x = -2000; x <= 3200; x += 120) {
      for (const z of [-34, 34]) {
        const post = new THREE.CylinderGeometry(0.4, 0.6, 16, 6);
        post.translate(x, 8, z);
        lightPosts.push(post);

        const head = new THREE.SphereGeometry(1.2, 8, 8);
        head.translate(x, 16, z);
        lightHeads.push(head);
      }
    }

    const postMesh = new THREE.Mesh(
      mergeGeometries(lightPosts),
      new THREE.MeshStandardMaterial({ color: 0x222432, metalness: 0.5, roughness: 0.5 })
    );
    this.group.add(postMesh);

    const headMesh = new THREE.Mesh(
      mergeGeometries(lightHeads),
      new THREE.MeshBasicMaterial({ color: 0xffe8ba })
    );
    this.group.add(headMesh);
  }

  /**
   * Generates elegant, stepped Art Deco and modern skyscrapers with soft
   * window illumination and soothing rooftop spires.
   */
  initSkyscrapers() {
    const atlas = createSoftNeonAtlas();
    const facadeMat = new THREE.MeshStandardMaterial({
      map: atlas.map,
      emissiveMap: atlas.emissiveMap,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.75, // Soft, eye-friendly intensity
      roughness: 0.55,
      metalness: 0.45,
    });

    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x151624,
      roughness: 0.7,
      metalness: 0.3,
    });

    // Soft crown accent trims (subtle pastel cyan & rose-lavender highlights)
    const crownMatCyan = new THREE.MeshBasicMaterial({ color: 0x44bbdd });
    const crownMatRose = new THREE.MeshBasicMaterial({ color: 0xcc4499 });

    const beaconGeo = new THREE.SphereGeometry(2.0, 8, 8);
    this.strobeMat = new THREE.MeshBasicMaterial({ color: 0xc82040 });

    const towerGeometries = [];
    const roofGeometries = [];
    const crownCyanGeos = [];
    const crownRoseGeos = [];
    const beaconPositions = [];

    let seed = 42;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    const xBlocks = [500, 850, 1200, 1550, 1900, 2250, 2600, 2950, 3300, 3650];
    const zBlocks = [
      -1150, -850, -550, -260, -110,
      110, 260, 550, 850, 1150
    ];

    for (const bx of xBlocks) {
      for (const bz of zBlocks) {
        const distFromCenterZ = Math.abs(bz);
        const distFromCenterX = Math.abs(bx - 2000);

        const width = 60 + rng() * 40;
        const depth = 60 + rng() * 40;

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

        // 1. Stepped Art Deco body structure
        const isArtDeco = height > 240;
        if (isArtDeco) {
          // Base tier (70% height)
          const h1 = height * 0.72;
          const g1 = new THREE.BoxGeometry(width, h1, depth);
          g1.translate(posX, h1 / 2, posZ);
          this.applyCrispUVs(g1, width, h1);
          towerGeometries.push(g1);

          // Step 2 tier (20% height, slightly narrower)
          const w2 = width * 0.76;
          const d2 = depth * 0.76;
          const h2 = height * 0.22;
          const g2 = new THREE.BoxGeometry(w2, h2, d2);
          g2.translate(posX, h1 + h2 / 2, posZ);
          this.applyCrispUVs(g2, w2, h2);
          towerGeometries.push(g2);

          // Step 3 crown tier
          const w3 = width * 0.52;
          const d3 = depth * 0.52;
          const h3 = height * 0.06;
          const g3 = new THREE.BoxGeometry(w3, h3, d3);
          g3.translate(posX, h1 + h2 + h3 / 2, posZ);
          this.applyCrispUVs(g3, w3, h3);
          towerGeometries.push(g3);

          // Crown glowing neon rim outline
          const crownTrim = new THREE.BoxGeometry(w3 + 0.8, 1.2, d3 + 0.8);
          crownTrim.translate(posX, height + 0.6, posZ);
          if (distFromCenterZ % 2 === 0) {
            crownCyanGeos.push(crownTrim);
          } else {
            crownRoseGeos.push(crownTrim);
          }

          // Needle spire on top (Empire State / Chrysler style)
          const spireHeight = 35 + rng() * 35;
          const spire = new THREE.CylinderGeometry(0.6, 2.2, spireHeight, 8);
          spire.translate(posX, height + 1.2 + spireHeight / 2, posZ);
          roofGeometries.push(spire);

          beaconPositions.push(new THREE.Vector3(posX, height + 1.2 + spireHeight, posZ));
        } else {
          // Standard modern high-rise
          const towerGeo = new THREE.BoxGeometry(width, height, depth);
          towerGeo.translate(posX, height / 2, posZ);
          this.applyCrispUVs(towerGeo, width, height);
          towerGeometries.push(towerGeo);

          const roofGeo = new THREE.BoxGeometry(width * 0.8, 6, depth * 0.8);
          roofGeo.translate(posX, height + 3, posZ);
          roofGeometries.push(roofGeo);

          beaconPositions.push(new THREE.Vector3(posX, height + 6, posZ));
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

    // Merge tower bodies
    const mergedTowers = mergeGeometries(towerGeometries);
    const towerMesh = new THREE.Mesh(mergedTowers, facadeMat);
    towerMesh.castShadow = true;
    towerMesh.receiveShadow = true;
    this.group.add(towerMesh);

    // Merge roofs and spires
    const mergedRoofs = mergeGeometries(roofGeometries);
    const roofMesh = new THREE.Mesh(mergedRoofs, roofMat);
    roofMesh.castShadow = true;
    roofMesh.receiveShadow = true;
    this.group.add(roofMesh);

    // Subtle rooftop glowing trims
    if (crownCyanGeos.length > 0) {
      const mergedCyan = mergeGeometries(crownCyanGeos);
      this.group.add(new THREE.Mesh(mergedCyan, crownMatCyan));
    }
    if (crownRoseGeos.length > 0) {
      const mergedRose = mergeGeometries(crownRoseGeos);
      this.group.add(new THREE.Mesh(mergedRose, crownMatRose));
    }

    // Instanced soft ruby beacons on skyscraper rooftops
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

  applyCrispUVs(geometry, width, height) {
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * (width / 24), uv.getY(i) * (height / 28));
    }
  }

  /**
   * Serene Celestial Moon hanging quietly over the city skyline,
   * replacing harsh high-contrast glare with gentle, dreamy moonlight.
   */
  initRetroSun() {
    const moonTexture = createSoftMoonTexture();
    const moonGeo = new THREE.CircleGeometry(960, 48);
    const moonMat = new THREE.MeshBasicMaterial({
      map: moonTexture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const moonMesh = new THREE.Mesh(moonGeo, moonMat);
    // Retain node name 'retro-synthwave-sun' for test compatibility
    moonMesh.name = 'retro-synthwave-sun';
    // Placed gracefully above the horizon at X = 7400, Y = 580, Z = 0
    moonMesh.position.set(7400, 580, 0);
    moonMesh.rotation.y = -Math.PI / 2;
    this.group.add(moonMesh);
  }

  /**
   * Dreamy night sky starfield with soft twinkling stars across the upper dome.
   */
  initStarfield() {
    const starCount = 650;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    let seed = 1337;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let i = 0; i < starCount; i++) {
      const theta = rng() * Math.PI * 2;
      const phi = THREE.MathUtils.degToRad(12 + rng() * 72); // Upper sky dome
      const dist = 8500;

      positions[i * 3] = dist * Math.cos(phi) * Math.cos(theta);
      positions[i * 3 + 1] = dist * Math.sin(phi);
      positions[i * 3 + 2] = dist * Math.cos(phi) * Math.sin(theta);

      // Subtle pastel star tints: soft white, pale cyan, soft rose
      const tintChoice = rng();
      if (tintChoice < 0.6) {
        colors[i * 3] = 0.95; colors[i * 3 + 1] = 0.95; colors[i * 3 + 2] = 1.0;
      } else if (tintChoice < 0.85) {
        colors[i * 3] = 0.75; colors[i * 3 + 1] = 0.90; colors[i * 3 + 2] = 1.0;
      } else {
        colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.80; colors[i * 3 + 2] = 0.95;
      }
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const starMat = new THREE.PointsMaterial({
      size: 2.8,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });

    const stars = new THREE.Points(starGeo, starMat);
    stars.name = 'neon-stars';
    this.group.add(stars);
  }

  update(dt, playerPos, totalTime = 0) {
    // Gentle breathing pulse on the rooftop aviation warning beacons (soft, not flashing abruptly)
    if (this.strobeMat) {
      const pulse = Math.sin(totalTime * 2.5) * 0.5 + 0.5;
      this.strobeMat.color.setRGB(0.78 * pulse + 0.15, 0.12 * pulse, 0.25 * pulse);
    }
  }
}
