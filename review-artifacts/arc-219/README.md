# PR #219: terrain seam review fix

Review: https://github.com/stlim0727/flight3d/pull/219#discussion_r4373236625

The original regional boundary had 160 edges at 50m spacing; local detail had
640 at 12.5m. At the on-land point `(-1000, -812.5)`, the local height is
21.8158416748m and the original coarse edge interpolates to 19.0681488514m:
a 2.7476928234m crack. Merely checking vertices against the height sampler did
not detect the mismatch between actual mesh edges.

The fix splits only regional triangles touching the inner seam. Every local
edge now has an identical regional edge with the same endpoint positions and
heights. Original DEM/graded assets and local feature heights are unchanged.
The seam adds 480 vertices/480 triangles, preserving triangle winding and a
complete normal/UV buffer. Draw calls remain 17; the complete preview contains
307,660 triangles instead of 307,180.

`tests/incheonSeam.test.js` failed before the fix (160 != 640), then passed for
both graded and natural modes. It compares the actual indexed edge sets,
checks one adjacent face per side, includes the reported regression point,
and rejects inverted/degenerate faces or missing vertex attributes.

Verification:

- `npm ci`, `npm run check`, complete `npm test`: 574 passed; production build passed.
- Focused seam tests rerun after adding winding/normal/UV assertions: passed.
- Intel ADL-N / ANGLE Vulkan browser: loaded production `/flight3d/` route,
  layer hide/restore, natural/graded cycles without geometry growth, view
  buttons, wheel, 390px layout and overlay spacing passed. No runtime/resource errors.
- [Raw browser result](results.json), [regional](regional.png),
  [oblique](oblique.png), [natural](natural-dsm.png), [mobile](mobile.png).

Reproduce with the same project Chrome lease as the main terrain verification:

```sh
node --test tests/incheonSeam.test.js tests/incheonTerrain.test.js
VITE_BASE_PATH=/flight3d/ npm run build
npm run preview -- --host 127.0.0.1 --port 35681 --base /flight3d/
APP_URL=http://127.0.0.1:35681/flight3d/incheon.html ARTIFACT_DIR=review-artifacts/arc-219 chrome-session --project flight3d node scripts/verify-incheon.mjs
```

The geometric edge test establishes seam closure. The wide browser captures
establish valid rendering and preserved controls; they are not a close-up
visual measurement of the original crack or a full-flight FPS benchmark.
