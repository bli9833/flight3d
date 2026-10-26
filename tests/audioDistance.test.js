import { describe, it } from 'node:test';
import assert from 'node:assert';
import { exteriorDistanceGain, exteriorAirCutoff } from '../src/audio/distanceAcoustics.js';

describe('Exterior distance acoustics', () => {
  it('is unattenuated in the near field and for missing input', () => {
    assert.strictEqual(exteriorDistanceGain(0), 1);
    assert.strictEqual(exteriorAirCutoff(0), 8800);
    for (const bad of [undefined, NaN, -5]) {
      assert.strictEqual(exteriorDistanceGain(bad), 1);
      assert.strictEqual(exteriorAirCutoff(bad), 8800);
    }
  });

  it('quiets and dulls the mix monotonically as the camera backs away', () => {
    const distances = [0, 20, 38, 55, 90, 140, 300];
    const gains = distances.map(exteriorDistanceGain);
    const cutoffs = distances.map(exteriorAirCutoff);
    for (let i = 1; i < distances.length; i++) {
      assert.ok(gains[i] < gains[i - 1], `gain should drop from ${distances[i - 1]}m to ${distances[i]}m`);
      assert.ok(cutoffs[i] < cutoffs[i - 1], `cutoff should drop from ${distances[i - 1]}m to ${distances[i]}m`);
    }
    // Chase cam at its default 55 m distance halves the perceived engine level.
    assert.ok(Math.abs(exteriorDistanceGain(60) - 0.5) < 1e-9);
  });

  it('keeps a floor so distant tower views still hear the flyby', () => {
    assert.ok(exteriorDistanceGain(5000) >= 0.08);
    assert.strictEqual(exteriorDistanceGain(100000), exteriorDistanceGain(5000));
    assert.ok(exteriorAirCutoff(5000) >= 1500);
    assert.strictEqual(exteriorAirCutoff(100000), exteriorAirCutoff(5000));
  });
});
