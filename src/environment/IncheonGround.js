import * as THREE from 'three';

// Illustration only: these colours do not claim surveyed land cover. The DSM,
// coastline, pavement and collision sampler remain the source of geometry.
function noise(x, z, period = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const hash = (a, b) => {
    if (period) {
      a = ((a % period) + period) % period;
      b = ((b % period) + period) % period;
    }
    const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(hash(ix, iz), hash(ix + 1, iz), sx),
    THREE.MathUtils.lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), sx), sz);
}

/** World-sized colour variation reveals hills without changing their height. */
export function colourIncheonGround(geometry) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const colours = new Float32Array(position.count * 3);
  const grass = new THREE.Color(0x65734b);
  const dryGrass = new THREE.Color(0x918263);
  const woodland = new THREE.Color(0x304d35);
  const rock = new THREE.Color(0x77786b);
  const colour = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i), y = position.getY(i);
    const broad = noise(x / 430, z / 430);
    const patches = noise(x / 95 + 17, z / 95 - 31);
    colour.copy(grass).lerp(dryGrass, broad * .65);
    // A gradual transition preserves flat airport grass and brings out the
    // actual surrounding ridges. No invented mountains or building footprints.
    const hills = THREE.MathUtils.smoothstep(y, 14, 65);
    colour.lerp(woodland, hills * (.65 + patches * .35));
    const slope = 1 - normal.getY(i);
    colour.lerp(rock, THREE.MathUtils.smoothstep(slope, .12, .4) * .55);
    colour.multiplyScalar(.8 + patches * .25);
    colour.toArray(colours, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
}

/** A small seamless 128m tile: metre-scale grain plus larger grass clumps.
 * Mipmaps suppress distant shimmer; no per-frame generation or extra draw calls.
 */
export function createIncheonGroundTexture(worldSize = 12000) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const pixels = context.createImageData(size, size);
  // Wrap each noise lattice, so every mip level repeats without a seam.
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const clumps = noise(x / size * 8, z / size * 8, 8);
    const blades = noise(x / size * 32, z / size * 32, 32);
    const grain = noise(x / size * 128, z / size * 128, 128);
    const value = Math.round(199 + clumps * 25 + blades * 20 + grain * 11);
    const i = (z * size + x) * 4;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
    pixels.data[i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(worldSize / 128, worldSize / 128);
  texture.anisotropy = 4;
  return texture;
}
