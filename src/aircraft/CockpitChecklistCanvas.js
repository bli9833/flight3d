import * as THREE from 'three';

/**
 * Boeing 737 Yoke Checklist & Approach Plate Canvas
 * Renders an authentic flight deck approach plate and landing checklist
 * mounted on the pilot's control yoke clipboard.
 */
export class CockpitChecklistCanvas {
  constructor(width = 512, height = 768) {
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
    this.texture.colorSpace = THREE.SRGBColorSpace;

    this.render();
  }

  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Clipboard backing sheet (subtle off-white aviation chart paper)
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, h);

    // Subtle paper edge border
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, w - 8, h - 8);

    // Header banner (Jeppesen / Boeing flight deck style)
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(8, 8, w - 16, 44);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('RKSS / GMP', 20, 36);

    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ILS or LOC Rwy 09L', w * 0.5 + 20, 28);
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('SEOUL GIMPO INTL', w * 0.5 + 20, 44);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('B737-800', w - 20, 36);

    // Frequency Bar
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(10, 56, w - 20, 32);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.strokeRect(10, 56, w - 20, 32);

    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('LOC 109.50', 20, 76);
    ctx.fillText('CRS 090°', 140, 76);
    ctx.fillText('FAF 2,000\'', 250, 76);
    ctx.fillText('DA(H) 247\'', 360, 76);

    // Section 1: Normal Checklist (Top Half)
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(10, 96, w - 20, 24);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('✈️ APPROACH & LANDING CHECKLIST', 22, 113);

    const checklistItems = [
      ['ALTIMETERS (QNH 1013)', 'SET & CROSSCHECKED'],
      ['APPROACH BRIEFING', 'COMPLETED'],
      ['SPEEDBRAKE', 'ARMED (GREEN LIGHT)'],
      ['LANDING GEAR', 'DOWN & 3 GREEN'],
      ['FLAPS (LANDING 30° / 40°)', 'SET & INDICATING'],
      ['AUTOBRAKE', 'SET (MODE 2 / 3)'],
      ['CABIN CREW', 'NOTIFIED FOR LANDING'],
      ['MISSED APPR ALTITUDE', '4,000 FT SET']
    ];

    let startY = 142;
    ctx.font = 'bold 12px monospace';
    checklistItems.forEach(([item, status], idx) => {
      // Row highlight
      if (idx % 2 === 0) {
        ctx.fillStyle = '#f1f5f9';
        ctx.fillRect(12, startY - 14, w - 24, 20);
      }
      ctx.fillStyle = '#1e293b';
      ctx.textAlign = 'left';
      ctx.fillText(item, 24, startY);

      // Dots connector
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('........................', 230, startY);

      ctx.fillStyle = idx === 3 ? '#15803d' : '#0369a1'; // Green for gear
      ctx.textAlign = 'right';
      ctx.fillText(status, w - 24, startY);
      startY += 22;
    });

    // Section 2: RKSS Approach Profile Diagram (Lower Half)
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(10, startY + 8, w - 20, 24);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('📍 PROFILE / GLIDEPATH (3.0° ILS)', 22, startY + 25);

    startY += 40;
    // Approach profile box
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(12, startY, w - 24, 210);
    ctx.strokeStyle = '#94a3b8';
    ctx.strokeRect(12, startY, w - 24, 210);

    // Profile flight path line
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(30, startY + 40);
    ctx.lineTo(150, startY + 40);
    ctx.lineTo(400, startY + 160);
    ctx.lineTo(470, startY + 160);
    ctx.stroke();

    // 3.0 degree angle indicator
    ctx.fillStyle = '#475569';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('3.00° GS', 230, startY + 80);
    ctx.fillText('FAF: BUMAN 2,000 FT', 40, startY + 30);
    ctx.fillText('RWY 09L ELEV 47 FT', 330, startY + 185);

    // Runway threshold marker
    ctx.fillStyle = '#15803d';
    ctx.fillRect(400, startY + 155, 60, 10);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('RWY 09L', 430, startY + 163);

    // Minimums Box
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(20, startY + 115, 140, 48);
    ctx.strokeStyle = '#64748b';
    ctx.strokeRect(20, startY + 115, 140, 48);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('CATEGORY C / D', 26, startY + 130);
    ctx.fillText('DA 247 FT (200\')', 26, startY + 144);
    ctx.fillText('RVR 550m / VIS 1/2', 26, startY + 158);

    // Bottom Footer with Official Boeing Flight Deck Brand
    const footerY = h - 36;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(8, footerY, w - 16, 28);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✈️ BOEING 737 FLIGHT CREW OPERATIONS MANUAL', w * 0.5, footerY + 18);

    this.texture.needsUpdate = true;
  }
}
