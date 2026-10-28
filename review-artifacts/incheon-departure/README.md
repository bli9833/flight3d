# Boeing 737-800 departure acceptance

Verified the production build on the task's preview server through the shared
Flight3d Chrome session. The flight harness mutes speech for accelerated stepping;
the audio harness separately verifies actual wall-clock playback.

- Full eight-stage B738 departure completed in 961.85 simulated seconds, with
  about 36 seconds of observed pushback. No crash, gear damage or browser exception.
- Desktop and 390 px mobile menu selection passed; no page overflow.
- Jetbridge docks at the forward port door, then retracts 13 m before pushback.
- Tractor wheels / beacon animate, coupling retracts and the tractor drives clear.
- Manual handoff retains climb thrust. Restart / Esc remove the tug, retract the
  bridge, stop radio playback and release aircraft controls.
- A native click starts the bundled speech; live RMS measured 0.170. All eight
  clips decode and render with nonzero signal and peaks below clipping.
- Pause/resume preserves speech position. Mute/cancel stop playback; unmuting
  does not replay an outdated call.
- `npm run check`: 300 JavaScript files, 11 pinned action references, no failures.
- `npm test`: 701 passing tests. `npm run build` passed (large-chunk advisory remains).
  After the final bridge-cab orientation adjustment, nine focused tests, syntax
  checks, the build and the gate browser harness passed again.

[Flight results](results.json) · [Audio results](audio-results.json) · [Gate results](gate-results.json)

[737 with docked bridge](gate.png) · [Bridge clear before pushback](bridge-clear.png) · [Tractor after disconnect](tug-disconnected.png)

Reproduce with `scripts/verify-incheon-departure.mjs`,
`scripts/verify-departure-audio.mjs` and `scripts/verify-departure-gate.mjs`.
The route is fictional simulator scenery; bundled speech is synthesized scripted
English dialogue. Microphone input, passengers and animated aircraft doors are
outside this change.
