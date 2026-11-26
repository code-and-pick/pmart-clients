보낸 앱: cdc-backoffice
받는 백엔드 영역: platform(cdc — PC 1 `pmart-backend-cdc` 세션 "CCdc 백엔드(PR 필수)"), cdc-outbound·transport-planning·transport-execution·cdc-location·cdc-quality
작성: pmart-clients PC 5, 2026-11-26

# 요청: 화면 번호(TRF·Wave·작업)를 아직 안 주는 응답에 더하기

사용자: "아직 DC 백오피스에서 Wave 간단한 번호로 나오는 게 아니라 식별값 그대로 나와" → "DC 백오피스 보고 이상하거나 보충해야 하는 부분 찾아와" → "응".
cdc-outbound 0.21.0(ADR-0070·0085)부터 TRF·Wave·작업·출발 검증에 화면 번호가 있고, 앱은 그 응답에서는 번호를 쓰도록 고쳤다(#587 + 이번 PR).
아래 응답에는 번호가 없어 시스템 ID(TRF-20261126-0001·WAVE-…·TSK-…)가 그대로 보인다. 현장은 번호만 안다.
계약은 origin/main 기준으로 봤다.

## DN-1 cdc-outbound — 피킹 부족 재할당 `GET /cdcs/{cdcId}/shortages`
- 줄(ShortageFollowup)에 `trfNumber`·`waveNumber`·`taskNumber`(+ `newTaskIds` 짝 `newTaskNumbers`).

## DN-2 cdc-outbound — LPN `GET /cdcs/{cdcId}/lpns`
- 줄에 `trfNumber`·`waveNumber`, 상차됐으면 `departureNumber`.

## DN-3 transport-execution — 운행 `GET /cdcs/{cdcId}/trips`·`GET /trips/{tripId}`
- `stops[].trfNumbers`(trfIds 순)·`transfers[].trfNumber`. (운행 tripId 는 TO-yyyyMMdd-nnn 이라 그대로 둬도 됨)

## DN-4 transport-planning — 운송지시서 `GET /cdcs/{cdcId}/transport-orders`
- `trfNumbers`(trfIds 순)·`stops[].trfNumbers`. (`TransportRequest.trfNumber` 는 이미 있음 — 같은 값)

## DN-5 cdc-quality — 리콜 이미 출발한 물량(recall 상세의 departures 줄)
- 줄에 `trfNumber`·`departureNumber`.

## (선택) DN-6 MFC 이름
- 앱은 center-master `GET /centers?type=MFC` 로 이름을 붙인다(목록을 못 받으면 ID). DC 운영자(CDC_SUPERVISOR)가 이 목록을 읽을 수 있는지만 확인 부탁 — 403 이면 운영자 허용 또는 응답에 `mfcName` 사본.

## 앱이 지금 하는 것
- 위 화면은 번호가 오면 번호를, 없으면 시스템 ID 를 보인다(마우스 올리면 시스템 ID). 지어낸 번호 없음.
- 번호로 찾기는 cdc-outbound 목록 `number` 거르기(waves·transfers)를 쓴다 — 이번 PR 로 TRF·Wave "열기", TRF 목록, 작업관리 Wave 칸, LPN TRF 칸이 번호를 받는다.
- 회신은 `../pmart-backend/docs/handoff/clients/cdc-backoffice/` 에서 읽는다.
