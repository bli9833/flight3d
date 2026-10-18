import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';

function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Procedural Terrain with Rolling Hills, Coastal Mountains, and Flat Airport Mesa
 * Generates an expansive 20km x 20km landscape with height queries for physics and foliage placement.
 */
export class Terrain {
  constructor(size = 20000, segments = 256) {
    this.size = size;
    this.segments = segments;
    // Deterministic seeded PRNG (seed 424242) ensures identical repeatable world geometry across all sessions and tests
    this.simplex = new SimplexNoise({ random: mulberry32(424242) });

    // Airport zone definition (flat plateau at y = 12m)
    this.airportCenter = new THREE.Vector2(0, 0);
    this.airportLength = 3800; // East-West
    this.airportWidth = 900;   // North-South
    this.airportElevation = 12.0;

    this.mesh = null;
    this.geometry = null;

    this.initTerrain();
  }

  /**
   * Analytical height function for terrain at world (x, z)
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

    // Ocean floor clamp
    const naturalHeight = Math.max(-45.0, baseH);

    // Blend natural height with flat airport plateau
    const finalHeight = (1.0 - airportWeight) * naturalHeight + airportWeight * this.airportElevation;

    return finalHeight;
  }

  initTerrain() {
    this.geometry = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    this.geometry.rotateX(-Math.PI * 0.5); // Align to X-Z horizontal plane

    const pos = this.geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    // Procedural color palette
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
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.05,
      flatShading: false
    });

    this.mesh = new THREE.Mesh(this.geometry, terrainMat);
    this.mesh.receiveShadow = true;
  }
}
