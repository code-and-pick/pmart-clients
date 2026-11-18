# [pmart-clients → pmart-backend] 요청: 라이더 백오피스 관제 — 직원이 진행 중 배송의 전달지(정확한 주소·좌표)를 보기 (2026-11-18)

- 보낸 앱: rider-backoffice (PC 5)
- 받는 백엔드 영역: delivery (delivery-execution — `drop-info` 원천 order 사본 O-5, 필요하면 delivery-tracking 관제 응답)
- 근거: 사용자 2026-11-18 "시뮬레이션 서버로 따로 넘어가니까 라이더 백오피스에서 실시간 현황이랑 주문 내역(픽업지, 전달지 등)을 같이 보기가 힘들어" → 관제를 **지도 + 오른쪽 상세 칸**으로 바꿈. 전달지 정도는 사용자가 **"정확한 주소"** 로 고름(동네·대략 위치가 아니라).
- 지금 클라이언트: 상세 칸에 라이더 위치·단계·도착 예정(tracking eta)·픽업지(execution `mfcName`·`mfcPhone` + 센터 주소)·주문번호·품목·요청사항은 보임. **전달지는 "백엔드 대기"** — 직원이 부를 API 가 없어 추측 호출하지 않음.

## 지금 계약에서 막힌 곳
- execution `GET /deliveries/{deliveryId}/drop-info` — **배정 라이더 본인만**(아니면 404). RIDER_OPS·OPERATOR_ADMIN 은 못 부름.
- dispatch `summary.dropAreaLabel`·`dropAreaPoint`(약 1km 격자) — 라이더 제안·배달 목록에만, 직원용 `GET /deliveries/{id}/dispatch` 에는 없음.
- tracking `GET /rider-locations` `ControlRider.activeDeliveries` — `deliveryId`·`stage`·`etaDrop` 만.

## 요청
| # | 필요한 것 | 쓰는 곳 |
|---|---|---|
| 1 | 진행 중 배송(배정 ~ 전달 전, 회수 배송이면 회수지)의 **전달지 정확한 도로명주소·상세주소·좌표**를 직원(RIDER_OPS·OPERATOR_ADMIN, 그 센터 운영자)이 조회 | 관제 상세 칸의 "전달지", 지도에 전달지 핀(픽업 센터 → 전달지) |
| 2 | (가능하면) 관제 목록 `activeDeliveries[]` 에 **전달지 좌표**(정확) | 지도에 고른 라이더뿐 아니라 배송 중 라이더들의 전달지 핀을 한 번에 — 배송마다 따로 부르지 않게 |

## 개인정보 — 정책 결정 부탁
고객 주소는 개인정보라 아래 중 무엇으로 할지 백엔드(정책) 결정이 필요합니다. 클라이언트는 정해진 대로 만듭니다.
- (가) 사유 입력 + 열람 기록: 라이더 원문 보기(`POST /riders/{riderId}/pii-reveals` — 사유 2~200자, audit 기록)처럼 배송마다 "전달지 보기" 사유 → 주소. 좌표(2번)는 사유 없이.
- (나) 진행 중 배송만 사유 없이 보되 열람 기록(누가·언제·어느 배송)은 서버가 남김.
- 어느 쪽이든: 전달 완료·실패 확정·취소 뒤에는 닫힘(drop-info 와 같게), `Cache-Control: no-store`, 로그에 주소 안 남김. **고객 이름·전화·출입 메모(공동현관 비밀번호일 수 있음)는 이번 요청에 넣지 않음** — 관제에는 주소·좌표만 필요.

## 질문
- 1번을 어느 서비스·경로로 할지(예: execution 직원용 `GET /deliveries/{id}/drop-location` 또는 drop-info 의 직원 허용), (가)/(나) 중 무엇인지, 버전.
- 회신은 `../pmart-backend/docs/handoff/clients/rider-backoffice/` 에서 읽겠습니다.
