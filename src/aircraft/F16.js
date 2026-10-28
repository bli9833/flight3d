import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// The supplied asset is +X forward, with a 93.94-unit wingspan. Its authored
// hierarchy supplies the Z-up conversion; mount it in our metre/-Z-forward frame.
export const F16_SCALE = 9.96 / 93.93575286865234;
export const F16_CENTER_X = 25.935216903686523;

/** Partition the authored, merged deployed gear into three movable legs. */
export function splitF16Gear(geometry) {
  const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const partitions = { nose: [], mainLeft: [], mainRight: [] };
  const positions = source.attributes.position;
  for (let i = 0; i < positions.count; i += 3) {
    const z = (positions.getZ(i) + positions.getZ(i + 1) + positions.getZ(i + 2)) / 3;
    const x = (positions.getX(i) + positions.getX(i + 1) + positions.getX(i + 2)) / 3;
    partitions[z < -0.5 ? 'nose' : x < 0 ? 'mainLeft' : 'mainRight'].push(i, i + 1, i + 2);
  }
  const result = {};
  for (const [name, vertices] of Object.entries(partitions)) {
    const part = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) {
      const values = new attribute.array.constructor(vertices.length * attribute.itemSize);
      vertices.forEach((vertex, i) => {
        for (let j = 0; j < attribute.itemSize; j++) values[i * attribute.itemSize + j] = attribute.array[vertex * attribute.itemSize + j];
      });
      part.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized));
    }
    part.computeBoundingBox();
    part.computeBoundingSphere();
    result[name] = part;
  }
  source.dispose();
  return result;
}

export class F16 {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'Aircraft_F16';
    this.lightsGroup = new THREE.Group();
    this.group.add(this.lightsGroup);
    this.lightsOn = true;
    this.useGltf = false;
    this.loadingGltf = true;
    this.modelLoaded = false;
    this.isCrashed = false;
    this.gearLegs = {};
    this.gearExtension = 1;
    this.cockpit = {
      group: new THREE.Group(), gltfCockpitGroup: new THREE.Group(),
      cockpitModelFailed: false, cockpitModelLoading: true,
      yokesVisible: true, gltfYokes: [], syncLighting() {},
      toggleYokes() { return this.yokesVisible; },
    };
    // The cockpit stays in the complete airframe, so exterior views also show it.
    this.group.add(this.cockpit.group);
    this.cockpit.group.add(this.cockpit.gltfCockpitGroup);
    this.ready = new GLTFLoader().loadAsync(`${import.meta.env?.BASE_URL ?? '/'}models/f-16.glb`)
      .then(gltf => this.installModel(gltf.scene))
      .catch(error => {
        this.cockpit.cockpitModelFailed = true;
        console.error('F-16 model failed to load:', error);
      }).finally(() => {
        this.loadingGltf = false;
        this.cockpit.cockpitModelLoading = false;
      });
  }

  installModel(scene) {
    const mount = new THREE.Group();
    mount.rotation.y = Math.PI / 2;
    mount.scale.setScalar(F16_SCALE);
    mount.position.z = F16_CENTER_X * F16_SCALE;
    mount.add(scene);
    mount.updateMatrixWorld(true);
    const meshes = [];
    scene.traverse(node => { if (node.isMesh) meshes.push(node); });
    for (const source of meshes) {
      const name = source.parent.name;
      const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
      const material = source.material.clone();
      if (material.transparent) {
        material.depthWrite = false;
        material.side = THREE.FrontSide;
        material.opacity = Math.min(material.opacity, 0.18);
      }
      if (material.name === 'F-16-hud') {
        material.transparent = true;
        material.opacity = 0.3;
        material.depthWrite = false;
      }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.castShadow = !material.transparent;
      mesh.receiveShadow = !material.transparent;
      if (name.startsWith('F-16-landingOn_')) {
        this.installGear(mesh);
      } else if (name.startsWith('F-16-landingOff_')) {
        this.stowedGear = mesh;
        this.group.add(mesh);
      } else if (name.startsWith('F-16-landingOnLight_')) {
        this.landingLight = mesh;
        this.lightsGroup.add(mesh);
      } else if (name.startsWith('F-16-cockpit_') || name.startsWith('F-16-hud_')) {
        this.cockpit.gltfCockpitGroup.add(mesh);
      } else {
        this.group.add(mesh);
      }
    }
    this.modelLoaded = this.useGltf = true;
    this.cockpit.onModelReady?.();
    this.update(0, { gearState: this.gearExtension });
  }

  installGear(mesh) {
    for (const [id, geometry] of Object.entries(splitF16Gear(mesh.geometry))) {
      const bounds = geometry.boundingBox;
      const pivot = bounds.getCenter(new THREE.Vector3());
      pivot.y = bounds.max.y;
      const group = new THREE.Group();
      group.name = `F16_Gear_${id}`;
      group.position.copy(pivot);
      geometry.translate(-pivot.x, -pivot.y, -pivot.z);
      const leg = new THREE.Mesh(geometry, mesh.material);
      leg.castShadow = leg.receiveShadow = true;
      group.add(leg);
      this.group.add(group);
      this.gearLegs[id] = group;
    }
    mesh.geometry.dispose();
  }

  update(dt, state = {}) {
    const extension = THREE.MathUtils.clamp(state.gearState ?? this.gearExtension, 0, 1);
    this.gearExtension = extension;
    const fold = (1 - extension) * Math.PI / 2;
    for (const [id, leg] of Object.entries(this.gearLegs)) {
      leg.visible = extension > 0.001;
      if (id === 'nose') leg.rotation.x = -fold;
      else leg.rotation.z = (id === 'mainLeft' ? -1 : 1) * fold;
      const failed = state.gearDamage?.[id] === 'collapsed';
      if (failed) leg.visible = false;
    }
    if (this.stowedGear) this.stowedGear.visible = extension < 0.999;
    if (this.landingLight) this.landingLight.visible = this.lightsOn && !this.isCrashed && extension > 0.95;
  }

  setCockpitMode(isCockpit) { this.isCockpit = isCockpit; }
  triggerCrashVisuals() { this.isCrashed = true; this.lightsGroup.visible = false; }
  resetCrashVisuals() { this.isCrashed = false; this.lightsGroup.visible = this.lightsOn; }
}
