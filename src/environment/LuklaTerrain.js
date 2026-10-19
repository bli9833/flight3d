import * as THREE from 'three';

/**
 * Real-World Himalayan Terrain for Nepal Tenzing-Hillary Airport (Lukla, VNLK)
 * Uses actual NASA/Copernicus 30m DEM elevation data (lukla_dem_256.bin) and
 * high-resolution ESRI satellite imagery (lukla_satellite.jpg).
 * Features exact 11.7% sloped runway carving, 700m canyon drop, and 6,000m+ Himalayan peaks.
 */
export class LuklaTerrain {
  constructor(size = 22000, segments = 255, customElevations = null) {
    this.size = size;
    this.segments = segments;
    this.gridSize = 256;

    // Shift offsets to place Lukla Airport at world origin (0, 0)
    // Derived from exact geo-coordinates (27.6878° N, 86.7314° E)
    this.shiftX = 578.47;
    this.shiftZ = 1766.85;

    // Runway 06/24 geometry specifications (ICAO: VNLK)
    this.runwayHeadingDeg = 58.0;
    this.runwayHeadingRad = THREE.MathUtils.degToRad(58.0);
    this.runwayLength = 527.0; // meters
    this.runwayWidth = 30.0;   // meters
    this.runwayGradient = 0.1176; // 11.76% (approx 6.7° slope)
    this.threshold06Elevation = 2805.0; // SW end (cliff edge)
    this.threshold24Elevation = 2867.0; // NE end (mountain wall)
    this.midElevation = 2836.0;

    // Elevation data storage (256x256 Float32 array)
    if (customElevations && customElevations.length === this.gridSize * this.gridSize) {
      this.elevations = customElevations;
      this.isLoaded = true;
    } else {
      this.elevations = new Float32Array(this.gridSize * this.gridSize);
      this.isLoaded = false;
      this.initProceduralFallback();
    }
    this.onLoaded = null;

    // Three.js 3D Mesh
    this.geometry = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    this.geometry.rotateX(-Math.PI * 0.5);

    // Initial elevation setup
    this.updateGeometryElevations();

    // Material with high-resolution satellite texture
    this.textureLoader = new THREE.TextureLoader();
    this.satelliteTexture = null;

    const defaultColorMat = new THREE.MeshStandardMaterial({
      color: 0x5a6358,
      roughness: 0.92,
      metalness: 0.05,
      flatShading: false
    });

    this.mesh = new THREE.Mesh(this.geometry, defaultColorMat);
    this.mesh.receiveShadow = true;

    // Load real DEM and satellite imagery if in browser environment
    if (!this.isLoaded) {
      this.loadRealWorldAssets();
    }
  }

  /**
   * Procedural Himalayan fallback algorithm while real DEM loads or in tests
   */
  initProceduralFallback() {
    for (let gy = 0; gy < this.gridSize; gy++) {
      for (let gx = 0; gx < this.gridSize; gx++) {
        const nx = (gx / (this.gridSize - 1) - 0.5);
        const nz = (gy / (this.gridSize - 1) - 0.5);

        // V-shaped Dudh Kosi canyon running SW to NE
        const canyonDist = Math.abs(nx * 0.85 - nz * 0.52);
        const canyonDepth = Math.max(0, 1.0 - canyonDist * 3.5);

        // Mountain ridges flanking canyon
        const ridgeLeft = Math.exp(-Math.pow((nx + 0.35) * 3.0, 2)) * 2800;
        const ridgeRight = Math.exp(-Math.pow((nx - 0.38) * 3.0, 2)) * 3200;

        let baseH = 2850.0 - canyonDepth * 700.0 + (ridgeLeft + ridgeRight) * 0.7;
        this.elevations[gy * this.gridSize + gx] = baseH;
      }
    }
  }

  /**
   * Load real DEM binary file (lukla_dem_256.bin) and satellite texture (lukla_satellite.jpg)
   */
  async loadRealWorldAssets() {
    try {
      if (typeof window !== 'undefined' && window.fetch) {
        // Browser environment: fetch binary DEM
        const res = await fetch('/terrain/lukla_dem_256.bin');
        if (res.ok) {
          const buf = await res.arrayBuffer();
          this.elevations = new Float32Array(buf);
          this.isLoaded = true;
          this.updateGeometryElevations();
          if (this.onLoaded) this.onLoaded();
        }

        // Load satellite texture
        this.textureLoader.load('/terrain/lukla_satellite.jpg', (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.anisotropy = 8;
          this.satelliteTexture = tex;

          this.mesh.material = new THREE.MeshStandardMaterial({
            map: tex,
            roughness: 0.88,
            metalness: 0.05,
            flatShading: false
          });
          this.mesh.material.needsUpdate = true;
        });
      }
    } catch (e) {
      console.warn('Could not load real-world Lukla DEM, using procedural fallback:', e);
    }
  }

  /**
   * Updates PlaneGeometry vertex heights using the DEM data and runway blend
   */
  updateGeometryElevations() {
    const pos = this.geometry.attributes.position;
    const uvs = this.geometry.attributes.uv;
    const count = pos.count;

    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);

      // Height from DEM + runway slope blend
      const h = this.getHeight(x, z);
      pos.setY(i, h);

      // Adjust UV mapping so satellite image perfectly aligns with world coordinates
      if (uvs) {
        const u = ((x + this.shiftX) / this.size) + 0.5;
        const v = 1.0 - (((z + this.shiftZ) / this.size) + 0.5);
        uvs.setXY(i, Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v)));
      }
    }

    pos.needsUpdate = true;
    if (uvs) uvs.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  /**
   * High-accuracy elevation query at world (x, z)
   * Evaluates DEM with bilinear interpolation and blends with 11.7% runway grade
   */
  getHeight(x, z) {
    // 1. Bilinear DEM interpolation
    const demX = x + this.shiftX;
    const demZ = z + this.shiftZ;

    const gx = ((demX / this.size) + 0.5) * (this.gridSize - 1);
    const gy = ((demZ / this.size) + 0.5) * (this.gridSize - 1);

    const cx = Math.max(0, Math.min(this.gridSize - 1.001, gx));
    const cy = Math.max(0, Math.min(this.gridSize - 1.001, gy));

    const ix = Math.floor(cx);
    const iy = Math.floor(cy);
    const fx = cx - ix;
    const fy = cy - iy;

    const h00 = this.elevations[iy * this.gridSize + ix];
    const h10 = this.elevations[iy * this.gridSize + ix + 1];
    const h01 = this.elevations[(iy + 1) * this.gridSize + ix];
    const h11 = this.elevations[(iy + 1) * this.gridSize + ix + 1];

    let naturalH = (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;

    // 2. Runway 06/24 Carving & 11.7% Grade Blending
    // Heading 058°: Longitudinal axis (s) along runway, Lateral axis (w) across runway
    // Vector along runway: sin(58°), -cos(58°)
    const sin58 = 0.848048;
    const cos58 = 0.529919;

    const s = x * sin58 - z * cos58; // Distance along runway from midpoint (-263.5m to +263.5m)
    const w = x * cos58 + z * sin58; // Distance perpendicular to runway

    const halfLength = this.runwayLength * 0.5; // 263.5m
    const halfWidth = this.runwayWidth * 0.5;   // 15.0m
    const lateralBlend = 32.0; // Margin to blend into hillside

    // If within runway longitudinal envelope
    if (s >= -halfLength && s <= halfLength) {
      // Sloped runway elevation (11.76% uphill grade: 2805m at threshold 06 to 2867m at threshold 24)
      const rwyH = this.midElevation + s * this.runwayGradient;

      const absW = Math.abs(w);
      if (absW <= halfWidth) {
        // Flat on tarmac surface
        return rwyH;
      } else if (absW < halfWidth + lateralBlend) {
        // Smooth Hermite blend between runway edge and natural mountainside
        const t = (absW - halfWidth) / lateralBlend;
        const weight = 0.5 * (1.0 + Math.cos(t * Math.PI));
        return rwyH * weight + naturalH * (1.0 - weight);
      }
    } else if (s > halfLength && s < halfLength + 120.0) {
      // Beyond Runway 24 upper end: steep retaining rock wall and mountain slope
      const wallDist = s - halfLength;
      const wallH = this.threshold24Elevation + wallDist * 1.8;
      const absW = Math.abs(w);
      if (absW <= halfWidth) {
        return Math.max(naturalH, wallH);
      } else if (absW < halfWidth + lateralBlend) {
        const t = (absW - halfWidth) / lateralBlend;
        const weight = 0.5 * (1.0 + Math.cos(t * Math.PI));
        const targetH = Math.max(naturalH, wallH);
        return targetH * weight + naturalH * (1.0 - weight);
      }
    } else if (s < -halfLength && s > -halfLength - 160.0) {
      // Beyond Runway 06 lower end: sheer cliff plunging into Dudh Kosi canyon
      const dropDist = -halfLength - s;
      const dropH = this.threshold06Elevation - dropDist * 2.2;
      const absW = Math.abs(w);
      if (absW <= halfWidth) {
        return Math.min(naturalH, dropH);
      } else if (absW < halfWidth + lateralBlend) {
        const t = (absW - halfWidth) / lateralBlend;
        const weight = 0.5 * (1.0 + Math.cos(t * Math.PI));
        const targetH = Math.min(naturalH, dropH);
        return targetH * weight + naturalH * (1.0 - weight);
      }
    }

    return naturalH;
  }

  /**
   * Surface normal at world (x, z) for physics calculation
   */
  getNormal(x, z) {
    const eps = 2.0;
    const hL = this.getHeight(x - eps, z);
    const hR = this.getHeight(x + eps, z);
    const hD = this.getHeight(x, z - eps);
    const hU = this.getHeight(x, z + eps);

    const normal = new THREE.Vector3(hL - hR, 2.0 * eps, hD - hU);
    normal.normalize();
    return normal;
  }
}
