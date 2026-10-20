import * as THREE from 'three';

// Original, deterministic density atlas. No downloaded assets or network requests.
// Four cumulus silhouettes, with a transparent gutter around every cell.
export function createCloudAtlas(cellSize = 128) {
  const normal = new THREE.Vector3();
  const data = new Uint8Array(cellSize * cellSize * 4 * 4);
  for (let tile = 0; tile < 4; tile++) {
    for (let y = 0; y < cellSize; y++) {
      for (let x = 0; x < cellSize; x++) {
        const u = x / (cellSize - 1) * 2 - 1;
        const v = y / (cellSize - 1) * 2 - 1;
        let density = 0;
        let nx = 0;
        let ny = 0;
        let nz = 0;
        let totalWeight = 0;
        for (let puff = 0; puff < 7; puff++) {
          const cx = (puff - 3) * 0.19;
          const cy = -0.24 + 0.38 * Math.exp(-cx * cx / 0.14)
            + Math.sin(puff * 2.3 + tile * 1.7) * 0.10;
          const rx = 0.29 + 0.05 * Math.sin(puff + tile);
          const ry = 0.32 + 0.12 * Math.cos(puff * 1.8 + tile);
          const distance = ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2;
          density = Math.max(density, 1 - distance);
          const weight = Math.exp(-distance * 4);
          nx += (u - cx) / rx * weight;
          ny += (v - cy) / ry * weight;
          nz += Math.sqrt(Math.max(0, 1 - distance)) * weight;
          totalWeight += weight;
        }
        const detail = Math.sin(u * 39 + tile) * Math.sin(v * 31 - tile) * 0.035
          + Math.sin(u * 81 + v * 57) * 0.015;
        const edge = Math.min(1, Math.max(0, (1 - Math.max(Math.abs(u), Math.abs(v))) * 12));
        const alpha = THREE.MathUtils.smoothstep(density + detail, 0, 0.4) * edge;
        const i = (y * cellSize * 4 + tile * cellSize + x) * 4;
        nx /= totalWeight;
        ny /= totalWeight;
        nz /= totalWeight;
        // Encode the rounded density surface normal for sun-direction lighting.
        normal.set(nx + detail * 2, ny + detail, nz).normalize();
        data[i] = Math.round((normal.x * 0.5 + 0.5) * 255);
        data[i + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
        data[i + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
        data[i + 3] = Math.round(alpha * 235);
      }
    }
  }
  const texture = new THREE.DataTexture(data, cellSize * 4, cellSize, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export class CloudLayer extends THREE.InstancedMesh {
  constructor() {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const atlas = createCloudAtlas();
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        atlas: { value: atlas },
        sunDirection: { value: new THREE.Vector3() },
        sunColor: { value: new THREE.Color() },
        ambientColor: { value: new THREE.Color() },
      },
      vertexShader: `
        attribute float cloudTile;
        uniform vec3 sunDirection;
        varying vec3 cloudSunDirection;
        varying float cloudFade;
        varying vec2 cloudUv;
        varying float tile;
        #include <fog_pars_vertex>
        void main() {
          cloudUv = uv;
          tile = cloudTile;
          vec4 center = modelMatrix * instanceMatrix * vec4(0., 0., 0., 1.);
          vec3 towardCamera = normalize(cameraPosition - center.xyz);
          vec3 right = cross(vec3(0., 1., 0.), towardCamera);
          if (length(right) < 0.001) {
            right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          }
          right = normalize(right);
          vec3 up = normalize(cross(towardCamera, right));
          cloudSunDirection = vec3(dot(sunDirection, right), dot(sunDirection, up), dot(sunDirection, towardCamera));
          cloudFade = smoothstep(150., 650., distance(cameraPosition, center.xyz));
          vec2 size = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
          vec4 mvPosition = viewMatrix * (center + vec4(right * position.x * size.x + up * position.y * size.y, 0.));
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D atlas;
        varying vec3 cloudSunDirection;
        varying float cloudFade;
        uniform vec3 sunColor;
        uniform vec3 ambientColor;
        varying vec2 cloudUv;
        varying float tile;
        #include <fog_pars_fragment>
        void main() {
          vec4 texel = texture2D(atlas, vec2((cloudUv.x + tile) / 4., cloudUv.y));
          texel.a *= cloudFade;
          if (texel.a < 0.01) discard;
          vec3 normal = normalize(texel.rgb * 2. - 1.);
          vec3 lightDirection = normalize(cloudSunDirection);
          float diffuse = 0.12 + 0.88 * max(dot(normal, lightDirection), 0.);
          gl_FragColor = vec4(ambientColor * (0.7 + 0.3 * normal.y) + sunColor * diffuse, texel.a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    super(geometry, material, 180);
    this.name = 'Cumulus atlas layer';
    this.atlas = atlas;
    this.clouds = [];
    let seed = 12012;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 180; i++) {
      const x = (random() - 0.5) * 32000;
      const z = (random() - 0.5) * 32000;
      if (Math.abs(x) < 4000 && Math.abs(z) < 2500) continue;
      this.clouds.push({
        position: new THREE.Vector3(x, 2800 + random() * 800, z),
        width: 900 + random() * 500,
        height: 360 + random() * 220,
        tile: i % 4,
        depth: 0,
      });
    }
    this.count = this.clouds.length;
    this.tiles = new THREE.InstancedBufferAttribute(new Float32Array(180), 1);
    geometry.setAttribute('cloudTile', this.tiles);
    this.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tiles.setUsage(THREE.DynamicDrawUsage);
    this.sortMatrix = new THREE.Matrix4();
    this.cloudMatrix = new THREE.Matrix4();
    // Bounding volume includes the full billboard diagonal at every orientation.
    this.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3200, 0), 24000);
    this.sortForCamera(new THREE.PerspectiveCamera());
  }

  sortForCamera(camera) {
    camera.updateWorldMatrix(true, false);
    this.updateWorldMatrix(true, false);
    this.sortMatrix.multiplyMatrices(camera.matrixWorldInverse, this.matrixWorld);
    for (const cloud of this.clouds) {
      const p = cloud.position;
      const m = this.sortMatrix.elements;
      cloud.depth = m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14];
    }
    // Back-to-front per camera, including cockpit/wing cameras and airport offset.
    this.clouds.sort((a, b) => a.depth - b.depth);
    this.clouds.forEach((cloud, i) => {
      this.cloudMatrix.makeScale(cloud.width, cloud.height, 1);
      this.cloudMatrix.setPosition(cloud.position);
      this.setMatrixAt(i, this.cloudMatrix);
      this.tiles.setX(i, cloud.tile);
    });
    this.instanceMatrix.needsUpdate = true;
    this.tiles.needsUpdate = true;
  }

  syncLighting(sun, ambient) {
    this.material.uniforms.sunDirection.value.copy(sun.position).sub(sun.target.position).normalize();
    this.material.uniforms.sunColor.value.copy(sun.color).multiplyScalar(sun.intensity * 0.3);
    this.material.uniforms.ambientColor.value.copy(ambient.color).multiplyScalar(ambient.intensity * 0.5);
  }

  dispose() {
    this.atlas.dispose();
    this.geometry.dispose();
    this.material.dispose();
    super.dispose();
  }
}
