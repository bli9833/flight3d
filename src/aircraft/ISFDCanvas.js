import * as THREE from 'three';

/**
 * Boeing 737 Integrated Standby Flight Display (ISFD) Canvas
 * Solid-state backup instrument located on the center instrument panel.
 * Displays independent backup artificial horizon, airspeed tape, altitude tape, and baro setting.
 */
export class ISFDCanvas {
  constructor(width = 256, height = 256) {
    this.width = width;
    this.height = height;

    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    this.pitchDeg = 0;
    this.rollDeg = 0;
    this.iasKnots = 0;
    this.altFt = 0;

    this.render();
  }

  updateData(telemetry) {
    this.pitchDeg = telemetry.pitchDeg || 0;
    this.rollDeg = telemetry.rollDeg || 0;
    this.iasKnots = telemetry.iasKnots || 0;
    this.altFt = telemetry.altitudeFt || 0;
    this.render();
  }

  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Bezel border
    ctx.fillStyle = '#11151c';
    ctx.fillRect(0, 0, w, h);

    // Bezel outer ring
    ctx.strokeStyle = '#2d3748';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, w - 4, h - 4);

    // Inner display area
    const dispX = 12, dispY = 12, dispW = w - 24, dispH = h - 24;
    ctx.save();
    ctx.beginPath();
    ctx.rect(dispX, dispY, dispW, dispH);
    ctx.clip();

    // 1. Standby Attitude Ball
    ctx.save();
    const cx = dispX + dispW * 0.5;
    const cy = dispY + dispH * 0.5;
    ctx.translate(cx, cy);
    ctx.rotate(-(this.rollDeg * Math.PI) / 180.0);

    const pitchPx = this.pitchDeg * 2.2;
    ctx.translate(0, pitchPx);

    // Sky
    ctx.fillStyle = '#0284c7';
    ctx.fillRect(-w, -h * 2, w * 2, h * 2);

    // Earth
    ctx.fillStyle = '#5c3a21';
    ctx.fillRect(-w, 0, w * 2, h * 2);

    // Horizon line
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    ctx.lineTo(w, 0);
    ctx.stroke();

    // Pitch ladder rungs (+/- 10, 20 deg)
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';

    for (let deg = -30; deg <= 30; deg += 10) {
      if (deg === 0) continue;
      const py = -deg * 2.2;
      const lw = 24;
      ctx.beginPath();
      ctx.moveTo(-lw, py);
      ctx.lineTo(lw, py);
      ctx.stroke();
      ctx.fillText(Math.abs(deg).toString(), -lw - 8, py + 3);
      ctx.fillText(Math.abs(deg).toString(), lw + 8, py + 3);
    }
    ctx.restore();

    // 2. Fixed Aircraft Symbol (Amber mini wings)
    ctx.fillStyle = '#f59e0b';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    // Center pip
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Left wing
    ctx.fillRect(cx - 36, cy - 2, 24, 4);
    ctx.strokeRect(cx - 36, cy - 2, 24, 4);
    // Right wing
    ctx.fillRect(cx + 12, cy - 2, 24, 4);
    ctx.strokeRect(cx + 12, cy - 2, 24, 4);

    // 3. Airspeed Indicator Tape (Left side)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(dispX, dispY, 44, dispH);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(dispX, dispY, 44, dispH);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'right';
    for (let s = Math.floor(this.iasKnots / 20) * 20 - 40; s <= this.iasKnots + 40; s += 20) {
      if (s < 0) continue;
      const sy = cy - (s - this.iasKnots) * 1.6;
      if (sy >= dispY + 10 && sy <= dispY + dispH - 10) {
        ctx.beginPath();
        ctx.moveTo(dispX + 34, sy);
        ctx.lineTo(dispX + 44, sy);
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.fillText(s.toString(), dispX + 30, sy + 4);
      }
    }
    // Digital IAS box
    ctx.fillStyle = '#000000';
    ctx.fillRect(dispX + 2, cy - 10, 40, 20);
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(dispX + 2, cy - 10, 40, 20);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(Math.round(this.iasKnots).toString(), dispX + 38, cy + 5);

    // 4. Altitude Indicator Tape (Right side)
    const altX = dispX + dispW - 48;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(altX, dispY, 48, dispH);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(altX, dispY, 48, dispH);

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    for (let a = Math.floor(this.altFt / 200) * 200 - 400; a <= this.altFt + 400; a += 200) {
      if (a < 0) continue;
      const ay = cy - (a - this.altFt) * 0.16;
      if (ay >= dispY + 10 && ay <= dispY + dispH - 10) {
        ctx.beginPath();
        ctx.moveTo(altX, ay);
        ctx.lineTo(altX + 10, ay);
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.fillText((a / 100).toFixed(0), altX + 14, ay + 4);
      }
    }
    // Digital Alt box
    ctx.fillStyle = '#000000';
    ctx.fillRect(altX + 2, cy - 10, 44, 20);
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(altX + 2, cy - 10, 44, 20);
    ctx.fillStyle = '#22c55e';
    ctx.fillText(Math.round(this.altFt).toString(), altX + 6, cy + 5);

    // Baro Setting at bottom right
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('STD 29.92', dispX + dispW - 4, dispY + dispH - 4);

    // ISFD label at top
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('STANDBY', cx, dispY + 12);

    ctx.restore();
    this.texture.needsUpdate = true;
  }
}
