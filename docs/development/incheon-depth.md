# 인천 주변 지면의 거리·높이 단서

비행 장면의 12km 지역 지면에 `IncheonGround.js`의 고도·경사 기반 색상과
128m 반복 상세 텍스처를 적용합니다. 430m/95m의 완만한 색 변화는 넓은 평지의
단색을 깨고, 14–65m 사이의 점진적인 녹색 변화는 원본 DSM의 능선을 드러냅니다.
16m/4m/1m 크기의 불규칙한 지면 무늬는 저공에서 표면의 상대적 움직임을 읽는 단서입니다.
텍스처는 주기적인 noise lattice와 mipmap을 사용해 타일 경계와 원거리 반짝임을 줄입니다.

색과 무늬는 **표현용 모형**이며 실제 식생·토지 이용 분류나 항공사진이 아닙니다.
DSM 높이, 해안 마스크, 공항 포장, 접지·충돌, 기존 2km 도시 텍스처와 독립 미리보기는
유지합니다. 새로운 시설이나 산지를 추가하지 않습니다. 지형 메시를 그대로 사용하므로
추가 draw call/삼각형은 없고, 512px 텍스처와 꼭짓점 색 버퍼만 추가됩니다.
전체 프레임 시간이나 고도감의 주관적 개선 정도를 이 수치로 보장하지 않습니다.

## 검증 재현

`headless-chrome` 스킬의 공용 프로젝트 세션에서 실행합니다.

```sh
npm run dev -- --host 127.0.0.1 --port 5198 --strictPort
chrome-headless --project flight3d start
chrome-session --project flight3d node scripts/verify-incheon-depth.mjs
```

`APP_URL`, `ARTIFACT_DIR`, `CAPTURE_LABEL`로 목적지와 결과 이름을 바꿀 수 있습니다.
활주로·접근·순항·지역 조망의 동일한 시점에서 캡처하고 브라우저 오류 및 렌더링
통계를 기록합니다. 정지 화면 비교이며 실제 시간 FPS 측정이나 비행 시퀀스 검증이 아닙니다.

[변경 전 접근](../../review-artifacts/incheon-depth/before-approach.png) ·
[변경 후 접근](../../review-artifacts/incheon-depth/after-approach.png) ·
[변경 전 지역 조망](../../review-artifacts/incheon-depth/before-regional.png) ·
[변경 후 지역 조망](../../review-artifacts/incheon-depth/after-regional.png) ·
[변경 전 통계](../../review-artifacts/incheon-depth/before.json) ·
[변경 후 통계](../../review-artifacts/incheon-depth/after.json)
