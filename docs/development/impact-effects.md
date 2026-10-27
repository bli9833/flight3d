# Impact effects

`ExplosionSystem.spawnExplosion(result, worldVelocity)` receives the velocity
before `triggerCrash` damps it. Visual spread follows squared impact speed, with
bounded particle counts; emitted dust and fragments inherit world momentum.

- Water uses ballistic spray and a soft, expanding surface ring at sea level.
  Spray stretches during ascent, falls under gravity, and fades at the surface.
  Water emits no fire, flash light, glowing fragments or persistent black smoke.
- Terrain uses brown dust; structures use grey dust. Dust slows and settles.
  Solid impacts emit small, non-additive fragments, with a short heat flash and
  limited fire at high speed. No horizontal shockwave floats at building height.
- Reset disposes particle materials/ring geometry and clears lights. Shared
  atlases are retained until system disposal. Particle counts remain bounded.

These are particle effects, not fluid simulation or structural deformation.
Damage detection and audio remain separate from particle emission. Aircraft
breakup and its camera are described below.

## Verification

Run `node --test tests/effectFlipbook.test.js` for water/solid separation,
ballistic settling, speed scaling, lifetimes, budgets and reset sequences.

Start Vite, then use the project browser lease:

```sh
PORT=5188 CRASH_SCREENSHOTS=0 ARTIFACT_DIR=review-artifacts/impact-realism \
  chrome-session --project flight3d node scripts/test-crash-scenarios.js
```

The script checks tower, water, terrain, building, tree, runway excursion and
restart. It also asserts that collision detection and effect emission receive the
same preserved pre-contact velocity, including a body-contact case where the
contact impulse changes the live velocity. It then renders controlled effect scenes at 0.4 and 2.4 seconds, checks
shader diagnostics and captures all three materials. Controlled captures show
particle appearance without the aircraft/HUD occluding them; they do not replace
collision assertions or establish whole-scene camera acceptance. Omit
`CRASH_SCREENSHOTS=0` for the ordinary in-flight captures as well.

See [captured effects](../../review-artifacts/impact-realism/README.md).

## Aircraft breakup and crash camera

`AircraftBreakup` partitions the active exterior's triangles into left/right
outboard regions and four longitudinal center sections. It retains source
materials/UVs, including batched GLBs, and hides the intact aircraft until reset.
Debris inherits pre-contact world velocity plus a bounded outward impulse, then
integrates gravity, drag, rotation and damped terrain contact at 120 Hz substeps.
Water debris sinks with drag instead of bouncing. Generated geometry is disposed
on reset; aircraft materials and textures remain shared.

The camera cuts immediately outside, fits the debris bounds (including portrait
aspect ratios), follows its center and prevents view switches until crash reset.
Reset restores the previous view and the intact aircraft. Node verification is
`node --test tests/aircraftBreakup.test.js`; `test:crash` checks the exterior view,
finite separated geometry, and captures `aircraft_breakup_exterior.png`.

This is a bounded visual breakup approximation, not a structural solver: region
boundaries have open cut faces, and debris uses approximate terrain contact radii.
It does not simulate collisions between fragments or with buildings after impact.
