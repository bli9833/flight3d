/**
 * Decide when the directional sun shadow map has to be rebuilt.
 *
 * The pass renders into a fixed 2048² target, so a refresh costs a full clear plus every
 * caster inside the sun's box. Three rebuilds it on every frame because it cannot know that
 * nothing moved, so a flight deck that is only turning its head repeats identical work.
 * `shadow.autoUpdate = false` hands that decision over, and this class answers it by
 * comparing the map's inputs against the ones it was built from.
 *
 * The inputs covered are what this scene actually moves casters with: world transforms,
 * geometry swaps, visibility, shadow layers, the view camera's own layer mask (three tests
 * casters against it), instanced batch sizes, and the light and its box. Bone poses, morph
 * weights, material settings and vertices edited inside a geometry are not read, so changing
 * one of those on a caster has to call `invalidate()`.
 */

/** A tenth of a millimetre of slack, and only for metres: a three-hundredth of a shadow
 * texel, wide enough that a settling airframe does not read as motion. */
const REBUILD_TOLERANCE = 1e-4;

/** One row of inputs, compared against the last row the map was built from. */
class Sample {
  constructor(capacity) {
    this.buffers = [new Float64Array(capacity), new Float64Array(capacity)];
    this.reference = 0;
    this.spare = 1;
    this.count = -1; // entries in the reference row, -1 while nothing has been recorded
    this.index = 0;
    this.changed = false;
  }

  /** Nothing is known about the map's contents, so the next row is always a change. */
  forget() {
    this.count = -1;
  }

  begin() {
    this.index = 0;
    this.changed = false;
  }

  /**
   * Take one entry. Exact by default: identifiers, layer masks and bias settings change the
   * pass outright however small the difference looks. Only metres get the tolerance.
   */
  put(value, slack = 0) {
    const index = this.index++;
    // Past the recorded length is a caster that the map on screen never drew.
    if (!this.changed && (index >= this.count
      || Math.abs(value - this.buffers[this.reference][index]) > slack)) {
      this.changed = true;
    }
    if (index === this.buffers[this.spare].length) this.grow();
    this.buffers[this.spare][index] = value;
  }

  /**
   * Whether this row differs from the reference. A differing row becomes the reference;
   * a matching row is dropped, so differences below the tolerance cannot accumulate.
   */
  resolve() {
    // A row shorter than the reference dropped a caster the map used to draw.
    if (this.count >= 0 && this.index < this.count) this.changed = true;
    if (!this.changed) return false;
    const swap = this.reference;
    this.reference = this.spare;
    this.spare = swap;
    this.count = this.index;
    return true;
  }

  /** Both rows keep the same length, so their entries stay comparable after a swap. */
  grow() {
    this.buffers = this.buffers.map(row => {
      const larger = new Float64Array(row.length * 2);
      larger.set(row);
      return larger;
    });
  }
}

export class SunShadowRefresh {
  constructor(light) {
    this.light = light;
    this.header = new Sample(64);
    this.casters = new Sample(4096);
  }

  /** The map no longer shows what was last recorded, so rebuild before reusing it again. */
  invalidate() {
    this.casters.forget();
  }

  /**
   * Ask whether the pass has to run for this frame, and mark `shadow.needsUpdate` when it
   * does. Call after the light and its box are set, immediately before `renderer.render`,
   * with the camera that render is about to use.
   */
  beforeRender(scene, camera) {
    const shadow = this.light.shadow;
    // With autoUpdate on, three refreshes the pass whatever is in it, and an unallocated
    // target has nothing to reuse. Neither is worth a scene walk to find out.
    const reusable = !shadow.autoUpdate && !!shadow.map;
    // The header tracks the aircraft, so a frame in motion — which is every frame of
    // flight — is settled by twenty comparisons instead of traversing the scene.
    const holds = reusable && !this.readHeader(camera) && !this.readCasters(scene);
    if (!reusable) this.casters.forget(); // the pass just ran on poses nobody recorded
    if (!holds) shadow.needsUpdate = true;
    return !holds;
  }

  /** Light transform, target, enabled state, the shadow camera's box, and the view camera. */
  readHeader(camera) {
    const light = this.light, shadow = light.shadow, box = shadow.camera, row = this.header;
    const metres = [light.position.x, light.position.y, light.position.z,
      light.target.position.x, light.target.position.y, light.target.position.z,
      box.near, box.far, box.left, box.right, box.top, box.bottom];
    // three draws a caster into this map only if the camera being rendered with can see its
    // layers, so the mask belongs to the pass's inputs even though the box does not move.
    const settings = [light.castShadow ? 1 : 0, light.visible ? 1 : 0,
      shadow.mapSize.width, shadow.mapSize.height, shadow.bias, shadow.normalBias, shadow.radius,
      camera.layers.mask];
    row.begin();
    for (const value of metres) row.put(value, REBUILD_TOLERANCE);
    for (const value of settings) row.put(value);
    return row.resolve();
  }

  /** Every mesh the pass would draw, in traversal order. */
  readCasters(scene) {
    // The transforms read here must be the ones this render is about to draw.
    scene.updateMatrixWorld();
    const row = this.casters;
    row.begin();
    scene.traverse(object => {
      if (!object.isMesh || !object.castShadow) return;
      // A caster hidden behind an ancestor is not drawn, so it must not be recorded either.
      // Its visibility flipping is caught when it enters or leaves the row.
      for (let node = object; node; node = node.parent) if (!node.visible) return;
      row.put(object.id);
      row.put(object.geometry?.id ?? 0);
      row.put(object.layers.mask);
      // Tree and city batches are instanced and repopulated by level of detail, which
      // redraws the silhouette without moving the mesh that owns the batch.
      if (object.isInstancedMesh) {
        row.put(object.count);
        row.put(object.instanceMatrix.version);
      }
      const matrix = object.matrixWorld.elements;
      for (let i = 0; i < 16; i++) row.put(matrix[i], REBUILD_TOLERANCE);
    });
    return row.resolve();
  }
}
