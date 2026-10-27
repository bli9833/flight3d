# Cockpit look-back measurement and SSAO warm fix

Evidence for the cockpit view cost audit and for the two fixes in this branch:
`CockpitOcclusion.warm()` (pre-build the SSAO pass while photo cockpit looks
forward) and the reduced AO scale for the transitional look-away view.

## Harnesses

- `scripts/measure-cockpit-lookback.mjs` — freezes the app loop, times
  `renderScene() + gl.finish()` per frame in six conditions
  ({3D virtual, PHOTO 2D} x {forward, aft}, plus AO-off ablations), two
  reversed repeats, then a cold AO-switch probe that disposes the pass, warms
  in photo-forward, and times the first frames after turning the head aft.
- `scripts/profile-cockpit-frame.mjs` — drives the real rAF loop with
  `performance.now()` accumulators around 18 `animate()` stages; `NO_VSYNC=1`
  adds `--disable-gpu-vsync --disable-frame-rate-limit` so rAF medians reflect
  true frame generation instead of headless present pacing.
- `scripts/probe-ao-hitch.mjs` — attributes the first look-away frame by
  recording `renderer.info.programs` cache-key diffs per frame.

## Environment

Headless Chrome (ANGLE/Vulkan) on Intel Arc ADL-N, 1440x900, coastal airport
on runway, physics frozen. Baselines: `cockpit-lookback/` is the `e71e85f`
measurement; `cockpit-lookback-baseline-main/` is the same harness on latest
main (`9bd11ac`, after #240-#244) with the fixes stashed;
`cockpit-lookback-fixed*/` include the fixes.

## Steady-state medians (renderScene + gl.finish, ms)

| condition | baseline main | fixed |
|---|---|---|
| 3D cockpit forward | 15.6 | 9.3 |
| 3D cockpit aft | 6.8 | 6.9 |
| 3D cockpit aft, AO off | 3.6 | 3.7 |
| photo forward | 4.3 | 3.7 |
| photo aft (AO reduced tier) | 7.7 | 6.4 |
| cold look-away first frame | 83.9 | 7.3 |

Unpaced rAF medians (`-novsync/`, true GPU cost): aft with AO 22.1 vs aft
without AO 9.7 on the pre-fix baseline — the SSAO chain, not cabin geometry,
is the look-back penalty; the copy shader's `deckDepth >= 1.0` early-out is why
the same chain is nearly free looking forward.

## Findings

1. The dominant look-back complaint is one-off: lazy `SSAOPass` construction,
   sRGB/shadow program variants, and render-target allocation all landed on
   the first head-turn frame (~84-196ms on this GPU). `warm()` moves that cost
   to the first photo-cockpit frame; the probe shows zero late program
   compiles on the first aft crossing afterwards.
2. Steady aft AO is genuinely more expensive (full-viewport depth defeats the
   early-out); the transitional photo look-away view now renders AO at the
   480px tier (`reduced` scale path), worth ~1.3ms median here and more on
   GPUs where the AO chain is a larger share.
3. Headless wall-clock intervals (150-183ms for all 3D cockpit conditions,
   AO off included) are present-pacing artifacts of the headless compositor,
   not app cost — use the unpaced medians.

## Limitations

- One iGPU (Intel ADL-N, Mesa Vulkan); a discrete GPU will shrink the steady
  AO tax; the program-compile hitch profile differs per driver.
- Lazy shader compiles contaminate means; medians are used and program growth
  is logged per repeat.
- Physics frozen, daytime parked pose; night cabins and in-flight head turns
  not covered.
- `photo-back` screenshots (`*-r1.png` pairs, baseline vs fixed) show slightly
  softer contact shading from the reduced AO tier in the transitional view.
