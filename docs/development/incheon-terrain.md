# 인천·영종도 2단계: 표면고도와 해안선

이 문서는 2단계의 데이터·보정·당시 측정 기록입니다. 현재 미리보기는
[3단계 도시 표현](incheon-city.md)을 기본 표시하며 원본 지형 데이터는 유지합니다.

[전체 단계](incheon-scenery.md)의 2단계입니다. `/incheon.html`은 주변 지형·해안선을
12 × 12 km로 보여 주고, 기존 도로·건물은 중심 2 × 2 km에만 표시합니다.
영종도 전체나 비행 가능한 인천공항을 구현한 단계는 아닙니다.

## 출처와 좌표 정합

- **표면고도:** [공개 Copernicus GLO-30 COG](https://copernicus-dem-30m.s3.amazonaws.com/readme.html),
  `Copernicus_DSM_COG_10_N37_00_E126_00_DEM`. 원본 SHA-256:
  `f530dd28308ecd6c5ceb0405dc1ffb7113bcafdec30d023de50f16dc433a274f`.
  약 1 arc-second(명목 30 m) 표면고도이며 건물·수목을 포함합니다. 맨땅 표고 DTM이 아닙니다.
- **해안선:** OSM 공식 map API의 작은 8개 구역을 2026-10-26 UTC에 조회한 뒤
  `natural=coastline` way 14개와 구성 node만 고정 원본으로 추출했습니다.
  요청 URL·수신 시각·응답 SHA와 추출 원본 SHA를 보관합니다. 재생성 시 API 재조회가 필요 없습니다.
- **수평 좌표:** 1단계와 같은 북위 37.448°, 동경 126.455° 기준 WGS84 ECEF 접평면,
  +X 동쪽 / +Z 남쪽 / m입니다. pyproj의 cart→topocentric 변환을 사용합니다.
  역변환 up=0 근사 후 재투영한 검사점 오차는 0.01 m 이내입니다. 이는 변환 수치 오차이며
  원본 지도의 위치 정확도를 뜻하지 않습니다.
- **높이:** 원본은 EGM2008 정표고 m입니다. 바다는 표시용 0 m이며 조석과 수심이 없습니다.
  AIP의 공항 표고와 EGM2008의 지역 수직 기준을 측량으로 교정한 것은 아닙니다.
  표고를 타원체고로 잘못 해석하거나 지역 전체에 상수 오프셋을 더하지 않습니다.

### 해안선 처리

방향 있는 coastline과 영역 경계를 polygonize합니다. OSM의 육지 왼쪽 규칙을
남쪽 +Z 좌표의 부호로 변환해 육지 면을 선택합니다. 내부에 끊어진 선이나 잘못된
고리가 있으면 빌드를 실패시키며 임의로 닫지 않습니다. 영역을 14개 면으로 나눈 뒤,
공항 육지·서남쪽 바다·동북쪽 육지의 별도 검사점으로 육지/바다 방향을 확인합니다.
렌더링 마스크는 1024 × 1024, 약 11.72 m/픽셀입니다. 해안선의 실측 정확도가 그 수치라는 뜻은 아닙니다.
[OSM 해안선 모델 설명](https://osmdata.openstreetmap.de/data/coast.html).

## 원본과 모형 보정을 분리

| 파일 | 범위/격자 | 역할 |
| --- | --- | --- |
| `regional-natural.bin` | 12 km / 401 × 401 / 30 m | 주변 원본 DSM의 쌍선형 재표본화 |
| `local-natural.bin` | 2 km / 161 × 161 / 12.5 m | 같은 원본의 중심 상세 격자; 새로운 측정 상세가 추가되지는 않음 |
| `local-graded.bin` | 2 km / 같은 격자 | 공항 포장·건물 부지 보정 모형 |

모든 binary는 북→남 행, 서→동 열, Float32 little-endian입니다.
전체 원본 타일의 표본을 그대로 보존한 것이 아니라 해당 로컬 좌표에 쌍선형으로 재표본화한 값이며,
각 파일의 체크섬·최저/최고값·원본 검사점은 `terrain-metadata.json`에 기록합니다.

보정은 중심 상세 영역에만 적용합니다.

- 제1터미널, 가져온 에이프런 면, 활주로/유도로 주변에 **7 m 참고 부지**를 만듭니다.
  근거는 [대한민국 AIP RKSI AD 2.2](https://aim.koca.go.kr/eaipPub/Package/2026-06-25/html/eAIP/KR-AD-2.RKSI-en-GB.html)의
  공항 표고입니다. 이 판본은 참고 자료이며 현행 운항 자료로 사용하지 않습니다.
  공항 표고는 각 포장점/활주로 문턱의 측량 높이가 아니므로 균일 부지는 명시적인 모형 근사입니다.
  외곽 80 m에서 원본으로 부드럽게 돌아갑니다.
- 다른 건물은 원본 DSM의 지붕 위에 다시 건물을 얹지 않도록, 윤곽 바깥 35 m 이내에서
  다른 건물을 제외한 표면고도의 하위 20% 값을 부지 참고 높이로 씁니다.
  건물 윤곽 15 m 주변까지 평탄하게 하고 다음 15 m에서 혼합합니다.
  이 방식은 수목·고가도로를 완전히 제거하는 DTM 복원 알고리즘이 아닙니다.
- 상세 영역의 가장자리 80 m에서 모든 보정을 0으로 줄입니다. 가장자리 표본은 원본과
  동일하며 영역 밖은 원본 높이를 그대로 사용합니다. 지역의 산지·해안을 공항 높이로 평탄화하지 않습니다.
- 보정 표본 14,462개, 원본 대비 최대 변화 약 31.44 m입니다. 큰 변화에는 터미널의
  DSM 지붕 형상 제거가 포함됩니다. 건물 바닥·기초는 같은 sampler에 맞추고 지붕/층은 수평으로 유지합니다.

`원본 DSM 비교`는 도로·건물을 잠시 숨기고 보정 전 표면만 보여 줍니다. 원본과 보정 격자를
덮어쓰지 않으며, 세 번 전환 후에도 GPU geometry 수가 늘지 않는지 검사합니다.

## 재생성

Python 가상환경에서 다음 고정 버전을 설치합니다. 기본 npm 빌드/테스트에는 Python이나 네트워크가 필요 없습니다.

```sh
python3 -m venv .cache/geospatial-venv
.cache/geospatial-venv/bin/pip install -r scripts/terrain/incheon-requirements.txt
.cache/geospatial-venv/bin/python scripts/terrain/build-incheon.py
node --test tests/incheonData.test.js tests/incheonTerrain.test.js
```

빌더는 원본 DEM을 `.cache/terrain/copernicus-n37-e126.tif`에 캐시하며 없을 때만 공개 URL에서
받아 SHA를 확인합니다. 해안선은 번들된 `coast-source.osm.json.gz`에서 재생성합니다.
중심 배치 `patch.json`의 원점·크기·SHA도 확인/기록합니다. 해안 마스크 PNG는 UV용 이미지로
저장하므로 GeoTIFF의 좌표 태그가 없다는 rasterio 경고가 날 수 있습니다. 공간 범위는 메타데이터에 있습니다.

원본 DEM 타일은 약 29 MB이고 저장소에 넣지 않습니다. 브라우저는 원본 타일/OSM 원본을 요청하지 않고,
가공된 3개 격자·마스크·해안 도형·메타데이터 약 903 KB를 추가로 읽습니다(압축 전 파일 합계).
OSM 자료는 ODbL이며 Copernicus 표고에는 해당 제품 이용허락·출처 고지를 유지합니다.
[데이터별 고지](../../public/scenery/incheon/LICENSE.md).

## 렌더링과 검증

주변 지형은 50 m 메시, 중심은 12.5 m 메시로 그립니다. 주변 메시에서 중심 부분을 빼서
겹침을 피하고 경계 높이는 같은 sampler로 계산합니다. 도로/면도 12.5 m 이하로 세분화한 후
지형을 샘플링합니다. 수면은 배경으로 먼저 그려 낮은 육지와 깊이 버퍼가 충돌하지 않게 합니다.
높이 과장·추가 사진 텍스처·물리 연동은 없습니다.

`headless-chrome` 스킬의 프로젝트 전용 세션에서 검사합니다.

```sh
VITE_BASE_PATH=/flight3d/ npm run build
npm run preview -- --host 127.0.0.1 --port 5191 --base /flight3d/
APP_URL=http://127.0.0.1:5191/flight3d/incheon.html chrome-session --project flight3d node scripts/verify-incheon.mjs
```

[검사 결과](../../review-artifacts/incheon-stage2/results.json),
[주변 지형·해안선](../../review-artifacts/incheon-stage2/regional.png),
[터미널 상세](../../review-artifacts/incheon-stage2/oblique.png),
[원본 DSM](../../review-artifacts/incheon-stage2/natural-dsm.png),
[390px 화면](../../review-artifacts/incheon-stage2/mobile.png).

Intel ADL-N / ANGLE Vulkan에서 최초 독립 장면은 **17 draw calls / 307,180 triangles**입니다.
이는 1단계의 평면 패치보다 큰 12 km 지형을 포함하므로 동일 장면 FPS 비교가 아닙니다.
전체 비행 루프의 프레임 시간·충돌·고가도로 여유고·실제 공항 접지는 아직 검증하지 않았습니다.
