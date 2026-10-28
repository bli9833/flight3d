# Aircraft stall warning

`isStalled` describes the model's magnitude-based flow-separation state, including
reattachment memory and negative-AoA separation. `isStallWarning` describes the
positive-AoA warning sensor and drives audio through simulator telemetry.
`isPreStall` is the warning while the separation diagnostic is still clear.
Neither warning flag changes forces or control authority. HUD STALL remains a
simulation separation diagnostic, not a replica of a real cockpit annunciator.

Attitude and increasing speed do not inhibit warning: body-frame air-relative
velocity determines AoA even inverted or descending. Negative AoA can separate
flow without activating these positive-AoA warning sensors. The existing 15 m/s
minimum airflow validity gate remains a simulator approximation. Audio is
inhibited on the ground; ground sensor checks and sensor failures are not modeled.

## Aircraft and evidence

- **C172S:** The [manufacturer POH, sections 4 and 7](https://befa.org/wp-content/uploads/2019/12/POH-Cessna-172S.pdf)
  describes a pneumatic leading-edge inlet/horn with warning 5–10 kt before stall.
  We calibrate the attached-flow lift coefficient at warning to a 7.5 kt margin
  at reference maximum mass in 1g sea-level flight, for each current flap angle.
  This produces an AoA threshold, not an IAS switch: maneuvering stalls still
  warn at higher speeds. The calibration uses the simulator's CL curve, not a
  claim to reproduce POH stall speeds or local inlet pressures. It does not
  constantly retune to the live mass or load factor.
- **B738:** Retains a configurable 2° margin below the model's flap-dependent
  critical AoA. This is an approximation, not a sourced Boeing shaker schedule.
  The [737 FCTM, General Information / Maneuver Margins](https://cmpva.org/descargas/B737_FCTM.pdf)
  describes warning margin adjustments for icing. Full Mach, slat, icing, dual
  vane and air/ground computer schedules are not available here and are not
  fabricated. The existing chirp/pulse synthesis is not a real shaker recording.
- **F16:** With gear handle DOWN, warning starts above +15° AoA, immediately on
  handle movement rather than waiting for gear extension. This condition is
  documented by the [Hellenic Air Force F-16D Block 50 safety investigation,
  pages 23 and 27](https://www.airandspaceforces.com/DRArchive/Documents/2015/July%202015/073015greeksib.pdf).
  Gear-up operation retains the model's 2° pre-separation margin as an explicit
  approximation; the complete FLCS low-speed warning schedule and AoA limiter
  are not reproduced. The 15° landing warning is not a claim that the wing
  physically stalls at 15°.

The underlying common post-stall coefficient model, positive/negative critical
AoA symmetry, and reverse-flow approximation are unchanged. These warning
improvements do not establish aircraft-specific post-stall fidelity.

## Verification

`node --test tests/stallWarning.test.js tests/aerodynamics.test.js tests/flightAudio.test.js`
checks flap calibration, fast inverted flight, unloading/reattachment sequences,
negative-AoA separation, gear-handle reversal, configuration reload and audio
routing. For real browser module and Web Audio verification, start Vite and run:

```sh
APP_URL=http://127.0.0.1:5274 chrome-session --project flight3d node scripts/verify-stall-warning.mjs
```

This bounded browser check covers signal routing and synthesized audio output,
not listening acceptance or complete flight recovery.

Verified for this change with Node 22.23.2: syntax/action checks, all 698 Node
tests and production build passed. Chrome module/Web Audio check passed for all
three aircraft: early warning produced nonzero rendered audio; recovery and
ground inhibition scheduled zero warning gain. No listening acceptance or full
browser flight scenario was performed.
