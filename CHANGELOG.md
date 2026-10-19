# Changelog

## [Unreleased]
- **fix(audio):** boost mobile speaker loudness, frequency response, and volume controls
  - Added Web Audio `DynamicsCompressorNode` mastering limiter to safely boost volume without distortion.
  - Retuned turbofan engine acoustic filter from 180 Hz to 260–900 Hz sweet spot for mobile phone transducers.
  - Added dual-spool CFM56 N1/N2 turbine whine harmonics and ground rolling runway rumble.
  - Added mobile speaker loudness boost mode (150%) and multi-touch audio gesture initialization.
  - Added on-screen sound & volume toggle button to preset bar, action panel, and mobile touch overlay.
- **feat:** camera‑anchored infinite ocean mesh and touchdown smoke realism (merged #29)
  - Ocean mesh now anchored to camera with grid snapping (`snapStep`).
  - Realistic tire smoke on landing gear; brake‑intensity threshold and nose‑wheel exclusion.
  - Updated Boeing 737‑800 landing‑gear geometry to official specs (wheeltrack 5.72 m, wheelbase 15.60 m).
  - Added verification script `scripts/verify-ocean-views.js` and unit test `tests/waterOcean.test.js`.

*Released on 2026‑10‑19*
