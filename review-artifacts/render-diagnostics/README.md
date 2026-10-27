# Render comparison panel acceptance

Verified on 2026-10-27 in the reusable Flight3d Chrome session with Intel ADL-N /
ANGLE Vulkan. Worktree based on e71e85f with this patch. Node 22.23.2. The aircraft
was held on the Coastal runway in B737 3D cockpit view; this is not an autonomous
flight or permanent browser-hang test.

`results.json` records all 11 option cases, asynchronous GPU/frame/counter
measurements, default-off gating, baseline/JSON export, mobile bounds, and reset.
All passed. Shader inspection confirms all eight sampled StandardMaterial draws
omit `USE_SHADOWMAP` with shadows disabled. World-only mode submits fewer
triangles. Repeated shader-option cycles stabilize at 145 programs in this run.
Native keyboard checks confirm focusing the panel releases held flight inputs
and typing C in a control does not change the camera.

After disabling developer mode, the panel is hidden, pixel ratio and renderer
counter mode are restored, diagnostic material references are cleared, and normal
quality preferences are unchanged. Aircraft/normal-quality changes also close
the trial. No JavaScript/shader errors occurred. Unsupported/disjoint GPU query
and restoration paths are covered by Node tests. The check/test/build gate passes
with all 648 tests.

Inspected desktop and mobile screenshots:

- [Default desktop](desktop-default.png)
- [English desktop](desktop-english.png)
- [Korean mobile](mobile-korean.png)

The mobile panel keeps counters and baseline/export controls above a scrollable
options area. The screenshot shows the settling state after resizing; missing
timings are shown as dashes rather than fabricated zeroes.

See [usage, option meanings and measurement limits](../../docs/development/render-diagnostics.md).
