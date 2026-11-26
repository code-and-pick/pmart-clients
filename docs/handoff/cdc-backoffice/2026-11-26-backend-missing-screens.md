보낸 앱: cdc-backoffice
받는 백엔드 영역: platform(cdc — PC 1 `pmart-backend-cdc` 세션), 운송(transport-*) 담당
작성: pmart-clients PC 5, 2026-11-26

# 요청: DC 백오피스에서 API 가 없어 못 띄우는 화면 — 적치·보충·재고 이동 이력·운송

사용자: "Dc백오피스에 Api 없어서 못 띄우는 화면 중에 중요하고, 꼭 있어야 하는 것들이 뭐야" → "백엔드에 요청해야 하는 거 뒤에 하고 바로 할 수 있는 것부터" → "응 보내".
API 가 이미 있는 화면(품질·폐기·리콜, Wave·작업 조작, 화면 번호, 피킹 부족, LPN, 평면도 작업자)은 #578 로 붙였다. 남은 것이 아래다.
계약은 origin/main 2961c144 기준으로 봤다. 입고 예정(ASN)·공급사·발주는 `2026-11-26-backend-purchase-orders.md`(PO-1~4)에 이미 있어 여기서 다시 적지 않는다.

우선순위(사용자에게 보고한 순서): **IB-1·2 적치 > RP-1·2 보충 > LG-1 재고 이동 이력 > TR-1~3 운송**.

---

## 1. 입고관리 — 적치(cdc-inbound)

`cdc-inbound-service.yaml` 0.1.0 은 계약만 있고 서비스가 없다(`services/` 에 cdc-inbound-service 없음). 계약에도 **목록이 없다** — `/putaway-tasks` 는 POST·`/{taskId}` GET 뿐이라
관리자가 "지금 적치 대기·진행 중인 게 무엇인지"를 볼 길이 없다.

### IB-1 cdc-inbound 서비스 구현(1~2단계 범위: 적치·MOV·보충)
- 계약 그대로 — 적치 지시 생성·조회·실행·취소. 게이트웨이 운영자(OPERATOR) 허용.

### IB-2 `GET /cdcs/{cdcId}/putaway-tasks?state=&page=&size=`(자기 센터 운영자) — 새 경로
- 줄 = 지금 `GET /putaway-tasks/{taskId}` 와 같은 모양(SKU·LOT·출발 칸·목표 칸·Q = C + U + K·상태·담당·만든 시각), 최신 순, state 거르기(생략 = 전부),
  쪽 나눔은 transfers·waves 와 같게(page 0부터·size ≤ 200·hasNext). 화면 번호(ADR-0070·0085 — 예 P+6)가 있으면 같이.
- 지금 `/putaway-tasks` 가 센터 밖 경로인데, 다른 직원 조회처럼 `/cdcs/{cdcId}/…` 아래면 센터 권한 검사가 같아진다(판단은 백엔드).
- 쓰는 곳: 입고관리 화면(적치 대기·진행·끝), 대시보드 "적치 대기 n건".

## 2. 보충관리 — 피킹 칸 보충(cdc-inbound replenishment-moves)

### RP-1 보충 MOV 서비스 구현(IB-1 과 같은 서비스)
- 피킹 칸이 최소 이하이면 자동 보충 MOV(계약 그대로). **피킹 부족(shortages)의 원인 칸을 미리 채우는 길**이라 피킹 부족 화면과 짝이다.

### RP-2 `GET /cdcs/{cdcId}/replenishment-moves?state=&trigger=&page=&size=` — 새 경로
- 줄 = `GET /replenishment-moves/{moveId}` 모양(SKU·LOT·출발·도착 칸·수량·산식 입력값(최소·최대·현재)·자동/수동·상태·연결 적치 지시), 최신 순.
- 쓰는 곳: 보충관리 화면, 칸별 재고·평면도에서 "이 칸 보충 중" 표시(선택).
- (선택) 수동 보충 `POST /replenishment-moves` 는 계약에 있다 — 화면에서 부를 수 있게 운영자 허용이면 붙인다.

## 3. 재고 이동 이력(원장) — cdc-inventory

지금은 `stock-snapshot`·`location-stocks` 로 **현재 수량만** 본다. 실사 차이·피킹 부족·품질 보류가 났을 때 "언제·누가·왜 이 칸 수량이 바뀌었나"를 따라갈 수 없다.

### LG-1 `GET /cdcs/{cdcId}/stock-movements?sku=&lot=&locationCode=&from=&to=&kind=&page=&size=` — 새 경로(이름은 백엔드 판단)
- 줄 = 재고 전기(commit) 하나: 시각·종류(입고 적치·피킹 차감·할당/해제·실사 조정·품질 보류/해제/폐기·보충 이동·출발·수령 정정 등 이미 있는 전기 종류 그대로)·
  SKU·LOT·칸(출발/도착)·버킷(현물·예약·보류·운송 중) 증감·뒤 수량·원천 참조(TRF·작업·실사·보류·폐기 ID)·처리자.
- 최신 순, 최소 하나의 거르기(sku 또는 locationCode) 필수로 해도 된다(전체 훑기 막기). 기간 기본 7일이면 충분.
- 쓰는 곳: 재고관리 [재고 현황] 줄 펼침·[칸별 재고]·[재계수 대기]·실사 결과에서 "이력" 보기.

## 4. 출하·운송 — transport-planning·transport-execution

`transport-planning-service.yaml`·`transport-execution-service.yaml` 은 계약만 있고 서비스가 없다. 출발 검증 결과(departures)와 LPN(상차·차량·도크)은 이미 보이지만,
"차가 언제 오는지·무엇을 싣기로 했는지·지금 어디인지"가 없다.

### TR-1 서비스 구현 + DC 출발 쪽 조회 허용
- 운행(trip)·배차(assignment)·운행 지시(instructions)·ETA 를 DC 운영자(CDC_SUPERVISOR)가 자기 센터 출발분만 읽을 수 있게.

### TR-2 `GET /cdcs/{cdcId}/trips?date=&state=&page=&size=` — 새 경로(또는 같은 뜻의 거르기)
- 줄 = 운행 번호·차량·기사(표시 이름 — 개인정보 마스킹 규칙)·도착 예정·도크·실을 TRF·LPN 수·상태(배차·도착·상차 중·출발·운행 중·도착)·ETA.
- 쓰는 곳: 출하·운송 화면(오늘 출발 계획), 대시보드 "다음 출발 n분 뒤"(선택).

### TR-3 (선택) 도크 배정 조회
- 어느 도크에 어느 차가 언제 — 계약에 도크 개념이 없으면 뒤로 미뤄도 된다.

---

## 앱이 지금 하는 것
- 입고관리·보충관리·출하·운송 메뉴는 "화면 준비 중" 상자에 "서버 API 없음"을 적어 둔다(지어낸 숫자 없음).
- 재고 이동 이력은 어디에도 그리지 않는다. 계약이 생기면 목(MSW)으로 먼저 붙이고 시험한다.
- 회신은 `../pmart-backend/docs/handoff/clients/cdc-backoffice/` 에서 읽는다.
