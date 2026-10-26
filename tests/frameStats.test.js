import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFrameIntervals } from '../scripts/lib/frameStats.mjs';
test('frame acceptance rejects missing, short, zero and malformed samples',()=>{
  for(const values of [undefined,[],Array(119).fill(16),Array(120).fill(0),[...Array(119).fill(16),NaN],[...Array(119).fill(16),Infinity]])assert.throws(()=>summarizeFrameIntervals(values));
});
test('long frames affect mean FPS and tail percentiles without being discarded',()=>{
  const values=[...Array(110).fill(10),...Array(9).fill(60),500],stats=summarizeFrameIntervals(values);
  assert.equal(stats.samples,120);assert.equal(stats.p95Ms,60);assert.equal(stats.maxMs,500);assert.equal(stats.over50Ms,10);
  assert.equal(stats.fps,120000/2140);
});
