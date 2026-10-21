# Airport exterior GLB evidence — issue #13

Captured on 2026-10-21 against baseline f46c426. Reproduce with
`node scripts/verify-airport-buildings.mjs` after starting Vite; see
[asset documentation](../../docs/development/airport-buildings.md).

Reference device: Intel(R) Core(TM) Ultra 7 256V, Windows, Chrome 155, 1440 × 1000.
Renderer: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver). This is software rendering, not a hardware GPU benchmark.
The scene has fixed daylight, lighting, animation phase and camera poses;
it excludes aircraft, ocean, sky, postprocessing and shadow maps.

| View | Before | After |
| --- | --- | --- |
| overview | [capture](overview-before.jpg) | [capture](overview-after.jpg) |
| terminal | [capture](terminal-before.jpg) | [capture](terminal-after.jpg) |
| tower | [capture](tower-before.jpg) | [capture](tower-after.jpg) |
| hangar | [capture](hangar-before.jpg) | [capture](hangar-after.jpg) |
| tower-camera | [capture](tower-camera-before.jpg) | [capture](tower-camera-after.jpg) |
| distant | [capture](distant-before.jpg) | [capture](distant-after.jpg) |

The overview and hangar pairs show the intentional correction from terminal-local
hangar coordinates to the collision metadata's world coordinates. The tower camera
pair uses (120,78,280) looking at (-1250,12,0); the runway threshold remains visible
between the new mullions. Distant hangars omit overlapping door overlays.

| View | Calls before → after | Triangles before → after | Median ms before → after | P95 ms before → after |
| --- | ---: | ---: | ---: | ---: |
| overview | 105 → 135 | 2064 → 3004 | 2.20 → 2.90 | 3.10 → 112.50 |
| terminal | 9 → 30 | 68 → 2552 | 1.00 → 1.10 | 2.10 → 2.50 |
| tower | 16 → 33 | 456 → 3196 | 0.60 → 1.30 | 1.50 → 29.50 |
| hangar | 6 → 10 | 136 → 1052 | 0.90 → 1.20 | 2.00 → 1.50 |
| tower-camera | 186 → 216 | 4424 → 8884 | 3.20 → 2.20 | 4.40 → 47.80 |
| distant | 337 → 367 | 7160 → 7608 | 2.40 → 3.40 | 3.30 → 30.20 |

Five warmup renders precede 20 samples per view; each sample measures render +
gl.finish wall time. Large P95 variation is recorded without treating it as a
stable full-simulator frame rate or claiming 60fps. Screenshots were inspected
for facade overlap and camera obstruction, with fixes reflected in these final
captures. Near/distant LOD selection and real blocked-HTTP fallback passed;
there were zero uncaught page exceptions.

The old buildings transfer no model file. The new kit transfers
173,692 payload bytes
(173,992 transfer bytes reported by Chrome,
including request overhead), in one cached request. This is the incremental
model cost, not the application's complete transfer size or JavaScript bundle.
Both airports use 9 texture maps, estimated at 34,603,008 RGBA8 bytes including
generated mipmaps; the new buildings add zero textures and zero texture bytes.
This estimate is not actual driver allocation/VRAM.

The budget set after the baseline/first comparison is: kit ≤200,000 payload
bytes, ≤40 additional calls in any fixed view, ≤5,000 additional visible triangles
nearby, ≤500 additional triangles in the distant view, and no additional texture
memory. The browser script asserts all these gates and requires all 12 captures.
Median/P95 times are observations, not a portable pass/fail budget. Full-flight,
touch/mobile, hardware GPU timing and shadow-map performance were not benchmarked.

Node 22.23.2: npm ci, npm run check, npm test (248 passing), npm run build passed.
The focused actual-GLB tests also passed after the final geometry adjustment.
Tests cover bounds/collision envelopes, camera rays, shared resources, LOD
near/far/near sequences, failed/invalid loading recovery, radar updates and
Incheon boarding geometry preservation.
