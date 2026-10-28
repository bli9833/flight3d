# Incheon gate departure acceptance

Verified through `scripts/verify-incheon-departure.mjs` against the task's Vite
server and the shared Flight3d Chrome session.

- Full eight-stage departure completed in 1083.97 simulated seconds, with a
  38-second observed pushback. No crashes, gear damage or browser exceptions.
- Desktop and 390 px mobile menu selection passed; no page overflow.
- Climb-thrust manual handoff and restart / Esc tug cleanup passed.
- `npm run check`: 290 JavaScript files and 11 pinned workflow action references.
- `npm test`: 687 passing tests. After the final straight-pushback adjustment,
  seven focused departure/tour tests, syntax checks and the build passed again.
- `npm run build` passed (Vite's existing large-chunk advisory remains).

[Structured result](results.json) · [Gate / tug](gate.png) · [Airborne handoff](airborne.png)

The captions are scripted text; spoken ATC and microphone input are not tested
or implemented. G1 and its access / runway connector are authored scenery.
