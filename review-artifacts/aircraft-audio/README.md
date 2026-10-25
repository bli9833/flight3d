# C172 audio comparison

These 3-second WAV files were rendered by real Chrome OfflineAudioContext from
the old and new FlightAudio graphs. They isolate a parked engine (no wind, ground
roll or warnings). The failure clip starts at full power and cuts combustion at
1 second.

| State | Before | C172 piston profile |
| --- | --- | --- |
| Idle | [Old jet idle](before-idle.wav) | [Piston idle](cessna-idle.wav) |
| Full power | [Old jet full power](before-full-power.wav) | [Piston full power](cessna-full-power.wav) |
| Engine failure | — | [Power → failure](cessna-failure.wav) |

[Raw measurements](results.json) include RMS, peaks and selected spectral
components. The harness checks non-clipping output, the 23.3/90 Hz firing tones,
a quiet turbine-whistle band in the piston profile and a silent failure tail.
It also used native mute/unmute clicks in the actual simulator, switched C172 ↔
B738 repeatedly with the same AudioContext and verified stationary failed-engine
silence. No browser exceptions were observed.

`npm run check`, all 542 Node tests, and `npm run build` passed. Node tests cover
profile switching, idle/power/release, failure/restart, mute/unmute, stall warning,
callout reset and crash/reset sequences.

These are synthetic sounds rather than recorded Lycoming samples. Human
listening, real speaker/headphone/Bluetooth quality and real-aircraft acoustic
accuracy have not been verified. The WAVs are provided for that listening review;
automated signal checks alone do not prove subjective sound quality.
