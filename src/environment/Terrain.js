import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { TerrainTextures } from './TerrainTextures.js';

function mulberry32(a) {
  return function() {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Procedural Terrain with Rolling Hills, Coastal Mountains, and Flat Airport Mesa
 * Features multi-layer PBR texture splatting, slope-dependent triplanar cliff projection,
 * micro-detail normal tiling, and world-space UV coordinate alignment.
 *
 * CRITICAL CONTRACT:
 * getHeight(x, z) MUST remain the exact source of truth for physics, gear suspension,
 * tree/building placement, and collision detection.
 */
export class Terrain {
  constructor(size = 20000, segments = 256, options = {}) {
    this.size = size;
    this.segments = segments;

    // Quality preset: 'high' (5-layer + triplanar + micro normal) or 'low' (2-layer planar)
    this.quality = options.quality === 'low' ? 'low' : 'high';

    // PBR tuning parameters
    this.normalStrength = options.normalStrength !== undefined ? options.normalStrength : 0.85;
    this.microStrength = options.microStrength !== undefined ? options.microStrength : 0.45;
    this.triplanarSharpness = options.triplanarSharpness !== undefined ? options.triplanarSharpness : 6.0;

    // Custom or procedurally generated PBR textures
    this.textures = options.textures || TerrainTextures.getTextures();

    // Deterministic seeded PRNG (seed 424242) ensures identical repeatable world geometry across all sessions and tests
    this.simplex = new SimplexNoise({ random: mulberry32(424242) });

    // Airport zone definition (flat plateau at y = 12m)
    this.airportCenter = new THREE.Vector2(0, 0);
    this.airportLength = 3800; // East-West
    this.airportWidth = 900;   // North-South
    this.airportElevation = 12.0;

    this.mesh = null;
    this.geometry = null;
    this.material = null;
    this.shaderUniforms = null;

    this.initTerrain();
  }

  /**
   * Analytical height function for terrain at world (x, z)
   * CONTRACT: Analytical source of truth for all physics, collision, and placement systems.
   */
  getHeight(x, z) {
    // 1. Check distance to airport bounds for flat plateau carving
    const dx = Math.abs(x - this.airportCenter.x);
    const dz = Math.abs(z - this.airportCenter.y);

    const halfL = this.airportLength * 0.5;
    const halfW = this.airportWidth * 0.5;
    const blendMargin = 500.0;

    let airportWeight = 0;
    if (dx < halfL && dz < halfW) {
      airportWeight = 1.0;
    } else if (dx < halfL + blendMargin && dz < halfW + blendMargin) {
      const qx = Math.max(0, dx - halfL) / blendMargin;
      const qz = Math.max(0, dz - halfW) / blendMargin;
      const d = Math.min(1.0, Math.sqrt(qx * qx + qz * qz));
      airportWeight = 0.5 * (1.0 + Math.cos(d * Math.PI));
    }

    // 2. Multi-octave natural terrain noise
    // Ocean basin in positive Z (South), Mountain range in negative Z (North) and East
    const nx = x * 0.00018;
    const nz = z * 0.00018;

    // Macro mountain ridges (octave 1)
    let n1 = this.simplex.noise(nx, nz);
    // Ridge noise using abs()
    let ridges = 1.0 - Math.abs(this.simplex.noise(nx * 2.2, nz * 2.2));
    ridges = ridges * ridges;

    // Rolling hills (octaves 2 & 3)
    let n2 = this.simplex.noise(nx * 3.5, nz * 3.5) * 0.5;
    let n3 = this.simplex.noise(nx * 8.0, nz * 8.0) * 0.25;
    let n4 = this.simplex.noise(nx * 18.0, nz * 18.0) * 0.1;

    // Coastal ocean factor: mountains in North (negative Z), tapering toward South bay (z > 1200)
    const southFactor = Math.max(0.0, Math.min(1.0, (1500.0 - z) / 2200.0));
    const mountainScale = 0.15 + 0.85 * southFactor;

    let baseH = (n1 * 180.0 + ridges * 380.0 + (n2 + n3 + n4) * 80.0) * mountainScale;

    // Coastal gradient: lower elevation toward the ocean (South / East bay)
    const oceanFalloff = Math.max(0, z - 800.0) * 0.045;
    baseH -= oceanFalloff;

    // Near airport: natural ground is kept gentle
    const distToAirport = Math.sqrt(x * x + z * z);
    if (distToAirport < 4000) {
      const flatten = 1.0 - distToAirport / 4000.0;
      baseH = baseH * (1.0 - flatten * 0.85);
    }

    // Runway approach corridor clearance (Runway 09L / 27R extended centerline along Z = 0)
    // Ensures obstacle clearance below the standard 3.0° glideslope (ICAO Annex 14 / TERPS OFZ)
    const corridorHalfWidth = 850.0;
    if (Math.abs(z) < corridorHalfWidth) {
      const zFactor = 1.0 - Math.abs(z) / corridorHalfWidth;
      const smoothZ = zFactor * zFactor * (3.0 - 2.0 * zFactor);

      if (x < -1600 && x > -5500) {
        // Flatten extended final approach corridor completely down to airport elevation
        baseH = baseH * (1.0 - smoothZ) + this.airportElevation * smoothZ;
      } else if (x <= -5500 && x > -8500) {
        // Distant approach: 2.0° clearance slope smoothly rising from corridor boundary (-5500m)
        const distFromBoundary = -5500 - x;
        const maxClearanceH = this.airportElevation + distFromBoundary * 0.020;
        if (baseH > maxClearanceH) {
          baseH = baseH * (1.0 - smoothZ) + maxClearanceH * smoothZ;
        }
      } else if (x > 1600 && x < 8500) {
        // East departure: climb corridor clearance
        const distFromThreshold = x - 1600;
        const maxClearanceH = this.airportElevation + distFromThreshold * 0.030;
        if (baseH > maxClearanceH) {
          baseH = baseH * (1.0 - smoothZ) + maxClearanceH * smoothZ;
        }
      }
    }

    // Perimeter edge falloff: smoothly slope perimeter mountains down into coastal waters (-18m)
    // so the terrain edge never clips as a sharp wall against the sky
    const edgeMargin = Math.max(Math.abs(x), Math.abs(z));
    if (edgeMargin > 8200.0) {
      const t = Math.max(0.0, Math.min(1.0, (10800.0 - edgeMargin) / 2600.0));
      const smoothEdge = t * t * (3.0 - 2.0 * t);
      baseH = baseH * smoothEdge + (1.0 - smoothEdge) * (-18.0);
    }

    // Ocean floor clamp
    const naturalHeight = Math.max(-45.0, baseH);

    // Blend natural height with flat airport plateau
    const finalHeight = (1.0 - airportWeight) * naturalHeight + airportWeight * this.airportElevation;

    return finalHeight;
  }

  setQuality(quality) {
    if (quality !== 'high' && quality !== 'low') {
      throw new Error(`Invalid quality preset: ${quality}. Expected 'high' or 'low'.`);
    }
    this.quality = quality;
    if (this.material) {
      this.material.defines = this.material.defines || {};
      this.material.defines.QUALITY_LOW = (quality === 'low' ? 1 : 0);
      this.material.needsUpdate = true;
    }
  }

  getQuality() {
    return this.quality;
  }

  setNormalStrength(strength) {
    this.normalStrength = strength;
    if (this.shaderUniforms && this.shaderUniforms.uNormalStrength) {
      this.shaderUniforms.uNormalStrength.value = strength;
    }
  }

  setMicroStrength(strength) {
    this.microStrength = strength;
    if (this.shaderUniforms && this.shaderUniforms.uMicroStrength) {
      this.shaderUniforms.uMicroStrength.value = strength;
    }
  }

  setTriplanarSharpness(sharpness) {
    this.triplanarSharpness = sharpness;
    if (this.shaderUniforms && this.shaderUniforms.uTriplanarSharpness) {
      this.shaderUniforms.uTriplanarSharpness.value = sharpness;
    }
  }

  initTerrain() {
    this.geometry = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    this.geometry.rotateX(-Math.PI * 0.5); // Align to X-Z horizontal plane

    const pos = this.geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    // Procedural color palette (kept on geometry for debugging / fallback)
    const colorSand = new THREE.Color(0xd4b886);
    const colorGrass = new THREE.Color(0x386631);
    const colorForest = new THREE.Color(0x23441e);
    const colorRock = new THREE.Color(0x5a544c);
    const colorSnow = new THREE.Color(0xf1f5f9);
    const colorRunwayZone = new THREE.Color(0x334138);

    const tempColor = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = this.getHeight(x, z);
      pos.setY(i, y);

      // Height and slope based color splatting
      const isAirport = Math.abs(x) < 1800 && Math.abs(z) < 400;

      if (isAirport) {
        tempColor.copy(colorRunwayZone);
      } else if (y < 2.5) {
        // Coastal sandy beach
        tempColor.copy(colorSand);
      } else if (y < 65) {
        // Lowland grass & fields
        const t = (y - 2.5) / 62.5;
        tempColor.copy(colorSand).lerp(colorGrass, t);
      } else if (y < 220) {
        // Forested foothills
        const t = (y - 65) / 155.0;
        tempColor.copy(colorGrass).lerp(colorForest, t);
      } else if (y < 380) {
        // High mountain rock
        const t = (y - 220) / 160.0;
        tempColor.copy(colorForest).lerp(colorRock, t);
      } else {
        // Snowy peaks
        const t = Math.min(1.0, (y - 380) / 120.0);
        tempColor.copy(colorRock).lerp(colorSnow, t);
      }

      colors[i * 3 + 0] = tempColor.r;
      colors[i * 3 + 1] = tempColor.g;
      colors[i * 3 + 2] = tempColor.b;
    }

    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geometry.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      roughness: 0.88,
      metalness: 0.05,
      flatShading: false,
      defines: {
        QUALITY_LOW: this.quality === 'low' ? 1 : 0
      }
    });

    terrainMat.onBeforeCompile = (shader) => {
      // 1. Assign PBR Texture & Parameter Uniforms
      shader.uniforms.uGrassMap = { value: this.textures.grassMap };
      shader.uniforms.uGrassNormal = { value: this.textures.grassNormal };
      shader.uniforms.uSandMap = { value: this.textures.sandMap };
      shader.uniforms.uSandNormal = { value: this.textures.sandNormal };
      shader.uniforms.uRockMap = { value: this.textures.rockMap };
      shader.uniforms.uRockNormal = { value: this.textures.rockNormal };
      shader.uniforms.uSnowMap = { value: this.textures.snowMap };
      shader.uniforms.uSnowNormal = { value: this.textures.snowNormal };
      shader.uniforms.uRunwayMap = { value: this.textures.runwayMap };
      shader.uniforms.uRunwayNormal = { value: this.textures.runwayNormal };
      shader.uniforms.uMicroNormal = { value: this.textures.microNormal };

      shader.uniforms.uAirportCenter = { value: this.airportCenter };
      shader.uniforms.uAirportSize = { value: new THREE.Vector2(this.airportLength, this.airportWidth) };
      shader.uniforms.uAirportBlendMargin = { value: 500.0 };

      // World-space UV scales (meters -> UV)
      shader.uniforms.uGrassScale = { value: 0.08 };
      shader.uniforms.uSandScale = { value: 0.05 };
      shader.uniforms.uRockScale = { value: 0.035 };
      shader.uniforms.uSnowScale = { value: 0.03 };
      shader.uniforms.uRunwayScale = { value: 0.06 };
      shader.uniforms.uMicroScale = { value: 0.75 };

      shader.uniforms.uNormalStrength = { value: this.normalStrength };
      shader.uniforms.uMicroStrength = { value: this.microStrength };
      shader.uniforms.uTriplanarSharpness = { value: this.triplanarSharpness };

      this.shaderUniforms = shader.uniforms;

      // 2. Vertex Shader: Export world-space coordinates and normal
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTerrainWorldPos;
        varying vec3 vTerrainWorldNormal;`
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTerrainWorldNormal = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);`
      );

      // 3. Fragment Shader: Inject varying, uniform, splatting, and triplanar logic
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTerrainWorldPos;
        varying vec3 vTerrainWorldNormal;

        uniform sampler2D uGrassMap;
        uniform sampler2D uGrassNormal;
        uniform sampler2D uSandMap;
        uniform sampler2D uSandNormal;
        uniform sampler2D uRockMap;
        uniform sampler2D uRockNormal;
        uniform sampler2D uSnowMap;
        uniform sampler2D uSnowNormal;
        uniform sampler2D uRunwayMap;
        uniform sampler2D uRunwayNormal;
        uniform sampler2D uMicroNormal;

        uniform vec2 uAirportCenter;
        uniform vec2 uAirportSize;
        uniform float uAirportBlendMargin;

        uniform float uGrassScale;
        uniform float uSandScale;
        uniform float uRockScale;
        uniform float uSnowScale;
        uniform float uRunwayScale;
        uniform float uMicroScale;

        uniform float uNormalStrength;
        uniform float uMicroStrength;
        uniform float uTriplanarSharpness;`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>

        vec3 wPos = vTerrainWorldPos;
        vec3 wNorm = normalize(vTerrainWorldNormal);

        // Slope cliff detection: steep slopes become rock cliffs
        // Normal.y < 0.65 corresponds to slopes steeper than ~49.5 degrees
        float slopeCliff = 1.0 - smoothstep(0.55, 0.68, wNorm.y);

        // Airport mesa plateau mask (elevation 12.0m)
        float dx = abs(wPos.x - uAirportCenter.x);
        float dz = abs(wPos.z - uAirportCenter.y);
        float halfL = uAirportSize.x * 0.5;
        float halfW = uAirportSize.y * 0.5;
        float airportWeight = 0.0;
        if (dx < halfL && dz < halfW) {
          airportWeight = 1.0;
        } else if (dx < halfL + uAirportBlendMargin && dz < halfW + uAirportBlendMargin) {
          float qx = max(0.0, dx - halfL) / uAirportBlendMargin;
          float qz = max(0.0, dz - halfW) / uAirportBlendMargin;
          float d = min(1.0, length(vec2(qx, qz)));
          airportWeight = 0.5 * (1.0 + cos(d * 3.1415926535));
        }

        vec3 tFinalAlbedo;
        float tFinalRoughness;
        float tFinalMetalness;
        vec3 tFinalWorldNormal;

        #if defined(QUALITY_LOW) && QUALITY_LOW == 1
          // Low Quality Preset: 2 layers (Grass & Rock) with planar mapping
          float rockWeight = max(slopeCliff, smoothstep(180.0, 320.0, wPos.y));
          float grassWeight = (1.0 - rockWeight) * (1.0 - airportWeight);
          float runwayWeight = airportWeight;
          rockWeight *= (1.0 - airportWeight);

          vec4 grassSamp = texture2D(uGrassMap, wPos.xz * uGrassScale);
          vec4 rockSamp = texture2D(uRockMap, wPos.xz * uRockScale);
          vec4 runwaySamp = texture2D(uRunwayMap, wPos.xz * uRunwayScale);

          tFinalAlbedo = grassSamp.rgb * grassWeight + rockSamp.rgb * rockWeight + runwaySamp.rgb * runwayWeight;
          tFinalRoughness = grassSamp.a * grassWeight + rockSamp.a * rockWeight + runwaySamp.a * runwayWeight;
          tFinalMetalness = 0.02 * (1.0 - runwayWeight) + 0.12 * runwayWeight;

          vec3 normGrass = texture2D(uGrassNormal, wPos.xz * uGrassScale).xyz * 2.0 - 1.0;
          vec3 normRock = texture2D(uRockNormal, wPos.xz * uRockScale).xyz * 2.0 - 1.0;
          vec2 blendPlanarN = normGrass.xy * grassWeight + normRock.xy * rockWeight;
          tFinalWorldNormal = normalize(wNorm + vec3(blendPlanarN.x * uNormalStrength, 0.0, blendPlanarN.y * uNormalStrength));
        #else
          // High Quality Preset: 5 layers + Triplanar cliff mapping + Micro detail normal
          // Elevation-based biomes
          float sandWeight = 1.0 - smoothstep(1.5, 7.5, wPos.y);
          float snowElevation = smoothstep(340.0, 420.0, wPos.y);
          // Snow accumulates only on gentler surfaces (slides off sheer vertical cliffs)
          float snowWeight = snowElevation * smoothstep(0.40, 0.65, wNorm.y);

          float rockElevation = smoothstep(180.0, 320.0, wPos.y);
          float rockWeight = max(slopeCliff, rockElevation);
          rockWeight = clamp(rockWeight * (1.0 - snowWeight * 0.85), 0.0, 1.0);

          float grassWeight = max(0.0, 1.0 - sandWeight - rockWeight - snowWeight);

          // Normalize natural weights
          float totalNat = sandWeight + grassWeight + rockWeight + snowWeight;
          if (totalNat > 0.0001) {
            sandWeight /= totalNat;
            grassWeight /= totalNat;
            rockWeight /= totalNat;
            snowWeight /= totalNat;
          } else {
            grassWeight = 1.0;
          }

          // Blend with airport mesa zone
          sandWeight *= (1.0 - airportWeight);
          grassWeight *= (1.0 - airportWeight);
          rockWeight *= (1.0 - airportWeight);
          snowWeight *= (1.0 - airportWeight);
          float runwayWeight = airportWeight;

          // Planar horizontal layers (world-space XZ)
          vec4 grassSamp = texture2D(uGrassMap, wPos.xz * uGrassScale);
          vec4 sandSamp = texture2D(uSandMap, wPos.xz * uSandScale);
          vec4 snowSamp = texture2D(uSnowMap, wPos.xz * uSnowScale);
          vec4 runwaySamp = texture2D(uRunwayMap, wPos.xz * uRunwayScale);

          // Triplanar mapping for rock cliffs (eliminates vertical stretching on steep walls)
          vec3 triWeight = pow(abs(wNorm), vec3(uTriplanarSharpness));
          triWeight /= (triWeight.x + triWeight.y + triWeight.z + 0.0001);

          vec4 rockX = texture2D(uRockMap, wPos.zy * uRockScale);
          vec4 rockY = texture2D(uRockMap, wPos.xz * uRockScale);
          vec4 rockZ = texture2D(uRockMap, wPos.xy * uRockScale);
          vec4 rockSamp = rockX * triWeight.x + rockY * triWeight.y + rockZ * triWeight.z;

          // Final Albedo & Roughness
          tFinalAlbedo = grassSamp.rgb * grassWeight +
                         sandSamp.rgb * sandWeight +
                         rockSamp.rgb * rockWeight +
                         snowSamp.rgb * snowWeight +
                         runwaySamp.rgb * runwayWeight;

          tFinalRoughness = grassSamp.a * grassWeight +
                           sandSamp.a * sandWeight +
                           rockSamp.a * rockWeight +
                           snowSamp.a * snowWeight +
                           runwaySamp.a * runwayWeight;

          tFinalMetalness = 0.02 * (1.0 - runwayWeight) + 0.12 * runwayWeight;

          // Planar normal sampling
          vec3 normGrass = texture2D(uGrassNormal, wPos.xz * uGrassScale).xyz * 2.0 - 1.0;
          vec3 normSand = texture2D(uSandNormal, wPos.xz * uSandScale).xyz * 2.0 - 1.0;
          vec3 normSnow = texture2D(uSnowNormal, wPos.xz * uSnowScale).xyz * 2.0 - 1.0;
          vec3 normRunway = texture2D(uRunwayNormal, wPos.xz * uRunwayScale).xyz * 2.0 - 1.0;

          vec2 blendPlanarN = normGrass.xy * grassWeight +
                              normSand.xy * sandWeight +
                              normSnow.xy * snowWeight +
                              normRunway.xy * runwayWeight;
          vec3 planarNormal = normalize(wNorm + vec3(blendPlanarN.x * uNormalStrength, 0.0, blendPlanarN.y * uNormalStrength));

          // Triplanar rock normal
          vec3 tNormX = texture2D(uRockNormal, wPos.zy * uRockScale).xyz * 2.0 - 1.0;
          vec3 tNormY = texture2D(uRockNormal, wPos.xz * uRockScale).xyz * 2.0 - 1.0;
          vec3 tNormZ = texture2D(uRockNormal, wPos.xy * uRockScale).xyz * 2.0 - 1.0;

          float signX = wNorm.x >= 0.0 ? 1.0 : -1.0;
          float signZ = wNorm.z >= 0.0 ? 1.0 : -1.0;
          vec3 wNormX = vec3(tNormX.z * signX, tNormX.y, tNormX.x);
          vec3 wNormY = vec3(tNormY.x, tNormY.z, tNormY.y);
          vec3 wNormZ = vec3(tNormZ.x, tNormZ.y, tNormZ.z * signZ);

          vec3 triplanarRockNormal = normalize(wNormX * triWeight.x + wNormY * triWeight.y + wNormZ * triWeight.z);
          vec3 rockNormal = normalize(mix(wNorm, triplanarRockNormal, uNormalStrength));

          tFinalWorldNormal = normalize(mix(planarNormal, rockNormal, rockWeight));

          // High-frequency Micro-detail Normal Map (fades smoothly with altitude/distance)
          float camDist = length(cameraPosition - wPos);
          float microFade = 1.0 - smoothstep(12.0, 240.0, camDist);
          if (microFade > 0.01) {
            vec3 microSample = texture2D(uMicroNormal, wPos.xz * uMicroScale).xyz * 2.0 - 1.0;
            tFinalWorldNormal = normalize(tFinalWorldNormal + vec3(microSample.x, 0.0, microSample.y) * (uMicroStrength * microFade));
          }
        #endif

        diffuseColor.rgb = tFinalAlbedo;`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = tFinalRoughness;`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = tFinalMetalness;`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        normal = transformDirection(tFinalWorldNormal, viewMatrix);`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <fog_fragment>',
        `#include <fog_fragment>
        #ifdef USE_FOG
          float tEdge = max(abs(vTerrainWorldPos.x), abs(vTerrainWorldPos.z));
          float tFade = smoothstep(8800.0, 10700.0, tEdge);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, tFade);
        #endif`
      );
    };

    this.material = terrainMat;
    this.mesh = new THREE.Mesh(this.geometry, terrainMat);
    this.mesh.receiveShadow = true;
  }

  /**
   * Surface normal at (x, z) via finite differences
   * @param {number} x
   * @param {number} z
   * @returns {THREE.Vector3}
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
