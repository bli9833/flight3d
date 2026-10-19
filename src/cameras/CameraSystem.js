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
    GEAR: 5,
    DRONE: 6
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

    // Drone Orbit Camera Parameters (Circumnavigating aircraft from slightly above)
    this.droneOrbitAngle = 1.8;
    this.droneOrbitSpeed = 0.28; // rad/s (~22.4s per full 360° circle)
    this.droneDistance = 38.0;   // Distance in meters (fits entire 39m B737 frame)
    this.droneHeight = 11.5;     // Elevated vantage point looking down (~17° downward pitch)
    this.droneLookOffset = new THREE.Vector3(0, 1.8, 0);
    this.dronePos = new THREE.Vector3();
    this.droneInitialized = false;

    // Tower Camera Location (Inside Control Tower Cab at 66m height)
    this.towerPos = new THREE.Vector3(120, 78, 280);

    // Flyby Camera State
    this.flybyPos = new THREE.Vector3();
    this.flybySet = false;
    this.getTerrainHeight = null;

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
        } else if (this.mode === CameraSystem.MODES.DRONE) {
          this.droneOrbitAngle -= dx * 0.005;
          this.droneHeight = Math.max(4.0, Math.min(32.0, this.droneHeight + dy * 0.05));
        }
      }
    });

    // Mouse wheel zoom for drone distance
    this.domElement.addEventListener('wheel', (e) => {
      if (this.mode === CameraSystem.MODES.DRONE) {
        this.droneDistance = Math.max(16.0, Math.min(85.0, this.droneDistance + e.deltaY * 0.04));
      }
    }, { passive: true });

    // Reset view on double click
    this.domElement.addEventListener('dblclick', () => {
      this.lookYaw = 0;
      this.lookPitch = -0.18;
      this.droneDistance = 38.0;
      this.droneHeight = 11.5;
    });
  }

  resetDroneOrbit(angle = 1.8) {
    this.droneOrbitAngle = angle;
    this.droneInitialized = false;
  }

  setTerrain(terrain) {
    if (typeof terrain === 'function') {
      this.getTerrainHeight = terrain;
    } else if (terrain && typeof terrain.getHeight === 'function') {
      this.getTerrainHeight = (x, z) => terrain.getHeight(x, z);
    }
  }

  queryGroundHeight(x, z) {
    if (this.getTerrainHeight) {
      try {
        const h = this.getTerrainHeight(x, z);
        if (typeof h === 'number' && !Number.isNaN(h)) return h;
      } catch (e) {}
    }
    return 12.0; // RKSS airport elevation default fallback
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
    } else if (this.mode === CameraSystem.MODES.DRONE) {
      const px = aircraftMesh.position.x + Math.sin(this.droneOrbitAngle) * this.droneDistance;
      const py = Math.max(aircraftMesh.position.y + 1.5, aircraftMesh.position.y + this.droneHeight);
      const pz = aircraftMesh.position.z + Math.cos(this.droneOrbitAngle) * this.droneDistance;
      this.dronePos.set(px, py, pz);
      this.droneInitialized = true;
      this.camera.position.copy(this.dronePos);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(aircraftMesh.position.clone().add(this.droneLookOffset));
    } else if (this.mode === CameraSystem.MODES.FLYBY) {
      const planePos = aircraftMesh.position;
      const planeQuat = aircraftMesh.quaternion;
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(planeQuat);
      forward.y = 0;
      if (forward.lengthSq() > 0.0001) forward.normalize();
      else forward.set(1, 0, 0);
      const right = new THREE.Vector3(-forward.z, 0, forward.x);

      const targetX = planePos.x + forward.x * 45.0 + right.x * 9.0;
      const targetZ = planePos.z + forward.z * 45.0 + right.z * 9.0;
      const groundH = this.queryGroundHeight(targetX, targetZ);
      const targetY = Math.max(groundH + 2.4, planePos.y - 0.5);

      this.flybyPos.set(targetX, targetY, targetZ);
      this.camera.position.copy(this.flybyPos);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(planePos.clone().add(new THREE.Vector3(0, 1.2, 0)));
      this.flybySet = true;
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
    this.mode = (this.mode + 1) % 7;
    if (this.mode === CameraSystem.MODES.FLYBY) {
      this.flybySet = false;
    }
    if (this.mode === CameraSystem.MODES.DRONE) {
      this.droneInitialized = false;
    }
    return this.getModeName();
  }

  setMode(m) {
    this.cancelTemporaryView();
    this.mode = m;
    if (this.mode === CameraSystem.MODES.FLYBY) {
      this.flybySet = false;
    }
    if (this.mode === CameraSystem.MODES.DRONE) {
      this.droneInitialized = false;
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
      case CameraSystem.MODES.DRONE: return 'DRONE (ORBIT VIEW)';
      default: return 'CAMERA';
    }
  }

  update(dt, aircraftMesh, flightState = {}, getTerrainHeight = null) {
    if (getTerrainHeight) {
      this.setTerrain(getTerrainHeight);
    }
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
        const onGround = !!(flightState && flightState.onGround);
        const groundSpeed = flightState
          ? (flightState.groundSpeed !== undefined
              ? flightState.groundSpeed
              : (flightState.iasKnots ? flightState.iasKnots * 0.514444 : 0))
          : 0;

        // Aircraft forward vector projected onto horizontal plane
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(planeQuat);
        forward.y = 0;
        if (forward.lengthSq() > 0.0001) {
          forward.normalize();
        } else {
          forward.set(1, 0, 0);
        }
        // Lateral right vector orthogonal to forward on horizontal plane
        const right = new THREE.Vector3(-forward.z, 0, forward.x);

        if (onGround && groundSpeed < 12.0) {
          // Case 1: Landed, parked, or slow taxiing on runway / apron
          // Position camera 45m ahead of nose, 9m to side for an impressive front 3/4 showcase view
          const targetX = planePos.x + forward.x * 45.0 + right.x * 9.0;
          const targetZ = planePos.z + forward.z * 45.0 + right.z * 9.0;
          const groundH = this.queryGroundHeight(targetX, targetZ);
          const targetY = Math.max(groundH + 2.4, planePos.y - 0.5);

          const targetPos = new THREE.Vector3(targetX, targetY, targetZ);
          if (!this.flybySet || this.flybyPos.distanceTo(targetPos) > 75.0) {
            this.flybyPos.copy(targetPos);
            this.flybySet = true;
          } else {
            // Smoothly track in front of aircraft if taxiing or turning
            this.flybyPos.lerp(targetPos, Math.min(1.0, dt * 6.0));
          }
        } else if (onGround) {
          // Case 2: Active takeoff roll or landing rollout at high speed (>= 12 m/s / ~23 kts)
          // Runway-side spotter camera positioned ~120m ahead and 20m off centerline at runway edge
          if (!this.flybySet) {
            const targetX = planePos.x + forward.x * 120.0 + right.x * 20.0;
            const targetZ = planePos.z + forward.z * 120.0 + right.z * 20.0;
            const groundH = this.queryGroundHeight(targetX, targetZ);
            const targetY = groundH + 1.8; // Eye level at runway edge
            this.flybyPos.set(targetX, targetY, targetZ);
            this.flybySet = true;
          }

          // Reset ahead once aircraft rolls past camera by > 140m
          const toPlane = planePos.clone().sub(this.flybyPos);
          if (this.camera.position.distanceTo(planePos) > 180 && forward.dot(toPlane) > 0) {
            this.flybySet = false;
          }
        } else {
          // Case 3: In flight (airborne)
          // Position camera ahead along flight path, safely above ground and sea level
          if (!this.flybySet) {
            const targetX = planePos.x + forward.x * 260.0 + right.x * 28.0;
            const targetZ = planePos.z + forward.z * 260.0 + right.z * 28.0;
            const groundH = this.queryGroundHeight(targetX, targetZ);
            // Height slightly below flight path, but strictly clamped above terrain and water
            const targetY = Math.max(groundH + 4.5, 4.5, planePos.y - 8.0);
            this.flybyPos.set(targetX, targetY, targetZ);
            this.flybySet = true;
          }

          // Reset if aircraft passes far beyond
          if (this.camera.position.distanceTo(planePos) > 600) {
            this.flybySet = false;
          }
        }

        // Final safety clamp: camera Y must NEVER be below terrain height or water surface
        const currentGroundH = this.queryGroundHeight(this.flybyPos.x, this.flybyPos.z);
        if (this.flybyPos.y < currentGroundH + 1.5) {
          this.flybyPos.y = currentGroundH + 1.5;
        }

        this.camera.position.copy(this.flybyPos);
        this.camera.up.set(0, 1, 0);

        // Look at aircraft center with slight vertical offset for good framing
        const lookTarget = planePos.clone().add(new THREE.Vector3(0, 1.2, 0));
        this.camera.lookAt(lookTarget);
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

      case CameraSystem.MODES.DRONE: {
        // Continuous 360° circular drone orbit around aircraft from slightly above
        this.droneOrbitAngle += this.droneOrbitSpeed * dt;

        // Subtle organic drone hovering bob motion
        const hoverBob = Math.sin(this.droneOrbitAngle * 2.2) * 0.55;
        const currentHeight = Math.max(planePos.y + 2.0, planePos.y + this.droneHeight + hoverBob);
        const targetX = planePos.x + Math.sin(this.droneOrbitAngle) * this.droneDistance;
        const targetZ = planePos.z + Math.cos(this.droneOrbitAngle) * this.droneDistance;

        const targetPos = new THREE.Vector3(targetX, currentHeight, targetZ);
        if (!this.droneInitialized) {
          this.dronePos.copy(targetPos);
          this.droneInitialized = true;
        } else {
          // Smooth position interpolation to prevent abrupt jumps
          this.dronePos.lerp(targetPos, Math.min(1.0, dt * 8.5));
        }
        this.camera.position.copy(this.dronePos);

        this.camera.up.set(0, 1, 0);
        const lookTarget = planePos.clone().add(this.droneLookOffset);
        this.camera.lookAt(lookTarget);
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
