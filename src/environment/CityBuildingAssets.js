import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Original 2 x 2 atlas: three facades and a shared rooftop. Kept in source so
// the browser receives no separately licensed texture or model download.
const TILE = 128;
const SIZE = TILE * 2;

function makeAtlas() {
  const color = new Uint8Array(SIZE * SIZE * 4);
  const windows = new Uint8Array(SIZE * SIZE * 4);
  const walls = [
    [60, 82, 105], // glazed office
    [173, 166, 149], // residential stone
    [110, 122, 131], // commercial cladding
    [86, 91, 96] // rooftop membrane
  ];
  for (let tile = 0; tile < 4; tile++) {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const windowX = x % 24;
        const windowY = y % 24;
        const isWindow = tile !== 3 && windowX >= 4 && windowX < 19 && windowY >= 5 && windowY < 19;
        const isFrame = tile !== 3 && (windowX < 2 || windowY < 2);
        const isRooftopUnit = tile === 3 && x > 37 && x < 91 && y > 38 && y < 87;
        const lit = isWindow && ((Math.floor(x / 24) * 7 + Math.floor(y / 24) * 11 + tile * 13) % 5 < 2);
        const wall = walls[tile];
        const px = (x + (tile % 2) * TILE + (y + Math.floor(tile / 2) * TILE) * SIZE) * 4;
        const rgb = isRooftopUnit ? [121, 128, 132]
          : isWindow ? (lit ? [119, 145, 163] : [38, 58, 75])
            : isFrame ? wall.map(v => Math.min(255, v + 24)) : wall;
        color.set([...rgb, 255], px);
        windows.set(lit ? [80, 68, 44, 255] : [0, 0, 0, 255], px);
      }
    }
  }
  const makeTexture = (data, colorSpace) => {
    const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
    texture.colorSpace = colorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  };
  return {
    map: makeTexture(color, THREE.SRGBColorSpace),
    emissiveMap: makeTexture(windows, THREE.SRGBColorSpace)
  };
}

function box(width, height, depth, bottom, facadeTile) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.translate(0, bottom + height / 2, 0);
  const uv = geometry.getAttribute('uv');
  for (let face = 0; face < 6; face++) {
    const tile = face === 2 || face === 3 ? 3 : facadeTile;
    const tx = tile % 2;
    const ty = Math.floor(tile / 2);
    for (let corner = 0; corner < 4; corner++) {
      const index = face * 4 + corner;
      uv.setXY(index, (tx + 0.01 + uv.getX(index) * 0.98) / 2,
        (ty + 0.01 + uv.getY(index) * 0.98) / 2);
    }
  }
  return geometry;
}

export function createCityBuildingAssets() {
  const atlas = makeAtlas();
  const nearMaterial = new THREE.MeshStandardMaterial({
    map: atlas.map,
    emissiveMap: atlas.emissiveMap,
    emissive: 0xffffff,
    emissiveIntensity: 0,
    roughness: 0.65,
    metalness: 0.15
  });
  const farMaterial = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.8, metalness: 0.1 });
  const parts = [
    [box(1, 0.88, 1, 0, 0), box(0.86, 0.12, 0.86, 0.88, 0)],
    [box(1, 0.96, 1, 0, 1), box(0.94, 0.04, 0.94, 0.96, 1)],
    [box(1, 0.8, 1, 0, 2), box(0.78, 0.2, 0.78, 0.8, 2)]
  ];
  const nearGeometries = parts.map(pieces => {
    const geometry = mergeGeometries(pieces);
    pieces.forEach(piece => piece.dispose());
    return geometry;
  });
  const farGeometry = box(1, 1, 1, 0, 0);
  return { atlas, nearMaterial, farMaterial, nearGeometries, farGeometry };
}

export function cityWindowIntensity(hour) {
  const daylight = Math.max(0, Math.sin((hour - 6) * Math.PI / 12));
  return 0.75 * (1 - THREE.MathUtils.smoothstep(daylight, 0.03, 0.35));
}
