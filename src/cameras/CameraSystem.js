import * as THREE from 'three';

/**
 * 6-Perspective Camera System (Cockpit, Chase, Wing View, Control Tower, Flyby, Landing Gear Belly Cam)
 * Features G-force cockpit head dynamics, stall buffeting vibration, touchdown shock jolt,
 * smooth exterior damping, and automatic temporary cinematic view cuts for takeoff/landing/gear transit.
 */
export class CameraSystem {
  static MODES = {
    COCKPIT: 0,
    CHASE: 1,
    WING: 2,
    TOWER: 3,
    FLYBY: 4,
    GEAR: 5
  };

  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.mode = CameraSystem.MODES.COCKPIT;

    // Temporary Cinematic View Cut State (e.g. brief gear cam preview during takeoff, landing, gear transit)
    this.temporaryViewTimer = 0;
    this.savedMode = null;
    this.onTemporaryViewComplete = null;

    // Cockpit Head Dynamics & Look-Around
    this.cockpitHeadOffset = new THREE.Vector3(-0.48, 0.82, -12.02); // Captain eye
    this.headGForceOffset = new THREE.Vector3();
    this.touchJoltOffset = 0;
    this.lookYaw = 0;
    this.lookPitch = -0.18; // Natural pilot head tilt showing MCP, instruments & runway horizon

    // Landing Gear Belly View Parameters (Oblique angle looking at nose and main gear under fuselage)
    this.gearCamOffset = new THREE.Vector3(2.4, -2.6, 6.2);
    this.gearLookTarget = new THREE.Vector3(-0.6, -1.9, -2.0);

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
    if (!this.domElement || typeof window === 'undefined') return;
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

    if (this.mode === CameraSystem.MODES.COCKPIT) {
      const eyeWorld = this.cockpitHeadOffset.clone().applyMatrix4(aircraftMesh.matrixWorld);
      this.camera.position.copy(eyeWorld);
      const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(aircraftMesh.quaternion);
      this.camera.up.copy(upWorld);
      const forwardLocal = new THREE.Vector3(0, 0, -100);
      forwardLocal.applyAxisAngle(new THREE.Vector3(1, 0, 0), this.lookPitch);
      forwardLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.lookYaw);
      const forwardWorld = forwardLocal.applyQuaternion(aircraftMesh.quaternion);
      this.camera.lookAt(eyeWorld.clone().add(forwardWorld));
    } else if (this.mode === CameraSystem.MODES.GEAR) {
      const eyeWorld = this.gearCamOffset.clone().applyMatrix4(aircraftMesh.matrixWorld);
      const targetWorld = this.gearLookTarget.clone().applyMatrix4(aircraftMesh.matrixWorld);
      this.camera.position.copy(eyeWorld);
      const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(aircraftMesh.quaternion);
      this.camera.up.copy(upWorld);
      this.camera.lookAt(targetWorld);
    } else {
      this.camera.position.copy(this.chasePos);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(aircraftMesh.position.clone().add(new THREE.Vector3(0, 1.5, 0)));
    }
  }

  showTemporaryView(m, durationSeconds = 4.5, onComplete = null) {
    if (this.mode !== m && this.temporaryViewTimer <= 0) {
      this.savedMode = this.mode;
    }
    this.mode = m;
    this.temporaryViewTimer = durationSeconds;
    this.onTemporaryViewComplete = onComplete;
    if (this.mode === CameraSystem.MODES.FLYBY) {
      this.flybySet = false;
    }
  }

  cancelTemporaryView() {
    if (this.temporaryViewTimer > 0) {
      this.temporaryViewTimer = 0;
      if (this.savedMode !== null && this.savedMode !== undefined) {
        this.mode = this.savedMode;
        this.savedMode = null;
      }
      this.onTemporaryViewComplete = null;
    }
  }

  cycleMode() {
    this.cancelTemporaryView();
    this.mode = (this.mode + 1) % 6;
    if (this.mode === CameraSystem.MODES.FLYBY) {
      this.flybySet = false;
    }
    return this.getModeName();
  }

  setMode(m) {
    this.cancelTemporaryView();
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
      case CameraSystem.MODES.GEAR: return 'GEAR CAM (BELLY)';
      default: return 'CAMERA';
    }
  }

  update(dt, aircraftMesh, flightState) {
    // 1. Process temporary cinematic view timer (auto-cut during takeoff, landing, gear transit)
    if (this.temporaryViewTimer > 0) {
      this.temporaryViewTimer -= dt;
      if (this.temporaryViewTimer <= 0) {
        this.temporaryViewTimer = 0;
        if (this.savedMode !== null && this.savedMode !== undefined) {
          this.mode = this.savedMode;
          this.savedMode = null;
          if (this.onTemporaryViewComplete) {
            const cb = this.onTemporaryViewComplete;
            this.onTemporaryViewComplete = null;
            cb();
          }
        }
      }
    }

    const planePos = aircraftMesh.position;
    const planeQuat = aircraftMesh.quaternion;

    // Smooth Touchdown Jolt with exponential decay (affects cockpit and exterior suspension reaction)
    this.touchJoltOffset = (this.touchJoltOffset || 0) * Math.max(0.0, 1.0 - dt * 6.0);
    if (flightState.touchdown) {
      const vsi = Math.abs(flightState.vsiFpm || 400);
      const severity = Math.min(1.2, Math.max(0.4, vsi / 450.0));
      this.touchJoltOffset = -0.045 * severity;
    }

    switch (this.mode) {
      case CameraSystem.MODES.COCKPIT: {
        // First-Person Cockpit View
        // 1. Calculate head displacement from G-forces & buffeting
        // On ground, ignore landing gear suspension spring oscillation to prevent instrument jitter
        const gForce = flightState.onGround ? 1.0 : (flightState.gForce || 1.0);
        const targetGOffset = Math.max(-0.02, Math.min(0.02, -(gForce - 1.0) * 0.015));
        this.headGForceOffset.y += (targetGOffset - this.headGForceOffset.y) * Math.min(1.0, dt * 4.0);

        // Stall Buffeting Shake (airborne only, restrained amplitude)
        let buffetX = 0, buffetY = 0;
        if (flightState.isStalled && !flightState.onGround) {
          const t = performance.now() * 0.03;
          const severity = flightState.buffetVibration || 0.5;
          buffetX = (Math.sin(t * 1.7) + Math.cos(t * 3.1)) * 0.005 * severity;
          buffetY = (Math.cos(t * 2.3) + Math.sin(t * 4.2)) * 0.005 * severity;
        }

        const eyeLocal = this.cockpitHeadOffset.clone();
        eyeLocal.y += this.headGForceOffset.y + buffetY + this.touchJoltOffset;
        eyeLocal.x += buffetX;

        // Transform eye point to world space
        const eyeWorld = eyeLocal.applyMatrix4(aircraftMesh.matrixWorld);
        this.camera.position.copy(eyeWorld);

        // Up vector tracks aircraft roll (MUST be set BEFORE lookAt)
        const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(planeQuat);
        this.camera.up.copy(upWorld);

        // Compute forward look target with head rotation
        const forwardLocal = new THREE.Vector3(0, 0, -100);
        // Apply pilot pan/tilt
        forwardLocal.applyAxisAngle(new THREE.Vector3(1, 0, 0), this.lookPitch);
        forwardLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.lookYaw);
        const forwardWorld = forwardLocal.applyQuaternion(planeQuat);

        this.camera.lookAt(eyeWorld.clone().add(forwardWorld));
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
        this.camera.up.set(0, 1, 0);
        this.camera.lookAt(lookTarget);
        break;
      }

      case CameraSystem.MODES.WING: {
        // Passenger Window View (Overlooking Left Wing & Engine)
        const windowLocal = new THREE.Vector3(-1.82, 0.45, 2.2);
        const eyeWorld = windowLocal.applyMatrix4(aircraftMesh.matrixWorld);
        this.camera.position.copy(eyeWorld);

        const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(planeQuat);
        this.camera.up.copy(upWorld);

        // Look outward towards wingtip and engine
        const lookLocal = new THREE.Vector3(-15.0, -1.2, -4.0);
        const lookWorld = lookLocal.applyMatrix4(aircraftMesh.matrixWorld);
        this.camera.lookAt(lookWorld);
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

      case CameraSystem.MODES.GEAR: {
        // Fuselage Lower Oblique Belly Cam looking at Landing Gear & Runway
        const eyeLocal = this.gearCamOffset.clone();
        const eyeWorld = eyeLocal.applyMatrix4(aircraftMesh.matrixWorld);

        const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(planeQuat);
        this.camera.up.copy(upWorld);

        // Dynamic touchdown shock jolt on belly camera
        if (Math.abs(this.touchJoltOffset) > 0.0005) {
          eyeWorld.addScaledVector(upWorld, this.touchJoltOffset * 1.6);
        }

        this.camera.position.copy(eyeWorld);

        const targetWorld = this.gearLookTarget.clone().applyMatrix4(aircraftMesh.matrixWorld);
        this.camera.lookAt(targetWorld);
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
