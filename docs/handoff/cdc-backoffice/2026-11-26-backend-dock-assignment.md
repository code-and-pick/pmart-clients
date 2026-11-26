보낸 앱: cdc-backoffice
받는 백엔드 영역: platform(cdc — PC 1 `pmart-backend-cdc` 세션 "CCdc 백엔드(PR 필수)"), transport-planning·cdc-location
작성: pmart-clients PC 5, 2026-11-26

# 요청: DC 백오피스 도크 배정(TR-3) — 운영자 조회·지정 경로

사용자: "도크 배정 … 만들어"(2026-11-26, 출하·운송 화면 #581 뒤).
회신 `clients/cdc-backoffice/2026-11-26-reply-transport.md` 는 TR-3 을 "칠곡 층 도크(R-22) 확정 뒤"로 미뤘다. 화면은 계약 없이 만들지 않으니, 확정되면 바로 붙일 수 있게 필요한 모양을 적는다.
계약은 origin/main a1cfe53f 기준으로 봤다.

## 지금 있는 것
- cdc-location 0.6.0: 위치 종류 `DOCK`(통로 90 — 층 5~7 북쪽 벽, 예 `CDC01-G-6-90-03-0-1`)와 `STAGING`(91·92). 운영자 `GET /cdcs/{cdcId}/locations` 로 도크 칸 목록은 볼 수 있다.
- cdc-location `POST /internal/dock-reservations`·`GET /internal/dock-reservations/{id}` — transport-planning 이 부르는 **내부** 경로뿐(운영자 목록·변경 없음).
- transport-execution `Trip`·transport-planning `TransportOrder` 에 도크 필드가 없다.

## DK-1 도크 예약 목록 — `GET /cdcs/{cdcId}/dock-reservations?date=&dockCode=&state=` (자기 센터 운영자)
- 줄 = 지금 `DockReservation` 모양(dockReservationId·dockCode·tripId·purpose·state·window·version) + 화면에 필요한 사본: 운행 번호(tripId = 운송지시서 번호)·노선·온도대·차량 번호판(없으면 화면이 trips 로 맞춰도 됨).
- 쓰는 곳: 출하·운송 [도크] 탭 — 층별 도크 × 시간 칸(오늘 출고일 상차 창), 운행 펼침에 "도크 G-6-90-03".

## DK-2 운행·지시서에 도크 사본 — `Trip.dockCode`·`TransportOrder.dockCode`(+ `dockReservationId`)
- 계획완료(confirmations) 때 planning 이 도크를 예약했다면 그 결과를 운행·지시서에 남겨 목록에서 바로 보이게.

## DK-3 (선택) 운영자 도크 바꾸기 — `POST /cdcs/{cdcId}/dock-reservations/{id}/changes {dockCode, reason}`(X-Expected-Version)
- 같은 창에 겹치면 409(지금 내부 경로의 CAPACITY_EXCEEDED 와 같은 판정). 출차 뒤는 409.
- 1단계에 자동 배정만 두고 수동 변경은 뒤로 미뤄도 된다 — 판단은 백엔드·사용자.

## 물어볼 것
- R-22(층 도크) 확정 상태 — cdc-location 0.6.0 설명(층 5~7 북쪽 벽)이 확정인지.
- 도크 배정을 planning 계획완료에 넣을지(자동), 아니면 상차 시작 때 따로 할지.

## 앱이 지금 하는 것
- 출하·운송 운행 상세에 "도크 배정은 아직 없어요(층 도크 확정 뒤)"를 적는다. 지어낸 도크 번호를 보이지 않는다.
- 계약이 생기면 목(MSW)으로 먼저 붙이고 시험한다. 회신은 `../pmart-backend/docs/handoff/clients/cdc-backoffice/` 에서 읽는다.
