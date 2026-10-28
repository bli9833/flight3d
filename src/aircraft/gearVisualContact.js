import * as THREE from 'three';

// Evaluate the physical support plane at the rendered tire, including pitch/roll
// caused by unequal suspension travel. Authored wheelbases need not match physics.
export function gearSupportHeight(contacts, compressions, x, z) {
  const [n, l, r] = contacts;
  const height = c => c.localPos.y - c.wheelRadius + (compressions?.[c.id] ?? 0);
  const lateral = (x - l.localPos.x) / (r.localPos.x - l.localPos.x);
  const main = height(l) + lateral * (height(r) - height(l));
  const mainAtNose = height(l) + (n.localPos.x - l.localPos.x) /
    (r.localPos.x - l.localPos.x) * (height(r) - height(l));
  return main + (z - l.localPos.z) / (n.localPos.z - l.localPos.z) * (height(n) - mainAtNose);
}

export function tireContact(geometry) {
  geometry.computeBoundingBox();
  const bottom = geometry.boundingBox.min.y;
  const p = geometry.attributes.position;
  const point = new THREE.Vector3();
  let count = 0;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) <= bottom + 0.002) {
      point.x += p.getX(i); point.z += p.getZ(i); count++;
    }
  }
  return point.set(point.x / count, bottom, point.z / count);
}
