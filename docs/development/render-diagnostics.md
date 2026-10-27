# Render comparison panel

Settings → **Developer mode (this session)** → Developer → **Render comparison
panel**. The panel opens over the current flight view. Park the aircraft and keep
the same camera pose for before/after measurements. Change one option at a time,
save a baseline, and export the settings plus measurements as JSON.

The panel is session-only. Closing it or disabling developer mode restores the
original materials, sidedness, shader hooks, mesh culling flags, pixel ratio,
shadow setting and renderer counter mode. Normal quality preferences are not
written. Changing aircraft, airport or the normal quality preset closes the
trial; reopening starts at that new baseline.

Cockpit material and face experiments require a separately mounted, fully loaded
cockpit model. They remain disabled while the B737 lighting bake is loading and
for the C172's unified interior/exterior model. Other comparisons remain available.
Async loader changes become the restoration baseline instead of being overwritten
by an earlier snapshot. First-time AO classification uses original materials even
when Unlit is selected; restoring caster/light trials invalidates shadow caches.

| Option | What the experiment changes |
| --- | --- |
| Pixel ratio | Absolute drawing-buffer pixels per CSS pixel, independently of terrain/shadow quality. Default restores the ratio captured on open. |
| Cockpit AO | Follow normal quality, force on, or skip AO and instrument composite passes. Force-on can isolate AO even at Performance quality. |
| Shadows | Skip shadow-map generation **and** compile out shadow sampling. Restore the original shadow setting on reset/close. |
| Local lights | Hide aircraft exterior lights or all point/spot lights during rendering. Normal animation of those lights continues. |
| Cockpit material | Substitute cached unlit materials for cockpit PBR materials. Exterior materials remain unchanged. |
| Cockpit faces | Front faces only, for measuring the cost of double-sided surfaces. Some interior surfaces will disappear. |
| Fragment depth | Scene-wide diagnostic projection depth instead of logarithmic fragment writes. Distant precision can break; this is not a production depth fix. |
| Scene | Render aircraft only or world only, removing the other groups from render work. This also affects their lights and shadows. |
| Frustum culling | Default versus disabling existing mesh frustum tests. This does not implement new spatial partitioning or hidden-surface culling; city batches with culling disabled in normal code retain that baseline. |

The selected state is applied through draw/pass visibility, renderer flags,
material substitution and shader variants. There are no new per-pixel option
uniform branches. Recompilation can stall the first use of a variant; the panel
discards frames beginning in the first two seconds after a change. Allow timings
to settle further if the first compilation takes longer. Program counts are
shown so recurring compilation can be distinguished from steady rendering cost.

The normal render path takes one JavaScript gate and does not run the profiler,
traverse meshes for trials, or issue timing queries. Scene/material scanning
happens when opening/changing relevant options or when new cockpit/scenery loads.
The active profiler has overhead, so keep it enabled for both sides of a comparison.

## Measurements

- FPS and frame intervals include the normal animation loop. CPU(render) covers
  render submission and diagnostic preparation, excluding physics/UI work.
- GPU milliseconds use asynchronous EXT_disjoint_timer_query_webgl2 queries
  around the complete scene render. At most four queries are pending; disjoint
  samples are discarded. Unsupported GPU timing is displayed as unavailable,
  never as zero milliseconds.
- Draw calls and submitted triangles accumulate across beauty, shadow, AO and
  instrument-redraw passes. They are not unique visible objects or triangles.
  The separate 2D photographic cockpit overlay is outside this 3D scene scope;
  use the 3D cockpit for these comparisons.
- Averages and P95 values use at most the latest 120 measured frames. The sample
  count is displayed; short runs are not statistically robust benchmarks.
- Baseline/export buttons wait for measured frame intervals and, when supported,
  GPU samples. The JSON contains options, camera pose, aircraft, airport, quality,
  baseline and current measurements. A negative delta means less elapsed time.
- CPU and GPU times overlap in the pipeline; adding them is not a frame-time
  estimate. A 60 FPS frame budget is 16.7 ms; 30 FPS is 33.3 ms for the whole frame.

## Verification

```sh
node --test tests/renderDiagnostics.test.js
APP_URL=http://127.0.0.1:5173/ chrome-session --project flight3d node scripts/verify-render-diagnostics.mjs
```

The browser verifier uses the reusable project Chrome session, creates/closes its
own tab, drives the actual controls, and records screenshots and measurements in
`.cache/render-diagnostics/` (`ARTIFACT_DIR` overrides). It checks developer gating,
all options, shadow shader defines, reduced geometry submission, JSON/baseline
capture, stable program counts on repeated toggles, English/Korean desktop/mobile
layout, and restoration when closing or changing normal settings. Inspect the
images as well as the result JSON. These are controlled render checks, not a full
flight, all-airport, GPU compatibility or permanent-hang reproduction suite.
The verifier also holds the real lighting-bake request before readiness, checks
shader-hook preservation after loading, initializes AO for the first time during
an Unlit trial, checks shadow invalidation on restore, and rejects cockpit-only
material/face changes for the loaded C172 unified model.

## Interpreting the follow-up benchmarks

[PR #241](https://github.com/stlim0727/flight3d/pull/241) contains repeated option
measurements. Disabling current frustum culling made those cases slower, which
shows that the existing culling is useful. It does **not** measure the potential
of finer mesh partitioning or new occlusion culling. Likewise, a camera outside a
point light's radius does not establish that visible surfaces are unaffected.

[PR #242](https://github.com/stlim0727/flight3d/pull/242) checked day/night views
and narrowed the safe light reduction to six nav/strobe light nodes; broader
removal visibly changed the scene. Its reported mean GPU reduction is 11.8%.
[PR #244](https://github.com/stlim0727/flight3d/pull/244) reports 5.02% for caching
stationary sunlight shadows; moving aircraft still rebuild the map each frame.
These are separate changes and their gains should not be added without a combined
measurement. The scene-wide depth trial also cannot establish the benefit or
visual safety of changing only cockpit depth. Unlit/front-only/depth options
remain diagnostics rather than safe production defaults.
