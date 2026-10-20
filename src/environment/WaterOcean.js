import * as THREE from 'three';

/**
 * Realistic Sunlight-Reflecting Ocean Water with Gerstner Waves
 * Features broad swell displacement, filtered per-pixel ripples, Fresnel reflections,
 * deep oceanic color absorption, and wave height query for floating ships.
 */
export class WaterOcean {
  constructor(size = 36000, segments = 180) {
    this.size = size;
    this.segments = segments;
    this.snapStep = this.size / this.segments;
    this.waterLevel = 0.0;
    this.sunDirection = new THREE.Vector3(0.5, 0.6, 0.4).normalize();

    this.initWater();
  }

  initWater() {
    // High-resolution plane geometry for wave displacement
    const geom = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    geom.rotateX(-Math.PI * 0.5);

    // Broad geometry swell and filtered fragment detail share world-space coordinates.
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: this.sunDirection },
        uDeepColor: { value: new THREE.Color(0x0a284a) },   // Deep ocean navy
        uShallowColor: { value: new THREE.Color(0x136a8a) },// Shallow coastal turquoise
        uSunColor: { value: new THREE.Color(0xffeedd) },
        uFogColor: { value: new THREE.Color(0xc8def4) },
        uFogDensity: { value: 0.00020 },
        uFogHeightFalloff: { value: 0.00068 },
        uBaseFogDensity: { value: 0.00020 },
        uEdgeFadeStart: { value: this.size * 0.5 * 0.70 },
        uEdgeFadeEnd: { value: this.size * 0.5 * 0.95 }
      },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>

        uniform float uTime;
        varying vec3 vWorldPos;
        varying vec2 vLocalPos;

        // Gerstner Wave function
        vec3 gerstnerWave(vec2 dir, float steepness, float wavelength, float speed, vec2 pos, float time) {
          float k = 6.2831853 / wavelength;
          float c = sqrt(9.8 / k) * speed;
          float f = k * (dot(dir, pos) - c * time);
          float a = steepness / k;

          return vec3(
            dir.x * (a * cos(f)),
            a * sin(f),
            dir.y * (a * cos(f))
          );
        }

        void main() {
          vec3 pos = position;
          vLocalPos = pos.xz;

          // Evaluate Gerstner waves in global world coordinates so wave phase is invariant to mesh translation
          vec4 baseWorldPos = modelMatrix * vec4(pos, 1.0);
          vec2 worldXZ = baseWorldPos.xz;

          // Only broad swell belongs on the 200m grid. Short waves are shaded per pixel.
          vec3 totalDisplacement = gerstnerWave(normalize(vec2(1.0, 0.4)), 0.0024, 1600.0, 1.0, worldXZ, uTime)
                                 + gerstnerWave(normalize(vec2(-0.6, 0.8)), 0.0024, 900.0, 1.2, worldXZ, uTime);
          vec3 displacedWorld = baseWorldPos.xyz + totalDisplacement;

          vWorldPos = displacedWorld;
          gl_Position = projectionMatrix * viewMatrix * vec4(displacedWorld, 1.0);
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>

        uniform vec3 uSunDir;
        uniform vec3 uDeepColor;
        uniform vec3 uShallowColor;
        uniform vec3 uSunColor;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        uniform float uFogHeightFalloff;
        uniform float uBaseFogDensity;
        uniform float uTime;
        uniform float uEdgeFadeStart;
        uniform float uEdgeFadeEnd;

        varying vec3 vWorldPos;
        varying vec2 vLocalPos;

        // Analytic wave slopes, filtered by pixel footprint to avoid distant shimmer.
        vec2 waveSlope(vec2 direction, float steepness, float wavelength, float speed, float footprint) {
          vec2 dir = normalize(direction);
          float k = 6.2831853 / wavelength;
          vec2 p = vWorldPos.xz;
          // Cross-wave phase modulation breaks up long parallel sine bands.
          float modulation = wavelength < 100.0 ?
            2.2 * sin(dot(p, vec2(-dir.y, dir.x)) * k * 0.43 + uTime * 0.13)
            + 1.4 * sin(dot(p, vec2(0.37, 0.93)) * k * 0.71 - uTime * 0.09) : 0.0;
          float phase = k * (dot(dir, p) - sqrt(9.8 / k) * speed * uTime) + modulation;
          float resolved = 1.0 - smoothstep(wavelength * 0.12, wavelength * 0.5, footprint);
          return dir * steepness * cos(phase) * resolved;
        }

        void main() {
          #include <logdepthbuf_fragment>

          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float footprint = max(length(dFdx(vWorldPos.xz)), length(dFdy(vWorldPos.xz)));
          vec2 slope = waveSlope(vec2(1.0, 0.4), 0.0024, 1600.0, 1.0, footprint)
                     + waveSlope(vec2(-0.6, 0.8), 0.0024, 900.0, 1.2, footprint)
                     + waveSlope(vec2(1.0, 0.4), 0.18, 48.0, 1.0, footprint)
                     + waveSlope(vec2(-0.6, 0.8), 0.14, 26.0, 1.2, footprint)
                     + waveSlope(vec2(0.2, -1.0), 0.10, 12.0, 1.5, footprint)
                     + waveSlope(vec2(0.8, 0.6), 0.06, 3.5, 0.8, footprint);
          vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));

          // Water is a dielectric (F0 ~ 0.02), with stronger sky reflection at grazing angles.
          float cosTheta = clamp(dot(viewDir, normal), 0.0, 1.0);
          float fresnel = 0.02 + 0.98 * pow(1.0 - cosTheta, 5.0);
          vec3 lightDir = normalize(uSunDir);
          vec3 halfVector = normalize(lightDir + viewDir);
          float nDotH = max(0.0, dot(normal, halfVector));
          float daylight = smoothstep(-0.04, 0.15, lightDir.y);
          // Unresolved ripples broaden the sun reflection instead of sparkling at subpixel scale.
          float roughness = mix(0.16, 0.28, smoothstep(1.0, 20.0, footprint));
          float alpha2 = pow(roughness, 4.0);
          float denominator = nDotH * nDotH * (alpha2 - 1.0) + 1.0;
          float distribution = alpha2 / max(0.00001, PI * denominator * denominator);
          float sunGlint = min(8.0, distribution * 0.02) * daylight;
          vec3 reflected = reflect(-viewDir, normal);
          float skyHeight = clamp(reflected.y, 0.0, 1.0);
          vec3 skyReflection = mix(uFogColor, uFogColor * vec3(0.42, 0.62, 0.85), sqrt(skyHeight));
          vec3 waterColor = mix(uDeepColor, uShallowColor, 0.12) * mix(0.08, 0.7, daylight);
          vec3 finalColor = mix(waterColor, skyReflection, fresnel);
          finalColor += uSunColor * sunGlint;

          // Synchronized atmospheric aerial perspective fog
          float dist = length(cameraPosition - vWorldPos);
          float camY = max(0.0, cameraPosition.y);
          float ptY = max(0.0, vWorldPos.y);
          float deltaY = abs(camY - ptY);
          float hWeight;
          if (deltaY < 2.0) {
            hWeight = exp(-uFogHeightFalloff * camY);
          } else {
            hWeight = (exp(-uFogHeightFalloff * min(camY, ptY)) - exp(-uFogHeightFalloff * max(camY, ptY))) / (uFogHeightFalloff * deltaY);
          }
          float effDensity = uBaseFogDensity * hWeight;
          float fogExp = effDensity * dist;
          float fogFactor = clamp(1.0 - exp(-fogExp * fogExp), 0.0, 1.0);

          // Far edge blending: ensure ocean water completely melts into horizon sky fog before boundary
          // Uses local mesh coordinates so the fade stays anchored to the far outer rim regardless of camera position
          float edgeDist = max(abs(vLocalPos.x), abs(vLocalPos.y));
          float edgeFade = smoothstep(uEdgeFadeStart, uEdgeFadeEnd, edgeDist);
          fogFactor = max(fogFactor, edgeFade);

          finalColor = mix(finalColor, uFogColor, fogFactor);

          gl_FragColor = vec4(finalColor, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: false,
      depthWrite: true
    });

    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.position.y = this.waterLevel;
  }

  /**
   * Analytical wave height query at (x, z) for ship buoyancy
   */
  getWaveHeight(x, z, time) {
    const wave = (dx, dz, wavelength, speed) => {
      const length = Math.hypot(dx, dz);
      const k = 2 * Math.PI / wavelength;
      const phase = k * (x * dx / length + z * dz / length - Math.sqrt(9.8 / k) * speed * time);
      return 0.0024 / k * Math.sin(phase);
    };
    return this.waterLevel + wave(1, 0.4, 1600, 1) + wave(-0.6, 0.8, 900, 1.2);
  }

  setSunDirection(dir) {
    this.sunDirection.copy(dir).normalize();
    if (this.material && this.material.uniforms && this.material.uniforms.uSunDir) {
      this.material.uniforms.uSunDir.value.copy(this.sunDirection);
    }
  }

  syncWithAtmosphere(sky) {
    if (!sky || !this.material || !this.material.uniforms) return;
    if (sky.fogColor) this.material.uniforms.uFogColor.value.copy(sky.fogColor);
    if (sky.currentDensity !== undefined) this.material.uniforms.uFogDensity.value = sky.currentDensity;
    if (sky.baseDensity !== undefined) this.material.uniforms.uBaseFogDensity.value = sky.baseDensity;
    if (sky.heightFalloff !== undefined) this.material.uniforms.uFogHeightFalloff.value = sky.heightFalloff;
    if (sky.sunLight && sky.sunLight.color) this.material.uniforms.uSunColor.value.copy(sky.sunLight.color);
    if (typeof sky.getSunDirection === 'function') {
      this.setSunDirection(sky.getSunDirection());
    }
  }

  update(dt, focusPos = null) {
    this.material.uniforms.uTime.value += dt;
    if (focusPos) {
      const snappedX = Math.round(focusPos.x / this.snapStep) * this.snapStep;
      const snappedZ = Math.round(focusPos.z / this.snapStep) * this.snapStep;
      this.mesh.position.x = snappedX;
      this.mesh.position.z = snappedZ;
    }
  }
}
