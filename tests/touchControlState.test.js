import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TouchFlightControls } from '../src/controls/TouchFlightControls.js';

function movedControls() {
  const controls = Object.create(TouchFlightControls.prototype);
  Object.assign(controls, {
    enabled: true,
    throttleActive: false,
    controls: { throttle: 0.55 },
    // Action groups have moved out of the overlay into the mobile menu.
    overlay: { querySelector: () => null },
    gearBtn: {}, spoilersBtn: {}, reverserBtn: {}, soundBtn: {},
  });
  return controls;
}

describe('Reparented mobile action state', () => {
  it('updates gear, spoiler and reverse states through deployment and recovery', () => {
    const controls = movedControls();
    controls.updateUI({ gearState: 1, spoilers: 0, engine1: { reverserActive: false } });
    assert.match(controls.gearBtn.innerHTML, /GEAR DN/);
    assert.equal(controls.gearBtn.className, 'btn-touch-pill active');
    assert.equal(controls.spoilersBtn.className, 'btn-touch-pill');
    assert.equal(controls.reverserBtn.className, 'btn-touch-pill');

    controls.updateUI({ gearState: 0, spoilers: 1, engine1: { reverserActive: true } });
    assert.match(controls.gearBtn.innerHTML, /GEAR UP/);
    assert.equal(controls.gearBtn.className, 'btn-touch-pill');
    assert.equal(controls.spoilersBtn.className, 'btn-touch-pill active');
    assert.equal(controls.reverserBtn.className, 'btn-touch-pill active-amber');

    controls.updateUI({ gearState: 0.5, spoilers: 0, engine1: { reverserActive: false } });
    assert.match(controls.gearBtn.innerHTML, /TRANS/);
    assert.equal(controls.spoilersBtn.className, 'btn-touch-pill');
    assert.equal(controls.reverserBtn.className, 'btn-touch-pill');
    controls.updateUI({ gearState: 1 });
    assert.match(controls.gearBtn.innerHTML, /GEAR DN/);
  });

  it('keeps audio mode and mute indicators synchronized after reparenting', () => {
    const controls = movedControls();
    for (const [state, className, text] of [
      [{ mode: 'normal' }, 'active', /100%/],
      [{ mode: 'mobile' }, 'active-amber', /150%/],
      [{ mode: 'bluetooth' }, 'active-cyan', /200%/],
      [{ muted: true }, 'muted', /OFF/],
      [{ muted: false, mode: 'normal' }, 'active', /100%/],
    ]) {
      controls.updateAudioUI(state);
      assert.equal(controls.soundBtn.className, `btn-touch-pill ${className}`);
      assert.match(controls.soundBtn.innerHTML, text);
    }
  });
});
