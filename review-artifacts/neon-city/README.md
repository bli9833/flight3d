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
