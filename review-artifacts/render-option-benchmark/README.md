# Render option A/B benchmark

Measured 2026-10-27 with the [render comparison panel](../../docs/development/render-diagnostics.md)
from PR #240. Intel ADL-N (Arc) / ANGLE Vulkan 1.4.335, WebGL 2.0,
`EXT_disjoint_timer_query_webgl2` available. Branch base 7b96b13. Node 22.23.2,
Vite dev server, 1440 × 900 CSS pixels, pixel ratio 1, `balanced` render quality,
B737 3D cockpit parked on the Coastal runway, physics integration stubbed so the
pose stays identical.

`scripts/benchmark-render-options.mjs` drives the real panel controls. For each of
four fixed head poses it measures the default state, then each option one at a
time, restoring the default between cases, with two repetitions per case
(`REPS=2 FRAMES=14`, median of reps). `results.json` holds every sample;
`view-*.png` are post-sweep restoration captures.

End-of-view baselines re-measured −0.7% … 0.0% against the start-of-view
baseline, so the sweep does not drift.

## Baseline per head pose

| pose | GPU ms | frame ms | draw calls | submitted triangles |
| --- | ---: | ---: | ---: | ---: |
| forward (yaw 0, pitch −0.25) | 161 | 166 | 698 | 5.41 M |
| right window (yaw 1.3) | 80 | 97 | 269 | 4.73 M |
| rear (yaw 2.7) | 155 | 171 | 382 | 4.69 M |
| overhead (pitch 0.6) | 117 | 128 | 330 | 5.08 M |

A 30 FPS budget is 33 ms for the whole frame, so this GPU is 3–5× over budget on
the cockpit view even after PR #239 landed.

## GPU time change per option (negative is faster)

| option | forward | right | rear | overhead | mean | visible change |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `lights/noLocal` | −50.1% | −38.7% | −51.6% | −46.2% | **−46.7%** | cockpit lamps and runway lights go dark |
| `material/unlit` | −51.4% | −24.2% | −54.1% | −60.5% | −47.5% | reference only: all shading removed |
| `scene/world` | −78.1% | −57.9% | −79.8% | −80.5% | −74.1% | reference only: aircraft removed |
| `scene/cockpit` | −35.7% | −50.9% | −32.2% | −19.8% | −34.6% | reference only: world removed |
| `side/front` | −33.1% | −18.5% | −35.1% | −44.6% | **−32.8%** | yes — see `visual/forward-side-front.png` |
| `resolution/0.75` | −31.9% | −30.2% | −35.1% | −32.9% | −32.5% | softer instruments |
| `lights/noExterior` | −31.5% | −23.0% | −31.3% | −28.5% | **−28.6%** | none in this daytime pose |
| `depth/projection` | −36.4% | −8.7% | −33.4% | −34.4% | **−28.2%** | none in this pose |
| `shadows/off` | −17.0% | −15.1% | −16.7% | −18.6% | −16.9% | shadow loss |
| `ao/off` | −6.1% | −11.2% | −7.0% | −9.8% | −8.5% | flatter contact shading |
| `resolution/1` | −0.1% | +0.3% | −0.3% | +0.0% | 0.0% | balanced quality already renders at 1 |
| `culling/off` | +2.7% | +19.8% | +7.8% | +7.6% | **+9.5%** | slower, not faster |

`visual/` contains forward-view captures of every option next to
`forward-baseline.png` for visual comparison.

## Scene attribution

`scripts/probe-render-work.mjs` (output `render-work.json`) counts what the
options are actually removing in the forward pose:

- 26 lights in the scene, 18 visible. **14 of the 18 visible lights are farther
  from the eye than their own attenuation range** — they illuminate nothing and
  are still compiled into every material's light loop. 3 visible lights have zero
  intensity. The B737 keeps 8 exterior `PointLight`s (range 8–15 m) plus two
  landing `SpotLight`s parented to the airframe; the pilot seat is outside their
  reach.
- The aircraft group submits 1.83 M triangles, of which 1.82 M (99.5%) come from
  double-sided materials and 1.83 M are shadow casters. `src/aircraft/Cockpit.js:143`
  forces `side = DoubleSide` on every material of the imported cockpit model.
- Scene total is 2.24 M unique triangles against 5.41 M submitted, so shadow, AO
  and instrument passes amplify the frame by roughly 2.4×.

## Optimization points, ranked

1. **Scope the compiled light set** (`lights/noLocal` −47%, `lights/noExterior`
   −29%). Out-of-range lights cannot change a pixel, so gating them is a
   no-visual-change win, unlike PR #239's per-fragment skip which still pays the
   loop, uniform upload and register cost. Light count is part of the program
   key, so gate with hysteresis and rounded buckets (the pattern already used in
   `src/environment/Airport.js:370`) to avoid recompile stutter.
2. **Use projection depth for cockpit-scoped materials** (−28%). The forward
   capture is indistinguishable from the baseline. `useProjectionDepth` already
   exists in `src/aircraft/CockpitDepth.js` for shadow and AO materials; the open
   question is whether near-field cockpit surfaces keep resolving against the
   45 km logarithmic exterior. Needs side-window and pillar edge validation.
3. **Make sidedness selective** (−33%). Global front-face culling visibly removes
   linings and the glareshield top, so the win has to come per mesh: keep
   `DoubleSide` only for genuinely single-layer panels and repair the rest by
   winding/normals at bake time (`scripts/bake-cockpit-transfer.mjs`), plus set
   `shadowSide` for the depth pass.
4. **Trim shadow casters** (−17%): 99.98% of aircraft triangles cast shadows,
   including interior meshes that cannot shade anything visible.
5. **Do not prioritize new spatial culling.** Disabling existing frustum culling
   made frames 2.7–19.8% *slower* while adding only 6.9% triangles, so the
   current culling already pays off and batch partitioning has little fragment
   budget left to recover. This supersedes the hypothesis recorded while
   reviewing PR #239.
6. **AO is cheap** (−8.5% while removing 31% of submitted triangles); it is not
   the cause of the cockpit stutter.
7. **Pixel ratio is a linear quality tradeoff**, not a free win: −32% for 0.56×
   pixels, with softer instruments. Keep it as a dynamic fallback only.

## Limits

- One GPU (Intel Arc ADL-N under ANGLE Vulkan), one aircraft, one airport, one
  daytime pose, parked. Ratios will differ on other hardware and at night, where
  exterior and runway lights do contribute.
- `lights/noExterior` and `depth/projection` look free of visual change only in
  this capture set; treat them as candidates that need night-scene and
  distant-geometry checks before any production change.
- Draw calls and triangles accumulate across passes and are not unique visible
  counts. CPU and GPU times overlap, so they do not add up to frame time.
- Options change compiled program counts (53–131 programs observed), so each
  case includes its own shader-compile settling; samples start after the panel's
  two-second warm-up and require a stable program count.
- This is a controlled render measurement, not a flight test and not a
  reproduction of the reported permanent browser hang, which stayed unreproduced.
