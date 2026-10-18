/**
 * International Standard Atmosphere (ISA) Model
 * Calculates temperature, pressure, density, and speed of sound as a function of altitude.
 */
export class Atmosphere {
  static R = 287.05;         // Specific gas constant for dry air (J/(kg·K))
  static GAMMA = 1.4;        // Ratio of specific heats for air
  static G0 = 9.80665;       // Standard gravity (m/s^2)
  static T0 = 288.15;        // Sea level standard temperature (K) (15°C)
  static P0 = 101325.0;      // Sea level standard pressure (Pa)
  static RHO0 = 1.225;       // Sea level standard density (kg/m^3)
  static LAPSE_RATE = 0.0065;// Temperature lapse rate in troposphere (K/m)
  static TROPOPAUSE_ALT = 11000.0; // Altitude of tropopause (m)

  /**
   * Get atmospheric conditions at altitude (meters above sea level)
   * @param {number} altitudeMeters 
   * @returns {{ temperature: number, pressure: number, density: number, speedOfSound: number, densityRatio: number }}
   */
  static getConditions(altitudeMeters) {
    const h = Math.max(-500, Math.min(altitudeMeters, 25000));
    let temperature, pressure;

    if (h <= Atmosphere.TROPOPAUSE_ALT) {
      // Troposphere
      temperature = Atmosphere.T0 - Atmosphere.LAPSE_RATE * h;
      pressure = Atmosphere.P0 * Math.pow(temperature / Atmosphere.T0, Atmosphere.G0 / (Atmosphere.LAPSE_RATE * Atmosphere.R));
    } else {
      // Lower Stratosphere (isothermal)
      const tTropo = Atmosphere.T0 - Atmosphere.LAPSE_RATE * Atmosphere.TROPOPAUSE_ALT;
      const pTropo = Atmosphere.P0 * Math.pow(tTropo / Atmosphere.T0, Atmosphere.G0 / (Atmosphere.LAPSE_RATE * Atmosphere.R));
      temperature = tTropo;
      const dh = h - Atmosphere.TROPOPAUSE_ALT;
      pressure = pTropo * Math.exp(-Atmosphere.G0 * dh / (Atmosphere.R * tTropo));
    }

    const density = pressure / (Atmosphere.R * temperature);
    const speedOfSound = Math.sqrt(Atmosphere.GAMMA * Atmosphere.R * temperature);
    const densityRatio = density / Atmosphere.RHO0;

    return {
      temperature,
      pressure,
      density,
      speedOfSound,
      densityRatio
    };
  }

  /**
   * Convert True Airspeed (TAS) to Indicated Airspeed (IAS) in m/s
   */
  static tasToIas(tas, densityRatio) {
    return tas * Math.sqrt(Math.max(0.001, densityRatio));
  }

  /**
   * Convert Indicated Airspeed (IAS) to True Airspeed (TAS) in m/s
   */
  static iasToTas(ias, densityRatio) {
    return ias / Math.sqrt(Math.max(0.001, densityRatio));
  }

  /**
   * Convert m/s to Knots (nautical miles per hour)
   */
  static msToKnots(ms) {
    return ms * 1.94384;
  }

  /**
   * Convert Knots to m/s
   */
  static knotsToMs(knots) {
    return knots / 1.94384;
  }

  /**
   * Convert meters to feet
   */
  static metersToFeet(m) {
    return m * 3.28084;
  }

  /**
   * Convert feet to meters
   */
  static feetToMeters(ft) {
    return ft / 3.28084;
  }
}
