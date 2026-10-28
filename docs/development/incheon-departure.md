# Incheon gate departure demo

Select **Incheon → Boeing 737-800 → Auto demo → Incheon gate → pushback → takeoff**
in the lobby, then watch the demo.
The departure profile is offered only for B738. C172 keeps its original Incheon tour.

The departure flies eight stages: gate preparation, tug pushback, disconnect,
taxi, hold short / tower contact, line up and wait, takeoff clearance, and takeoff
with an airborne manual handoff. Bundled English radio speech includes distinct pilot, ground-crew and controller voices with matching captions. Stage names, speaker labels and the briefing support Korean and English. Exchanges are scripted; microphone recognition is not included. Waiting stages finish only after the current call ends. The master mute/volume controls apply to radio playback, the menu pauses and resumes at the same speech position, and cancellation/reset stops it without stale replay.

G1 is an authored gate placement within source Apron 1, not a surveyed stand ID.
Its bridge docks at the 737 forward port door and retracts before pushback.
Apron 1 and Apron 2 boundaries come from complete OpenStreetMap multipolygon
relations 3917465 and 3156115. The original bounding-box snapshot omitted member
ways and the airfield builder ignored relations. Supplementary frozen full-relation
snapshots restore those members, with checksums and versions recorded in
`public/scenery/incheon/apron-source-metadata.json`. Overlapping elements retain
the same versions and coordinates as the original snapshot. Supplementary element
timestamps must not be newer than the original snapshot cutoff. Open/incomplete
rings are rejected and inner holes are preserved instead of filled.

No authored apron rectangle, widened taxi corridor or runway-entry connector is
added to rendering, ground contact or grading. Taxi vertices retain the mapped
centreline coordinates. Departure uses runway 33L because its existing mapped
connector provides a continuous path from the apron. The tug follows a reverse
arc inside the source apron and hands over aligned with the taxi exit.

These are OSM geometry boundaries, not surveyed accuracy or live operational
clearances. Existing default widths remain where the original taxiway has no
width tag; those defaults are not widened for this demo. Airport elevation remains
the existing modeled 7 m. The landing-traffic call is scripted.

There is one initial gate reset through the normal preset lifecycle. A visible
737-sized tractor animates its wheels and beacon, retracts its coupling and drives clear after disconnect. It supplies bounded horizontal towing forces and a heading-restoring moment
through the normal integrator. After disconnect, all motion uses engine thrust,
nosewheel steering, wheel brakes and flight controls. Hold-short and lineup
completion require a physical stop. Lineup alone does not release takeoff thrust.
The 737 uses flaps 15, rotates from 140 knots and follows a 170-knot initial-climb target. Completion requires real liftoff and 80 m above airport elevation; the handoff
retains climb thrust. Esc, preset changes, airport changes and restart remove the
tug and release automation. P restarts the selected departure profile.

## Verification

```sh
node --test tests/incheonDeparture.test.js tests/incheonDemo.test.js tests/departureRadio.test.js tests/departureJetBridge.test.js tests/incheonAprons.test.js
npm run check
npm test
npm run build
```

For browser acceptance, start Vite on port 5283, then use the project browser:

```sh
npm run dev -- --host 127.0.0.1 --port 5283
chrome-session --project flight3d node scripts/verify-incheon-departure.mjs
chrome-session --project flight3d node scripts/verify-departure-audio.mjs
chrome-session --project flight3d node scripts/verify-departure-gate.mjs
```

`APP_URL` and `ARTIFACT_DIR` override the URL and `.cache/incheon-departure`
artifact directory. The harness checks desktop/mobile menu selection and overflow,
flies the complete departure with deterministic physics, captures each stage,
checks every grounded wheel against the source pavement on every physics step,
checks gear integrity / absence of crashes and invalid positions, verifies the
climb-thrust handoff, and restarts/cancels to verify tug cleanup and input release.
It closes only its own tab. Review the PNGs and `results.json` alongside the exit
status. Node tests separately cover stage gating, bounded towing force, restart,
cancellation, and a stop/alignment/clearance sequence.

See [captured acceptance evidence](../../review-artifacts/incheon-departure/README.md).

The flight harness mutes audio so deterministic accelerated stepping does not wait
for wall-clock speech. The audio harness separately tests a native user click,
actual live voice samples, speech-end gating, pause/resume offset, mute/unmute,
cancellation, and offline rendering of all eight decoded clips. Set `SCREENSHOTS=0`
for a physics-only run if GPU screenshot capture is slow.

Voice assets are already bundled; no runtime TTS, OS voice installation or API key
is needed. To regenerate original dialogue locally, use FFmpeg with its Flite
filter and run `node scripts/build-departure-radio.mjs`. The manifest records the
transcript, speaker voice and duration. Attribution is in
`public/audio/departure/LICENSE.txt`. Generated speech is band-limited to
320–3100 Hz; it is synthetic dialogue, not a recording of live controllers.

The gate harness checks desktop/mobile selection, the 737 bridge docking and
clearance sequence, visible tractor movement after uncoupling, wheel animation
and cancellation cleanup, with screenshots under `.cache/departure-gate`.
