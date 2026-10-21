# Runway pavement review — issue #8

Baseline: `1e4666a` (main). 2026-10-20, Chrome headless at 1280×720,
Intel ADL-N Vulkan via ANGLE; see `integration.json` for the GPU string.

## Visual evidence

Each `*-before.png` has an identically positioned `*-after.png`. Both airports
have touchdown, low approach, and apron views, plus touchdown views with day,
sunset, and low-light illumination. The controlled scene includes only the
airport, a hemisphere light and directional sun, with ACES tone mapping. It
isolates pavement costs; it is not a whole-world flight benchmark. Sunset/night
images vary sun intensity/colour; they are lighting stress checks, not the full
simulator's day/night sky. `lukla-integrated.png` additionally checks placement
and terrain boundaries in the full simulator with physics/animation paused.

Coastal touchdown camera: (-1300, 28, 24), target (-1050, 12, 0).
Coastal approach: (-1640, 21, 10), target (-1150, 12, 0).
Coastal apron: (-240, 28, 300), target (80, 12, 280).
Lukla camera coordinates use runway-local (s, w, h), with world elevation
2836 + s×0.1176 + h. Touchdown: (-160,10,10) → (-30,0,0);
approach: (-300,4,10) → (-100,0,0); apron: (40,60,12) → (110,45,0).
FOV 55°. Day light intensity 3, sunset 1.4, night 0.05; hemisphere intensity 2.

Inspected: pavement aggregate/cracks, repair patches, paired rubber tracks,
readable markings and intact apron/threshold edges. Markings retain their own
normalized UVs, separate from metre-scaled pavement UVs. No geometry, terrain
height, obstacle, lighting logic, runway dimensions or collision changes.
Static low-angle views show no obvious moiré or depth interference. Tile
repetition remains visible; moving-camera shimmer and mobile GPU performance
have not been comprehensively measured.

## Measurements

20 synchronous renders after 5 warmups, `gl.finish()` after each render;
median wall time includes CPU submission and GPU completion. Results are noisy
and should not be treated as a simulator FPS claim. The lower measured Lukla
time does not establish a speedup. `metrics.json` contains every scene result.

| Day touchdown | Median frame ms, before → after | Draw calls | Estimated texture MiB |
| --- | --- | --- | --- |
| coastal | 1.30 → 1.90 | 240 → 244 | 0.67 → 33.00 |
| lukla | 1.70 → 0.50 | 69 → 73 | 1.33 → 33.67 |

Additional JPEG payload: **3,803,265 bytes** for six 1024px maps, loaded from local
static hosting. Each map is RGBA8 after decode with generated mipmaps; six maps
add approximately **32 MiB**. Rubber adds one 128×512 RGBA texture per airport
(0.33 MiB each); repair patches reuse the asphalt maps. Both airports together
share exactly six pavement maps, not twelve. Each airport adds four draw calls
(two rubber zones and two repairs), eight triangles, and no per-frame updates.
The memory estimates include existing marking textures but exclude render
targets, driver allocations and other simulator objects.

## Behavioral verification

`integration.json`: all six maps loaded, identical map objects after three
coastal/Lukla airport and runway-preset reset cycles, no page errors. Separate
page with all pavement JPEG requests blocked: both pavement materials retain
solid fallbacks, no page errors. Local maps mean no runtime external CDN.

`npm run check`, all **186** Node tests, and `npm run build` pass. Tests include
metre-scaled UV density for different slab sizes/subdivisions, headless fallback,
shadow/depth properties, runway dimensions, and normalized Lukla marking UVs.
Build retains the existing large-chunk advisory.

Asset sources, authors, license, exact URLs and SHA-256 hashes:
[provenance](../../public/textures/pavement/README.md) and
[sources.json](../../public/textures/pavement/sources.json).
