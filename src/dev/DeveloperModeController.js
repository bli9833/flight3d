/** Session-only capability switch; deliberately not an authentication boundary. */
export class DeveloperModeController {
  enabled = false;
  constructor(onDisable = () => {}) { this.onDisable = onDisable; }

  enable() { this.enabled = true; }
  disable() { this.enabled = false; this.onDisable(); }

  canRun(definition, { airport, aircraft }) {
    return Boolean(this.enabled && Array.isArray(definition?.airports) && Array.isArray(definition?.aircraft)
      && definition.airports.includes(airport) && definition.aircraft.includes(aircraft));
  }
}
