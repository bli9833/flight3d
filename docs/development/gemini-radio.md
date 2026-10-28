# Gemini radio audition

Generate two short English departure transmissions with distinct controller and
pilot voices, retaining clean WAVs and radio-band filtered/compressed WAVs:

```sh
node scripts/sample-gemini-radio.mjs --dry-run
# Set GEMINI_API_KEY securely in your terminal environment first.
node scripts/sample-gemini-radio.mjs
```

Requires Node 22 and FFmpeg. Output defaults to `.cache/gemini-radio/`;
`GEMINI_SAMPLE_DIR` overrides it. The default model is
`gemini-2.5-flash-preview-tts`; `GEMINI_TTS_MODEL` can select a compatible
GenerateContent TTS model. It makes two sequential requests without retries or
provider fallback. Free-tier eligibility and quotas belong to the Google project;
the API request cannot force free-tier billing.

The key stays in the generation process, never in browser assets. This audition
does not replace the existing departure clips. Listen to both versions before
regenerating all scenario audio. Radio processing currently adds band limiting
and compression; it does not add static or push-to-talk clicks.

References: [speech generation](https://ai.google.dev/gemini-api/docs/generate-content/speech-generation),
[pricing](https://ai.google.dev/gemini-api/docs/pricing).
