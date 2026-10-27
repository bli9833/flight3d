# Cockpit sun-shadow scope — render option 4

The benchmark ranked the cockpit's share of the sun's depth pass at roughly −17% of frame
GPU time. This unit reclaims it without touching what is drawn: the sun's shadow map is
reused for as long as nothing that feeds it has changed, instead of being cleared and
redrawn behind the cockpit on every frame.

`SkyAtmosphere` sets `sunLight.shadow.autoUpdate = false` and asks a new
[`SunShadowRefresh`](../../src/environment/SunShadowRefresh.js) immediately before each
render. The oracle answers by comparing the pass's inputs against the inputs it was built
from: the light's transform and target, its shadow camera's box and settings, and every
mesh the pass would draw — identity, geometry, layers, visibility, instanced batch size and
buffer version, and world matrix. Two flat `Float64Array` rows are kept and swapped, so a
parked frame costs no allocation and no rebuild.

The header is checked first and it tracks the aircraft, so every frame of flight — where the
sun's box follows the airframe and the map is genuinely stale — settles in nineteen float
comparisons and never traverses the scene. Metres are compared with a tenth-of-a-millimetre
of slack, which is a three-hundredth of a shadow texel; identifiers and settings are exact.
A row that matches is dropped rather than recorded, so sub-tolerance drift cannot accumulate
into a visible offset, and a frame that rebuilds without sampling casters forgets its
snapshot, because the map then shows poses nobody recorded.

## What the pass actually costs

`scripts/probe-shadow-pass.mjs` attributes the sun's depth pass by owning group, in a
cockpit view at noon (`balanced` quality, 2048² map, 32 m ortho half-box):

| group | meshes | casters | triangles into the map | doubled by `DoubleSide` |
| --- | --- | --- | --- | --- |
| cockpit | 153 | 153 | 1,817,908 | 1,817,828 |
| aircraft | 36 | 36 | 4,577 | 316 |
| **pass total** | | | **1,822,485** | |

99.7% of the pass is the cockpit shell, and almost all of it is drawn twice because the
interior materials are double-sided. `scripts/probe-frame-movers.mjs` then watched 40 parked
frames: 45 objects changed, of which **0** were casters the sun map samples — the movers were
six cockpit display materials (canvas textures) and none of them cast. The traversal is
therefore repeating identical work, which is what this change removes.

## Verification (2026-10-27)

- Node 22.23.2 in the worktree at `origin/main` (e71e85f): `npm run check` (266 files, 0
  failures), `npm test` (650 tests, 0 failures), `npm run build` (clean).
- `tests/sunShadowRefresh.test.js` — 9 cases: first frame and missing target, casters
  appearing/hiding/swapping geometry, light and box changes, three keeping the pass while
  `autoUpdate` is on and re-learning it on hand-back, non-casters ignored, motion hidden
  behind an invisible ancestor, instanced repopulation, jitter absorbed and drift rebuilt,
  and a moving frame settled by the header with zero scene traversals.
- Browser: `scripts/verify-cockpit-shadow-scope.mjs` on ANGLE Vulkan (Intel Arc ADL-N),
  local Vite on 127.0.0.1:5173, CDP, 1600×900. Each view measures the shipped build against
  `autoUpdate = true` in an A/B/A sandwich, times the GPU with
  `EXT_disjoint_timer_query_webgl2`, and compares the full drawing buffer between levels.
  Results in [results.json](results.json), captures per view below.

| view | sun map rebuilt | ship GPU | baseline GPU | Δ GPU | Δ wall | pixels changed | this view's floor |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 12h forward | 1/19 | 164.3 ms | 174.6 ms | −5.9% | −9.1% | 7 of 1.44M (max 55) | 9 px (max 96) |
| 12h right | 0/33 | 82.9 ms | 88.9 ms | −6.7% | 0 | 0 | 0 |
| 12h rear | 0/20 | 158.3 ms | 164.4 ms | −3.7% | −9.1% | 0 | 0 |
| 12h overhead | 0/25 | 123.0 ms | 129.1 ms | −4.7% | 0 | 0 | 0 |
| 23h forward | 0/20 | 157.2 ms | 167.6 ms | −6.2% | 0 | 1 px (max 1) | 10 px (max 48) |
| 23h right | 0/34 | 81.3 ms | 87.3 ms | −6.9% | 0 | 0 | 0 |
| 23h rear | 0/21 | 150.9 ms | 156.8 ms | −3.8% | 0 | 0 | 0 |
| 23h overhead | 0/25 | 116.4 ms | 122.4 ms | −4.9% | 0 | 0 | 1 px (max 11) |

Mean −5.35% GPU per frame, −5.21% over the whole sample, with **1 rebuild in 197 parked
frames**. Where the saved time crosses a display tick, the wall median drops a full 16.7 ms
(183.3 → 166.7 ms). A/B/A drift stayed within 0.1% at every view, and no context loss or
page exceptions were recorded.

In motion the check must be free and the reuse must not engage: the same harness slides the
airframe 0.5 m per frame and the map rebuilt **23/23** frames at −0.1% GPU and 0% throughput.

Four of the eight captured pairs — `12h-right`, `12h-overhead`, `23h-right`, `23h-rear` — are
byte-identical PNG files across the two levels, before any pixel arithmetic.

### Negative controls

Both gates bite. Patched copies of `SunShadowRefresh.beforeRender`, run through the same
harness and reverted afterwards:

- Claim every frame is stale → the parked deck rebuilt 20/20 and the verifier failed with
  *"A parked deck must mostly skip the pass"*, with the GPU win collapsed to 0.1%.
- Never rebuild once a map exists → the verifier failed with *"A moving airframe must
  rebuild the map every frame"*.

### What the harness had to learn first

The first sweep failed a zero-difference pixel gate at 2.8% of pixels. That was the harness,
not the change: a parked deck is not a still frame. The 737's strobe and beacon lights and
the airport's approach "rabbit" set their intensities from `performance.now()`, and the
turbine fans and the ocean's wave phase advance one step at a time — so two identical
settled renders of the *baseline* differed by ~35,000 pixels, and the same-level comparison
was meaningless. `verify-cockpit-shadow-scope.mjs` now parks those animators and pins the
accumulated instrument time before every grab, which took the floor from 2.4% of pixels to
single digits.

The floor is not exactly zero. A handful of pixels (up to 10 here) still land differently
between two consecutive identical renders — they do so with `sun.castShadow = false` and with
`renderer.shadowMap.enabled = false` too, so it is the pipeline's own wobble rather than
anything the sun map contributes. The gate therefore compares the cross-level difference
against the worst of three same-level pairs measured at the same view, and separately insists
that floor stays under 0.01% of pixels so a noisier harness cannot quietly widen it.

## Rejected and falsified alternatives

- **Move the cockpit to a layer the sun ignores** — the first cut of "scope the casters".
  Cost +3.9% GPU and changed 51.4% of the frame: the cockpit still receives, so dropping it
  from the map also drops the deck's own shading.
- **Force `shadowSide = FrontSide` on cockpit materials** — measured ≈0%. The interior is
  single-sided where it matters and the pass cost is in the double-sided shell, which needs
  the geometry, not the flag.
- **Skip the deck casters only while the camera is inside** (`skipDeck`) — −0.6%, inside the
  noise, and it changes the shadow the deck throws on the wing.
- **Benchmark item 2, cheaper projection depth** — invalidated before measurement: this
  scene mixes log and linear depth across materials, so a single re-encoded range cannot be
  compared against the shipped frames.
- Trimming the map's resolution (−32.5%), disabling shadows (−17%) and single-sided lighting
  (−33%) remain available as quality tradeoffs; this unit deliberately spends none of them.

## Limits of this change

- The win is parked-only. In flight the sun's box follows the airframe, so the map is stale
  every frame and the oracle only adds nineteen comparisons to the decision. That is the
  honest scope: looking around from a standstill, on the ramp, in the demo views, and while
  inspecting the aircraft.
- The oracle reads transforms, geometry, visibility, layers and instanced buffers. It does
  not read bone poses, morph weights or material settings. This scene has no `SkinnedMesh`
  and no `morphTargetInfluences` in `src`, so nothing currently needs them; anything that
  adds one must call `sunShadowRefresh.invalidate()` when it changes a caster.
- A caster that moves by less than 1e-4 m per frame is absorbed. The tolerance is applied to
  metres only, and a matching row is discarded rather than recorded, so the absorbed amount
  cannot accumulate: the drift case in the unit test (60 frames of 1e-5) ends in a rebuild.
- The 12h-forward and 23h-forward differences (7 and 1 px) are within the same view's own
  floor (9 and 10 px) and are not attributed to the reuse; they are recorded as measured.
- Browser evidence is from headless Chrome on an Intel Arc A-series GPU through Vulkan.
  The pixel comparisons are full-drawing-buffer `readPixels`, not visual inspection alone:
  captures are in this directory as `<hour>h-<pose>-<level>.png` for both levels.

## Reproduce

```sh
npm ci
npm run check && npm test && npm run build
npm run dev -- --port 5173 &
ARTIFACT_DIR=review-artifacts/cockpit-shadow-scope MEASURE_SECONDS=3 \
  APP_URL=http://127.0.0.1:5173/ \
  chrome-session --project flight3d node scripts/verify-cockpit-shadow-scope.mjs
```
