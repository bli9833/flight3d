/** Demo choices are separate from manual spawn presets. */
export function demoProfiles(aircraftId = 'B738', airport = 'coastal') {
  if (aircraftId === 'C172') {
    if (airport === 'incheon') return [
      { id: 'incheon-tour', labelKey: 'demo.incheon.name', briefingKey: 'demo.incheon.briefing' },
      { id: 'incheon-departure', labelKey: 'departure.name', briefingKey: 'departure.briefing' },
    ];
    if (airport === 'lukla') {
      return [
        { id: 'scenic', labelKey: 'demo.c172.canyon', briefingKey: 'demo.c172.canyon.briefing' },
        { id: 'maneuvers', labelKey: 'demo.c172.maneuvers', briefingKey: 'demo.c172.maneuvers.briefing' },
      ];
    }
    return [
      { id: 'proximity', labelKey: 'demo.c172.proximity', briefingKey: 'demo.c172.proximity.briefing' },
      { id: 'scenic', labelKey: 'demo.c172.city', briefingKey: 'demo.c172.city.briefing' },
      { id: 'maneuvers', labelKey: 'demo.c172.maneuvers', briefingKey: 'demo.c172.maneuvers.briefing' },
    ];
  }
  return [{ id: 'classic', labelKey: 'demo.b738.classic', briefingKey: 'lobby.briefing.scenario.demo' }];
}

export function resolveDemoProfile(aircraftId, airport, requested) {
  const choices = demoProfiles(aircraftId, airport);
  return choices.find(choice => choice.id === requested) ?? choices[0];
}
