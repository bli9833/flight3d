# Landing gear fit

The main legs previously folded outward while their entire assemblies shrank.
Doors inherited the leg transform, so panels could appear outside the fuselage
or above the wing. The replacement keeps rigid geometry, folds the main legs
inward below the wing, and preserves the deployed axle centers used by physics.

Nose doors have fixed airframe hinges, open before the leg moves, and close only
once stowed. Their closed geometry and UVs are sampled from the exterior skin.
The loaded model uses a forward nose bay; the more tapered procedural fallback
uses an aft bay. Main tires remain visible in recessed wheel openings. Rounded
fairings and a narrow strut cover fit below the wing instead of using large
rotating keel panels. Bay apertures split the actual skin triangles, retaining
materials and UVs; shadow geometry uses the same apertures.

## Reproduce

Start Vite, then use Node 22 and installed Chrome:

```sh
SIM_URL=http://127.0.0.1:5173 node scripts/test-gear-retraction.mjs --gpu
```

Omit `--gpu` to use SwiftShader. `CHROME_PATH`, `CDP_PORT`, and `ARTIFACT_DIR`
override the executable, isolated debug port, and output directory. The harness
checks a full cycle and reversal (205 poses per model) and produces 50 fixed
screenshots: five retraction stages from five views for both model variants.
These are deterministic model renders with the simulation paused.

For a full retract/extend animation, add `--animation` and optionally set
`FFMPEG_PATH`. This streams 201 JPEG frames to a VP9 WebM, with synchronized
underside and above-wing views. The animation samples poses, rather than
recording real-time flight.

Regression coverage includes rigid dimensions, fixed hinges, folding direction,
wing/engine clearance envelopes, direction reversal, suspension/contact alignment,
closed doors against the actual GLB skin, preservation of upper-wing triangles,
actual fairing-roof clearance for every stowed tire vertex, and UV-preserving bay subtraction. This is a visual fit correction; it does not
add mechanical simulation or change the landing gear force model.

## Recorded result

Validated on current main with the fix: `npm run check`, all 197 tests, and
`npm run build -- --configLoader runner` passed. Runner loading avoids writing
Vite's bundled config into the shared read-only dependency directory.

Hardware Vulkan browser acceptance checked 205 poses per model and saved 50
screenshots with no uncaught browser exceptions. The highest moving main-gear
vertex stayed at or below -1.53 m in aircraft coordinates (the clearance envelope
is -1.48 m). These envelope checks complement the visual views; they are not a
triangle-level mechanical collision solver.

- [Before: main gear fully up](before-main-up.png)
- [After: main gear halfway](main-half.png) and [fully up](main-up.png)
- [Above-wing halfway](above-half.png) and [side fully up](side-up.png)
- [Loaded nose fully up](nose-up.png) and [fallback nose fully up](fallback-nose-up.png)
- [Full retract/extend animation](full-cycle.webm) (201 poses, 16.75 seconds)
- [Browser results](results.json)
