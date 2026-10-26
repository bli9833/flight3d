# North hillside city — issue #207

Baseline: `258c55e5b8d196227255af0dfc719df8ded4bdf5` (includes south district #211).
Current source: the PR containing this directory. No new GLB binary was added.

## Reproduction

Use Node 22.23.2 and `npm ci`. Start Vite on port 5186 and a dedicated Chrome CDP
profile. On Windows/PowerShell, start Chrome hidden:

```powershell
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5186 --strictPort
# In another terminal:
Start-Process 'C:/Program Files/Google/Chrome/Application/chrome.exe' -WindowStyle Hidden -ArgumentList @('--headless=new', '--remote-debugging-port=9467', '--user-data-dir=C:/temp/flight3d-north-review', '--use-angle=d3d11', '--no-first-run', 'about:blank')
$env:CHROME_DEBUG_PORT='9467'
$env:ARTIFACT_DIR='review-artifacts/north-city'
node scripts/verify-city-district.mjs
```

Use an unused profile/port and stop only the processes started for this review.
Other platforms can use their own Chrome executable/backend with the same CDP
port. Override `SIM_URL`, `BASELINE_REF` and `ARTIFACT_DIR` as necessary. The
baseline FoliageAndCities source is read from Git; its unchanged south district
and building asset helpers are shared with current code. Both versions await
their actual GLB loads before measurements.

## Evidence

- `north-{low,high}-{day,night}-{before,after}.jpg`: seed 12345, identical cameras,
  1440 x 900, noon and 23:00; real 22,000 m / 256-segment terrain and foliage.
- `south-day-{before,after}.jpg`: south regression view; east/south building
  positions, dimensions, heights, colors/archetypes are compared by the harness
  (the metadata includes transforms/archetypes; the original color draw sequence
  is retained). Visual inspection found connected streets, grounded plinths and
  no road/building/tree intersections in the inspected north views.
- `north-plinth-and-junction.jpg`, `north-junction.jpg`, `north-dead-end.jpg`:
  close views of foundations, shared intersections and intentional road ends.
- `north-full-scene.jpg`: same north view rendered by the actual simulator.
- `browser-results.json`: host/GPU, per-pose metrics, asset network response,
  fallback with blocked GLB, day/night and LOD round trips, collision query,
  district topology and relative performance budgets.
- `flight-results.json`: six simulated seconds crossing north at 120 Hz physics,
  no crash/nonfinite state, minimum clearance above 60 m, north-plinth collision
  query, coastal→Lukla→coastal collision-grid isolation, reset, runway parking and
  approach/runway preset round trip. The harness disables requestAnimationFrame
  before full-simulator initialization to prevent wall-clock stepping and camera
  drift between explicit stepping/rendering/capture.
- `crash-results.txt`: existing crash suite (six impact types, restart, explosion
  rendering and preserved impact-velocity checks). Screenshot files remain local;
  this log does not claim visual review of every explosion.
- `flight-suite-results.txt` and `flight-suite-performance.json`: existing five
  flight scenarios (takeoff, stall/recovery, landing/braking, camera/presets,
  demo start/stop), with the original assertions. On Windows a temporary copy of
  `scripts/test-flight-agent.js` changes only Chrome's executable path, profile
  directory, `windowsHide` and Vulkan→D3D11 launcher flag. The committed runner's
  default Linux launcher is not changed by this PR.

## Measurement limits

Validated on Intel Core Ultra 7 256V / Intel Arc 140V, Chrome 155, ANGLE D3D11.
The final district has 13 lots, 22 street links, 8 junctions and 5 dead ends.
Maximum accepted grade (both surfaces) is 16.72%; maximum plinth height 4.93 m.
At seed 12345, total buildings change from 349 to 219; the 206 east/south records
are identical. The shared GLB response is 149,945 encoded bytes with cache
disabled, versus 149,668 asset-file bytes.

| Pose | Calls before → after | Triangles before → after | Median ms before → after | p95 ms before → after |
| --- | ---: | ---: | ---: | ---: |
| North low, day | 16 → 18 | 265,926 → 251,088 | 0.2 → 0.2 | 0.4 → 0.5 |
| North high, day | 13 → 15 | 254,352 → 248,068 | 0.2 → 0.2 | 0.4 → 0.3 |
| North low, night | 16 → 18 | 265,926 → 251,088 | 0.2 → 0.2 | 0.7 → 0.5 |
| North high, night | 13 → 15 | 254,352 → 248,068 | 0.1 → 0.2 | 0.4 → 0.5 |
| South, day | 18 → 22 | 347,754 → 346,298 | 0.2 → 0.2 | 0.4 → 0.5 |

`npm run check`, `npm test` (565 passing tests), and `npm run build` passed on
Node 22.23.2. All five existing flight scenarios and all six existing crash types
plus restart passed. The flight suite checks demo start/stage advance/stop;
it does not prove a complete autonomous demo circuit. City browser captures and
the separate deterministic north flyover/airport round trip also passed.

The isolated city harness performs 10 warmups then 100 render+`gl.finish` wall-time
samples per pose. These are **not full-flight FPS or GPU timer queries**; sub-ms
samples are subject to browser clock granularity. Full-flight suite timing measures
simulation execution speed and is a different metric.

The city performance budget allows baseline +4 calls and +15,000 triangles;
median <= max(1.5 x baseline, baseline +2 ms), p95 <= max(2 x baseline,
baseline +4 ms). This is a regression guard with clock-jitter allowance, not a
target frame rate. Inspect raw JSON rather than comparing independent machines.
The shared asset is 149,668 file bytes; CDP `encodedDataLength` includes response
overhead and cache state is recorded. Generated atlas storage is an RGBA8 estimate,
not measured VRAM or network transfer.

Placement samples both surfaces at <=4 m and rendered triangle boundaries; unit
tests independently resample accepted actual-terrain lots at 0.5 m. This does not
prove safety for arbitrary unsampled discontinuities in a future height function.
Roads are cosmetic overlays and the existing analytic/render mismatch remains;
no road taxi/contact-surface claim or terrain deformation is made. The hillside
town deliberately retains fewer buildings than the old random cluster.
