# Gemini departure radio acceptance

All eight departure stage WAVs were generated with Gemini 2.5 Flash TTS,
24 kHz mono PCM, then band limited to 300–3200 Hz and compressed. Pilot:
Charon; controllers: Kore; ground crew: Fenrir. Clearance reuses the approved
two-voice audition. Clean takes remain in the local authoring cache.

Validation on 2026-10-28:

- JavaScript syntax and workflow pin checks passed.
- Full existing regression suite: 779 passed before asset replacement.
- Audio tests repeated after replacement: 27 passed.
- Production build passed (existing large-chunk advisory).
- Production browser audio acceptance passed through the shared Flight3D Chrome
  session: native click starts playback, stage waits for speech completion,
  live audio signal is present, pause preserves offset, mute/unmute avoids stale
  replay, cancellation stops playback, and all eight clips decode and render
  without silence or clipping. Browser exceptions: zero.

`audio-results.json` contains the browser measurements. These checks establish
playback behavior and signal validity; they do not score pronunciation or
subjective voice quality. No runtime API or credentials are included in the app.
