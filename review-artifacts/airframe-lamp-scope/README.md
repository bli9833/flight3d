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

Three.js compiles every *visible* punctual light into the light loop of every
material. Those six lamps only ever shade airframe skin, which the cockpit seat
hides (`gltfGroup.visible = false`) and which the pilot cannot see from the
forward-facing poses measured here. They cost the whole loop and shade nothing.

Beacon and landing-light lamps are deliberately excluded: they do reach surfaces
inside the cockpit view.

## Measurement

`node scripts/verify-aircraft-light-scope.mjs` (run through `chrome-session
--project flight3d`, `MEASURE_SECONDS=3`) forces each lamp scope on the same page,
freezes the blink cycle at identical intensities, measures `EXT_disjoint_timer_query_webgl2`
GPU medians, then diffs the full drawing buffer with and without the scope.
`none` is the unscoped baseline, `navStrobe` is exactly what this branch ships.

| Time | Pose | Baseline | Scoped | Δ GPU median | Changed pixels | A/B/A drift |
| --- | --- | --- | --- | --- | --- | --- |
| 12h | forward | 160.9 ms | 140.1 ms | −12.9 % | 0.0005 % | −0.1 % |
| 12h | right | 85.0 ms | 76.0 ms | −10.7 % | 0 % | −0.1 % |
| 12h | rear | 159.6 ms | 138.6 ms | −13.1 % | 0 % | −0.5 % |
| 12h | overhead | 121.6 ms | 111.4 ms | −8.3 % | 0 % | +0.4 % |
| 23h | forward | 154.6 ms | 133.0 ms | −14.0 % | 0.0004 % | −0.0 % |
| 23h | right | 83.8 ms | 74.4 ms | −11.2 % | 0 % | −0.0 % |
| 23h | rear | 151.8 ms | 131.0 ms | −13.7 % | 0 % | +0.2 % |
| 23h | overhead | 115.5 ms | 103.8 ms | −10.1 % | 0 % | −0.1 % |

Mean −11.8 %, best −14.0 %. Frame rate tracks the GPU time at these frame lengths
(12h forward 6.00 → 7.29 fps, 23h rear 6.70 → 7.70 fps). Program count, draw
calls and submitted triangles read identically in every baseline/scoped pair
(`renderer.info` after the last timed frame); no GL errors, no lost context,
21–41 timing samples per case.

The only visual difference is 6–7 pixels of 1.44 M in the forward poses (max
channel delta 51/255) where the wingtip strobe's glow reaches the frame edge at
blink peak. Nothing else in the cockpit view changes.

## Levels measured and rejected

Hiding more lamps is faster but visibly lossy, so this branch stops at nav + strobe.

| Scope | Δ GPU median | Changed pixels |
| --- | --- | --- |
| `navStrobe` (shipped) | −8.3 … −14.0 % | ≤0.0005 % |
| `navStrobeBeacon` | −14.2 … −20.8 % | 0.04 … 1.75 % |
| `allExterior` | −21.8 … −31.6 % | 6.0 … 80.8 % |

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
- Browser evidence: this directory (`results.json`, 32 PNG pairs, day and night,
  four poses). Not tested: mobile/low-power GPUs, exterior camera paths, and the
  shader-recompile cost when crossing cockpit ↔ exterior (the existing
  `gltfGroup` toggle already recompiles on that switch).
