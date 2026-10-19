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

    // High-resolution local terrace mesh for the carved runway and airport grounds
    // Tessellates the 800m x 300m airport envelope at 10m spacing (80 x 30 segments)
    // to preserve exact carved runway and terrace geometry without coarse DEM interpolation bulge
    const sLength = 800; // -400m to +400m along runway heading 058°
    const wWidth = 300;  // -150m to +150m across runway
    const sSegs = 80;
    const wSegs = 30;
    const sin58 = 0.848048;
    const cos58 = 0.529919;

    this.localTerraceGeometry = new THREE.PlaneGeometry(sLength, wWidth, sSegs, wSegs);
    this.localTerraceGeometry.rotateX(-Math.PI * 0.5);

    const localPos = this.localTerraceGeometry.attributes.position;
    for (let i = 0; i < localPos.count; i++) {
      const s = localPos.getX(i);
      const w = localPos.getZ(i);
      const x = s * sin58 + w * cos58;
      const z = -s * cos58 + w * sin58;
      localPos.setXYZ(i, x, 0, z);
    }

    // Initial elevation setup (both coarse mesh and local terrace mesh)
    this.updateGeometryElevations();

    // Material with high-resolution satellite texture
    this.textureLoader = new THREE.TextureLoader();
    this.satelliteTexture = null;

    const defaultColorMat = new THREE.MeshStandardMaterial({
      color: 0x5a6358,
      roughness: 0.92,
      metalness: 0.05,
      flatShading: false,
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.Mesh(this.geometry, defaultColorMat);
    this.mesh.receiveShadow = true;

    this.localTerraceMesh = new THREE.Mesh(this.localTerraceGeometry, defaultColorMat);
    this.localTerraceMesh.receiveShadow = true;
    this.mesh.add(this.localTerraceMesh);

    // Load real DEM and satellite imagery if in browser environment
    if (!this.isLoaded) {
      this.loadRealWorldAssets();
    }
  }

  /**
   * Procedural Himalayan fallback algorithm while real DEM loads or in tests
   */
  initProceduralFallback() {
    const sin58 = 0.848048;
    const cos58 = 0.529919;
    const halfLength = this.runwayLength * 0.5;

    for (let gy = 0; gy < this.gridSize; gy++) {
      for (let gx = 0; gx < this.gridSize; gx++) {
        // Map grid indices to world coordinates (inverting shiftX/shiftZ applied in getHeight)
        const worldX = ((gx / (this.gridSize - 1)) - 0.5) * this.size - this.shiftX;
        const worldZ = ((gy / (this.gridSize - 1)) - 0.5) * this.size - this.shiftZ;

        // s: distance along runway axis (SW to NE)
        // w: distance lateral / perpendicular to runway axis (SE to NW)
        const s = worldX * sin58 - worldZ * cos58;
        const w = worldX * cos58 + worldZ * sin58;

        // Base canyon floor along Dudh Kosi gorge
        let canyonFloor = 2836.0;
        if (s < -halfLength) {
          // Drops into Dudh Kosi river gorge (elevation down to ~1,950m at s = -5000m)
          const distSW = -s - halfLength;
          canyonFloor = Math.max(1950.0, 2805.0 - distSW * 0.22);
        } else if (s > halfLength) {
          // Rises into mountain wall
          const distNE = s - halfLength;
          canyonFloor = 2867.0 + distNE * 0.35;
        } else {
          // On runway: slope from 2805m to 2867m
          canyonFloor = 2836.0 + s * 0.1176;
        }

        // Natural mountain ridges rise on both lateral sides (|w| > 100m)
        const absW = Math.abs(w);
        let ridgeH = 0.0;
        if (absW > 100.0) {
          const latDist = absW - 100.0;
          ridgeH = Math.min(2800.0, Math.pow(latDist / 400.0, 1.6) * 450.0);
        }

        let baseH = canyonFloor + ridgeH;

        // Flatten airport terrace and runway envelope
        if (s >= -halfLength && s <= halfLength) {
          const rwyH = 2836.0 + s * 0.1176;
          let targetH = rwyH;
          let flatWMin = -45.0;
          let flatWMax = 45.0;
          let blendW = 55.0;

          if (s >= -15.0 && s <= 135.0) {
            flatWMax = 85.0;
            blendW = 50.0;
            if (w > 15.0) {
              targetH = Math.max(rwyH, 2844.0);
            }
          }

          if (w >= flatWMin && w <= flatWMax) {
            baseH = Math.min(baseH, targetH);
          } else if (w < flatWMin) {
            const dist = flatWMin - w;
            if (dist < blendW) {
              const t = dist / blendW;
              const weight = 0.5 * (1.0 + Math.cos(t * Math.PI));
              baseH = Math.min(baseH, targetH) * weight + baseH * (1.0 - weight);
            }
          } else if (w > flatWMax) {
            const dist = w - flatWMax;
            if (dist < blendW) {
              const t = dist / blendW;
              const weight = 0.5 * (1.0 + Math.cos(t * Math.PI));
              baseH = Math.min(baseH, targetH) * weight + baseH * (1.0 - weight);
            }
          }
        }

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
            flatShading: false,
            side: THREE.DoubleSide
          });
          this.mesh.material.needsUpdate = true;
          if (this.localTerraceMesh) {
            this.localTerraceMesh.material = this.mesh.material;
          }
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
    const sin58 = 0.848048;
    const cos58 = 0.529919;
    const pos = this.geometry.attributes.position;
    const uvs = this.geometry.attributes.uv;
    const count = pos.count;
    // A rotated coarse cell can extend this far along either runway axis.
    const coarseMargin = (this.size / this.segments) * (sin58 + cos58);

    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);

      let h = this.getHeight(x, z);

      // Depress coarse mesh vertices within the local high-res terrace envelope
      // so coarse 86m triangles never bulge above the carved terrace or runway surface
      const s = x * sin58 - z * cos58;
      const w = x * cos58 + z * sin58;
      if (Math.abs(s) <= 360.0 && Math.abs(w) <= 130.0) {
        h -= 10.0;
      }
      if (Math.abs(s) <= this.runwayLength * 0.5 + coarseMargin &&
          Math.abs(w) <= this.runwayWidth * 0.5 + coarseMargin) {
        h = Math.min(h, this.midElevation + s * this.runwayGradient - 10.0);
      }

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

    // Update local high-resolution terrace mesh (10m spacing)
    if (this.localTerraceGeometry) {
      const lPos = this.localTerraceGeometry.attributes.position;
      const lUvs = this.localTerraceGeometry.attributes.uv;
      const lCount = lPos.count;

      for (let i = 0; i < lCount; i++) {
        const x = lPos.getX(i);
        const z = lPos.getZ(i);
        let h = this.getHeight(x, z);
        const s = x * sin58 - z * cos58;
        const w = x * cos58 + z * sin58;
        // Recess only the rendered terrain beneath the asphalt. Include one
        // terrace cell beyond each edge so interpolated boundary triangles
        // cannot cross the runway plane, especially at the uphill threshold.
        // Keep getHeight() unchanged for landing gear and collision queries.
        if (Math.abs(s) <= this.runwayLength * 0.5 + 10.0 &&
            Math.abs(w) <= this.runwayWidth * 0.5 + 10.0) {
          h = Math.min(h, this.midElevation + s * this.runwayGradient - 0.5);
        }
        lPos.setY(i, h);

        if (lUvs) {
          const u = ((x + this.shiftX) / this.size) + 0.5;
          const v = 1.0 - (((z + this.shiftZ) / this.size) + 0.5);
          lUvs.setXY(i, Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v)));
        }
      }

      lPos.needsUpdate = true;
      if (lUvs) lUvs.needsUpdate = true;
      this.localTerraceGeometry.computeVertexNormals();
    }
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
    const absW = Math.abs(w);

    // 2. Lukla Airport Carved Terrace & Sloped Runway Trench
    if (s >= -halfLength && s <= halfLength) {
      // Sloped runway elevation (11.76% uphill grade: 2805m at threshold 06 to 2867m at threshold 24)
      const rwyH = this.midElevation + s * this.runwayGradient;

      if (absW <= halfWidth) {
        // Flat on runway tarmac surface
        return rwyH;
      }

      // Apron tarmac and helipads terrace surface
      if (s >= -15.0 && s <= 135.0 && w > halfWidth && w <= 52.0) {
        return Math.max(rwyH, 2844.0);
      }

      let targetH = rwyH;
      let flatWMin = -45.0; // Flat shoulder on canyon side
      let flatWMax = 45.0;  // Flat shoulder on mountain side
      let blendW = 55.0;

      // Apron, terminal, and control tower terrace zone (s in [-15, 135])
      // In this zone, the mountain is leveled to form the aircraft parking apron and terminal plateau
      if (s >= -15.0 && s <= 135.0) {
        flatWMax = 85.0; // Encompasses apron (w up to 51m) and terminal/tower (w up to 70m)
        blendW = 50.0;
        if (w > 15.0) {
          // Apron terrace elevation sits cleanly at ~2844m
          targetH = Math.max(rwyH, 2844.0);
        }
      }

      if (w >= flatWMin && w <= flatWMax) {
        return Math.min(naturalH, targetH);
      } else if (w < flatWMin) {
        const dist = flatWMin - w;
        if (dist < blendW) {
          const t = dist / blendW;
          const weight = 0.5 * (1.0 + Math.cos(t * Math.PI));
          return Math.min(naturalH, targetH) * weight + naturalH * (1.0 - weight);
        }
      } else if (w > flatWMax) {
        const dist = w - flatWMax;
        if (dist < blendW) {
          const t = dist / blendW;
          const weight = 0.5 * (1.0 + Math.cos(t * Math.PI));
          return Math.min(naturalH, targetH) * weight + naturalH * (1.0 - weight);
        }
      }
    } else if (s > halfLength && s < halfLength + 140.0) {
      // Beyond Runway 24 upper end: steep retaining rock wall and mountain slope
      const wallDist = s - halfLength;
      const wallH = this.threshold24Elevation + wallDist * 1.8;
      const absW = Math.abs(w);
      if (absW <= 35.0) {
        return Math.max(naturalH, wallH);
      } else if (absW < 80.0) {
        const t = (absW - 35.0) / 45.0;
        const weight = 0.5 * (1.0 + Math.cos(t * Math.PI));
        return Math.max(naturalH, wallH) * weight + naturalH * (1.0 - weight);
      }
    } else if (s < -halfLength) {
      // Beyond Runway 06 lower end: cliff plunging into Dudh Kosi canyon, blended smoothly into DEM
      const dropDist = -halfLength - s;
      let canyonH;
      if (dropDist <= 200.0) {
        canyonH = this.threshold06Elevation - dropDist * 1.75;
      } else {
        canyonH = 2455.0 - (dropDist - 200.0) * 0.15;
      }

      // Smoothly blend canyonH into naturalH between dropDist = 200m and 1200m (s = -463.5 to -1463.5)
      let targetH;
      if (dropDist <= 200.0) {
        targetH = canyonH;
      } else if (dropDist < 1200.0) {
        const t = (dropDist - 200.0) / 1000.0;
        const weightS = 0.5 * (1.0 + Math.cos(t * Math.PI));
        targetH = Math.min(naturalH, canyonH) * weightS + naturalH * (1.0 - weightS);
      } else {
        targetH = naturalH;
      }

      const absW = Math.abs(w);
      if (absW <= 40.0) {
        return Math.min(naturalH, targetH);
      } else if (absW < 110.0) {
        const t = (absW - 40.0) / 70.0;
        const weightW = 0.5 * (1.0 + Math.cos(t * Math.PI));
        return Math.min(naturalH, targetH) * weightW + naturalH * (1.0 - weightW);
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
