# Airframe lamp scoping in B737 cockpit view

Branch `perf/cockpit-light-scope`, based on `main` at `e71e85f` (includes PR #239's
`directLight.visible` skip). Evidence produced 2026-10-27 on the Intel Arc ADL-N
Vulkan backend.

## Change

`Boeing737.scopeAirframeLamps()` sets `visible = !this.isCockpit` on the three
navigation lamps and the three wingtip strobes, and runs from `buildLights()` and
from `setCockpitMode()`. `main.js` calls `setCockpitMode()` every frame, so the
scope is continuously enforced across camera changes, async GLTF arrival, and
crash recovery (`triggerCrashVisuals`/`resetCrashVisuals` only touch
`lightsGroup.visible`, never per-lamp state).

Three.js includes visible punctual lights in the light set of lit materials.
The cockpit hides the outer airframe (`gltfGroup.visible = false`). The four
day/night poses below measure the remaining visual effect of dropping six
nav/strobe nodes; this is not a proof that their light never reaches any visible
surface in every possible cockpit pose.

Beacon and landing-light lamps are deliberately excluded: they do reach surfaces
inside the cockpit view.

## Measurement

`node scripts/verify-aircraft-light-scope.mjs` (run through `chrome-session
--project flight3d`, `MEASURE_SECONDS=3`) forces each lamp scope on the same page,
re-pins strobe intensity to **8** and beacon intensity to **6** after every
simulation step (their actual runtime maxima), measures `EXT_disjoint_timer_query_webgl2`
GPU medians, then diffs the full drawing buffer with and without the scope.
`none` is the unscoped baseline, `navStrobe` is exactly what this branch ships.

| Time | Pose | Baseline | Scoped | Δ GPU median | Changed pixels | A/B/A drift |
| --- | --- | --- | --- | --- | --- | --- |
| 12h | forward | 159.7 ms | 139.0 ms | −13.0 % | 0.000309 % | +0.1 % |
| 12h | right | 83.4 ms | 74.6 ms | −10.5 % | 0.027778 % | +0.1 % |
| 12h | rear | 158.2 ms | 138.0 ms | −12.8 % | 0 % | 0 % |
| 12h | overhead | 120.3 ms | 109.1 ms | −9.3 % | 0 % | −0.6 % |
| 23h | forward | 152.3 ms | 131.5 ms | −13.7 % | 0.000386 % | +0.8 % |
| 23h | right | 81.9 ms | 72.9 ms | −10.9 % | 0.050154 % | +0.4 % |
| 23h | rear | 151.1 ms | 130.4 ms | −13.7 % | 0 % | +0.2 % |
| 23h | overhead | 114.9 ms | 102.7 ms | −10.6 % | 0 % | +0.1 % |

Mean −11.8 %, best −13.7 %. Program count, draw
calls and submitted triangles read identically in every baseline/scoped pair
(`renderer.info` after the last timed frame); no GL errors, no lost context,
21–42 timing samples per baseline/scoped case.

Forward poses differ by 4–5 pixels of 1.296 M (maximum channel delta 43/255 and
45/255). Right-window poses differ in 0.028–0.050% of pixels, each by at most
1/255. Rear and overhead captures are identical in this run. We do not claim
zero visual change. RGBA RMSE is at most 0.03773 on the 0–255 scale.

The old 0.01%-of-pixels gate fails on the corrected peak-intensity right views,
despite their maximum difference being one 8-bit step. The verifier now requires
both <0.1% changed pixels and <0.1 RGBA RMSE; the raw fractions and channel maxima
remain in JSON. These are explicit tolerances, not proof of exact image equality.

Review follow-up: previous PNGs read the canvas in a later CDP evaluation, after
the trial had been restored, and all 32 were the same black image. Those files
have been replaced. Each new PNG is serialized immediately after rendering its
own scope in the same evaluation as readPixels, before restoration. All captures
pass a >1000 nonblack-pixel guard; the 32 files now have 28 distinct SHA-256 hashes
(some identical pairs are expected). Representative daytime/right and nighttime/
forward images were inspected. JSON also asserts [8,8,8] strobe and [6,6] beacon
intensities in every timed and visual case.

## Levels measured and rejected

Hiding more lamps is faster but visibly lossy, so this branch stops at nav + strobe.

| Scope | Δ GPU median | Changed pixels |
| --- | --- | --- |
| `navStrobe` (shipped) | −9.3 … −13.7 % | ≤0.050154 %, see amplitudes above |
| `navStrobeBeacon` | −14.4 … −20.9 % | 1.68 … 7.15 % |
| `allExterior` | −21.1 … −32.7 % | 8.80 … 86.06 % |

The `allExterior` numbers match the −28.6 % attributed to lighting scope in the
render-option benchmark, confirming that measurement was never available for free.

## Why the Cessna is untouched

`Cessna172.setCockpitMode()` keeps `gltfGroup.visible = true` on purpose — the
pilot sees instruments, yokes, engine cowl and wings — so its wingtip lamps shade
geometry that is actually in frame. The scoping rule is B737-specific.

## Checks

- `tests/boeing737Pbr.test.js` — 10/10 pass. The new case asserts the six-lamp set,
  cockpit hiding, beacon/landing retention, exterior restore, and survival of
  crash recovery. Negative control (reverting `scopeAirframeLamps`) fails the case.
- `npm run check`, `npm test`, `npm run build` — see PR CI.
- Browser evidence: this directory (`results.json`, 32 PNG files, day and night,
  four poses). Not tested: mobile/low-power GPUs, exterior camera paths, and the
  shader-recompile cost when crossing cockpit ↔ exterior (the existing
  `gltfGroup` toggle already recompiles on that switch).
