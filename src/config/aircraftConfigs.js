/**
 * @file aircraftConfigs.js
 * @description Centralized, typed, and extensible Aircraft Specification & Aerodynamic Configurations.
 * Allows adding new aircraft types (e.g. B737, B777, F-16, Cessna 172) by defining configuration objects.
 */

/**
 * @typedef {Object} AircraftConfig
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {Object} massProperties - Mass and inertia tensor values
 * @property {Object} aerodynamics - Dimensionless aerodynamic derivatives and geometry
 * @property {Object} propulsion - Engine thrust and spool dynamics
 * @property {Object} landingGear - Gear suspension, steering, and braking parameters
 * @property {Object} cockpit - Cockpit geometry, eye offsets, and instrument placements
 */

export const BOEING_737_800 = {
  id: 'B738',
  name: 'Boeing 737-800',
  description: 'Twin-engine narrow-body jet airliner with CFM56-7B high-bypass turbofans',

  // 1. Mass & Inertial Properties
  massProperties: {
    emptyWeightKg: 41413,
    maxTakeoffWeightKg: 79010,
    currentMassKg: 66000.0,
    // Principal moments of inertia (kg·m^2) for heavy twin-jet airliner
    Ixx: 1650000.0, // Roll inertia (heavy fuel wings)
    Iyy: 3450000.0, // Pitch inertia (long heavy passenger fuselage)
    Izz: 4850000.0  // Yaw inertia
  },

  // 2. Aerodynamic Geometry & Stability Derivatives
  aerodynamics: {
    wingspanM: 35.8,       // Span b (m)
    wingAreaM2: 124.6,     // Area S (m^2)
    meanChordM: 3.99,      // MAC c_bar (m)
    oswaldEfficiency: 0.82,// Span efficiency factor e

    // Lift parameters
    cl0Clean: 0.22,        // Zero-AoA clean lift
    claPerRad: 5.65,       // Lift slope dCL/dAlpha
    alphaStallDeg: 15.5,   // Clean stall angle of attack
    clFlapBoostMax: 0.95,  // Max lift boost at full flaps (40 deg)
    spoilerLiftDump: 0.38, // Lift dump with flight spoilers deployed

    // Drag parameters
    cd0Clean: 0.0185,      // Parasitic zero-lift drag
    gearDrag: 0.024,       // Additional parasitic drag with gear down
    spoilerDrag: 0.075,    // Additional drag with speedbrakes extended
    transonicMachBuffet: 0.78, // Mach threshold for compressibility drag

    // Longitudinal (Pitch) Stability Derivatives
    cm0: -0.02,            // Trim pitching moment at zero AoA
    cma: -0.90,            // Static pitch stability (dCm/dAlpha < 0)
    cmDe: -1.25,           // Elevator pitch control authority (dCm/dDe per rad)
    cmQ: -26.0,            // Heavy transport pitch rate damping derivative

    // Lateral-Directional (Roll & Yaw) Stability Derivatives
    clBeta: -0.14,         // Dihedral effect / sweepback roll (dCl/dBeta)
    clDa: 0.18,            // Aileron roll control authority (dCl/dDa per rad)
    clP: -0.65,            // Roll rate damping derivative
    cnBeta: -0.22,         // Directional weathercock stability (dCn/dBeta < 0 in Three.js Y-up)
    cnDr: -0.12,           // Rudder yaw control authority (dCn/dDr per rad)
    cnR: -0.32,            // Yaw rate damping derivative
    adverseYaw: -0.025,    // Adverse yaw coupling from aileron deflection

    // Flap detents (degrees)
    flapAngles: [0, 1, 5, 15, 20, 30, 40]
  },

  // 3. Propulsion System (Twin Turbofans)
  propulsion: {
    numEngines: 2,
    engineName: 'CFM56-7B26',
    maxStaticThrustPerEngineN: 121000.0, // ~27,000 lbf each
    idleN1Percent: 22.0,
    togaN1Percent: 100.0,
    spoolUpTimeSec: 3.2,                 // Idle to TOGA response lag
    spoolDownTimeSec: 2.4,               // TOGA to Idle lag
    reverseThrustEfficiency: 0.45,       // 45% reverse thrust deflection
    baseFuelFlowKgPerHour: 350.0
  },

  // 4. Landing Gear & Ground Interaction
  landingGear: {
    gearTransitTimeSec: 8.0,
    contacts: [
      {
        id: 'nose',
        name: 'Nose Gear',
        localPos: { x: 0.0, y: -2.1, z: -13.8 },
        restLength: 1.2,
        kSpring: 420000, // N/m
        cDamper: 48000,  // N/(m/s)
        isSteerable: true,
        maxSteeringDeg: 55.0
      },
      {
        id: 'mainLeft',
        name: 'Left Main Gear',
        localPos: { x: -2.86, y: -2.2, z: 1.8 },
        restLength: 1.1,
        kSpring: 650000,
        cDamper: 62000,
        isSteerable: false
      },
      {
        id: 'mainRight',
        name: 'Right Main Gear',
        localPos: { x: 2.86, y: -2.2, z: 1.8 },
        restLength: 1.1,
        kSpring: 650000,
        cDamper: 62000,
        isSteerable: false
      }
    ],
    rollingFriction: 0.02,
    maxBrakingFriction: 0.45,
    tireLateralFriction: 0.75
  },

  // 5. Cockpit Camera & Instrument Layout
  cockpit: {
    captainEyePos: { x: -0.48, y: 1.02, z: -12.02 },
    defaultLookPitchRad: -0.22,
    defaultFov: 68.0,
    exteriorFov: 55.0
  }
};

/**
 * Registry of available aircraft configurations
 */
export const AIRCRAFT_REGISTRY = {
  B738: BOEING_737_800
};

export const DEFAULT_AIRCRAFT_ID = 'B738';
