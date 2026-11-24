# 재고 증감 실시간 반영 — 통합 백오피스 화면 설계와 스트림 계약에 바라는 것

보낸 앱: backoffice (PC 2)
받는 백엔드 영역: mfc(스트림 계약 — mfc-inventory, IV-7), backoffice(bff 중계 여부 — PC 2 백엔드: **중계 안 함**, 2026-11-24 회신)

- 근거: PC 1 사용자 결정(2026-11-24, PC1 백엔드가 전함) "실시간 재고 차감 취소 시 증감이 바로바로 백오피스에 반영 되어야 해" → 방식 B(서버가 밀어 주기, SSE), MFC·통합 전부. **계약이 나오기 전까지 화면 설계만.**

## 통합 백오피스에서 재고가 보이는 곳(2026-11-24 코드 기준)
| 화면 | 지금 | 실시간으로 |
|---|---|---|
| 대시보드 "센터별 품절"(관리자) | mfc-inventory `GET /stock-summaries`(센터별 품절 상품 수), 60초마다 다시 읽음 | 스트림 이벤트를 받으면 **그 센터 줄만** 다시 읽음(2초 모아서 한 번) — 품절 수는 화면이 세지 않는다(서버 집계 그대로) |
| 대시보드 "결품 많은 상품"(bff shortage-by-sku) | 기간 지표(지난 일) | 바꾸지 않음(실시간 재고가 아니라 기간 집계) |
| 상품 조회의 판매 상태(판매 중·일시 품절) | 상품 판매 상태(product) — 재고 수가 아님 | 바꾸지 않음 |
- **SKU 별 재고 목록은 통합 백오피스에 없다**(센터 재고 목록·상세 `GET /mfcs/{mfcId}/stocks`·`/stock` 은 MFC 백오피스 — PC 3). 통합에 "센터 재고 현황" 화면이 필요하면 사용자 결정 뒤 새로 만든다(그때도 아래 같은 방식).

## 화면 동작(계약이 나오면)
1. 연결: 화면이 보일 때만 연다(대시보드 품절 칸이 화면에 있을 때) — **mfc-inventory 스트림 경로 하나**를 연다. 머리줄 센터를 골랐으면 mfcId 를 주고, "전체 센터"면 mfcId 없이(볼 수 있는 모든 센터가 연결 하나로 온다, 센터마다 여러 개 열지 않는다). bff 경로는 쓰지 않는다(2026-11-24 회신).
2. 이벤트: 줄 하나만 고친다 — 이벤트의 `mfcId` 로 그 센터의 요약만 다시 읽음(이벤트 값으로 화면이 품절 수를 계산하지 않는다). 2초 안에 여러 개면 한 번.
3. 끊김: 자동 다시 연결(1초 → 2·4·…·30초), 다시 붙으면 **한 번 다시 읽음**(놓친 이벤트를 덮으려고). 끊긴 동안은 칸에 "실시간 끊김 — 마지막 HH:MM 기준"(0·빈 값으로 보이지 않게).
4. 기존 60초 다시 읽기는 끊겼을 때만(연결돼 있으면 멈춤).
5. 인증: 토큰은 메모리라 EventSource 대신 fetch 스트림(Authorization 헤더) — 게이트웨이가 SSE 를 끊지 않는지(시간 제한·버퍼) 확인 부탁.

## 스트림 계약에 바라는 것
- 경로: mfc-inventory 한 경로, mfcId 를 주면 그 센터·비우면 볼 수 있는 모든 센터(IV-7, 경로·이벤트 이름은 PC 3 계약대로). ~~bff 중계 `GET /views/stock-stream`~~ — 만들지 않기로 함.
- 꼭 있어야 하는 것: `{ eventId, mfcId, occurredAt }`(화면은 이것만으로 동작). 아래 SKU·수량·원인·버전·`Last-Event-ID` 는 있으면 좋은 것.
- 이벤트 본문(최소): `{ eventId, mfcId, sku, availableQty(가용), onHandQty?, reservedQty?, cause(RESERVED·RELEASED·CANCEL_RETURN·SHIPPED·ADJUSTED·RECEIVED 등), occurredAt, version(SKU 재고 버전 — 순서 뒤집힘 무시용) }`.
- `id:` 줄에 eventId, 다시 연결 때 `Last-Event-ID` 로 이어 받기가 되면 좋다(안 되면 화면은 다시 읽기로 덮는다).
- 품절 요약이 바뀌었을 때 따로 알려 주면(예: `kind: SUMMARY_CHANGED`) 화면은 SKU 이벤트를 세지 않고 그것만 본다 — 둘 중 편한 쪽으로.
- 직원 토큰 권한: 본사 관리자 모든 센터, 센터 계정 자기 센터(지금 stock-summaries 와 같게).

## PC1 백엔드 회신(2026-11-24)
- 계약에 바라는 점(eventId·Last-Event-ID, SUMMARY_CHANGED, 전체 센터 한 연결, 권한)을 mfc 백엔드에 전함.
- 게이트웨이 전역 response-timeout 10초가 SSE 를 끊을 수 있어 — 스트림 경로가 정해지면 PC 1 이 그 라우트의 시간 제한을 푼다. heartbeat 5초 안팎 부탁해 둠.
- 통합 "센터 재고 현황" 화면 새로 둘지는 PC 1 사용자에게 올림 — 지금 대상은 대시보드 품절 칸만.

## PC 2 백엔드 회신(2026-11-24, `../pmart-backend/docs/handoff/clients/backoffice/2026-11-24-reply-live-stock-stream.md`, 백엔드 PR #426)
- 사용자 결정 "재고 서버가 전체 스트림을 직접 주는 1번으로" — **backoffice-bff 는 중계하지 않는다**(`/views/stock-stream` 없음).
- mfc-inventory 에 SSE 하나 요청(IV-7, PC 3): mfcId 주면 그 센터, 비우면 볼 수 있는 모든 센터. 권한은 `/stock-summaries` 와 같음. 이벤트 최소 `{eventId, mfcId, occurredAt}`, heartbeat 5초 안팎.
- 화면은 위 설계(보일 때만 연결·그 센터만 다시 읽기·다시 연결 + 한 번 다시 읽기·끊김 표시·60초 다시 읽기는 끊겼을 때만) 그대로, 연결 대상만 mfc-inventory 하나로 바뀜.
- 상태: PC 3 계약 대기 — 경로·이벤트 이름이 나오면 PC 2 백엔드가 알림. 그 전까지 구현하지 않는다.

## 계약·반영(2026-11-24)
- 계약: mfc-inventory 0.46.0 `GET /stock-stream`(백엔드 #428, PC 3) — `mfcId` 반복·선택(비우면 볼 수 있는 모든 센터), 이벤트 `ready`·`stock-changed`·`summary-changed`(가용 0 경계)·`resync`, heartbeat `: hb` 5초, Last-Event-ID 1시간, 최대 연결 30분, 연결 많으면 503 STREAM_LIMIT. LAN 게이트웨이 열림(PC1 백엔드 확인 — 45초 안 끊김).
- 화면(`web/backoffice/src/shared/stockStream.ts`, `app/DashboardWidgets.tsx` SoldOutRow): 보일 때만 연결, 머리줄 센터면 `mfcId`, 전체면 없이 한 연결. `summary-changed`·`resync`·첫 `ready`(이어 받기 아님)·다시 붙은 `ready` 에 `/stock-summaries` 를 2초 모아 한 번 다시 읽는다(품절 수는 화면이 세지 않음). `stock-changed` 는 품절 칸에 쓰지 않는다.
  연결돼 있으면 60초 다시 읽기를 멈추고 칸 제목 옆 "● 실시간", 끊기면 1·2·4…30초 뒤 Last-Event-ID 로 다시 연결하며 "실시간 끊김 — 마지막 HH:MM 기준" + 60초 다시 읽기.
- 공용 `pmartFetch`(web/core)는 Accept 를 JSON 으로 덮어써 서버가 406 을 낼 수 있어, 부른 쪽이 `text/event-stream` 을 달라고 하면 그대로 두게 고침.
- 설계와 다른 점: "그 센터 줄만 다시 읽기" 대신 `/stock-summaries` 한 번(이미 한 요청으로 모든 센터가 오고, 2초 모으기라 부담 같음).
