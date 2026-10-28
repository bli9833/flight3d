import test from 'node:test';
import assert from 'node:assert/strict';
import { gearSupportHeight } from '../src/aircraft/gearVisualContact.js';
import { CESSNA_172, F16_FALCON } from '../src/config/aircraftConfigs.js';

test('rendered contact plane follows unequal loading, release and reset without drift', () => {
  for (const config of [CESSNA_172, F16_FALCON]) {
    const contacts = config.landingGear.contacts;
    for (const compression of [{}, { nose: .08, mainLeft: .12, mainRight: .04 }, {}, { nose: .03 }, {}]) {
      for (const c of contacts) {
        assert.ok(Math.abs(gearSupportHeight(contacts, compression, c.localPos.x, c.localPos.z)
          - (c.localPos.y - c.wheelRadius + (compression[c.id] ?? 0))) < 1e-12);
      }
      // A point beyond the authored physics wheelbase must still lie on the
      // same support plane, rather than clamping to the nearest wheel's travel.
      const a = gearSupportHeight(contacts, compression, .1, -3);
      const b = gearSupportHeight(contacts, compression, .1, -2);
      const c = gearSupportHeight(contacts, compression, .1, -1);
      assert.ok(Math.abs(a + c - 2 * b) < 1e-12);
    }
  }
});
