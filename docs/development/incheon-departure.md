# Incheon gate departure demo

Select **Incheon → C172 → Auto demo → Incheon gate → pushback → takeoff**
in the lobby, then watch the demo. The original Incheon tour remains the default.
The existing Incheon aircraft restriction is unchanged: autonomous demos are C172-only.

The departure flies eight stages: gate preparation, tug pushback, disconnect,
taxi, hold short / tower contact, line up and wait, takeoff clearance, and takeoff
with an airborne manual handoff. English radio captions include both controllers'
instructions and pilot readbacks. Stage names and the briefing support Korean and
English. Radio exchange is scripted and automatic; microphone recognition and
spoken radio audio are not part of this scenario.

G1 is an authored stand near the mapped Terminal 1 outline. The taxi polyline
uses connected points from `incheonAirfield.json`'s taxiways. The stand access
and the short runway 15R connector are authored simulator pavement, explicitly
separate from mapped airport data. Their geometry is shared by the rendered
pavement and terrain/contact surface. This is fictional training scenery, not a
surveyed gate, current clearance, operational airport route or traffic service.
The landing-traffic call is scripted; no live runway-occupancy detection is implied.

There is one initial gate reset through the normal preset lifecycle. A visible
tractor supplies bounded horizontal towing forces and a heading-restoring moment
through the normal integrator. After disconnect, all motion uses engine thrust,
nosewheel steering, wheel brakes and flight controls. Hold-short and lineup
completion require a physical stop. Lineup alone does not release takeoff thrust.
Completion requires real liftoff and 80 m above airport elevation; the handoff
retains climb thrust. Esc, preset changes, airport changes and restart remove the
tug and release automation. P restarts the selected departure profile.

## Verification

```sh
node --test tests/incheonDeparture.test.js tests/incheonDemo.test.js
npm run check
npm test
npm run build
```

For browser acceptance, start Vite on port 5283, then use the project browser:

```sh
npm run dev -- --host 127.0.0.1 --port 5283
chrome-session --project flight3d node scripts/verify-incheon-departure.mjs
```

`APP_URL` and `ARTIFACT_DIR` override the URL and `.cache/incheon-departure`
artifact directory. The harness checks desktop/mobile menu selection and overflow,
flies the complete departure with deterministic physics, captures each stage,
checks gear integrity / absence of crashes and invalid positions, verifies the
climb-thrust handoff, and restarts/cancels to verify tug cleanup and input release.
It closes only its own tab. Review the PNGs and `results.json` alongside the exit
status. Node tests separately cover stage gating, bounded towing force, restart,
cancellation, and a stop/alignment/clearance sequence.

See [captured acceptance evidence](../../review-artifacts/incheon-departure/README.md).
