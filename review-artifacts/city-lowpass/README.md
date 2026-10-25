# City low-pass detail acceptance

Compared origin/main (`6317427`) with this branch using
`scripts/verify-city-lowpass.mjs` and the reusable Flight3d Chrome browser.
The city is isolated on flat ground to make the geometry cost and facade scale
visible. These are not full-scene flight screenshots or full-flight FPS.

- [Rooftop before](roof-day-before.jpg) / [after](roof-day-after.jpg)
- [Low-level daylight](street-day-after.jpg)
- [Low-level night](street-night-after.jpg)
- [Raw metrics](results.json)

All 537 seeded building records (including collision metadata) are identical.
Near/far counts are identical in each paired shot. Day/night/roof/skyline/far
views rendered without browser exceptions or shader compilation errors.
Near views still require seven calls including ground; skyline/far require four.
Street-view triangles rise from 9,770 to 45,170; far triangles remain 6,446.
Two existing 256×256 atlases are reused with no new textures or model downloads.
The GPU is Intel ADL-N through ANGLE Vulkan (see raw results). Timings use
20 renders with gl.finish after five warmups and are noisy isolated wall times;
they do not establish a full-flight frame-rate improvement.

`npm run check`, all 507 Node tests, and `npm run build` passed. Existing city
bounds, rotated-footprint collision and LOD tests exercise the richer geometry.
No C172 demo integration flight or deployment is claimed by this separate PR.
