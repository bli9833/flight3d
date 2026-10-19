import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';

const CACHE_DIR = path.resolve(process.cwd(), '.cache/satellite_tiles');
const OUT_PATH = path.resolve(process.cwd(), 'public/terrain/lukla_satellite.jpg');

async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });

  const zoom = 13;
  const minX = 6067;
  const maxX = 6071;
  const minY = 3437;
  const maxY = 3441;

  const totalCols = maxX - minX + 1; // 5
  const totalRows = maxY - minY + 1; // 5
  const fullWidth = totalCols * 256;  // 1280
  const fullHeight = totalRows * 256; // 1280

  console.log(`🛰️ Stitching 5x5 ESRI Satellite Tiles (Zoom ${zoom}) into ${fullWidth}x${fullHeight} JPEG...`);

  const compositeBuffer = Buffer.alloc(fullWidth * fullHeight * 4);

  let tileCount = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      tileCount++;
      const cachedFile = path.join(CACHE_DIR, `${zoom}_${x}_${y}.jpg`);
      let tileBuf;

      if (fs.existsSync(cachedFile)) {
        tileBuf = fs.readFileSync(cachedFile);
      } else {
        const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`;
        process.stdout.write(`Downloading tile ${tileCount}/25 (${x}, ${y})...\r`);
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        const ab = await res.arrayBuffer();
        tileBuf = Buffer.from(ab);
        fs.writeFileSync(cachedFile, tileBuf);
      }

      const decoded = jpeg.decode(tileBuf, { useTArray: true });
      const tileWidth = decoded.width;
      const tileHeight = decoded.height;

      const colOffset = (x - minX) * 256;
      const rowOffset = (y - minY) * 256;

      for (let r = 0; r < tileHeight; r++) {
        const srcStart = r * tileWidth * 4;
        const srcEnd = srcStart + tileWidth * 4;
        const dstY = rowOffset + r;
        const dstX = colOffset;
        const dstStart = (dstY * fullWidth + dstX) * 4;

        compositeBuffer.set(decoded.data.subarray(srcStart, srcEnd), dstStart);
      }
    }
  }

  console.log('\n🎨 Encoding full composite satellite texture to JPEG (85% quality)...');
  const encoded = jpeg.encode({
    width: fullWidth,
    height: fullHeight,
    data: compositeBuffer
  }, 85);

  fs.writeFileSync(OUT_PATH, encoded.data);
  console.log(`✅ Stitched Satellite Texture successfully created at ${OUT_PATH} (${(encoded.data.length / 1024).toFixed(1)} KB)!`);
}

main().catch(err => {
  console.error('Fatal error during satellite tile stitch:', err);
  process.exit(1);
});
