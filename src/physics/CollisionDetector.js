import * as THREE from 'three';

/**
 * High-Performance Aircraft Collision & Obstacle Detector
 * Checks 6-DOF aircraft collision against:
 * 1. Terrain & Hills (mountain ridges, ground impact, hard landing, wingtip/tail strikes)
 * 2. Water / Ocean (ocean impact & ditching)
 * 3. Airport Control Tower (cylindrical observation tower & mast)
 * 4. Airport Buildings (terminal concourse & hangars)
 * 5. Trees (spatial hash grid of 3,500+ trees)
 * 6. City Buildings & Skyscrapers (spatial hash grid of 550+ structures)
 * 7. Maritime Ships (cargo ships, cruise liners, tankers)
 */
export class CollisionDetector {
  constructor(terrain, airport, foliageAndCities, ships, water) {
    this.terrain = terrain;
    this.airport = airport;
    this.foliage = foliageAndCities;
    this.ships = ships;
    this.water = water;

    // Aircraft collision probe points in aircraft local body coordinates (meters)
    // Nose forward (-Z), Right (+X), Up (+Y), Wingtip span ~34.4m, Length ~35m
    this.probePoints = [
      { id: 'nose', pos: new THREE.Vector3(0, -0.2, -17.5), radius: 1.5, desc: '기수 (Nose Radome)' },
      { id: 'tail', pos: new THREE.Vector3(0, 1.2, 17.5), radius: 1.2, desc: '후방 동체 (Tail Empennage)' },
      { id: 'fin', pos: new THREE.Vector3(0, 9.2, 16.0), radius: 0.8, desc: '수직 꼬리날개 (Vertical Fin)' },
      { id: 'wingL', pos: new THREE.Vector3(-17.2, 0.6, 2.8), radius: 1.0, desc: '좌측 주익단 (Left Wingtip)' },
      { id: 'wingR', pos: new THREE.Vector3(17.2, 0.6, 2.8), radius: 1.0, desc: '우측 주익단 (Right Wingtip)' },
      { id: 'engineL', pos: new THREE.Vector3(-5.2, -1.4, -1.5), radius: 1.4, desc: '좌측 엔진 (Left Engine)' },
      { id: 'engineR', pos: new THREE.Vector3(5.2, -1.4, -1.5), radius: 1.4, desc: '우측 엔진 (Right Engine)' },
      { id: 'belly', pos: new THREE.Vector3(0, -1.75, 0.0), radius: 1.8, desc: '동체 하단 (Belly Fuselage)' }
    ];

    // Spatial hash grids for O(1) broadphase lookups
    this.gridCellSize = 150.0; // meters per cell
    this.treeGrid = new Map();
    this.buildingGrid = new Map();

    this.buildSpatialGrids();
  }

  getGridKey(x, z) {
    const gx = Math.floor(x / this.gridCellSize);
    const gz = Math.floor(z / this.gridCellSize);
    return `${gx}_${gz}`;
  }

  buildSpatialGrids() {
    // 1. Index trees
    if (this.foliage && this.foliage.treeData) {
      for (const tree of this.foliage.treeData) {
        const key = this.getGridKey(tree.x, tree.z);
        if (!this.treeGrid.has(key)) {
          this.treeGrid.set(key, []);
        }
        this.treeGrid.get(key).push(tree);
      }
    }

    // 2. Index city buildings
    if (this.foliage && this.foliage.buildingData) {
      for (const bldg of this.foliage.buildingData) {
        const minX = bldg.x - bldg.width * 0.5;
        const maxX = bldg.x + bldg.width * 0.5;
        const minZ = bldg.z - bldg.depth * 0.5;
        const maxZ = bldg.z + bldg.depth * 0.5;

        // Add to all intersecting grid cells
        const minGx = Math.floor(minX / this.gridCellSize);
        const maxGx = Math.floor(maxX / this.gridCellSize);
        const minGz = Math.floor(minZ / this.gridCellSize);
        const maxGz = Math.floor(maxZ / this.gridCellSize);

        for (let gx = minGx; gx <= maxGx; gx++) {
          for (let gz = minGz; gz <= maxGz; gz++) {
            const key = `${gx}_${gz}`;
            if (!this.buildingGrid.has(key)) {
              this.buildingGrid.set(key, []);
            }
            this.buildingGrid.get(key).push(bldg);
          }
        }
      }
    }
  }

  setEnvironment(terrain, airport, foliage = null, ships = null, water = null) {
    this.terrain = terrain;
    this.airport = airport;
    this.foliage = foliage;
    this.ships = ships;
    this.water = water;
    this.treeGrid.clear();
    this.buildingGrid.clear();
    this.buildSpatialGrids();
  }

  /**
   * Main collision evaluation called every physics step
   * Returns null if no collision, or a collision result object
   */
  checkCollision(position, quaternion, linearVelocity, gearState, pitchDeg, rollDeg) {
    const speedMs = linearVelocity.length();
    const speedKnots = speedMs * 1.94384;
    const vsiMs = linearVelocity.y;

    // Transform all probes to world coordinates
    const worldProbes = this.probePoints.map(p => {
      const worldPos = p.pos.clone().applyQuaternion(quaternion).add(position);
      return {
        id: p.id,
        pos: worldPos,
        radius: p.radius,
        desc: p.desc
      };
    });

    // 1. Airport Control Tower Check
    const towerResult = this.checkControlTower(position, worldProbes);
    if (towerResult) {
      return {
        collided: true,
        type: 'TOWER',
        name: '관제탑 충돌 (CONTROL TOWER COLLISION)',
        point: towerResult.point,
        speedKnots,
        description: `공항 관제탑에 ${towerResult.part} 부위가 격돌했습니다.`
      };
    }

    // 2. Airport Buildings Check (Terminal & Hangars)
    const airportBldgResult = this.checkAirportBuildings(position, worldProbes);
    if (airportBldgResult) {
      return {
        collided: true,
        type: 'BUILDING',
        name: '공항 건물 충돌 (AIRPORT STRUCTURE COLLISION)',
        point: airportBldgResult.point,
        speedKnots,
        description: `공항 터미널/격납고 시설에 ${airportBldgResult.part} 부위가 충돌했습니다.`
      };
    }

    // 3. City Skyscraper / Buildings Check (Broadphase via spatial grid)
    const cityBldgResult = this.checkCityBuildings(position, worldProbes);
    if (cityBldgResult) {
      return {
        collided: true,
        type: 'BUILDING',
        name: '도심 빌딩 충돌 (SKYSCRAPER COLLISION)',
        point: cityBldgResult.point,
        speedKnots,
        description: `도심 고층 빌딩과 ${cityBldgResult.part} 부위가 격돌했습니다.`
      };
    }

    // 4. Tree / Foliage Collision Check (Broadphase via spatial grid)
    const treeResult = this.checkTrees(position, worldProbes);
    if (treeResult) {
      return {
        collided: true,
        type: 'TREE',
        name: '산림 수목 충돌 (TREE COLLISION)',
        point: treeResult.point,
        speedKnots,
        description: `울창한 수목 지대에 ${treeResult.part} 부위가 충돌했습니다.`
      };
    }

    // 5. Maritime Ship Collision Check
    const shipResult = this.checkShips(position, worldProbes);
    if (shipResult) {
      return {
        collided: true,
        type: 'SHIP',
        name: '해상 선박 충돌 (MARITIME VESSEL COLLISION)',
        point: shipResult.point,
        speedKnots,
        description: `해상 선박에 ${shipResult.part} 부위가 충돌했습니다.`
      };
    }

    // 6. Water / Ocean Impact Check
    const waterResult = this.checkWater(position, worldProbes, speedMs, vsiMs);
    if (waterResult) {
      return {
        collided: true,
        type: 'WATER',
        name: '수면 격추 / 해상 추락 (OCEAN WATER IMPACT)',
        point: waterResult.point,
        speedKnots,
        description: `바다 수면에 고속으로 격돌했습니다.`
      };
    }

    // 7. Terrain & Hills Collision Check
    const terrainResult = this.checkTerrain(position, worldProbes, gearState, pitchDeg, rollDeg, speedMs, vsiMs);
    if (terrainResult) {
      return {
        collided: true,
        type: 'TERRAIN',
        name: terrainResult.name,
        point: terrainResult.point,
        speedKnots,
        description: terrainResult.description
      };
    }

    return null;
  }

  checkControlTower(aircraftPos, worldProbes) {
    if (!this.airport || !this.airport.controlTowerData) return null;
    const t = this.airport.controlTowerData;

    // Check cylinder boundary
    const tBaseY = t.y;
    const tTopY = t.y + t.height;

    for (const probe of worldProbes) {
      const dx = probe.pos.x - t.x;
      const dz = probe.pos.z - t.z;
      const distSq = dx * dx + dz * dz;
      const effectiveRadius = t.radius + probe.radius;

      if (distSq < effectiveRadius * effectiveRadius) {
        if (probe.pos.y >= tBaseY && probe.pos.y <= tTopY) {
          return { point: probe.pos.clone(), part: probe.desc };
        }
      }
    }
    return null;
  }

  checkAirportBuildings(aircraftPos, worldProbes) {
    if (!this.airport) return null;

    // Check terminal concourse box
    const term = this.airport.terminalData;
    if (term) {
      const minY = term.y;
      const maxY = term.y + term.height;

      if (term.rotationY !== undefined) {
        // Oriented bounding box check (local coordinate space of rotated building)
        const cosR = Math.cos(-term.rotationY);
        const sinR = Math.sin(-term.rotationY);
        const halfW = (term.localWidth || term.width) * 0.5;
        const halfD = (term.localDepth || term.depth) * 0.5;

        for (const probe of worldProbes) {
          const dx = probe.pos.x - term.x;
          const dz = probe.pos.z - term.z;
          const lx = dx * cosR - dz * sinR;
          const lz = dx * sinR + dz * cosR;

          if (
            Math.abs(lx) <= halfW + probe.radius &&
            Math.abs(lz) <= halfD + probe.radius &&
            probe.pos.y >= minY && probe.pos.y <= maxY
          ) {
            return { point: probe.pos.clone(), part: probe.desc };
          }
        }
      } else {
        const minX = term.x - term.width * 0.5;
        const maxX = term.x + term.width * 0.5;
        const minZ = term.z - term.depth * 0.5;
        const maxZ = term.z + term.depth * 0.5;

        for (const probe of worldProbes) {
          if (
            probe.pos.x >= minX - probe.radius && probe.pos.x <= maxX + probe.radius &&
            probe.pos.z >= minZ - probe.radius && probe.pos.z <= maxZ + probe.radius &&
            probe.pos.y >= minY && probe.pos.y <= maxY
          ) {
            return { point: probe.pos.clone(), part: probe.desc };
          }
        }
      }
    }

    // Check hangars
    if (this.airport.hangarsData) {
      for (const h of this.airport.hangarsData) {
        const minX = h.x - h.width * 0.5;
        const maxX = h.x + h.width * 0.5;
        const minZ = h.z - h.depth * 0.5;
        const maxZ = h.z + h.depth * 0.5;
        const minY = h.y;
        const maxY = h.y + h.height;

        for (const probe of worldProbes) {
          if (
            probe.pos.x >= minX - probe.radius && probe.pos.x <= maxX + probe.radius &&
            probe.pos.z >= minZ - probe.radius && probe.pos.z <= maxZ + probe.radius &&
            probe.pos.y >= minY && probe.pos.y <= maxY
          ) {
            return { point: probe.pos.clone(), part: probe.desc };
          }
        }
      }
    }

    return null;
  }

  checkCityBuildings(aircraftPos, worldProbes) {
    if (!this.foliage || !this.foliage.buildingData) return null;

    // Spatial hash query of 3x3 surrounding cells
    const curGx = Math.floor(aircraftPos.x / this.gridCellSize);
    const curGz = Math.floor(aircraftPos.z / this.gridCellSize);

    for (let gx = curGx - 1; gx <= curGx + 1; gx++) {
      for (let gz = curGz - 1; gz <= curGz + 1; gz++) {
        const key = `${gx}_${gz}`;
        const bldgs = this.buildingGrid.get(key);
        if (!bldgs) continue;

        for (const b of bldgs) {
          const halfW = b.width * 0.5;
          const halfD = b.depth * 0.5;
          const minX = b.x - halfW;
          const maxX = b.x + halfW;
          const minZ = b.z - halfD;
          const maxZ = b.z + halfD;
          const minY = b.y;
          const maxY = b.y + b.height;

          // Quick bounding box check for aircraft center
          if (aircraftPos.y > maxY + 15 || aircraftPos.y < minY - 5) continue;

          for (const probe of worldProbes) {
            if (
              probe.pos.x >= minX - probe.radius && probe.pos.x <= maxX + probe.radius &&
              probe.pos.z >= minZ - probe.radius && probe.pos.z <= maxZ + probe.radius &&
              probe.pos.y >= minY && probe.pos.y <= maxY
            ) {
              return { point: probe.pos.clone(), part: probe.desc };
            }
          }
        }
      }
    }
    return null;
  }

  checkTrees(aircraftPos, worldProbes) {
    if (!this.foliage || !this.foliage.treeData) return null;

    const curGx = Math.floor(aircraftPos.x / this.gridCellSize);
    const curGz = Math.floor(aircraftPos.z / this.gridCellSize);

    for (let gx = curGx - 1; gx <= curGx + 1; gx++) {
      for (let gz = curGz - 1; gz <= curGz + 1; gz++) {
        const key = `${gx}_${gz}`;
        const trees = this.treeGrid.get(key);
        if (!trees) continue;

        for (const t of trees) {
          // If aircraft center is far above tree, skip
          if (aircraftPos.y > t.y + t.height + 15) continue;

          for (const probe of worldProbes) {
            const dx = probe.pos.x - t.x;
            const dz = probe.pos.z - t.z;
            const distSq = dx * dx + dz * dz;
            const maxR = t.radius + probe.radius;

            if (distSq < maxR * maxR) {
              if (probe.pos.y >= t.y && probe.pos.y <= t.y + t.height) {
                return { point: probe.pos.clone(), part: probe.desc };
              }
            }
          }
        }
      }
    }
    return null;
  }

  checkShips(aircraftPos, worldProbes) {
    if (!this.ships || !this.ships.vessels) return null;

    for (const v of this.ships.vessels) {
      const vPos = v.mesh.position;
      const vRotY = v.mesh.rotation.y;
      const halfL = v.length * 0.5;
      const halfW = v.width * 0.5;
      const height = v.height || 35.0;

      // Transform probe to ship local coordinates
      const cosR = Math.cos(-vRotY);
      const sinR = Math.sin(-vRotY);

      for (const probe of worldProbes) {
        const dx = probe.pos.x - vPos.x;
        const dz = probe.pos.z - vPos.z;
        const localX = cosR * dx - sinR * dz;
        const localZ = sinR * dx + cosR * dz;

        if (
          Math.abs(localX) < halfW + probe.radius &&
          Math.abs(localZ) < halfL + probe.radius &&
          probe.pos.y >= 0 && probe.pos.y <= height
        ) {
          return { point: probe.pos.clone(), part: probe.desc };
        }
      }
    }
    return null;
  }

  checkWater(aircraftPos, worldProbes, speedMs, vsiMs) {
    if (!this.terrain) return null;

    const terrainH = this.terrain.getHeight(aircraftPos.x, aircraftPos.z);
    // Water is located where natural terrain is at or below sea level (elevation <= 2.5m)
    if (terrainH > 2.5) return null;

    const waterLevel = 0.0;
    // Ditching / crashing into water: speed > 15 m/s (~30 knots) or vertical descent > 3.0 m/s
    if (speedMs < 5.0 && Math.abs(vsiMs) < 1.0) return null; // Stationary boat/seaplane safe state

    for (const probe of worldProbes) {
      if (probe.pos.y <= waterLevel + 0.5) {
        return { point: probe.pos.clone() };
      }
    }
    return null;
  }

  checkTerrain(aircraftPos, worldProbes, gearState, pitchDeg, rollDeg, speedMs, vsiMs) {
    if (!this.terrain) return null;

    const groundH = this.terrain.getHeight(aircraftPos.x, aircraftPos.z);
    const isAirportRunway = (this.airport && typeof this.airport.isOnRunway === 'function')
      ? this.airport.isOnRunway(aircraftPos.x, aircraftPos.z)
      : (Math.abs(aircraftPos.x) < 1950 && Math.abs(aircraftPos.z) < 450);
    const isGearDeployed = gearState > 0.75;
    const isPitchSafe = pitchDeg >= -9.5 && pitchDeg <= 16.5;
    const isRollSafe = Math.abs(rollDeg) <= 16.5;

    // 1. Runway operations (Takeoff roll, rotation, flare, touchdown, and braking)
    if (isAirportRunway) {
      // Hard landing: only checked when wheels actually contact ground (y <= groundH + 2.15m)
      if (aircraftPos.y <= groundH + 2.15 && speedMs > 25.0) {
        // Gear collapse / belly impact onto runway concrete
        if (aircraftPos.y < groundH + 1.35) {
          return {
            name: '하드 랜딩 기체 파손 (HARD LANDING CRASH)',
            point: aircraftPos.clone(),
            description: `과도한 충격으로 랜딩기어가 파손되며 동체가 활주로에 격돌했습니다.`
          };
        }
        // Catastrophic extreme vertical slam (> 2400 FPM)
        if (vsiMs < -12.5) {
          return {
            name: '하드 랜딩 기체 파손 (HARD LANDING CRASH)',
            point: aircraftPos.clone(),
            description: `과도한 강하율(${(-vsiMs * 196.85).toFixed(0)} FPM)로 인해 활주로에 격돌했습니다.`
          };
        }
        // Severe wingtip scrape on runway
        if (!isRollSafe) {
          return {
            name: '주익단 지면 접촉 (WINGTIP STRIKE CRASH)',
            point: aircraftPos.clone(),
            description: `과도한 뱅크각(${rollDeg.toFixed(1)}°)으로 주익이 활주로에 접촉했습니다.`
          };
        }
        // Severe nose dive into runway
        if (pitchDeg < -7.5) {
          return {
            name: '기수 노즈기어 파손 격돌 (NOSE DIVE CRASH)',
            point: aircraftPos.clone(),
            description: `음성 피치(${pitchDeg.toFixed(1)}°)로 기수가 활주로에 격돌했습니다.`
          };
        }
        // Severe tail strike beyond rotation envelope (> 14.5 deg at low altitude)
        if (pitchDeg > 14.5 && aircraftPos.y < groundH + 1.85) {
          return {
            name: '테일 스트라이크 (TAIL STRIKE CRASH)',
            point: aircraftPos.clone(),
            description: `과도한 기수 상승각(${pitchDeg.toFixed(1)}°)으로 후방 동체가 활주로에 격돌했습니다.`
          };
        }
        // Gear-up belly landing at high speed (> 30 knots)
        if (gearState < 0.25) {
          return {
            name: '동체 착륙 폭발 (GEAR-UP BELLY CRASH)',
            point: aircraftPos.clone(),
            description: `랜딩기어 미전개 상태에서 고속(${(speedMs * 1.94384).toFixed(0)} KT)으로 동체가 활주로와 충돌했습니다.`
          };
        }
      }
      // On the airport runway with gear deployed and normal attitude: safe operations!
      if (isGearDeployed && isPitchSafe && isRollSafe) {
        return null;
      }
    }

    // 2. Off-runway terrain, mountain ridges, and steep hills collision
    for (const probe of worldProbes) {
      const probeGroundH = this.terrain.getHeight(probe.pos.x, probe.pos.z);

      // On runway plateau with gear deployed, ignore belly/engine/tail ground clearance
      if (isAirportRunway && isGearDeployed) {
        continue;
      }

      // If probe penetrates into ground/mountain slope
      if (probe.pos.y < probeGroundH + 0.1) {
        return {
          name: '산악 지형 충돌 (TERRAIN / MOUNTAIN COLLISION)',
          point: probe.pos.clone(),
          description: `구릉 지형 또는 산악 지면에 ${probe.desc} 부위가 격돌했습니다.`
        };
      }
    }

    return null;
  }
}
