import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LuklaTerrain } from '../src/environment/LuklaTerrain.js';

test('DEM loading exposes terminal failures and can recover on an explicit retry', async t => {
  const previousWindow = globalThis.window;
  globalThis.window = { fetch: true };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  t.mock.method(console, 'warn', () => {});
  for (const [name, response, error] of [
    ['HTTP error', async () => ({ ok: false, status: 503 }), /HTTP 503/],
    ['network rejection', async () => { throw new Error('Network unavailable'); }, /Network unavailable/],
    ['invalid grid', async () => ({ ok: true, arrayBuffer: async () => new Float32Array([1]).buffer }), /Invalid Lukla DEM grid/]
  ]) {
    await t.test(name, async st => {
      const terrain = { isLoaded: false, loadError: null, gridSize: 2,
        textureLoader: { load() {} }, updateGeometryElevations() {},
        onLoaded() { this.loadedCallbacks = (this.loadedCallbacks || 0) + 1; } };
      st.mock.method(globalThis, 'fetch', response);
      await LuklaTerrain.prototype.loadRealWorldAssets.call(terrain);
      assert.equal(terrain.isLoaded, false);
      assert.match(terrain.loadError, error);
      assert.equal(terrain.loadedCallbacks, undefined);
      globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new Float32Array([1, 2, 3, 4]).buffer });
      await LuklaTerrain.prototype.loadRealWorldAssets.call(terrain);
      assert.equal(terrain.isLoaded, true);
      assert.equal(terrain.loadError, null);
      assert.equal(terrain.loadedCallbacks, 1);
    });
  }
});
