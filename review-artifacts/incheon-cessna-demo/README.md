# Incheon C172 demo acceptance

Run `scripts/verify-incheon-demo.mjs` under the Flight3d Chrome project session,
with Vite on 5189. The browser uses the regular 120 Hz physics/collision pipeline;
wall-clock physics is frozen while deterministic stepping runs the entire flight.
The route completed twice with the same result: **476.63 simulated seconds**,
three facility passes, touchdown **479.29 m** past the 15R threshold and a stopped
position **580.79 m** past the threshold, **0.005 m** off the modeled centreline.
All gear remained normal; no crash, landing incident or browser exception occurred.
These coordinates are simulator measurements, not real-world surveying accuracy.

- [390px menu](menu-mobile.png): Incheon-specific route, no horizontal overflow.
- [T1 close pass](terminal-pass.png): continuous low flight over the modeled terminal.
- [Business district](business-pass.png): close rooftop pass by the modeled hotels.
- [Runway stop](runway-stop.png): aircraft stopped inside 15R, parking brake retained.
- [Results](results.json): sampled-flight summary and acceptance assertions.

The harness also uses real P / 7 / Esc keyboard events to verify runway restart,
manual camera preservation through the circuit transition, and release of virtual
controls. Node check/test/build passed (587 tests). This is desktop flight and
mobile menu evidence; mobile touch flight and audio listening were not tested.
The current finite Incheon scenery and modeled building heights remain unchanged.
