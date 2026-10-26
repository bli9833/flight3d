import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const canvas = document.querySelector('#scene');
const status = document.querySelector('#status');

function footprint(points) {
  // Shape XY becomes world XZ after rotation: shape Y = -world Z.
  return new THREE.Shape(points.slice(0, -1).map(([x, z]) => new THREE.Vector2(x, -z)));
}

function roadWidth(feature) {
  const explicit = Number(feature.width);
  if (explicit > 0 && explicit <= 100) return explicit;
  if (feature.kind === 'runway') return 45;
  if (feature.kind === 'taxiway') return 18;
  return { motorway: 15, motorway_link: 8, trunk: 13, primary: 12, secondary: 10,
    tertiary: 8, residential: 6, service: 4, footway: 2, path: 2, steps: 2 }[feature.highway] ?? 5;
}

function ribbon(points, width, y) {
  const vertices = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    if (length === 0) continue;
    const nx = -dz / length * width / 2;
    const nz = dx / length * width / 2;
    const p = [a[0] + nx, y, a[1] + nz];
    const q = [a[0] - nx, y, a[1] - nz];
    const r = [b[0] + nx, y, b[1] + nz];
    const s = [b[0] - nx, y, b[1] - nz];
    vertices.push(...p, ...r, ...q, ...q, ...r, ...s);
  }
  if (!vertices.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

async function start() {
  const response = await fetch(`${import.meta.env.BASE_URL}scenery/incheon/patch.json`);
  if (!response.ok) throw new Error(`지도 데이터 요청 실패 (${response.status})`);
  const data = await response.json();
  if (data.schemaVersion !== 1 || !data.features?.length) throw new Error('지도 데이터 형식을 확인해 주세요.');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setClearColor(0xd9e1df);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(43, 1, 1, 15000);
  const controls = new OrbitControls(camera, canvas);
  controls.minDistance = 80;
  controls.maxDistance = 7000;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  canvas.tabIndex = 0;
  controls.listenToKeyEvents(canvas);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x809189, 2.3));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(-1400, 2500, 900);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshLambertMaterial({ color: 0xc2ccbb }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.2;
  scene.add(ground);
  const grid = new THREE.GridHelper(2000, 20, 0x8d9f97, 0xaebdaf);
  grid.position.y = 0.02;
  scene.add(grid);

  const layers = Object.fromEntries(['roads', 'surfaces', 'buildings'].map(name => [name, new THREE.Group()]));
  Object.values(layers).forEach(layer => scene.add(layer));
  const batches = new Map();
  const counts = {};
  function batch(layer, color, geometry) {
    if (!geometry) return;
    const key = `${layer}:${color}`;
    if (!batches.has(key)) batches.set(key, { layer, color, geometries: [] });
    // Uniform, non-indexed layout permits merging ribbons, shapes and extrusions.
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    flat.deleteAttribute('uv');
    batches.get(key).geometries.push(flat);
    if (flat !== geometry) geometry.dispose();
  }
  for (const feature of data.features) {
    counts[feature.kind] = (counts[feature.kind] ?? 0) + 1;
    for (const points of feature.parts) {
      if (feature.kind === 'building') {
        const geometry = new THREE.ExtrudeGeometry(footprint(points), { depth: feature.height.meters, bevelEnabled: false, steps: 1 });
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, 1.0, 0);
        batch('buildings', feature.height.source === 'placeholder' ? 0xc9aa79 : 0x659cb7, geometry);
      } else if (feature.area) {
        const geometry = new THREE.ShapeGeometry(footprint(points));
        geometry.rotateX(-Math.PI / 2);
        const colors = { water: 0x8db8c7, park: 0x8daa7f, apron: 0xaab1ae, runway: 0x5b6569, taxiway: 0x77817e, road: 0x77817e };
        const land = { grass: 0x9bb88b, forest: 0x829d78, commercial: 0xc3beb1, industrial: 0xbcbcb1, residential: 0xc7c9b6 };
        const color = colors[feature.kind] ?? land[feature.landuse] ?? 0xb2beaa;
        const airportSurface = ['apron', 'runway', 'taxiway', 'road'].includes(feature.kind);
        geometry.translate(0, airportSurface ? 0.35 : 0.1, 0);
        batch(airportSurface ? 'roads' : 'surfaces', color, geometry);
      } else {
        const color = feature.kind === 'runway' ? 0x5b6569 : feature.kind === 'taxiway' ? 0x89938c
          : ['footway', 'path', 'steps'].includes(feature.highway) ? 0xe0d7bf : 0x697773;
        batch('roads', color, ribbon(points, roadWidth(feature), 0.6));
      }
    }
  }
  for (const { layer, color, geometries } of batches.values()) {
    const geometry = mergeGeometries(geometries, false);
    if (!geometry) throw new Error('지도 도형 병합에 실패했습니다.');
    layers[layer].add(new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })));
    geometries.forEach(g => g.dispose());
  }
  const terminal = data.features.find(f => f.id === 'relation/3917466');
  if (terminal) {
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 512; labelCanvas.height = 96;
    const context = labelCanvas.getContext('2d');
    context.fillStyle = '#ffffffed'; context.fillRect(0, 0, 512, 96);
    context.font = 'bold 34px sans-serif'; context.textAlign = 'center'; context.fillStyle = '#254a42';
    context.fillText('제1여객터미널 · T1', 256, 61);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(labelCanvas), depthTest: false }));
    const points = terminal.parts.flat();
    label.position.set(points.reduce((s, p) => s + p[0], 0) / points.length, 95,
      points.reduce((s, p) => s + p[1], 0) / points.length);
    label.scale.set(310, 58, 1);
    scene.add(label);
  }

  let pending = false;
  function render() {
    pending = false;
    const { width, height } = canvas.parentElement.getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    document.querySelector('#render-info').textContent = `${renderer.info.render.calls} draw calls · ${renderer.info.render.triangles.toLocaleString()} triangles · 조작할 때만 렌더링`;
    window.incheonPreview = { ready: true, counts, render: { ...renderer.info.render },
      renderer: renderer.getContext().getParameter(renderer.getContext().RENDERER) };
  }
  function invalidate() { if (!pending) { pending = true; requestAnimationFrame(render); } }
  function view(top) {
    controls.target.set(0, 0, 0);
    camera.position.set(top ? 0 : 1550, top ? 3100 : 2000, top ? 0.1 : 2050);
    controls.update(); invalidate();
  }
  controls.addEventListener('change', invalidate);
  new ResizeObserver(invalidate).observe(canvas.parentElement);
  document.querySelector('#top').addEventListener('click', () => view(true));
  document.querySelector('#oblique').addEventListener('click', () => view(false));
  for (const input of document.querySelectorAll('[data-layer]')) {
    input.addEventListener('change', () => { layers[input.dataset.layer].visible = input.checked; invalidate(); });
  }
  const levels = data.features.filter(f => f.height?.source === 'levels-estimate').length;
  for (const [name, value] of [['표시 구역', '2 × 2 km'], ['도로 객체', counts.road], ['건물 객체', counts.building], ['층수 기반 추정', `${levels}개`], ['높이 미상', `${counts.building - levels}개`]]) {
    const dt = document.createElement('dt'); dt.textContent = name;
    const dd = document.createElement('dd'); dd.textContent = value;
    document.querySelector('#counts').append(dt, dd);
  }
  document.querySelector('#coverage').textContent = `구멍이 있거나 불완전한 복합 도형 ${data.stats.excludedRelations}개는 제외했습니다. 원본 데이터와 한계는 문서에 기록했습니다.`;
  status.textContent = '실제 도로·건물 배치를 불러왔습니다. 현재 구역은 영종도 전체의 일부입니다.';
  view(false);
}

start().catch(error => { status.textContent = `미리보기를 불러오지 못했습니다: ${error.message}`; console.error(error); });
