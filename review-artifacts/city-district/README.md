# GLB district pilot evidence

Compared with `2542473` (including the recent procedural facade improvement), on
Intel N95 / Intel Vulkan hardware GPU, Chrome 156, 1440 × 900. Same seeded city
and coastal terrain; trees, aircraft, airport meshes and the ocean are excluded
from this isolated benchmark. Screenshots verify building/road integration,
near/far detail and night emission; they are not full-flight acceptance.

| Pose | Draw calls before → after | Triangles before → after | Median ms before → after | p95 ms before → after |
| --- | --- | --- | --- | --- |
| Low, day | 7 → 12 | 157304 → 237132 | 0.5 → 0.7 | 1.8 → 1.7 |
| High, day | 7 → 11 | 137816 → 173152 | 0.4 → 0.3 | 1.2 → 2.3 |
| Low, night | 7 → 12 | 157304 → 237132 | 0.4 → 0.5 | 1.3 → 3.7 |

Five warmups and 20 wall-clock samples with `gl.finish` per pose. Shared-host
noise and this small sample prevent interpreting the high-altitude median as a
speedup. Added triangles include the terrain-following road grid. GLB transfer
is 149,668 uncompressed bytes; the new emissive mask is two RGBA pixels. The
actual district contains 110 buildings; other city clusters are unchanged.

- [Low day before](district-low-day-before.jpg) / [after](district-low-day-after.jpg)
- [High day before](district-high-day-before.jpg) / [after](district-high-day-after.jpg)
- [Low night before](district-low-night-before.jpg) / [after](district-low-night-after.jpg)
- [Raw results and GPU identity](browser-results.json)

The browser checks passed GLB completion, instance totals, zero shader/runtime
errors, and blocked-GLB fallback (all 110 district collision records retained).
Node tests cover actual GLB bounds, lot spacing, runway exclusion, tree removal,
foundation/far collision envelopes, and LOD transitions. Local `npm run check`,
`npm test` (523 tests), and `npm run build` passed. The build retains its bundle
size advisory. No full-flight or mobile performance acceptance is claimed.

Reproduce with the command in [city documentation](../../docs/development/city-buildings.md).
Northern hillside follow-up: [#207](https://github.com/stlim0727/flight3d/issues/207).
