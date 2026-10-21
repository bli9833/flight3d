// Original exterior-only kit. Regenerate: node scripts/build-airport-assets.mjs
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mkdir, writeFile } from 'node:fs/promises';

// GLTFExporter uses the browser FileReader API for its binary buffer.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); });
  }
};
const materials = {
  shell: new T.MeshStandardMaterial({ name: 'ivory-cladding', color: 0xd9ddd8, roughness: .72 }),
  steel: new T.MeshStandardMaterial({ name: 'steel-frames', color: 0x435464, metalness: .65, roughness: .4 }),
  glass: new T.MeshStandardMaterial({ name: 'opaque-exterior-glass', color: 0x24536a, metalness: .65, roughness: .22 }),
  red: new T.MeshStandardMaterial({ name: 'safety-red', color: 0xc44130, roughness: .55 })
};
const kit = new T.Group(); kit.name = 'Flight3dAirportKit';
let parts;
function add(geometry, material, x, y, z, rz = 0) {
  geometry.rotateZ(rz); geometry.translate(x, y, z);
  (parts[material] ??= []).push(geometry);
}
function box(w, h, d, x, y, z, mat = 'shell', rz = 0) {
  add(new T.BoxGeometry(w, h, d), mat, x, y, z, rz);
}
function cylinder(top, bottom, height, segments, y, mat = 'shell') {
  add(new T.CylinderGeometry(top, bottom, height, segments), mat, 0, y, 0);
}
function module(name, build) {
  parts = {}; build();
  const group = new T.Group(); group.name = name;
  for (const [material, geometries] of Object.entries(parts)) {
    const mesh = new T.Mesh(mergeGeometries(geometries), materials[material]);
    mesh.name = `${name}-${material}`; group.add(mesh);
    geometries.forEach(g => g.dispose());
  }
  kit.add(group); return group;
}
for (const detailed of [true, false]) {
  const suffix = detailed ? 'Near' : 'Far';
  module(`Tower${suffix}`, () => {
    cylinder(4.5, 7.5, 60, detailed ? 16 : 8, 30);
    cylinder(9.5, 5.5, 4, 16, 62);
    cylinder(10.5, 9.2, 5.5, 16, 66.5, 'glass');
    cylinder(10.6, 10.6, .7, 16, 69.6, 'steel');
    cylinder(0, 10.6, 2.5, 16, 71.2);
    cylinder(.2, .35, 12, 8, 77, 'red');
    if (detailed) {
      for (let i = 0; i < 16; i++) {
        const a = (i + .25) / 16 * Math.PI * 2;
        box(.18, 5.5, .18, Math.sin(a) * 9.8, 66.5, Math.cos(a) * 9.8, 'steel');
      }
      for (const y of [12, 24, 36, 48]) cylinder(7.55 - y * .05, 7.55 - y * .05, .3, 16, y, 'steel');
      box(2, 3.5, .3, 0, 1.75, -7.1, 'steel');
    }
  });
  module(`TerminalBay${suffix}`, () => {
    box(50, 18, 70, 0, 9, 0);
    box(49, 12, .25, 0, 9, -34.95, 'glass');
    box(50, 1.2, 70, 0, 18.6, 0, 'steel');
    if (detailed) {
      for (let x = -24; x <= 24; x += 4) box(.18, 13, .35, x, 9, -35, 'steel');
      for (const y of [3, 9, 15]) box(50, .18, .35, 0, y, -35, 'steel');
      box(50, .4, 4, 0, 15.5, -33);
      for (const x of [-15, 15]) { box(7, 1.5, 5, x, 19.35, 5, 'steel'); box(6, .2, 4, x, 20.2, 5); }
      for (const z of [-20, 20]) box(50, .18, .3, 0, 19.25, z);
    }
  });
  module(`JetBridge${suffix}`, () => {
    box(8, .35, 28, 0, 4.9, 0, 'steel');
    box(8, .35, 28, 0, 9.1, 0);
    for (const x of [-3.7, 3.7]) box(.3, 3.85, 28, x, 7, 0, 'glass');
    box(8, 4.5, 2, 0, 7, -13, 'steel');
    if (detailed) {
      for (const z of [-10, -5, 0, 5, 10]) for (const x of [-3.9, 3.9]) box(.2, 4, .2, x, 7, z, 'shell');
      for (const x of [-2.5, 2.5]) { box(.5, 4.7, .5, x, 2.35, -8, 'steel'); box(1, .7, 1.2, x, .35, -8, 'steel'); }
    }
  });
  module(`Hangar${suffix}`, () => {
    // Closed exterior, no interior mesh, footprint 90 x 70 and height 35.
    box(89.6, 25, 69.6, 0, 12.5, .2, 'steel');
    const roof = new T.BufferGeometry();
    const vertices = [
      -45,25,-35, 45,25,-35, 0,35,-35, -45,25,35, 0,35,35, 45,25,35,
      -45,25,-35, 0,35,-35, 0,35,35, -45,25,-35, 0,35,35, -45,25,35,
      0,35,-35, 45,25,-35, 45,25,35, 0,35,-35, 45,25,35, 0,35,35
    ];
    roof.setAttribute('position', new T.Float32BufferAttribute(vertices, 3)); roof.computeVertexNormals();
    // Match BoxGeometry attributes for batching.
    roof.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(36), 2));
    roof.setIndex(Array.from({ length: 18 }, (_, i) => i)); add(roof, 'shell', 0, 0, 0);
    if (detailed) {
      box(78, 21, .2, 0, 10.5, -34.7, 'shell');
      for (let x = -39; x <= 39; x += 6) box(.15, 21, .3, x, 10.5, -34.85, 'steel');
      box(78, 3, .3, 0, 19, -34.8, 'glass');
      for (let z = -30; z <= 30; z += 5) for (const x of [-44.8, 44.8]) box(.35, 24, .3, x, 12, z, 'shell');
    }
  });
}
const radar = module('Radar', () => {
  box(5.6, 2.5, .45, 0, 1, 0, 'red'); box(.3, 2, .3, 0, -.5, 0, 'steel');
});
radar.position.y = 72.5;
const beacon = new T.Group(); beacon.name = 'Beacon'; beacon.position.y = 83; kit.add(beacon);
const result = await new GLTFExporter().parseAsync(kit, { binary: true });
await mkdir('public/models/airport', { recursive: true });
await writeFile('public/models/airport/airport-kit.glb', Buffer.from(result));
console.log(`airport-kit.glb: ${result.byteLength} bytes`);
