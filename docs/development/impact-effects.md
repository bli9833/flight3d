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
Aircraft crash motion, damage detection and audio are independent of this change.

## Verification

Run `node --test tests/effectFlipbook.test.js` for water/solid separation,
ballistic settling, speed scaling, lifetimes, budgets and reset sequences.

Start Vite, then use the project browser lease:

```sh
PORT=5188 CRASH_SCREENSHOTS=0 ARTIFACT_DIR=review-artifacts/impact-realism \
  chrome-session --project flight3d node scripts/test-crash-scenarios.js
```

The script checks tower, water, terrain, building, tree, runway excursion and
restart. It then renders controlled effect scenes at 0.4 and 2.4 seconds, checks
shader diagnostics and captures all three materials. Controlled captures show
particle appearance without the aircraft/HUD occluding them; they do not replace
collision assertions or establish whole-scene camera acceptance. Omit
`CRASH_SCREENSHOTS=0` for the ordinary in-flight captures as well.

See [captured effects](../../review-artifacts/impact-realism/README.md).
