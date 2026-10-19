import * as THREE from 'three';

/**
 * Realistic Sunlight-Reflecting Ocean Water with Gerstner Waves
 * Features dynamic wave displacement, Fresnel reflections, intense sun specular glitter,
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

    // Custom Water Shader Material with Gerstner Waves & Sunlight Specular Glint
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: this.sunDirection },
        uDeepColor: { value: new THREE.Color(0x0a284a) },   // Deep ocean navy
        uShallowColor: { value: new THREE.Color(0x136a8a) },// Shallow coastal turquoise
        uFoamColor: { value: new THREE.Color(0xdcebf5) },
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
        varying vec3 vNormal;
        varying float vWaveHeight;
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

          // 3 Octaves of Gerstner Waves
          vec3 w1 = gerstnerWave(normalize(vec2(1.0, 0.4)), 0.18, 48.0, 1.0, worldXZ, uTime);
          vec3 w2 = gerstnerWave(normalize(vec2(-0.6, 0.8)), 0.14, 26.0, 1.2, worldXZ, uTime);
          vec3 w3 = gerstnerWave(normalize(vec2(0.2, -1.0)), 0.10, 12.0, 1.5, worldXZ, uTime);

          vec3 totalDisplacement = w1 + w2 + w3;
          vec3 displacedWorld = baseWorldPos.xyz + totalDisplacement;
          vWaveHeight = totalDisplacement.y;

          // Compute analytical normal from wave gradients in world coordinates
          float eps = 0.8;
          vec2 pXCoord = worldXZ + vec2(eps, 0.0);
          vec2 pZCoord = worldXZ + vec2(0.0, eps);
          vec3 pXDisp = gerstnerWave(normalize(vec2(1.0, 0.4)), 0.18, 48.0, 1.0, pXCoord, uTime)
                      + gerstnerWave(normalize(vec2(-0.6, 0.8)), 0.14, 26.0, 1.2, pXCoord, uTime)
                      + gerstnerWave(normalize(vec2(0.2, -1.0)), 0.10, 12.0, 1.5, pXCoord, uTime);
          vec3 pZDisp = gerstnerWave(normalize(vec2(1.0, 0.4)), 0.18, 48.0, 1.0, pZCoord, uTime)
                      + gerstnerWave(normalize(vec2(-0.6, 0.8)), 0.14, 26.0, 1.2, pZCoord, uTime)
                      + gerstnerWave(normalize(vec2(0.2, -1.0)), 0.10, 12.0, 1.5, pZCoord, uTime);
          vec3 pX = baseWorldPos.xyz + vec3(eps, 0.0, 0.0) + pXDisp;
          vec3 pZ = baseWorldPos.xyz + vec3(0.0, 0.0, eps) + pZDisp;
          vec3 n = normalize(cross(pZ - displacedWorld, pX - displacedWorld));
          vNormal = n;

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
        uniform vec3 uFoamColor;
        uniform vec3 uSunColor;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        uniform float uFogHeightFalloff;
        uniform float uBaseFogDensity;
        uniform float uTime;
        uniform float uEdgeFadeStart;
        uniform float uEdgeFadeEnd;

        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying float vWaveHeight;
        varying vec2 vLocalPos;

        void main() {
          #include <logdepthbuf_fragment>

          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          vec3 normal = normalize(vNormal);

          // Fresnel reflectance: Schlick's approximation
          float cosTheta = clamp(dot(viewDir, normal), 0.0, 1.0);
          float fresnel = 0.04 + (1.0 - 0.04) * pow(1.0 - cosTheta, 5.0);

          // Sunlight Specular Reflection (Blazing Sun Glint)
          vec3 lightDir = normalize(uSunDir);
          vec3 halfVector = normalize(lightDir + viewDir);
          float nDotH = max(0.0, dot(normal, halfVector));

          // Sharp microfacet specular highlight
          float specular = pow(nDotH, 180.0) * 4.2;
          // Secondary softer sun lobe
          float specularSoft = pow(nDotH, 24.0) * 0.8;

          // Water base color gradient based on wave height
          float waveGradient = smoothstep(-1.2, 1.5, vWaveHeight);
          vec3 waterColor = mix(uDeepColor, uShallowColor, waveGradient * 0.65);

          // Synchronized atmospheric sky reflection adapting to time of day
          vec3 skyReflection = mix(uFogColor * 0.70, uFogColor * 1.15, fresnel);

          // Blend water color with sky reflection via Fresnel
          vec3 finalColor = mix(waterColor, skyReflection, fresnel * 0.75);

          // Add Sun Glint (Sun specular reflection)
          finalColor += uSunColor * (specular + specularSoft);

          // Wave crest foam
          float foamThreshold = 0.75;
          if (vWaveHeight > foamThreshold) {
            float foamFactor = smoothstep(foamThreshold, 1.2, vWaveHeight) * 0.45;
            finalColor = mix(finalColor, uFoamColor, foamFactor);
          }

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
    const k1 = 6.283 / 48.0;
    const c1 = Math.sqrt(9.8 / k1);
    const f1 = k1 * (x * 0.92 + z * 0.38 - c1 * time);
    const a1 = 0.18 / k1;

    const k2 = 6.283 / 26.0;
    const c2 = Math.sqrt(9.8 / k2) * 1.2;
    const f2 = k2 * (-x * 0.6 + z * 0.8 - c2 * time);
    const a2 = 0.14 / k2;

    return this.waterLevel + a1 * Math.sin(f1) + a2 * Math.sin(f2);
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
