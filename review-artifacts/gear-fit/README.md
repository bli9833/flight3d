# Landing gear fit

The main legs retract inward into the airframe without scaling. Their outer
wheel faces point down and remain exposed through two round openings close to
the original belly skin. There are no main-wheel doors, external wheel-bay pods,
or large rotating keel panels. The leg pivots sit at the wing roots; independent
axle swivels keep the deployed wheels upright and the stowed tire faces aligned
with the belly. Deployed axle centers and suspension remain aligned with physics.

Nose doors retain fixed airframe hinges, open before the nose leg moves, and close
once stowed. Their geometry and texture coordinates follow the exterior skin.
The loaded model has a forward nose bay; the tapered fallback uses an aft bay.
Circular main-wheel apertures split the actual skin triangles while preserving
material groups and interpolating UVs/normals. Internal recess liners end inside
the original skin; they do not add external housings. Shadows use the apertures.

## Reproduce

Start Vite, then use Node 22 and installed Chrome:

```sh
SIM_URL=http://127.0.0.1:5173 node scripts/test-gear-retraction.mjs --gpu
```

Omit `--gpu` for SwiftShader. `CHROME_PATH`, `CDP_PORT`, and `ARTIFACT_DIR` override
the executable, debug port, and output directory. The harness checks full cycles
and reversal (205 poses per model), then saves 60 screenshots: five retraction
stages from six views, including directly below, for loaded and fallback models.
These are deterministic renders with simulation paused.

Add `--animation` and optionally `FFMPEG_PATH` for a synchronized above/below
VP9 WebM of the full cycle (201 frames, 16.75 seconds). This samples poses rather
than recording real-time flight.

## Validation

`npm run check`, all 201 tests, and `npm run build -- --configLoader runner`
passed. Runner loading avoids writing bundled config into the shared read-only
dependency directory. Hardware Vulkan browser acceptance recorded no uncaught
exceptions; measured envelope results are in [results.json](results.json).

Tests cover rigid dimensions, folding direction, fixed nose-door hinges,
reversal, suspension/contact alignment, upright deployed and downward-facing
stowed wheel axles, absence of main-wheel covers, open round apertures, exposed
tire faces within 12 cm of the original GLB belly, preservation of upper-wing
triangles, and UV-preserving skin subtraction. Envelope checks supplement the
visual evidence; this does not add a triangle-level mechanical collision solver.

- [Before: main gear fully up](before-main-up.png)
- [Directly below: exposed tire faces, fully up](belly-up.png)
- [Main gear halfway](main-half.png) and [fully up](main-up.png)
- [Above halfway](above-half.png) and [side fully up](side-up.png)
- [Loaded nose fully up](nose-up.png) and [fallback nose fully up](fallback-nose-up.png)
- [Full retract/extend animation](full-cycle.webm)
