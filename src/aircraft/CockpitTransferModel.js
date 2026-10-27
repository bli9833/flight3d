import * as THREE from 'three';

// The current ambient is uniform. Sky is one basis column, floods three columns,
// and the sun is sampled on a small sphere (bank can put it below the deck).
// Direct sun stays rasterised;
// only its diffuse bounce is read from the transfer texture.
export const TRANSFER_VERSION = 1;
export const POSITION_STEP = 0.08;
export const NORMAL_STEP = 0.5;
export const SUN_DIRECTIONS = Object.freeze([-60, -20, 20, 60].flatMap(elevation =>
  Array.from({ length: 6 }, (_, i) => {
    const a = i * Math.PI / 3, e = THREE.MathUtils.degToRad(elevation);
    return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
  })).concat([[0, 1, 0], [0, -1, 0]]));
export const TRANSFER_COLUMNS = 4 + SUN_DIRECTIONS.length;

export function receiverKey(position, normal) {
  return [...position.toArray().map(x => Math.round(x / POSITION_STEP)),
    ...normal.toArray().map(x => Math.round(x / NORMAL_STEP))].join(',');
}

/**
 * The single-scatter bake has no light source size and few bounces, so receivers
 * either side of a panel edge can differ ~100x while sitting 8cm apart; those
 * steps read as jagged black blotches on the ceiling. Averaging each receiver
 * with its nearby, similarly-oriented neighbours approximates penumbra and the
 * multi-bounce fill the solver misses.
 */
export function smoothTransport(keys, values, columns = TRANSFER_COLUMNS) {
  const grid = new Int16Array(keys.length * 6);
  const cells = new Map();
  const bucketKey = (x, y, z) => ((x + 512) << 20) | ((y + 512) << 10) | (z + 512);
  for (let i = 0; i < keys.length; i++) {
    const parts = keys[i].split(',');
    if (parts.length !== 6) throw Error('Invalid receiver key');
    for (let k = 0; k < 6; k++) grid[i * 6 + k] = Number(parts[k]);
    const key = bucketKey(grid[i * 6] >> 3, grid[i * 6 + 1] >> 3, grid[i * 6 + 2] >> 3);
    let list = cells.get(key);
    if (!list) cells.set(key, list = []);
    list.push(i);
  }
  const radius = 4 * POSITION_STEP, radius2 = radius * radius;
  const out = new Float32Array(values.length);
  const sums = new Float64Array(columns);
  const magnitude = new Float32Array(keys.length);
  for (let i = 0; i < keys.length; i++) {
    const b = i * 6;
    magnitude[i] = Math.sqrt(grid[b + 3] ** 2 + grid[b + 4] ** 2 + grid[b + 5] ** 2) || 1;
  }
  for (let i = 0; i < keys.length; i++) {
    const a0 = i * 6;
    const ax = grid[a0], ay = grid[a0 + 1], az = grid[a0 + 2];
    const anx = grid[a0 + 3], any = grid[a0 + 4], anz = grid[a0 + 5];
    const na = magnitude[i];
    for (let c = 0; c < columns; c++) sums[c] = values[i * columns + c];
    let weight = 1;
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      const list = cells.get(bucketKey((ax >> 3) + x, (ay >> 3) + y, (az >> 3) + z));
      if (!list) continue;
      for (const j of list) {
        if (j === i) continue;
        const b0 = j * 6;
        const dx = grid[b0] - ax, dy = grid[b0 + 1] - ay, dz = grid[b0 + 2] - az;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 * POSITION_STEP * POSITION_STEP > radius2) continue;
        const cosine = (anx * grid[b0 + 3] + any * grid[b0 + 4] + anz * grid[b0 + 5]) /
          (na * magnitude[j]);
        if (cosine < .55) continue;
        const w = (1 - Math.sqrt(d2) * POSITION_STEP / radius) ** 2;
        weight += w;
        for (let c = 0; c < columns; c++) {
          const v = values[j * columns + c];
          if (v) sums[c] += w * v;
        }
      }
    }
    const inv = 1 / weight;
    for (let c = 0; c < columns; c++) out[i * columns + c] = sums[c] * inv;
  }
  return out;
}

export function sunWeights(direction) {
  const ranked = SUN_DIRECTIONS.map((v, i) => ({ i,
    distance: Math.max(0, 1 - direction.dot(new THREE.Vector3(...v)))
  }));
  // A continuous partition of unity avoids jumps when nearest neighbours swap.
  const sum = ranked.reduce((s, v) => s + 1 / Math.max(1e-12, v.distance ** 4), 0);
  return ranked.map(v => [v.i, (1 / Math.max(1e-12, v.distance ** 4)) / sum]);
}

/** Nonnegative diffuse radiosity: outgoing = reflectance * incident. */
export function solveTransfer(direct, links, reflectance, columns, tolerance = 1e-5) {
  const count = reflectance.length;
  if (!count || !Number.isInteger(columns) || columns < 1 || direct.length !== count * columns ||
      links.length !== count || !direct.every(v => Number.isFinite(v) && v >= 0) ||
      reflectance.some(v => !Number.isFinite(v) || v < 0 || v >= 1) ||
      links.some(row => row.some(([j, f]) => !Number.isInteger(j) || j < 0 || j >= count ||
        !Number.isFinite(f) || f < 0) || row.reduce((s, [, f]) => s + f, 0) > 1 + 1e-8)) {
    throw Error('Invalid diffuse transfer system');
  }
  let result = Float64Array.from(direct);
  for (let iteration = 0; iteration < 100; iteration++) {
    const next = Float64Array.from(direct);
    for (let i = 0; i < count; i++) {
      for (const [j, factor] of links[i]) {
        for (let k = 0; k < columns; k++) {
          next[i * columns + k] += factor * reflectance[j] * result[j * columns + k];
        }
      }
    }
    let error = 0;
    for (let i = 0; i < next.length; i++) error = Math.max(error, Math.abs(next[i] - result[i]));
    result = next;
    if (error < tolerance) return { values: result, iterations: iteration + 1, residual: error };
  }
  throw new Error('Cockpit radiosity did not converge');
}

// Meet the night-time illumination baseline without exceeding installed output.
// Coordinate descent solves a bounded least-squares problem, not an aperture dimmer.
export function solveFloodOutputs(rows, daylight, maximum) {
  const output = maximum.slice();
  for (let pass = 0; pass < 24; pass++) {
    for (let j = 0; j < maximum.length; j++) {
      let numerator = 0, denominator = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const target = row.reduce((s, c, k) => s + c * maximum[k], 0);
        const other = row.reduce((s, c, k) => s + (k === j ? 0 : c * output[k]), daylight[i]);
        numerator += row[j] * (target - other);
        denominator += row[j] ** 2;
      }
      output[j] = denominator > 0 ? Math.max(0, Math.min(maximum[j], numerator / denominator)) : 0;
    }
  }
  return output;
}
