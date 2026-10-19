# Changelog

## [Unreleased]
- **feat:** camera‑anchored infinite ocean mesh and touchdown smoke realism (merged #29)
  - Ocean mesh now anchored to camera with grid snapping (`snapStep`).
  - Realistic tire smoke on landing gear; brake‑intensity threshold and nose‑wheel exclusion.
  - Updated Boeing 737‑800 landing‑gear geometry to official specs (wheeltrack 5.72 m, wheelbase 15.60 m).
  - Added verification script `scripts/verify-ocean-views.js` and unit test `tests/waterOcean.test.js`.

*Released on 2026‑10‑19*
