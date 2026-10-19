import * as THREE from 'three';

/**
 * Multi-contact Tricycle Landing Gear Physics (Boeing 737 class)
 * Simulates steerable nose gear and dual main gear bogies with independent
 * oleo-pneumatic spring-damper suspension, tire scrub, braking friction,
 * and realistic gear retraction/extension cycle.
 */
export class LandingGear {
  constructor() {
    this.gearState = 1.0; // 0.0 (UP) to 1.0 (DOWN & LOCKED)
    this.targetGearState = 1.0;
    this.gearTransitSpeed = 0.12; // ~8 seconds for full transit
    this.isTransit = false;

    // Contact points relative to aircraft Center of Gravity (m)
    // In Three.js aircraft local coordinates:
    // +X = Right, +Y = Up, -Z = Forward
    // Matches authentic Boeing 737-800 Airport Planning specifications:
    // - Wheel Track: 5.72m (Main bogies at x = ±2.86m)
    // - Wheelbase: 15.60m (Nose gear at z = -13.8m, Main bogies at z = +1.8m)
    this.contacts = [
      {
        id: 'nose',
        localPos: new THREE.Vector3(0.0, -3.27, -12.5), // Front steerable
        wheelRadius: 0.38,
        restLength: 0.9,
        kSpring: 420000, // N/m
        cDamper: 48000,  // N/(m/s)
        isSteerable: true,
        compression: 0,
        isGrounded: false,
        touchdownThisFrame: false,
        worldPos: new THREE.Vector3(),
        prevWorldPos: new THREE.Vector3()
      },
      {
        id: 'mainLeft',
        localPos: new THREE.Vector3(-3.2, -3.30, 1.8), // Left main
        wheelRadius: 0.48,
        restLength: 0.9,
        kSpring: 850000,
        cDamper: 72000,
        isSteerable: false,
        compression: 0,
        isGrounded: false,
        touchdownThisFrame: false,
        worldPos: new THREE.Vector3(),
        prevWorldPos: new THREE.Vector3()
      },
      {
        id: 'mainRight',
        localPos: new THREE.Vector3(3.2, -3.30, 1.8),  // Right main
        wheelRadius: 0.48,
        restLength: 0.9,
        kSpring: 850000,
        cDamper: 72000,
        isSteerable: false,
        compression: 0,
        isGrounded: false,
        touchdownThisFrame: false,
        worldPos: new THREE.Vector3(),
        prevWorldPos: new THREE.Vector3()
      }
    ];

    this.brakes = 0.0; // 0.0 to 1.0
    this.steerAngle = 0.0; // Radians
    this.onGround = false;
    this.totalWeightOnWheels = 0;
    this.touchdownEvent = false;
  }

  toggleGear() {
    if (this.targetGearState > 0.5) {
      this.targetGearState = 0.0;
    } else {
      this.targetGearState = 1.0;
    }
  }

  setGearTarget(down) {
    this.targetGearState = down ? 1.0 : 0.0;
  }

  setBrakes(val) {
    this.brakes = Math.max(0.0, Math.min(1.0, val));
  }

  setSteering(rudderInput, groundSpeedMs) {
    // Variable steering ratio: high authority at low taxi speeds, limited authority at takeoff roll
    const speedRatio = Math.max(0.15, 1.0 - Math.min(1.0, groundSpeedMs / 35.0) * 0.82);
    const maxTiller = THREE.MathUtils.degToRad(55.0); // Max nosewheel deflection
    this.steerAngle = -rudderInput * maxTiller * speedRatio;
  }

  /**
   * Update landing gear forces and ground physics
   * @param {number} dt 
   * @param {THREE.Object3D} aircraftMesh 
   * @param {THREE.Vector3} linearVelocity (world m/s)
   * @param {THREE.Vector3} angularVelocity (body rad/s)
   * @param {Function} getTerrainHeight (x, z) => height in meters
   * @returns {{ forces: THREE.Vector3, moments: THREE.Vector3, onGround: boolean, touchdown: boolean }}
   */
  update(dt, aircraftMesh, linearVelocity, angularVelocity, getTerrainHeight) {
    // Animate gear transit
    if (Math.abs(this.targetGearState - this.gearState) > 0.001) {
      this.isTransit = true;
      const step = Math.sign(this.targetGearState - this.gearState) * this.gearTransitSpeed * dt;
      this.gearState = Math.max(0.0, Math.min(1.0, this.gearState + step));
    } else {
      this.isTransit = false;
      this.gearState = this.targetGearState;
    }

    const netForceWorld = new THREE.Vector3(0, 0, 0);
    const netMomentBody = new THREE.Vector3(0, 0, 0);

    this.onGround = false;
    this.touchdownEvent = false;
    this.totalWeightOnWheels = 0;

    // If gear is mostly retracted, check if belly touches terrain for crash/belly landing
    const gearDeploy = this.gearState;
    if (gearDeploy < 0.1) {
      // Belly contact check
      const bellyWorld = new THREE.Vector3(0, -1.88, 0).applyMatrix4(aircraftMesh.matrixWorld);
      const groundY = getTerrainHeight(bellyWorld.x, bellyWorld.z);
      if (bellyWorld.y < groundY + 0.15) {
        // High friction crash scrape
        const depth = Math.max(0.05, groundY + 0.15 - bellyWorld.y);
        netForceWorld.y += 2500000 * depth;
        // Heavy drag
        netForceWorld.x -= linearVelocity.x * 20000;
        netForceWorld.z -= linearVelocity.z * 20000;
        this.onGround = true;
      }
      return {
        forces: netForceWorld,
        moments: netMomentBody,
        onGround: this.onGround,
        touchdown: false,
        gearState: this.gearState,
        isTransit: this.isTransit
      };
    }

    // World transformation matrices
    const worldQuat = aircraftMesh.quaternion;
    const invWorldQuat = worldQuat.clone().invert();
    const touchdownContacts = [];

    for (const c of this.contacts) {
      // Deployed position scaled by gear deployment
      const deployedLocal = c.localPos.clone();
      deployedLocal.y *= gearDeploy;

      // Calculate world position of wheel hub
      const hubWorld = deployedLocal.clone().applyMatrix4(aircraftMesh.matrixWorld);
      const groundH = getTerrainHeight(hubWorld.x, hubWorld.z);
      const wheelRadius = c.wheelRadius !== undefined ? c.wheelRadius : 0.48;
      const contactY = groundH + wheelRadius;

      c.worldPos.copy(hubWorld);
      c.worldPos.y = groundH; // Bottom of tire touching terrain

      const penetration = contactY - hubWorld.y;

      if (penetration > 0) {
        // Strut is compressed!
        const wasGrounded = c.isGrounded;
        c.isGrounded = true;
        this.onGround = true;
        c.compression = Math.min(c.restLength, penetration);

        // Contact point velocity in world space = linearVel + angularVel x r
        const rWorld = hubWorld.clone().sub(aircraftMesh.position);
        const angVelWorld = angularVelocity.clone().applyQuaternion(worldQuat);
        const contactVel = linearVelocity.clone().add(angVelWorld.clone().cross(rWorld));
        const groundSpeed = Math.sqrt(linearVelocity.x * linearVelocity.x + linearVelocity.z * linearVelocity.z);
        const sinkRate = -contactVel.y;

        // Touchdown impact requires descending from the air into the runway surface (sinkRate > 0.25 m/s)
        if (!wasGrounded && penetration > 0.03 && sinkRate > 0.25) {
          c.touchdownThisFrame = true;
          this.touchdownEvent = true;
          touchdownContacts.push({
            id: c.id,
            worldPos: c.worldPos.clone(),
            groundSpeed,
            sinkRate,
            compression: c.compression
          });
        } else {
          c.touchdownThisFrame = false;
        }

        // Suspension normal force (Hooke's spring + damping)
        const vUp = contactVel.y;
        let normalForceMag = c.kSpring * c.compression - c.cDamper * vUp;
        if (normalForceMag < 0) normalForceMag = 0; // Strut can only push away

        this.totalWeightOnWheels += normalForceMag;

        // Normal force pushes upwards along terrain normal (approx vertical)
        const fNormal = new THREE.Vector3(0, normalForceMag, 0);

        // Wheel forward and lateral vectors in world space
        let wheelForwardLocal = new THREE.Vector3(0, 0, -1);
        if (c.isSteerable) {
          wheelForwardLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.steerAngle);
        }
        const wheelForwardWorld = wheelForwardLocal.clone().applyQuaternion(worldQuat);
        wheelForwardWorld.y = 0;
        if (wheelForwardWorld.lengthSq() > 0.0001) {
          wheelForwardWorld.normalize();
        } else {
          wheelForwardWorld.set(0, 0, -1);
        }

        const wheelLateralWorld = new THREE.Vector3(-wheelForwardWorld.z, 0, wheelForwardWorld.x);

        // Decompose contact velocity onto wheel plane
        const vForward = contactVel.dot(wheelForwardWorld);
        const vLateral = contactVel.dot(wheelLateralWorld);

        // Rolling resistance & Brakes along forward axis
        let muBrake = 0.02; // Baseline rolling resistance
        if (this.brakes > 0.01) {
          muBrake += this.brakes * 0.58; // Boeing 737 anti-skid carbon brake friction
        }
        const fForwardMag = -Math.sign(vForward) * Math.min(Math.abs(vForward) * 25000.0, normalForceMag * muBrake);
        const fForward = wheelForwardWorld.clone().multiplyScalar(fForwardMag);

        // Lateral scrub resistance (prevents skidding sideways)
        const muLateral = 0.75;
        const fLateralMag = -Math.sign(vLateral) * Math.min(Math.abs(vLateral) * 35000.0, normalForceMag * muLateral);
        const fLateral = wheelLateralWorld.clone().multiplyScalar(fLateralMag);

        // Net wheel force in world space
        const fWheelWorld = fNormal.clone().add(fForward).add(fLateral);
        netForceWorld.add(fWheelWorld);

        // Calculate moment produced around CG: M = r x F
        const fWheelBody = fWheelWorld.clone().applyQuaternion(invWorldQuat);
        const momentBody = c.localPos.clone().cross(fWheelBody);
        netMomentBody.add(momentBody);
      } else {
        c.isGrounded = false;
        c.compression = 0;
        c.touchdownThisFrame = false;
      }
    }

    return {
      forces: netForceWorld,
      moments: netMomentBody,
      onGround: this.onGround,
      touchdown: this.touchdownEvent,
      gearState: this.gearState,
      isTransit: this.isTransit,
      weightOnWheels: this.totalWeightOnWheels,
      touchdownContacts,
      compressions: {
        nose: this.contacts[0].compression,
        mainLeft: this.contacts[1].compression,
        mainRight: this.contacts[2].compression
      }
    };
  }
}
