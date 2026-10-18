import * as THREE from 'three';

/**
 * 5-Perspective Camera System (Cockpit, Chase, Wing View, Control Tower, Flyby)
 * Features G-force cockpit head dynamics, stall buffeting vibration, touchdown shock jolt, and smooth exterior damping.
 */
export class CameraSystem {
  static MODES = {
    COCKPIT: 0,
    CHASE: 1,
    WING: 2,
    TOWER: 3,
    FLYBY: 4
  };

  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.mode = CameraSystem.MODES.COCKPIT;

    // Cockpit Head Dynamics & Look-Around
    this.cockpitHeadOffset = new THREE.Vector3(-0.48, 0.82, -12.02); // Captain eye
    this.headGForceOffset = new THREE.Vector3();
    this.lookYaw = 0;
    this.lookPitch = -0.18; // Natural pilot head tilt showing MCP, instruments & runway horizon

    // Chase Camera Parameters
    this.chaseDistance = 55.0;
    this.chaseHeight = 10.5;
    this.chasePos = new THREE.Vector3();
    this.chaseTarget = new THREE.Vector3();

    // Tower Camera Location (Inside Control Tower Cab at 66m height)
    this.towerPos = new THREE.Vector3(120, 78, 280);

    // Flyby Camera State
    this.flybyPos = new THREE.Vector3();
    this.flybySet = false;

    // Mouse drag look
    this.isDragging = false;
    this.prevMouse = { x: 0, y: 0 };

    this.initMouseLook();
  }

  initMouseLook() {
    this.domElement.addEventListener('mousedown', (e) => {
      if (e.button === 0 || e.button === 2) {
        this.isDragging = true;
        this.prevMouse.x = e.clientX;
        this.prevMouse.y = e.clientY;
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        const dx = e.clientX - this.prevMouse.x;
        const dy = e.clientY - this.prevMouse.y;
        this.prevMouse.x = e.clientX;
        this.prevMouse.y = e.clientY;

        if (this.mode === CameraSystem.MODES.COCKPIT) {
          this.lookYaw -= dx * 0.0035;
          this.lookPitch -= dy * 0.0035;
          this.lookPitch = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, this.lookPitch));
        }
      }
    });

    // Reset cockpit view on double click
    this.domElement.addEventListener('dblclick', () => {
      this.lookYaw = 0;
      this.lookPitch = -0.18;
    });
  }

  snapToTarget(aircraftMesh) {
    const behindLocal = new THREE.Vector3(0, this.chaseHeight, this.chaseDistance);
    this.chasePos.copy(behindLocal.applyMatrix4(aircraftMesh.matrixWorld));
    this.camera.position.copy(this.chasePos);
    this.camera.lookAt(aircraftMesh.position.clone().add(new THREE.Vector3(0, 1.5, 0)));
  }

  cycleMode() {
    this.mode = (this.mode + 1) % 5;
    if (this.mode === CameraSystem.MODES.FLYBY) {
      this.flybySet = false;
    }
    return this.getModeName();
  }

  setMode(m) {
    this.mode = m;
    if (this.mode === CameraSystem.MODES.FLYBY) {
      this.flybySet = false;
    }
  }

  getModeName() {
    switch (this.mode) {
      case CameraSystem.MODES.COCKPIT: return 'COCKPIT (CAPTAIN)';
      case CameraSystem.MODES.CHASE: return 'CHASE (EXTERIOR)';
      case CameraSystem.MODES.WING: return 'WING VIEW';
      case CameraSystem.MODES.TOWER: return 'AIRPORT TOWER';
      case CameraSystem.MODES.FLYBY: return 'CINEMATIC FLYBY';
      default: return 'CAMERA';
    }
  }

  update(dt, aircraftMesh, flightState) {
    const planePos = aircraftMesh.position;
    const planeQuat = aircraftMesh.quaternion;

    switch (this.mode) {
      case CameraSystem.MODES.COCKPIT: {
        // First-Person Cockpit View
        // 1. Calculate head displacement from G-forces & buffeting
        const gForce = flightState.gForce || 1.0;
        const targetGOffset = -(gForce - 1.0) * 0.04;
        this.headGForceOffset.y += (targetGOffset - this.headGForceOffset.y) * Math.min(1.0, dt * 10.0);

        // Stall Buffeting Shake (high frequency vibration)
        let buffetX = 0, buffetY = 0;
        if (flightState.isStalled) {
          const t = performance.now() * 0.035;
          buffetX = (Math.sin(t * 1.7) + Math.cos(t * 3.1)) * 0.015 * flightState.buffetVibration;
          buffetY = (Math.cos(t * 2.3) + Math.sin(t * 4.2)) * 0.015 * flightState.buffetVibration;
        }

        // Touchdown Jolt
        let touchJolt = 0;
        if (flightState.touchdown) {
          touchJolt = -0.05;
        }

        const eyeLocal = this.cockpitHeadOffset.clone();
        eyeLocal.y += this.headGForceOffset.y + buffetY + touchJolt;
        eyeLocal.x += buffetX;

        // Transform eye point to world space
        const eyeWorld = eyeLocal.applyMatrix4(aircraftMesh.matrixWorld);
        this.camera.position.copy(eyeWorld);

        // Compute forward look target with head rotation
        const forwardLocal = new THREE.Vector3(0, 0, -100);
        // Apply pilot pan/tilt
        forwardLocal.applyAxisAngle(new THREE.Vector3(1, 0, 0), this.lookPitch);
        forwardLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.lookYaw);
        const forwardWorld = forwardLocal.applyQuaternion(planeQuat);

        this.camera.lookAt(eyeWorld.clone().add(forwardWorld));
        // Up vector tracks aircraft roll
        const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(planeQuat);
        this.camera.up.copy(upWorld);
        break;
      }

      case CameraSystem.MODES.CHASE: {
        // Smooth Third-Person Exterior Chase Camera
        const behindLocal = new THREE.Vector3(0, this.chaseHeight, this.chaseDistance);
        const targetBehindWorld = behindLocal.applyMatrix4(aircraftMesh.matrixWorld);

        // Damped interpolation to smooth camera motion
        this.chasePos.lerp(targetBehindWorld, Math.min(1.0, dt * 6.5));
        this.camera.position.copy(this.chasePos);

        const lookTarget = planePos.clone().add(new THREE.Vector3(0, 1.5, 0));
        this.camera.lookAt(lookTarget);
        this.camera.up.set(0, 1, 0);
        break;
      }

      case CameraSystem.MODES.WING: {
        // Passenger Window View (Overlooking Left Wing & Engine)
        const windowLocal = new THREE.Vector3(-1.82, 0.45, 2.2);
        const eyeWorld = windowLocal.applyMatrix4(aircraftMesh.matrixWorld);
        this.camera.position.copy(eyeWorld);

        // Look outward towards wingtip and engine
        const lookLocal = new THREE.Vector3(-15.0, -1.2, -4.0);
        const lookWorld = lookLocal.applyMatrix4(aircraftMesh.matrixWorld);
        this.camera.lookAt(lookWorld);
        const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(planeQuat);
        this.camera.up.copy(upWorld);
        break;
      }

      case CameraSystem.MODES.TOWER: {
        // Fixed Airport Control Tower View looking at plane
        this.camera.position.copy(this.towerPos);
        this.camera.lookAt(planePos);
        this.camera.up.set(0, 1, 0);
        break;
      }

      case CameraSystem.MODES.FLYBY: {
        // Position camera 350m ahead of aircraft on first enter
        if (!this.flybySet) {
          const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(planeQuat);
          this.flybyPos.copy(planePos).add(forward.multiplyScalar(280)).add(new THREE.Vector3(25, -15, 0));
          this.flybySet = true;
        }

        this.camera.position.copy(this.flybyPos);
        this.camera.lookAt(planePos);
        this.camera.up.set(0, 1, 0);

        // Reset if aircraft passes far beyond
        if (this.camera.position.distanceTo(planePos) > 650) {
          this.flybySet = false;
        }
        break;
      }
    }

    // Apply catastrophic impact / explosion camera trauma shake
    if (this.trauma > 0) {
      this.trauma = Math.max(0.0, this.trauma - dt * 0.55);
      const shakePower = Math.pow(this.trauma, 2.0);
      const shakeOffset = new THREE.Vector3(
        (Math.random() - 0.5) * 3.2 * shakePower,
        (Math.random() - 0.5) * 2.5 * shakePower,
        (Math.random() - 0.5) * 3.2 * shakePower
      );
      this.camera.position.add(shakeOffset);
    }
  }

  addTrauma(amount = 1.0) {
    this.trauma = Math.min(1.0, (this.trauma || 0) + amount);
  }
}
