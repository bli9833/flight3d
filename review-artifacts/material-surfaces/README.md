# Issue #66 material comparisons

For the final ocean appearance, see the [wave-scale refinement](water-scale/README.md).
The images below record the initial material pass.

Baseline: `f46c426` (current main at implementation start). Captured with
`scripts/verify-material-surfaces.mjs`, Chrome/ANGLE Vulkan, 1200×800,
fixed time 12.5s and fixed cameras/lighting. Each `before-*.png` pairs with the
corresponding `after-*.png`. These are isolated production-material scenes.

- Ocean low/high: broad interpolated plastic highlights replaced by per-pixel
  wave detail and filtered sun reflection.
- Terrain high/low: independently hashed texture noise, nonmetallic materials,
  broad colour patches; high quality additionally blends offset texture tiles.
- Sunset/night: warm reflection and suppression of the sun lobe below the horizon.

All 12 captures compiled runnable shaders with no recorded browser errors.
Ocean retains 1 draw call / 64,800 triangles; terrain scenes retain 2 draw calls /
195,872 triangles (including ocean). No texture assets or material texture
allocations are added. High-quality terrain doubles texture lookups; this check
is not a GPU frame-time or mobile performance benchmark. No 60fps claim is made.
The sky is deliberately a constant background here; its horizon line does not
reproduce the application's full atmospheric sky. Water remains a procedural
approximation, with no scene reflection or depth-based shore foam.

[Ocean before](before-ocean-low.png) · [Ocean after](after-ocean-low.png)

[Terrain before](before-terrain-high.png) · [Terrain after](after-terrain-high.png)
