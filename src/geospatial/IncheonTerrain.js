/** Shared terrain sampling for preview meshes and feature placement; no DOM. */
export class IncheonTerrain {
  constructor(metadata, grids, coastline) {
    if (metadata.schemaVersion !== 1 || !metadata.grids || !coastline?.land) throw new Error('Invalid Incheon terrain metadata');
    this.metadata = metadata;
    this.grids = grids;
    this.coastline = coastline;
    for (const [name, descriptor] of Object.entries(metadata.grids)) {
      const values = grids[name];
      if (!Number.isInteger(descriptor.gridSize) || descriptor.gridSize < 2 || !(descriptor.worldSize > 0)
        || !values || values.length !== descriptor.gridSize ** 2 || !values.every(Number.isFinite)) {
        throw new Error(`Invalid terrain grid: ${name}`);
      }
    }
  }

  sampleGrid(name, x, z) {
    const { gridSize, worldSize } = this.metadata.grids[name];
    const half = worldSize / 2;
    if (![x, z].every(Number.isFinite) || Math.abs(x) > half || Math.abs(z) > half) throw new RangeError('Outside Incheon terrain bounds');
    const col = (x + half) / worldSize * (gridSize - 1);
    const row = (z + half) / worldSize * (gridSize - 1);
    const ix = Math.min(Math.floor(col), gridSize - 2);
    const iz = Math.min(Math.floor(row), gridSize - 2);
    const fx = col - ix;
    const fz = row - iz;
    const data = this.grids[name];
    const i = iz * gridSize + ix;
    return data[i] * (1-fx) * (1-fz) + data[i+1] * fx * (1-fz)
      + data[i+gridSize] * (1-fx) * fz + data[i+gridSize+1] * fx * fz;
  }

  getNaturalHeight(x, z) {
    return this.sampleGrid(Math.max(Math.abs(x), Math.abs(z)) <= 1000 ? 'local-natural' : 'regional-natural', x, z);
  }

  getHeight(x, z) {
    return Math.max(Math.abs(x), Math.abs(z)) <= 1000
      ? this.sampleGrid('local-graded', x, z) : this.getNaturalHeight(x, z);
  }

  isLand(x, z) {
    const insideRing = ring => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i]; const b = ring[j];
        if ((a[1] > z) !== (b[1] > z) && x < (b[0]-a[0]) * (z-a[1]) / (b[1]-a[1]) + a[0]) inside = !inside;
      }
      return inside;
    };
    const { type, coordinates } = this.coastline.land;
    if (!['Polygon', 'MultiPolygon'].includes(type)) throw new Error('Invalid land polygon type');
    const polygons = type === 'Polygon' ? [coordinates] : coordinates;
    return polygons.some(rings => insideRing(rings[0]) && !rings.slice(1).some(insideRing));
  }
}

export async function loadIncheonTerrain(baseUrl) {
  const json = async file => {
    const response = await fetch(`${baseUrl}${file}`);
    if (!response.ok) throw new Error(`Terrain asset ${file}: HTTP ${response.status}`);
    return response.json();
  };
  const [metadata, coastline] = await Promise.all([json('terrain-metadata.json'), json('coastline.json')]);
  const entries = await Promise.all(Object.entries(metadata.grids).map(async ([name, descriptor]) => {
    const response = await fetch(`${baseUrl}${descriptor.file}`);
    if (!response.ok) throw new Error(`Terrain grid ${name}: HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== descriptor.gridSize ** 2 * 4) throw new Error(`Terrain grid size mismatch: ${name}`);
    const view = new DataView(buffer);
    const values = new Float32Array(descriptor.gridSize ** 2);
    for (let i = 0; i < values.length; i++) values[i] = view.getFloat32(i * 4, true);
    return [name, values];
  }));
  return new IncheonTerrain(metadata, Object.fromEntries(entries), coastline);
}
