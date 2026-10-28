/** Original scripted exchanges, rendered to bundled radio clips at build-authoring time. */
export const DEPARTURE_RADIO = {
  gate: [
    ['pilot', 'Incheon Apron, Sky 123, ready for pushback.'],
    ['apron', 'Sky 123, pushback approved.'],
    ['crew', 'Tug connected.'],
  ],
  pushback: [
    ['crew', 'Brakes released, commencing pushback.'],
    ['pilot', 'Pushback acknowledged.'],
  ],
  disconnect: [
    ['crew', 'Pushback complete. Set parking brake.'],
    ['pilot', 'Brake set.'],
    ['crew', 'Tug disconnected, all equipment clear.'],
  ],
  taxi: [
    ['pilot', 'Ground, Sky 123, ready to taxi.'],
    ['ground', 'Taxi via the simulation route to runway 15R. Hold short.'],
    ['pilot', 'Taxi to 15R, hold short, Sky 123.'],
  ],
  hold: [
    ['pilot', 'Incheon Tower, Sky 123, holding short runway 15R, ready for departure.'],
    ['tower', 'Hold short, landing traffic.'],
    ['pilot', 'Holding short, Sky 123.'],
  ],
  lineup: [
    ['tower', 'Sky 123, runway 15R, line up and wait.'],
    ['pilot', 'Runway 15R, line up and wait, Sky 123.'],
  ],
  clearance: [
    ['tower', 'Sky 123, runway 15R, cleared for takeoff.'],
    ['pilot', 'Runway 15R, cleared for takeoff, Sky 123.'],
  ],
  takeoff: [['pilot', 'Takeoff clearance confirmed. Accelerating, rotating and climbing.']],
};

export function departureRadioCaption(stage, speakerLabel = speaker => speaker) {
  return (DEPARTURE_RADIO[stage] ?? []).map(([speaker, text]) => `${speakerLabel(speaker)}: ${text}`).join(' ');
}
