# Issue #59: exterior control surfaces

The original `b737-800.glb` remains unchanged. Its batched airframe geometry is
split at measured hinge/span boundaries at load time, retaining UVs, normals and
material. Ailerons, flaps, elevators and rudder follow existing flight telemetry.
Landing gear and spoilers are unchanged.

Validation used Node 22.23.2 and Chromium with ANGLE/SwiftShader:

- `npm run check`: JavaScript syntax and pinned workflow action references passed.
- `npm test`: 178 passed, zero failed/skipped. The new tests use actual GLB
  geometry, check total area and neutral bounds, and verify deflection directions,
  stable held input, reversal and restoration to neutral.
- `npm run build`: passed, with the existing bundle-size warning.
- `node scripts/verify-control-surfaces.mjs`: native CDP D-key input reached
  telemetry and both loaded ailerons; all seven surfaces responded via the real
  aircraft update method, held input was stable, and release restored neutral.
  No page exceptions were recorded. See `browser-results.json`.

`neutral.png` and `deflected.png` show a clone of the actual loaded GLB rendered
with the same material/geometry and a fixed camera/light, isolating the changed
surfaces from the moving world. The deflected pose combines right roll, pull-up,
right pedal and 40-degree flaps. Images were inspected for moving trailing edges
and preserved neutral shape. This is not a full flight or performance benchmark.

The browser checker pauses the background animation during isolated captures and
reloads the page afterward to restore the application. This avoids competing
software-rendered world frames causing screenshot timeouts. Hinge positions are
asset-specific; a replacement GLB needs new measurements and validation. The
cockpit shadow proxy deliberately retains the original neutral geometry.
