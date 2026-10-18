import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

/**
 * Atmospheric Sky, Sun, Dynamic Lighting & Volumetric Clouds
 * Features realistic Rayleigh & Mie scattering Sky shader, time-of-day presets (Dawn, Noon, Sunset, Night),
 * and instanced cumulus cloud formations at 1,800m altitude.
 */
export class SkyAtmosphere {
  constructor(scene) {
    this.scene = scene;

    // Time of day (hours: 0.0 to 24.0, default 16.5 = Golden Hour Afternoon)
    this.timeOfDay = 16.8;

    // Sunlight & Ambient lights
    this.sunLight = new THREE.DirectionalLight(0xfff4e5, 3.5);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 1.0;
    this.sunLight.shadow.camera.far = 2000;
    this.sunLight.shadow.bias = -0.0003;
    this.sunLight.shadow.normalBias = 0.02;
    const sCam = 120;
    this.sunLight.shadow.camera.left = -sCam;
    this.sunLight.shadow.camera.right = sCam;
    this.sunLight.shadow.camera.top = sCam;
    this.sunLight.shadow.camera.bottom = -sCam;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.ambientLight = new THREE.AmbientLight(0xdde8f5, 1.2);
    this.scene.add(this.ambientLight);

    // Sky shader object
    this.sky = new Sky();
    this.sky.scale.setScalar(45000);
    this.scene.add(this.sky);

    this.sunPosition = new THREE.Vector3();

    // Procedural Cumulus Cloud layer at y = 1800m
    this.cloudsGroup = new THREE.Group();
    this.initClouds();
    this.scene.add(this.cloudsGroup);

    this.updateSun();
  }

  setTimeOfDay(hours, targetPos = null) {
    this.timeOfDay = (hours + 24) % 24;
    this.updateSun(targetPos);
  }

  updateSun(targetPos = null) {
    // Map 24h to solar elevation and azimuth
    // 06:00 = Sunrise (elev 0°), 12:00 = Noon (elev 65°), 18:00 = Sunset (elev 0°), 24:00 = Midnight
    const hourRad = ((this.timeOfDay - 6.0) / 24.0) * Math.PI * 2.0;

    const elevation = Math.sin(hourRad) * 65.0; // degrees
    const azimuth = 180.0 + Math.cos(hourRad) * 45.0; // degrees

    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);

    this.sunPosition.setFromSphericalCoords(1, phi, theta);

    // Update Sky Shader uniforms (smooth continuous Rayleigh transition prevents sky flashing)
    const rayleighT = Math.max(0.0, Math.min(1.0, (elevation - 4.0) / 12.0));
    const uniforms = this.sky.material.uniforms;
    uniforms['turbidity'].value = 8.0;
    uniforms['rayleigh'].value = 3.5 - 2.3 * rayleighT;
    uniforms['mieCoefficient'].value = 0.005;
    uniforms['mieDirectionalG'].value = 0.85;
    uniforms['sunPosition'].value.copy(this.sunPosition);

    // Update Sun Light direction & position following aircraft to eliminate shadow clipping popping
    if (targetPos) {
      this.sunLight.target.position.copy(targetPos);
      this.sunLight.position.copy(targetPos).addScaledVector(this.sunPosition, 600);
    } else {
      this.sunLight.position.copy(this.sunPosition).multiplyScalar(800);
    }

    // Update Atmospheric Aerial Perspective Fog Color
    if (!this.scene.fog) {
      this.scene.fog = new THREE.FogExp2(0xc8def4, 0.000040);
    }

    if (elevation > 5.0) {
      // Daylight / Afternoon
      const t = Math.min(1.0, (elevation - 5.0) / 20.0);
      this.sunLight.color.setRGB(1.0, 0.85 + t * 0.15, 0.70 + t * 0.30);
      this.sunLight.intensity = 1.5 + t * 2.2;
      this.ambientLight.intensity = 0.8 + t * 0.6;
      this.scene.fog.color.setRGB(0.72 + t * 0.08, 0.84 + t * 0.06, 0.94 + t * 0.04);
    } else if (elevation > -4.0) {
      // Golden Hour Sunset / Sunrise (Warm atmospheric scatter as seen in MSFS 2024)
      const t = (elevation + 4.0) / 9.0;
      this.sunLight.color.setRGB(1.0, 0.45 * t + 0.3, 0.15 * t + 0.1);
      this.sunLight.intensity = Math.max(0.2, t * 1.5);
      this.ambientLight.intensity = 0.45 + t * 0.35;
      this.scene.fog.color.setRGB(0.92, 0.58 * t + 0.25, 0.38 * t + 0.20);
    } else {
      // Night / Twilight
      this.sunLight.intensity = 0.05;
      this.sunLight.color.setRGB(0.1, 0.15, 0.3);
      this.ambientLight.intensity = 0.25;
      this.scene.fog.color.setRGB(0.04, 0.06, 0.12);
    }
  }

  initClouds() {
    const cloudCount = 180;
    const puffGeo = new THREE.DodecahedronGeometry(1, 1);
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.95,
      metalness: 0.05,
      transparent: true,
      opacity: 0.85
    });

    const cloudInst = new THREE.InstancedMesh(puffGeo, cloudMat, cloudCount * 6);
    const dummy = new THREE.Object3D();
    let placed = 0;

    // Distribute cloud clusters at realistic fair-weather altitude (y = 2800m ~ 3600m / ~9,200ft ~ 11,800ft)
    // Expand horizontal coverage to 32km and provide an airport departure corridor
    for (let c = 0; c < cloudCount; c++) {
      const cx = (Math.random() - 0.5) * 32000;
      const cz = (Math.random() - 0.5) * 32000;

      // Keep airport immediate departure/approach corridor clear (x: ±4000m, z: ±2500m)
      if (Math.abs(cx) < 4000 && Math.abs(cz) < 2500) {
        continue;
      }

      const cy = 2800 + Math.random() * 800;

      // Each cloud has 4-7 overlapping puffs
      const puffs = 4 + Math.floor(Math.random() * 3);
      for (let p = 0; p < puffs; p++) {
        const ox = (Math.random() - 0.5) * 450;
        const oz = (Math.random() - 0.5) * 450;
        const oy = (Math.random() - 0.5) * 120;

        const scaleX = 260 + Math.random() * 200;
        const scaleY = 120 + Math.random() * 80;
        const scaleZ = 260 + Math.random() * 200;

        dummy.position.set(cx + ox, cy + oy, cz + oz);
        dummy.scale.set(scaleX, scaleY, scaleZ);
        dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        dummy.updateMatrix();

        cloudInst.setMatrixAt(placed++, dummy.matrix);
      }
    }

    cloudInst.count = placed;
    cloudInst.instanceMatrix.needsUpdate = true;
    this.cloudsGroup.add(cloudInst);
  }

  getSunDirection() {
    return this.sunPosition.clone().normalize();
  }
}
