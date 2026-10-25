/** Demo choices are separate from manual spawn presets. */
export function demoProfiles(aircraftId = 'B738', airport = 'coastal') {
  if (aircraftId === 'C172') return [
    { id: 'scenic', labelKey: airport === 'lukla' ? 'demo.c172.canyon' : 'demo.c172.city', briefingKey: airport === 'lukla' ? 'demo.c172.canyon.briefing' : 'demo.c172.city.briefing' },
    { id: 'maneuvers', labelKey: 'demo.c172.maneuvers', briefingKey: 'demo.c172.maneuvers.briefing' },
  ];
  return [{ id: 'classic', labelKey: 'demo.b738.classic', briefingKey: 'lobby.briefing.scenario.demo' }];
}

export function resolveDemoProfile(aircraftId, airport, requested) {
  const choices = demoProfiles(aircraftId, airport);
  return choices.find(choice => choice.id === requested) ?? choices[0];
}
