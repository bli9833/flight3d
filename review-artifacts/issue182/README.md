# Cockpit shading performance (#182)

Settings → Cockpit shading → Performance disables only cockpit SSAO. Detailed
remains the default, and both choices are saved independently of Graphics.
Aircraft geometry, instruments, direct sunlight/shadows, exterior quality, DPR
and terrain are retained. Global Performance already skips AO; this setting
adds no further savings in that preset. Photo/exterior views already skip AO.

The current SSAOPass performs a cockpit normal/depth pass, AO, blur and composite,
followed by an instrument redraw. The latter protects unlit displays from AO
on geometry behind them. Removing those passes with identical shading requires
a different occlusion representation or baked assets; no equivalent-quality
optimization is claimed by this change.

## Verification

Node 22.23.2: check, all 462 tests, build passed. Real Intel ADL-N Vulkan Chrome,
1280×720, DPR 1, balanced graphics, frozen runway cockpit: repeated renders
fell from 706 to 604 draw calls. The two 12-render samples were 15.95/15.49 ms
with AO and 7.26/5.45 ms without. These short, ordered, GPU-fenced fixed-scene
samples establish avoided rendering work; they are not live-flight FPS results
or a guarantee for other hardware. First-use compilation can affect timing.
`results.json` records raw samples and renderer identity.

Inspected detailed/performance captures: contact shading changes on interior
surfaces while the exterior view and instruments remain intact. Toggling twice,
reload persistence, unchanged graphics/DPR/terrain and zero GL errors passed.
The 390×844 mobile Settings selector was visible, within the viewport and hit
testable; see mobile.png. Night/flight performance and other devices were not
benchmarked.

Reproduce with Vite on 5182 and the project Chrome daemon:

```sh
chrome-session --project flight3d node scripts/verify-cockpit-quality.mjs
```

APP_URL and ARTIFACT_DIR can override the defaults. The script owns/closes its
own tab and reuses the daemon. Its preference changes are confined to the test
origin; it does not restore that origin's previous preferences.
