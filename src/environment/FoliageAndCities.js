import * as THREE from 'three';
import { cityWindowIntensity, createCityBuildingAssets } from './CityBuildingAssets.js';

/**
 * High-Performance Instanced Foliage (3,500+ Trees) & Urban City Buildings (500+ Structures)
 * Uses THREE.InstancedMesh for optimal 60+ FPS rendering while guaranteeing clear airport flight paths.
 */
export class FoliageAndCities {
  constructor(terrain, random = Math.random) {
    this.terrain = terrain;
    this.random = random;
    this.group = new THREE.Group();

    this.treeData = [];
    this.buildingData = [];

    this.initFoliage();
    this.initCities();
  }

  initFoliage() {
    const treeCount = 3500;

    // Compound geometry for pine tree: brown trunk + tiered green cone foliage
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 3.5, 6);
    trunkGeo.translate(0, 1.75, 0);

    const foliageGeo = new THREE.ConeGeometry(3.2, 8.5, 7);
    foliageGeo.translate(0, 6.5, 0);

    // Merge or instantiate separate meshes
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x422d1d, roughness: 0.9 });
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x1f4724, roughness: 0.8 });

    const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    const foliageInst = new THREE.InstancedMesh(foliageGeo, foliageMat, treeCount);

    const dummy = new THREE.Object3D();
    let placed = 0;

    // Distribute trees across landscape
    const areaRadius = 9000;
    const seedPoints = [];

    for (let i = 0; i < treeCount * 2 && placed < treeCount; i++) {
      const angle = this.random() * Math.PI * 2;
      const dist = 600 + Math.sqrt(this.random()) * (areaRadius - 600);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;

      // Check airport exclusion zone: $|x| < 2400$ and $|z| < 450$
      if (Math.abs(x) < 2400 && Math.abs(z) < 450) {
        continue;
      }
      // Approach path clearance
      if (Math.abs(z) < 250 && Math.abs(x) < 3600) {
        continue;
      }

      const y = this.terrain.getHeight(x, z);
      // Only plant on soil/grass: above water (3.5m) and below alpine scree (280m)
      if (y < 3.5 || y > 280) {
        continue;
      }

      // Random organic scaling
      const scale = 0.75 + this.random() * 0.85;
      dummy.position.set(x, y, z);
      dummy.scale.set(scale, scale * (0.85 + this.random() * 0.35), scale);
      dummy.rotation.y = this.random() * Math.PI * 2;
      dummy.updateMatrix();

      trunkInst.setMatrixAt(placed, dummy.matrix);
      foliageInst.setMatrixAt(placed, dummy.matrix);

      this.treeData.push({
        x,
        y,
        z,
        height: 10.5 * scale,
        radius: 3.5 * scale
      });

      placed++;
    }

    trunkInst.count = placed;
    foliageInst.count = placed;

    trunkInst.instanceMatrix.needsUpdate = true;
    foliageInst.instanceMatrix.needsUpdate = true;

    this.group.add(trunkInst, foliageInst);
  }

  initCities() {
    const buildingCount = 550;
    this.cityAssets = createCityBuildingAssets();
    this.cityLodNearDistance = 1800;
    this.cityLodCamera = new THREE.Vector3(Infinity, Infinity, Infinity);
    this.cityArchetypes = this.cityAssets.nearGeometries.map((geometry, index) => {
      const near = new THREE.InstancedMesh(geometry, this.cityAssets.nearMaterial, buildingCount);
      const far = new THREE.InstancedMesh(this.cityAssets.farGeometry, this.cityAssets.farMaterial, buildingCount);
      near.name = `city-near-${index}`;
      far.name = `city-far-${index}`;
      // Instances cover separate clusters; a single aggregate bounding sphere
      // would include most of the map and offer no useful frustum culling.
      near.frustumCulled = false;
      far.frustumCulled = false;
      near.count = far.count = 0;
      this.group.add(near, far);
      return { near, far, records: [] };
    });

    const dummy = new THREE.Object3D();
    let placed = 0;

    // City Clusters:
    // 1. East Bay Metropolis: Center (x=2800, z=1400)
    // 2. North Coast Tech Hub: Center (x=-800, z=-2800)
    // 3. Airport Logistics & Business Park: Center (x=900, z=650)
    const clusters = [
      { cx: 2800, cz: 1400, radius: 1200, count: 260, maxH: 140 },
      { cx: -800, cz: -2800, radius: 1000, count: 180, maxH: 85 },
      { cx: 900,  cz: 750,   radius: 600,  count: 110, maxH: 45 }
    ];

    const colorVariants = [
      new THREE.Color(0xdbeafe), // Light glass blue
      new THREE.Color(0xf1f5f9), // White marble/concrete
      new THREE.Color(0x64748b), // Dark slate
      new THREE.Color(0x38bdf8), // Cyan tinted glass
      new THREE.Color(0xe2e8f0)  // Brushed steel
    ];

    clusters.forEach(cluster => {
      for (let i = 0; i < cluster.count && placed < buildingCount; i++) {
        const angle = this.random() * Math.PI * 2;
        const r = Math.sqrt(this.random()) * cluster.radius;
        const x = cluster.cx + Math.cos(angle) * r;
        const z = cluster.cz + Math.sin(angle) * r;

        // Ensure clear of runway
        if (Math.abs(x) < 2200 && Math.abs(z) < 420) continue;

        const groundY = this.terrain.getHeight(x, z);
        if (groundY < 2.5) continue; // Don't place in ocean

        // Building Dimensions
        const width = 18 + this.random() * 26;
        const depth = 18 + this.random() * 26;
        // Central skyscrapers taller than outskirts
        const distFromCenter = r / cluster.radius;
        const height = (15 + this.random() * 25) + (1.0 - distFromCenter) * cluster.maxH;

        const rotationY = Math.floor(this.random() * 4) * (Math.PI * 0.5); // Grid aligned
        const worldWidth = Math.abs(Math.cos(rotationY)) * width + Math.abs(Math.sin(rotationY)) * depth;
        const worldDepth = Math.abs(Math.sin(rotationY)) * width + Math.abs(Math.cos(rotationY)) * depth;
        const c = colorVariants[Math.floor(this.random() * colorVariants.length)];
        // Check the full rotated footprint, not only its center.
        if (Math.abs(x) < 2200 + worldWidth / 2 && Math.abs(z) < 420 + worldDepth / 2) continue;

        dummy.position.set(x, groundY, z);
        dummy.scale.set(width, height, depth);
        dummy.rotation.y = rotationY;
        dummy.updateMatrix();
        const archetype = placed % this.cityArchetypes.length;

        this.buildingData.push({
          x,
          y: groundY,
          z,
          width: worldWidth,
          height,
          depth: worldDepth,
          localWidth: width,
          localDepth: depth,
          rotationY,
          archetype
        });

        this.cityArchetypes[archetype].records.push({ x, y: groundY, z, height, matrix: dummy.matrix.clone(), color: c });

        placed++;
      }
    });

    this.updateCityLod(new THREE.Vector3());
    this.setTimeOfDay(16.8);
  }

  updateCityLod(cameraPosition) {
    if (this.cityLodCamera.distanceToSquared(cameraPosition) < 80 * 80) return;
    this.cityLodCamera.copy(cameraPosition);
    const nearDistanceSquared = this.cityLodNearDistance ** 2;
    for (const { near, far, records } of this.cityArchetypes) {
      let nearCount = 0;
      let farCount = 0;
      for (const record of records) {
        const dx = cameraPosition.x - record.x;
        const dy = cameraPosition.y - (record.y + record.height / 2);
        const dz = cameraPosition.z - record.z;
        const mesh = dx * dx + dy * dy + dz * dz < nearDistanceSquared ? near : far;
        const index = mesh === near ? nearCount++ : farCount++;
        mesh.setMatrixAt(index, record.matrix);
        mesh.setColorAt(index, record.color);
      }
      near.count = nearCount;
      far.count = farCount;
      near.instanceMatrix.needsUpdate = true;
      far.instanceMatrix.needsUpdate = true;
      if (near.instanceColor) near.instanceColor.needsUpdate = true;
      if (far.instanceColor) far.instanceColor.needsUpdate = true;
    }
  }

  setTimeOfDay(hour) {
    this.cityAssets.nearMaterial.emissiveIntensity = cityWindowIntensity(hour);
  }
}
