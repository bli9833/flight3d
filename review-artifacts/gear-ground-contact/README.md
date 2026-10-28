# C172 and F-16 ground contact

The exterior tires now follow the physical support plane evaluated at each
rendered tire's position, including independent suspension compression. The
C172's separated struts deform toward their fixed upper attachment; F-16 gear
retains its continuous retraction animation. Airframe/cockpit placement and
physics parameters stay unchanged.

Verified with Node 22.23.2:

- `npm run check`: passed.
- `npm test`: 765 passed, no failures.
- `npm run build`: passed (bundle-size advisory).
- `chrome-session --project flight3d node scripts/verify-gear-ground-contact.mjs`:
  30 loaded-GLB tire measurements across unequal compression, release and reset;
  maximum local support-plane error 8.82e-8 m. All six neutral tire bottoms
  were within 5 mm of the world ground plane.
- Models loaded with a translated/rotated aircraft root to cover asynchronous
  loading after movement. Both resulting ground-level captures were inspected.

Reproduce with Vite on port 5281; see docs/development/ci.md. This fixture checks
rendered geometry and suspension sequences, not a complete taxi/landing or
terrain-slope transition. Browser extension exceptions are excluded from the
application exception gate.
