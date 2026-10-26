# 인천 4단계 브라우저 검증

`/flight3d/` base의 프로덕션 빌드, Intel ADL-N / ANGLE Vulkan, DPR 1에서 실행했습니다.
자동 검사는 `scripts/verify-incheon-flight.mjs`, 원본 결과는 [results.json](results.json)입니다.

- B737 / C172: 물리 120Hz에서 이륙 → 별도 접근 시작 → 플레어 → 접지 → 제동 → 5초 정지.
  각 비행의 시작 이후 위치·속도를 덮어쓰지 않고 검증용 조종 입력만 사용합니다.
  충돌·착륙 사고 없음, 모든 기어 normal. 접지 확인 직후 수직속도는 원본 결과에 기록합니다.
- 유도로: 실제 중심선의 직선 구간에서 8m/s로 시작해 5초 이동, 바퀴 포장 판정과 충돌 확인.
- 자산 요청 차단으로 로딩 실패를 재현하고 이전 공항 유지·Fly 복구·재시도 확인.
  로딩 중 해안 공항 선택 취소가 늦은 완료로 덮어써지지 않는지 확인.
- 실제 로비 버튼의 CDP 클릭, 수동 시나리오만 노출, 정지 로비 및 P-key 데모 진입 차단.
- 기존 건물 윤곽에 검사 probe와 항공기를 배치해 충돌을 재현하고 리셋 후 10초 정상 접지.
- Lukla → coastal → Incheon 전환과 지형·카메라·충돌 소유권, 8개 카메라 모드의 유한 좌표/지면 여유.
- 390 × 844 메뉴의 가로 넘침, 공항 선택 버튼과 145° 접근 브리핑.

[활주로](runway.png) · [접근](approach.png) · [착륙 후 정지](stopped.png) ·
[공항 원경](overview.png) · [로비](lobby.png) · [390px 로비](mobile.png).
스크린샷은 일시정지 상태에서 정지 메뉴만 숨겨 촬영합니다. HUD는 물리 상태를 갱신한 프레임입니다.

런타임/앱 리소스 오류 없음. 브라우저가 자동 요청하는 기존 `/favicon.ico` 오류는 검사 대상에서 제외합니다.
의도적으로 차단한 자산 실패는 결과의 expectedLoadErrors에 별도 기록합니다.
물리 시간 가속 검사이며 전체 비행 FPS·p95·실측 메모리·로딩 끊김 비교는 하지 않았습니다.

자료: © OpenStreetMap contributors · ODbL; Copernicus WorldDEM-30 © DLR / Airbus, EU / ESA.
[공유 출처 고지](../../public/scenery/incheon/LICENSE.md), [범위·근사·재현](../../docs/development/incheon-flight.md).
