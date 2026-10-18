import * as THREE from 'three';

/**
 * Maritime Traffic & Ships (Container Cargo Vessel, Cruise Liner, Oil Tanker, Speedboats)
 * Includes realistic wave buoyancy (pitch/roll bobbing on ocean waves) and moving yachts with wake trails.
 */
export class Ships {
  constructor(water) {
    this.water = water;
    this.group = new THREE.Group();

    this.vessels = [];
    this.speedboats = [];

    this.initShips();
  }

  initShips() {
    // 1. Large Container Cargo Ship (anchored in South Bay: x=800, z=4200)
    const cargoShip = this.createCargoShip();
    cargoShip.position.set(800, 0, 4200);
    cargoShip.rotation.y = THREE.MathUtils.degToRad(35.0);
    this.group.add(cargoShip);
    this.vessels.push({ mesh: cargoShip, basePos: cargoShip.position.clone(), length: 220, width: 34 });

    // 2. Luxury Cruise Liner (cruising off coastal headland: x=-2400, z=5500)
    const cruiseLiner = this.createCruiseLiner();
    cruiseLiner.position.set(-2400, 0, 5500);
    cruiseLiner.rotation.y = THREE.MathUtils.degToRad(-60.0);
    this.group.add(cruiseLiner);
    this.vessels.push({ mesh: cruiseLiner, basePos: cruiseLiner.position.clone(), length: 190, width: 30 });

    // 3. Oil Tanker / Bulk Freighter (anchored in deep outer roadstead: x=4500, z=6500)
    const tanker = this.createTanker();
    tanker.position.set(4500, 0, 6500);
    tanker.rotation.y = THREE.MathUtils.degToRad(110.0);
    this.group.add(tanker);
    this.vessels.push({ mesh: tanker, basePos: tanker.position.clone(), length: 180, width: 28 });

    // 4. Actively Moving Motor Yachts / Speedboats cruising the bay
    this.createSpeedboat(-500, 3200, 15.0, 1200);
    this.createSpeedboat(1500, 2800, 18.0, 900);
  }

  createCargoShip() {
    const ship = new THREE.Group();

    const hullMat = new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.6, metalness: 0.3 }); // Red hull
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
    const superMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.4 }); // White bridge

    // Hull (Length 220m, Width 32m, Height 18m)
    const hullGeo = new THREE.BoxGeometry(32, 16, 210);
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.position.y = 4;
    ship.add(hull);

    // Pointed Bow
    const bowGeo = new THREE.ConeGeometry(16, 35, 4);
    bowGeo.rotateZ(Math.PI * 0.25);
    bowGeo.rotateX(Math.PI * 0.5);
    const bow = new THREE.Mesh(bowGeo, hullMat);
    bow.position.set(0, 4, -115);
    ship.add(bow);

    // Weather Deck
    const deck = new THREE.Mesh(new THREE.BoxGeometry(31, 2, 205), deckMat);
    deck.position.y = 12;
    ship.add(deck);

    // Multi-color Stacked Shipping Containers
    const containerColors = [0x2563eb, 0xdc2626, 0x16a34a, 0xd97706, 0x475569];
    const containerGeo = new THREE.BoxGeometry(2.5, 2.6, 6.2);

    for (let row = -10; row <= 10; row += 2) {
      if (Math.abs(row) > 7) continue; // Leave room for aft bridge
      for (let col = -5; col <= 5; col += 2) {
        for (let tier = 0; tier < 3 + Math.floor(Math.random() * 2); tier++) {
          const cMat = new THREE.MeshStandardMaterial({
            color: containerColors[Math.floor(Math.random() * containerColors.length)],
            roughness: 0.7
          });
          const cMesh = new THREE.Mesh(containerGeo, cMat);
          cMesh.position.set(col * 2.8, 14 + tier * 2.6, row * 7.5);
          ship.add(cMesh);
        }
      }
    }

    // Aft Superstructure Bridge Tower
    const bridgeGeo = new THREE.BoxGeometry(26, 24, 22);
    const bridge = new THREE.Mesh(bridgeGeo, superMat);
    bridge.position.set(0, 24, 75);
    ship.add(bridge);

    // Bridge Navigation Wings & Radar Mast
    const wingGeo = new THREE.BoxGeometry(36, 4, 8);
    const wings = new THREE.Mesh(wingGeo, superMat);
    wings.position.set(0, 32, 75);

    const mastGeo = new THREE.CylinderGeometry(0.5, 0.8, 18, 8);
    const mast = new THREE.Mesh(mastGeo, new THREE.MeshStandardMaterial({ color: 0x334155 }));
    mast.position.set(0, 42, 75);

    // Smokestack Funnel
    const funnelGeo = new THREE.CylinderGeometry(2.8, 3.2, 12, 12);
    const funnel = new THREE.Mesh(funnelGeo, new THREE.MeshStandardMaterial({ color: 0x111827 }));
    funnel.position.set(0, 36, 92);

    ship.add(wings, mast, funnel);
    return ship;
  }

  createCruiseLiner() {
    const liner = new THREE.Group();

    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3, metalness: 0.1 });
    const blueHullMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5 });
    const funnelMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.4 }); // Red funnel
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.2, metalness: 0.8 });

    // Lower Hull (Length 190m, Width 28m)
    const hullGeo = new THREE.BoxGeometry(28, 14, 180);
    const hull = new THREE.Mesh(hullGeo, blueHullMat);
    hull.position.y = 3;
    liner.add(hull);

    // Pointed Clipper Bow
    const bowGeo = new THREE.ConeGeometry(14, 30, 4);
    bowGeo.rotateZ(Math.PI * 0.25);
    bowGeo.rotateX(Math.PI * 0.5);
    const bow = new THREE.Mesh(bowGeo, blueHullMat);
    bow.position.set(0, 3, -100);
    liner.add(bow);

    // Tiered Passenger Decks (Decks 4 through 12)
    const decksGeo = new THREE.BoxGeometry(26, 20, 160);
    const decks = new THREE.Mesh(decksGeo, whiteMat);
    decks.position.set(0, 18, 5);
    liner.add(decks);

    // Balcony Glass Strips
    for (let d = 11; d <= 26; d += 4) {
      const balcL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 145), glassMat);
      balcL.position.set(-13.2, d, 5);
      const balcR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 145), glassMat);
      balcR.position.set(13.2, d, 5);
      liner.add(balcL, balcR);
    }

    // Top Lido Sun Deck with Twin Swimming Pools
    const poolGeo = new THREE.BoxGeometry(8, 0.4, 14);
    const poolMat = new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.1 });
    const pool1 = new THREE.Mesh(poolGeo, poolMat);
    pool1.position.set(0, 28.2, -15);
    const pool2 = new THREE.Mesh(poolGeo, poolMat);
    pool2.position.set(0, 28.2, 25);
    liner.add(pool1, pool2);

    // Dual Iconic Winged Cruise Funnels
    const funnelGeo = new THREE.CylinderGeometry(2.5, 3.5, 12, 12);
    funnelGeo.rotateX(0.15); // Raked backwards
    const funnel1 = new THREE.Mesh(funnelGeo, funnelMat);
    funnel1.position.set(0, 34, 45);
    liner.add(funnel1);

    return liner;
  }

  createTanker() {
    const tanker = new THREE.Group();

    const hullMat = new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.7 }); // Forest green hull
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 });
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.7, roughness: 0.4 });

    // Long Flat Tanker Hull (Length 180m, Width 26m)
    const hullGeo = new THREE.BoxGeometry(26, 12, 170);
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.position.y = 2.5;
    tanker.add(hull);

    // Tanker Deck with Pipeline Network
    const deck = new THREE.Mesh(new THREE.BoxGeometry(25, 2, 165), deckMat);
    deck.position.y = 8;
    tanker.add(deck);

    // Pipeline manifolds running along deck
    for (let p = -4; p <= 4; p += 4) {
      const pipeGeo = new THREE.CylinderGeometry(0.4, 0.4, 120, 8);
      pipeGeo.rotateX(Math.PI * 0.5);
      const pipe = new THREE.Mesh(pipeGeo, pipeMat);
      pipe.position.set(p, 9.5, -15);
      tanker.add(pipe);
    }

    // Aft Castle Superstructure
    const castleGeo = new THREE.BoxGeometry(22, 18, 24);
    const castle = new THREE.Mesh(castleGeo, new THREE.MeshStandardMaterial({ color: 0xf1f5f9 }));
    castle.position.set(0, 16, 65);
    tanker.add(castle);

    return tanker;
  }

  createSpeedboat(cx, cz, speed, radius) {
    const boat = new THREE.Group();

    // Sleek V-Hull (Length 22m, Width 5m)
    const hullGeo = new THREE.ConeGeometry(2.8, 22, 4);
    hullGeo.rotateZ(Math.PI * 0.25);
    hullGeo.rotateX(Math.PI * 0.5);
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.3 });
    const hull = new THREE.Mesh(hullGeo, hullMat);
    boat.add(hull);

    // Windshield & Cabin
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 2.2, 7.5),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
    );
    cabin.position.set(0, 1.8, 1.5);
    boat.add(cabin);

    // Foaming Wake Trail (Planes expanding behind the boat)
    const wakeGeo = new THREE.PlaneGeometry(8, 45);
    wakeGeo.rotateX(-Math.PI * 0.5);
    const wakeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.45,
      depthWrite: false
    });
    const wake = new THREE.Mesh(wakeGeo, wakeMat);
    wake.position.set(0, 0.05, 25);
    boat.add(wake);

    this.group.add(boat);

    this.speedboats.push({
      mesh: boat,
      cx,
      cz,
      radius,
      speed,
      angle: Math.random() * Math.PI * 2
    });
  }

  /**
   * Update buoyancy and movements
   */
  update(dt, totalTime) {
    // 1. Large Ships Wave Buoyancy (Gentle pitch and roll rocking)
    this.vessels.forEach(v => {
      const px = v.basePos.x;
      const pz = v.basePos.z;

      // Sample wave height at bow and stern to compute pitch
      const halfL = v.length * 0.4;
      const yMid = this.water.getWaveHeight(px, pz, totalTime);
      const yBow = this.water.getWaveHeight(px, pz - halfL, totalTime);
      const yStern = this.water.getWaveHeight(px, pz + halfL, totalTime);

      v.mesh.position.y = yMid;
      // Pitch rotation
      const pitch = Math.atan2(yBow - yStern, v.length);
      v.mesh.rotation.x = pitch * 0.85;

      // Gentle roll oscillation
      v.mesh.rotation.z = Math.sin(totalTime * 0.6 + px * 0.01) * 0.015;
    });

    // 2. Moving Speedboats
    this.speedboats.forEach(b => {
      b.angle += (b.speed / b.radius) * dt;
      const x = b.cx + Math.cos(b.angle) * b.radius;
      const z = b.cz + Math.sin(b.angle) * b.radius;

      b.mesh.position.x = x;
      b.mesh.position.z = z;

      // Wave height & planning bow lift
      const yWave = this.water.getWaveHeight(x, z, totalTime);
      b.mesh.position.y = yWave + 0.3;

      // Tangent heading angle
      b.mesh.rotation.y = -b.angle;
      // Bow-up trim while cruising at speed
      b.mesh.rotation.x = THREE.MathUtils.degToRad(-6.0);
    });
  }
}
