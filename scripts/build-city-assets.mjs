// Original MIT-licensed exterior kit. Rebuild: node scripts/build-city-assets.mjs
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mkdir, writeFile } from 'node:fs/promises';
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }); }
};
const kit = new T.Group();
const material = new T.MeshStandardMaterial({ vertexColors: true, roughness: .7 });
for (let kind = 0; kind < 3; kind++) {
  const parts = [];
  const box = (w, h, d, x, y, z, color) => {
    // Opaque window panels need only their outward face, not six-sided boxes.
    const window = color === 0x244a61;
    const g = window ? new T.PlaneGeometry(w === .012 ? d : w, h) : new T.BoxGeometry(w, h, d);
    if (window) g.rotateY(w === .012 ? Math.sign(x) * Math.PI / 2 : z < 0 ? Math.PI : 0);
    g.translate(x, y, z);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, color === 0x244a61 ? .75 : .25, .5);
    const c = new T.Color(color), colors = [];
    for (let i = 0; i < g.attributes.position.count; i++) colors.push(c.r, c.g, c.b);
    g.setAttribute('color', new T.Float32BufferAttribute(colors, 3)); parts.push(g);
  };
  const wall = [0x829aaa, 0xcbbfa8, 0xb1b8b6][kind];
  box(1, .08, 1, 0, .04, 0, 0x646b70); // full footprint / foundation
  box(.9, .83, .9, 0, .495, 0, wall);
  box(.96, .025, .96, 0, .92, 0, 0x465663);
  box(.28, .0675, .24, -.18, .96625, .13, 0x6e7b81);
  const floors = [12, 8, 5][kind];
  for (let f = 0; f < floors; f++) {
    const y = .12 + f * .76 / floors;
    for (let col = 0; col < 5; col++) {
      const p = -.35 + col * .175;
      for (const side of [-1, 1]) {
        box(.105, .42 / floors, .012, p, y, side * .455, 0x244a61);
        box(.012, .42 / floors, .105, side * .455, y, p, 0x244a61);
      }
    }
    if (kind === 1) for (const side of [-1, 1]) box(.78, .012, .07, 0, y - .03, side * .46, 0xe1d6c4);
    if (kind === 0) box(.925, .009, .925, 0, y - .025, 0, 0xc2cbd0);
  }
  box(.22, .07, .018, 0, .115, -.46, 0x172d3a);
  box(.4, .015, .16, 0, .16, -.42, 0x526776);
  const mesh = new T.Mesh(mergeGeometries(parts), material); mesh.name = `District${kind}`;
  kit.add(mesh); parts.forEach(g => g.dispose());
}
const bytes = await new GLTFExporter().parseAsync(kit, { binary: true });
await mkdir('public/models/city', { recursive: true });
await writeFile('public/models/city/district-kit.glb', Buffer.from(bytes));
console.log(`City kit: ${bytes.byteLength} bytes`);
