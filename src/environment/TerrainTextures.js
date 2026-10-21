import * as THREE from 'three';

/**
 * Procedural PBR Texture Generator for Flight3D Terrain
 * Generates seamless, periodic, high-resolution PBR textures (Albedo, Normal, Roughness)
 * packed into RGBA DataTextures:
 * - Albedo in RGB, Roughness in Alpha
 * - Tangent-space Normal in RGB (128, 128, 255 = flat)
 *
 * Uses deterministic hashing and periodic lattice noise so textures tile 100% seamlessly
 * with zero boundary seams and zero network/external asset dependencies.
 */

/**
 * Generate a periodic 2D fractal noise grid of size [w, h] with integer period.
 * Wrapping at boundaries is mathematically exact (periodic lattice).
 */
function createPeriodicNoiseGrid(w, h, basePeriod = 16, octaves = 4, persistence = 0.5, seed = 42) {
  // Hash both axes independently. Flattening rows into a 256-entry permutation
  // correlated adjacent rows and produced diagonal/checker patterns from altitude.
  const lattice = (x, y, octave) => {
    let hash = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed ^ Math.imul(octave, 1274126177);
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
  };

  const out = new Float32Array(w * h);

  let maxAmp = 0;
  let curAmp = 1.0;
  let curFreq = 1;

  for (let o = 0; o < octaves; o++) {
    const period = basePeriod * curFreq;

    for (let y = 0; y < h; y++) {
      const yCoord = (y / h) * period;
      const j0 = Math.floor(yCoord);
      const j1 = (j0 + 1) % period;
      const fy = yCoord - j0;
      const sy = fy * fy * (3.0 - 2.0 * fy);

      const yOffset = y * w;

      for (let x = 0; x < w; x++) {
        const xCoord = (x / w) * period;
        const i0 = Math.floor(xCoord);
        const i1 = (i0 + 1) % period;
        const fx = xCoord - i0;
        const sx = fx * fx * (3.0 - 2.0 * fx);

        const v00 = lattice(i0, j0, o);
        const v10 = lattice(i1, j0, o);
        const v01 = lattice(i0, j1, o);
        const v11 = lattice(i1, j1, o);

        const v0 = v00 * (1.0 - sx) + v10 * sx;
        const v1 = v01 * (1.0 - sx) + v11 * sx;
        const val = (v0 * (1.0 - sy) + v1 * sy) * curAmp;

        out[yOffset + x] += val;
      }
    }

    maxAmp += curAmp;
    curAmp *= persistence;
    curFreq *= 2;
  }

  // Normalize to [0, 1]
  const invMax = 1.0 / maxAmp;
  for (let i = 0; i < out.length; i++) {
    out[i] *= invMax;
  }

  return out;
}

/**
 * Compute seamless tangent-space normal map from periodic height grid.
 */
function createNormalFromHeights(heights, w, h, strength = 1.5) {
  const normalData = new Uint8Array(w * h * 4);

  for (let y = 0; y < h; y++) {
    const yU = ((y - 1 + h) % h) * w;
    const yD = ((y + 1) % h) * w;
    const yCur = y * w;

    for (let x = 0; x < w; x++) {
      const xL = (x - 1 + w) % w;
      const xR = (x + 1) % w;

      // Central difference
      const dx = (heights[yCur + xR] - heights[yCur + xL]) * strength;
      const dy = (heights[yD + x] - heights[yU + x]) * strength;

      const invLen = 1.0 / Math.sqrt(dx * dx + dy * dy + 1.0);
      const nx = -dx * invLen;
      const ny = -dy * invLen;
      const nz = invLen;

      const idx = (yCur + x) * 4;
      normalData[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      normalData[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalData[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normalData[idx + 3] = 255;
    }
  }

  return normalData;
}

function createDataTexture(data, w, h, isSRGB = true) {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = isSRGB ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 1. Grass (512x512)
 * Lush natural green with subtle patchiness, fine blade texture, and soil undertones.
 */
function generateGrassTextures(w = 512, h = 512) {
  const nMacro = createPeriodicNoiseGrid(w, h, 8, 4, 0.5, 101);
  const nMicro = createPeriodicNoiseGrid(w, h, 32, 3, 0.5, 202);

  const albedoData = new Uint8Array(w * h * 4);
  const heights = new Float32Array(w * h);

  for (let i = 0; i < w * h; i++) {
    const macro = nMacro[i];
    const micro = nMicro[i];
    heights[i] = macro * 0.65 + micro * 0.35;

    // Base colors: lush green (56, 102, 49), darker forest patch (35, 68, 30), sunny olive (85, 138, 58)
    const patch = macro * 0.8 + micro * 0.2;
    let r, g, b;
    if (patch < 0.45) {
      // Dark moist soil / deep turf
      const t = patch / 0.45;
      r = 45 * (1 - t) + 40 * t;
      g = 52 * (1 - t) + 82 * t;
      b = 32 * (1 - t) + 38 * t;
    } else if (patch < 0.8) {
      // Lush green field
      const t = (patch - 0.45) / 0.35;
      r = 40 * (1 - t) + 68 * t;
      g = 82 * (1 - t) + 125 * t;
      b = 38 * (1 - t) + 48 * t;
    } else {
      // Sunny bright grass tips
      const t = (patch - 0.8) / 0.2;
      r = 68 * (1 - t) + 95 * t;
      g = 125 * (1 - t) + 155 * t;
      b = 48 * (1 - t) + 62 * t;
    }

    // Roughness: 0.86 - 0.94 (matte vegetation)
    const roughness = Math.round((0.87 + macro * 0.06) * 255);

    const idx = i * 4;
    albedoData[idx] = Math.min(255, Math.max(0, Math.round(r)));
    albedoData[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
    albedoData[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
    albedoData[idx + 3] = roughness;
  }

  const normalData = createNormalFromHeights(heights, w, h, 1.4);

  return {
    albedo: createDataTexture(albedoData, w, h, true),
    normal: createDataTexture(normalData, w, h, false)
  };
}

/**
 * 2. Sand / Coastal Beach (256x256)
 * Golden beach sand with gentle ripples and fine quartz grains.
 */
function generateSandTextures(w = 256, h = 256) {
  const nMacro = createPeriodicNoiseGrid(w, h, 6, 3, 0.5, 303);
  const nMicro = createPeriodicNoiseGrid(w, h, 24, 3, 0.5, 404);

  const albedoData = new Uint8Array(w * h * 4);
  const heights = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const i = y * w + x;
      const macro = nMacro[i];
      const micro = nMicro[i];

      // Subtle periodic ripples along u
      const ripple = Math.sin(u * 20.0 * Math.PI + macro * 4.0) * 0.12;
      const hVal = macro * 0.5 + ripple + micro * 0.38;
      heights[i] = hVal;

      // Beach sand tones: warm golden beige (212, 184, 134)
      const tone = Math.min(1.0, Math.max(0.0, macro * 0.6 + ripple * 0.5 + micro * 0.4));
      const r = 188 + tone * 36;
      const g = 160 + tone * 32;
      const b = 118 + tone * 24;

      // Roughness: 0.80 - 0.88
      const roughness = Math.round((0.82 + micro * 0.06) * 255);

      const idx = i * 4;
      albedoData[idx] = Math.min(255, Math.max(0, Math.round(r)));
      albedoData[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      albedoData[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      albedoData[idx + 3] = roughness;
    }
  }

  const normalData = createNormalFromHeights(heights, w, h, 1.1);

  return {
    albedo: createDataTexture(albedoData, w, h, true),
    normal: createDataTexture(normalData, w, h, false)
  };
}

/**
 * 3. Mountain Rock / Cliff (512x512)
 * Stratified craggy granite/slate with sharp ridges, mineral strata, and deep crevices.
 */
function generateRockTextures(w = 512, h = 512) {
  const nMacro = createPeriodicNoiseGrid(w, h, 8, 4, 0.55, 505);
  const nRidge = createPeriodicNoiseGrid(w, h, 16, 4, 0.5, 606);
  const nMicro = createPeriodicNoiseGrid(w, h, 32, 3, 0.45, 707);

  const albedoData = new Uint8Array(w * h * 4);
  const heights = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const macro = nMacro[i];
      // Ridge noise creates sharp mountain crags and cleavage planes
      let ridge = 1.0 - Math.abs(nRidge[i] * 2.0 - 1.0);
      ridge = ridge * ridge;

      // Horizontal geological strata
      const strata = Math.sin(v * 24.0 * Math.PI + macro * 5.0) * 0.15;
      const hVal = macro * 0.35 + ridge * 0.45 + strata + nMicro[i] * 0.2;
      heights[i] = hVal;

      // Base colors: dark slate granite (90, 84, 76), ochre mineral bands (120, 96, 75), quartz (140, 136, 128)
      let r, g, b;
      if (hVal < 0.35) {
        // Shadowed rock crevice
        const t = hVal / 0.35;
        r = 50 * (1 - t) + 72 * t;
        g = 46 * (1 - t) + 68 * t;
        b = 42 * (1 - t) + 64 * t;
      } else if (hVal < 0.7) {
        // Weathered slate rock with ochre vein
        const t = (hVal - 0.35) / 0.35;
        r = 72 * (1 - t) + 112 * t;
        g = 68 * (1 - t) + 98 * t;
        b = 64 * (1 - t) + 82 * t;
      } else {
        // Exposed granite face & light quartz
        const t = (hVal - 0.7) / 0.3;
        r = 112 * (1 - t) + 145 * t;
        g = 98 * (1 - t) + 140 * t;
        b = 82 * (1 - t) + 132 * t;
      }

      // Roughness: 0.70 - 0.82 (highlights catch sun on ridge edges)
      const roughness = Math.round((0.72 + (1.0 - ridge) * 0.12) * 255);

      const idx = i * 4;
      albedoData[idx] = Math.min(255, Math.max(0, Math.round(r)));
      albedoData[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      albedoData[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      albedoData[idx + 3] = roughness;
    }
  }

  // Strong normal relief for cliffs
  const normalData = createNormalFromHeights(heights, w, h, 2.4);

  return {
    albedo: createDataTexture(albedoData, w, h, true),
    normal: createDataTexture(normalData, w, h, false)
  };
}

/**
 * 4. Alpine Snow (256x256)
 * Crisp wind-carved snowdrifts with crystalline sheen.
 */
function generateSnowTextures(w = 256, h = 256) {
  const nMacro = createPeriodicNoiseGrid(w, h, 6, 3, 0.5, 808);
  const nMicro = createPeriodicNoiseGrid(w, h, 24, 3, 0.4, 909);

  const albedoData = new Uint8Array(w * h * 4);
  const heights = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const i = y * w + x;
      const macro = nMacro[i];
      const micro = nMicro[i];

      // Wind drift ripples
      const drift = Math.sin((u + v * 0.5) * 12.0 * Math.PI + macro * 3.0) * 0.1;
      const hVal = macro * 0.6 + drift + micro * 0.3;
      heights[i] = hVal;

      // Bright snow: sunlit white (245, 248, 252), blue shadow trough (215, 226, 240)
      const t = Math.min(1.0, Math.max(0.0, hVal));
      const r = 215 * (1 - t) + 248 * t;
      const g = 226 * (1 - t) + 250 * t;
      const b = 240 * (1 - t) + 254 * t;

      // Roughness: 0.48 - 0.60 (slick, slightly specular ice crust)
      const roughness = Math.round((0.50 + micro * 0.12) * 255);

      const idx = i * 4;
      albedoData[idx] = Math.min(255, Math.max(0, Math.round(r)));
      albedoData[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      albedoData[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      albedoData[idx + 3] = roughness;
    }
  }

  const normalData = createNormalFromHeights(heights, w, h, 0.8);

  return {
    albedo: createDataTexture(albedoData, w, h, true),
    normal: createDataTexture(normalData, w, h, false)
  };
}

/**
 * 5. Runway Mesa Zone / Compacted Earth (256x256)
 * Asphalt aggregate / dark compacted apron base.
 */
function generateRunwayTextures(w = 256, h = 256) {
  const nMacro = createPeriodicNoiseGrid(w, h, 8, 3, 0.5, 1111);
  const nMicro = createPeriodicNoiseGrid(w, h, 32, 3, 0.5, 1212);

  const albedoData = new Uint8Array(w * h * 4);
  const heights = new Float32Array(w * h);

  for (let i = 0; i < w * h; i++) {
    const macro = nMacro[i];
    const micro = nMicro[i];
    heights[i] = macro * 0.4 + micro * 0.6;

    // Dark asphalt / service aggregate (51, 65, 56)
    const aggregate = micro;
    const r = 40 + aggregate * 25;
    const g = 50 + aggregate * 26;
    const b = 44 + aggregate * 22;

    // Roughness: 0.78 - 0.84
    const roughness = Math.round((0.80 + micro * 0.05) * 255);

    const idx = i * 4;
    albedoData[idx] = Math.min(255, Math.max(0, Math.round(r)));
    albedoData[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
    albedoData[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
    albedoData[idx + 3] = roughness;
  }

  const normalData = createNormalFromHeights(heights, w, h, 1.2);

  return {
    albedo: createDataTexture(albedoData, w, h, true),
    normal: createDataTexture(normalData, w, h, false)
  };
}

/**
 * 6. Micro-detail Normal Map (256x256)
 * High-frequency pebble/grit bumpiness for ground-level inspection.
 */
function generateMicroNormal(w = 256, h = 256) {
  const n1 = createPeriodicNoiseGrid(w, h, 32, 2, 0.5, 1313);
  const n2 = createPeriodicNoiseGrid(w, h, 64, 2, 0.5, 1414);

  const heights = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    // Sharp cellular pebble bumps
    const p = n1[i];
    heights[i] = p * 0.6 + n2[i] * 0.4;
  }

  const normalData = createNormalFromHeights(heights, w, h, 1.8);
  return createDataTexture(normalData, w, h, false);
}

/**
 * Singleton cache for terrain textures
 */
let cachedTextures = null;

export class TerrainTextures {
  static getTextures(forceRegenerate = false) {
    if (cachedTextures && !forceRegenerate) {
      return cachedTextures;
    }

    const grass = generateGrassTextures(512, 512);
    const sand = generateSandTextures(256, 256);
    const rock = generateRockTextures(512, 512);
    const snow = generateSnowTextures(256, 256);
    const runway = generateRunwayTextures(256, 256);
    const micro = generateMicroNormal(256, 256);

    cachedTextures = {
      grassMap: grass.albedo,
      grassNormal: grass.normal,
      sandMap: sand.albedo,
      sandNormal: sand.normal,
      rockMap: rock.albedo,
      rockNormal: rock.normal,
      snowMap: snow.albedo,
      snowNormal: snow.normal,
      runwayMap: runway.albedo,
      runwayNormal: runway.normal,
      microNormal: micro
    };

    return cachedTextures;
  }

  static dispose() {
    if (!cachedTextures) return;
    Object.values(cachedTextures).forEach(tex => {
      if (tex && typeof tex.dispose === 'function') {
        tex.dispose();
      }
    });
    cachedTextures = null;
  }
}
