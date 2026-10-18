import * as THREE from 'three';

/**
 * Realistic Sunlight-Reflecting Ocean Water with Gerstner Waves
 * Features dynamic wave displacement, Fresnel reflections, intense sun specular glitter,
 * deep oceanic color absorption, and wave height query for floating ships.
 */
export class WaterOcean {
  constructor(size = 22000) {
    this.size = size;
    this.waterLevel = 0.0;
    this.sunDirection = new THREE.Vector3(0.5, 0.6, 0.4).normalize();

    this.initWater();
  }

  initWater() {
    // High-resolution plane geometry for wave displacement
    const geom = new THREE.PlaneGeometry(this.size, this.size, 160, 160);
    geom.rotateX(-Math.PI * 0.5);

    // Custom Water Shader Material with Gerstner Waves & Sunlight Specular Glint
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: this.sunDirection },
        uDeepColor: { value: new THREE.Color(0x0a284a) },   // Deep ocean navy
        uShallowColor: { value: new THREE.Color(0x136a8a) },// Shallow coastal turquoise
        uFoamColor: { value: new THREE.Color(0xdcebf5) },
        uSunColor: { value: new THREE.Color(0xffeedd) }
      },
      vertexShader: `
        uniform float uTime;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying float vWaveHeight;

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

          // 3 Octaves of Gerstner Waves
          vec3 w1 = gerstnerWave(normalize(vec2(1.0, 0.4)), 0.18, 48.0, 1.0, pos.xz, uTime);
          vec3 w2 = gerstnerWave(normalize(vec2(-0.6, 0.8)), 0.14, 26.0, 1.2, pos.xz, uTime);
          vec3 w3 = gerstnerWave(normalize(vec2(0.2, -1.0)), 0.10, 12.0, 1.5, pos.xz, uTime);

          vec3 displaced = pos + w1 + w2 + w3;
          vWaveHeight = displaced.y;

          // Compute analytical normal from wave gradients
          float eps = 0.8;
          vec3 pX = pos + vec3(eps, 0.0, 0.0) + gerstnerWave(normalize(vec2(1.0, 0.4)), 0.18, 48.0, 1.0, pos.xz + vec2(eps, 0.0), uTime);
          vec3 pZ = pos + vec3(0.0, 0.0, eps) + gerstnerWave(normalize(vec2(1.0, 0.4)), 0.18, 48.0, 1.0, pos.xz + vec2(0.0, eps), uTime);
          vec3 n = normalize(cross(pZ - displaced, pX - displaced));
          vNormal = n;

          vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDir;
        uniform vec3 uDeepColor;
        uniform vec3 uShallowColor;
        uniform vec3 uFoamColor;
        uniform vec3 uSunColor;
        uniform float uTime;

        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying float vWaveHeight;

        void main() {
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

          // Sky reflection color approximation
          vec3 skyReflection = mix(vec3(0.35, 0.55, 0.85), vec3(0.7, 0.85, 1.0), fresnel);

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

          // Subtle distance fog blending
          float dist = length(cameraPosition - vWorldPos);
          float fogFactor = clamp((dist - 3000.0) / 12000.0, 0.0, 0.85);
          vec3 fogColor = vec3(0.55, 0.70, 0.88);
          finalColor = mix(finalColor, fogColor, fogFactor);

          gl_FragColor = vec4(finalColor, 0.94);
        }
      `,
      transparent: true,
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
    this.material.uniforms.uSunDir.value.copy(this.sunDirection);
  }

  update(dt) {
    this.material.uniforms.uTime.value += dt;
  }
}
