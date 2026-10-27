import * as THREE from 'three';

// Partition actual exterior triangles into structural regions, including batched GLBs.
// Own only generated geometry; source materials/textures remain owned by the aircraft.
export class AircraftBreakup {
  constructor(scene) {
    this.scene = scene;
    this.pieces = [];
    this.target = new THREE.Vector3();
    this.radius = 20;
  }

  spawn(aircraft, velocity) {
    this.clear();
    aircraft.setCockpitMode(false);
    const root = aircraft.group;
    root.updateWorldMatrix(true, true);
    const sources = aircraft.useGltf ? [aircraft.gltfGroup,
      aircraft.gearGroup?.parent === root ? aircraft.gearGroup : null]
      : aircraft.proceduralGroup ? [aircraft.proceduralGroup]
        : [aircraft.fuselageGroup, aircraft.wingGroup, aircraft.tailGroup,
          aircraft.empennageGroup, aircraft.enginesGroup, aircraft.gearGroup];
    const inverse = root.matrixWorld.clone().invert();
    const meshes = [];
    const bounds = new THREE.Box3();
    for (const source of sources.filter(Boolean)) source.traverseVisible(mesh => {
      if (!mesh.isMesh || !mesh.geometry.attributes.position) return;
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      geometry.applyMatrix4(inverse.clone().multiply(mesh.matrixWorld));
      geometry.computeBoundingBox();
      bounds.union(geometry.boundingBox);
      meshes.push({ geometry, material: mesh.material });
    });
    if (bounds.isEmpty()) return;
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const regions = new Map();
    for (const { geometry, material } of meshes) {
      const p = geometry.attributes.position;
      const buckets = new Map();
      for (let i = 0; i < p.count; i += 3) {
        const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
        const z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
        const region = Math.abs(x - center.x) > size.x * 0.16
          ? (x < center.x ? 'left' : 'right')
          : `body${Math.min(3, Math.floor(4 * (z - bounds.min.z) / Math.max(size.z, 0.01)))}`;
        const group = geometry.groups.find(g => i >= g.start && i < g.start + g.count);
        const matIndex = group?.materialIndex ?? 0;
        const key = `${region}:${matIndex}`;
        if (!buckets.has(key)) buckets.set(key, { region, matIndex, indices: [] });
        buckets.get(key).indices.push(i, i + 1, i + 2);
      }
      for (const { region, matIndex, indices } of buckets.values()) {
        const fragment = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(geometry.attributes)) {
          const data = new attr.array.constructor(indices.length * attr.itemSize);
          indices.forEach((index, n) => {
            for (let k = 0; k < attr.itemSize; k++) data[n * attr.itemSize + k] = attr.array[index * attr.itemSize + k];
          });
          fragment.setAttribute(name, new THREE.BufferAttribute(data, attr.itemSize, attr.normalized));
        }
        const mesh = new THREE.Mesh(fragment, Array.isArray(material) ? material[matIndex] : material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (!regions.has(region)) regions.set(region, new THREE.Group());
        regions.get(region).add(mesh);
      }
      geometry.dispose();
    }
    let n = 0;
    const speed = velocity.length();
    for (const object of regions.values()) {
      const box = new THREE.Box3().setFromObject(object);
      const pivot = box.getCenter(new THREE.Vector3());
      object.children.forEach(mesh => mesh.geometry.translate(-pivot.x, -pivot.y, -pivot.z));
      object.position.copy(pivot).applyMatrix4(root.matrixWorld);
      object.quaternion.copy(root.getWorldQuaternion(new THREE.Quaternion()));
      const outward = pivot.clone().sub(center).applyQuaternion(object.quaternion).normalize();
      const impulse = outward.multiplyScalar(Math.min(16, speed * 0.13));
      impulse.y += Math.min(7, speed * 0.05);
      this.scene.add(object);
      this.pieces.push({ object, velocity: velocity.clone().multiplyScalar(0.55).add(impulse),
        spin: new THREE.Vector3(0.4 + n * 0.13, (n % 2 ? -1 : 1) * 0.6, 0.3 - n * 0.11),
        radius: box.getSize(new THREE.Vector3()).length() * 0.12 });
      n++;
    }
    this.aircraft = aircraft;
    root.visible = false;
    this.updateBounds();
  }

  update(dt, terrain, waterLevel = null) {
    // Substeps bound contact integration, not the total elapsed simulation time.
    let remaining = Number.isFinite(dt) ? Math.max(dt, 0) : 0;
    while (remaining > 0) {
      const h = Math.min(remaining, 1 / 120);
      remaining -= h;
      for (const piece of this.pieces) {
        const { object, velocity, spin, radius } = piece;
        const floor = terrain?.getHeight(object.position.x, object.position.z) ?? 0;
        // Approximate the immersed height of the fragment's contact sphere.
        // Dry terrain, shoreline crossings and shallow water use the same forces.
        const immersion = Number.isFinite(waterLevel) ? THREE.MathUtils.clamp(
          (Math.min(waterLevel, object.position.y + radius)
            - Math.max(floor, object.position.y - radius)) / (2 * radius), 0, 1) : 0;
        velocity.y -= 9.81 * h;
        velocity.multiplyScalar(Math.exp(-(0.12 + 2 * immersion) * h));
        spin.multiplyScalar(Math.exp(-2 * immersion * h));
        object.position.addScaledVector(velocity, h);
        object.rotateOnWorldAxis(new THREE.Vector3(1, 0, 0), spin.x * h);
        object.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), spin.y * h);
        object.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), spin.z * h);
        object.quaternion.normalize();
        const contactHeight = (terrain?.getHeight(object.position.x, object.position.z) ?? 0) + radius;
        if (object.position.y < contactHeight) {
          object.position.y = contactHeight;
          if (velocity.y < 0) velocity.y = Math.abs(velocity.y) > 1 ? -velocity.y * 0.18 * (1 - immersion) : 0;
          velocity.x *= Math.exp(-3.5 * h);
          velocity.z *= Math.exp(-3.5 * h);
          spin.multiplyScalar(Math.exp(-5 * h));
        }
      }
    }
    if (this.aircraft) this.aircraft.group.visible = false;
    this.updateBounds(terrain, waterLevel);
  }

  updateBounds(terrain, waterLevel = null) {
    if (!this.pieces.length) return;
    const box = new THREE.Box3();
    for (const { object } of this.pieces) box.expandByObject(object);
    box.getCenter(this.target);
    this.radius = Math.max(10, box.getSize(new THREE.Vector3()).length() / 2);
    const floor = terrain?.getHeight(this.target.x, this.target.z) ?? 0;
    if (Number.isFinite(waterLevel) && floor < waterLevel) this.target.y = Math.max(waterLevel, this.target.y);
  }

  clear() {
    for (const { object } of this.pieces) {
      this.scene.remove(object);
      object.traverse(mesh => mesh.geometry?.dispose());
    }
    this.pieces = [];
    if (this.aircraft) this.aircraft.group.visible = true;
    this.aircraft = null;
  }
}
