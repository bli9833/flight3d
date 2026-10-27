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
APP_URL=http://127.0.0.1:5173/ chrome-session --project flight3d node scripts/verify-cockpit-flood-performance.mjs
```

The verifier requires the project Chrome daemon. It acquires no separate browser
identity, creates/closes only its own tab, uses nonblocking GPU queries during
timing, and exercises the failed-bake fallback by blocking its metadata request.
