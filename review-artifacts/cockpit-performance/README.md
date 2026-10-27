# B737 cockpit performance trials

Measured on Intel ADL-N / ANGLE Vulkan in the reusable Flight3d Chrome session.
Viewport 1440 x 900 CSS pixels, device DPR 2, Balanced render quality (2160 x 1350
drawing buffer), detailed cockpit AO. The aircraft and environment animations
are held still for paired measurements. These are GPU rendering comparisons on
this host, not frame-rate promises for other devices or a full flight acceptance.

## 1. Exclude baked-out flood lights

The valid light-transfer bake already contains flood irradiance. Its three
PointLights had zero intensity but still occupied slots in every lit shader.
Hide those nodes after the bake binds; retain actual lights if the bake fails.

Two paired trials, with old/new order reversed, measured median GPU times:

| View | Before | After | GPU time reduction |
| --- | ---: | ---: | ---: |
| Forward | 396.5 ms | 348.1 ms | 12.2% |
| Rear | 533.3 ms | 477.8 ms | 10.4% |

The day/night forward/rear visual comparison changes at most 19 pixels out of
2.916 million, with an overall channel RMSE below 0.084/255. Repeated renders of
the same variant also show sparse raster variation. The rear comparisons are
pixel-identical. No broad lighting change is observed. Blocking the bake metadata
confirms all three fallback floods remain visible at their original intensities.
No JavaScript exceptions or context loss occurred.

Raw results: [floods.json](floods.json). Screenshots remain in the local ignored
`.cache/cockpit-flood-performance/` directory. Reproduce with Vite running:

```sh
APP_URL=http://127.0.0.1:5173/ chrome-session --project flight3d node scripts/verify-cockpit-light-performance.mjs
```

The verifier requires the project Chrome daemon. It acquires no separate browser
identity, creates/closes only its own tab, uses nonblocking GPU queries during
timing, and exercises the failed-bake fallback by blocking its metadata request.

## 2. Skip direct-light BRDF evaluation for zero contribution

Three's local-light calculation already determines whether its attenuated light
colour is exactly zero. The standard shader nevertheless evaluates RE_Direct.
The cockpit shader now guards that calculation with Three's existing
`directLight.visible` result. Light positions, finite ranges, cone angles,
attenuation, strobe timing and exterior rendering retain their original behavior.
This changes no cutoff threshold and removes no exterior lights from the scene.

With step 1 retained, independently paired old/new trials measured:

| View | Step 1 only | Steps 1 + 2 | Additional GPU time reduction |
| --- | ---: | ---: | ---: |
| Forward | 348.9 ms | 301.1 ms | 13.7% |
| Rear | 479.9 ms | 388.8 ms | 19.0% |

Relative to the initial baseline, the two changes reduce GPU time by approximately
24% forward and 27% rearward. They remain separate commits. The bake was regenerated;
both binaries, receiver data and transport coefficients are unchanged. Only the
Cockpit.js provenance hashes changed in the manifests.

The implemented shader's day/night forward/rear comparison changes at most 29
pixels, with RMSE below 0.070/255, within repeated-frame raster variation. With
the bake blocked, actual nonzero flood lights remain visible and their before/
after rendering differs by RMSE 0.00088/255. No shader errors, JavaScript
exceptions, WebGL errors or context loss occurred. The full check/test/build gate
passes, including all 641 Node tests. Day/night forward screenshots were inspected.

Raw results: [direct.json](direct.json). Reproduce the second comparison:

```sh
EXPERIMENT=direct APP_URL=http://127.0.0.1:5173/ chrome-session --project flight3d node scripts/verify-cockpit-light-performance.mjs
```

The verifier compares measured variants against repeated-render noise and also
limits changed pixels to below 0.01% of the image. The default experiment remains
`floods`, for independently reproducing the first change.

## Rejected refinement: early point-light range rejection

A further browser-only trial rejected zero-power or out-of-radius point lights
before direction/attenuation calculations, using the same physical finite range.
It preserved images but increased GPU time from 299.3 to 308.4 ms forward and
386.7 to 402.5 ms rearward. That extra branch was rejected and is not in the
production shader. Raw results: [rejected-range.json](rejected-range.json).

## 3. Resolution trial: retain explicit quality control

With both lighting fixes and detailed AO enabled, a separate fixed-forward trial
measured GPU time at drawing pixel ratios 1.5 / 1 / 0.75 / 0.5: approximately
301 / 161 / 111 / 73 ms. The 0.75 screenshot visibly softens panel lettering and
instruments. Lower resolution is effective, but no adaptive resolution policy or
automatic quality reduction is included in these lighting fixes. The existing
Performance quality setting remains available to trade detail for speed.
Raw results: [resolution.json](resolution.json).

## Mouse look after the changes

A short native CDP mouse-drag check used the normal animation loop, frozen
physics, Balanced quality and detailed AO. Two cycles of left/right/up/down
drags produced 32 measured frames with mean interval 271.3 ms (~3.7 FPS) and
maximum gap 333.3 ms. No exception or context-loss event occurred. This shorter
run is not a paired benchmark against the earlier six-cycle diagnosis; it
confirms the actual input path remains usable but still slow on this GPU.
No permanent browser hang was reproduced. Raw results: [native-after.json](native-after.json).
