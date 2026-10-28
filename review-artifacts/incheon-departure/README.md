# Boeing 737-800 departure on source-mapped pavement

The previously authored apron rectangle, widened taxi corridor and runway
connector have been removed. Missing Apron 1/2 multipolygon members are restored
from frozen full-relation OSM snapshots. Checksums, original versions, shared
coordinates and the original source cutoff are verified. Incomplete/open rings
are rejected, and holes remain unpaved. The rendered pavement and contact queries
use the same source shapes; no scenario pavement is appended.

Verified the production build using the shared Flight3d Chrome session:

- All eight stages completed through runway **33L** in **373.45 simulated seconds**.
- **130,522 grounded-wheel contact checks; zero pavement exits.** The observer runs
  after every physics step and the harness rejects an empty contact audit.
- No crash, gear damage, invalid pose or browser exception.
- Gate placement and the reverse turning manoeuvre fit source Apron 1. Taxi edges
  come from identified source ways; the existing connector supplies runway entry.
- The 737 jetbridge docks/retracts; the tug uncouples and drives clear with animated
  wheels. Desktop and 390 px menus fit; cancellation cleans up bridge/tug/radio.
- Spoken 33L calls start on a native click; all eight assets decode/render with
  audible signal and no clipping. Pause/resume, mute/unmute and cancel pass.
- `npm test`: **707 passed**. After the final source-cutoff/edge provenance checks,
  **13 focused tests**, syntax checks and deterministic airfield regeneration pass.
- `npm run check`: 302 JavaScript files and 11 pinned action references pass.
  `npm run build` passes (the existing large-chunk advisory remains).

[Flight results](results.json) · [Every-step pavement audit](pavement-audit.json) · [Audio results](audio-results.json) · [Gate results](gate-results.json)

[737 at source Apron 1](gate.png) · [Bridge clear before pushback](bridge-clear.png) · [Turned aircraft after tug disconnect](tug-disconnected.png)

Reproduce with `scripts/verify-incheon-departure.mjs`,
`scripts/verify-departure-audio.mjs` and `scripts/verify-departure-gate.mjs`.
The accelerated flight check mutes speech; the audio check separately exercises
actual wall-clock playback. OSM boundaries are map data, not surveyed precision;
existing default widths for untagged taxiways and modeled 7 m elevation remain.
G1 placement, the bridge and radio dialogue are authored simulator content.
