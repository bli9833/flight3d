# Aircraft demo acceptance

Verified against the aircraft-demo-scenarios branch with the real WebGL browser
and 120 Hz deterministic physics through `scripts/verify-cessna-demos.mjs`.
The four C172 airport/profile combinations completed without sampled stalls or
crashes. `summary.json` records elapsed simulation time, minimum terrain
clearance, maximum bank, cameras used and powered handoff.

The same harness exercised native keyboard camera selection across a stage
boundary, Esc cancellation, P restart with the selected route and Boeing classic
scenario routing. It checked menu horizontal overflow at 390×844. Full gate:
`npm run check`, 515 Node tests, and `npm run build` passed.

- [Mobile route menu](menu-mobile.png)
- [City low pass](city-pass.png)
- [Canyon low pass](canyon-pass.png)
- [C172 forward cockpit view](cockpit-forward.png)

The cockpit camera height was subsequently raised from panel-center height to
0.72 m and the coastal scenario was rerun; the forward-view and mobile captures
come from that final run. This camera-only adjustment does not change flight
physics. City placement is randomized, so later page loads can select a different
clear corridor. The demos start airborne and do not verify C172 takeoff/landing,
audio, loops or inverted flight. No deployment is claimed.

Browser GPU: ANGLE Intel Vulkan 1.4.335, Intel Graphics ADL-N, Mesa 26.0.8
(queried through CDP SystemInfo.getInfo).
