# Neon City browser preview

Captured from PR #243 on 2026-10-27 using the reusable Flight3d Chrome session,
Intel ADL-N / ANGLE Vulkan, 1440×900, Balanced quality and C172 chase camera.
Physics integration was held to keep each preset at its spawn pose.

- [Runway](runway.png)
- [Urban canyon](approach.png)
- [Skyline](cruise.png)

`scripts/verify-neon-city.mjs` selects Neon, loads the C172, captures the actual
render immediately before serializing its buffer, checks all three preset
positions and the 100-building scenery, and checks that selecting Coastal hides
Neon. `results.json` reports PASS with no page exceptions. All three images were
visually inspected. These are static previews of the current rendering, not a
deployed interactive URL or evidence of a completed canyon flight, collision
recovery, mobile support, or performance on Mac.

Syntax/action-pin checks and the four focused `neonCity.test.js` tests passed.
The existing production behavior is unchanged by this preview follow-up.

Integration follow-up: merged the diagnostics, benchmark, lamp-scope and shadow
cache changes from main. The airport-switch conflict preserves both Neon and
diagnostic restoration. A browser rerun checks that leaving Neon closes an active
World-only trial (`airportRestore` in JSON). Syntax/action checks, the 38 related
Neon/diagnostics/shadow/B737 tests, and a production build pass. The images above
are the original inspected preview captures; the integration rerun's raw captures
are retained with the task cache.
