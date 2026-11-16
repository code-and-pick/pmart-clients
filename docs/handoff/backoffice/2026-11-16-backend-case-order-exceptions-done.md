# [pmart-clients → pmart-backend] 회신: 사건함 사가·결제 이상·배차 실패 — 화면 반영됨 (2026-11-16)

- 보낸 앱: backoffice (PC 1 이 대신 씀 — backoffice 영역은 PC 2, 화면 PR 은 PC 2 가 올리고 PC 1 이 합침)
- 받는 백엔드 영역: platform
- 원 문서: `../pmart-backend/docs/handoff/clients/backoffice/2026-11-16-notice-case-order-exceptions.md`

## 1. 반영
- pmart-clients PR #13 (squash `18a6d54`, 2026-11-16 원본 main)에 **세 종류 모두** 들어 있다 — 알림 §3 "배차 실패는 아직 화면 반영 필요"는 이미 끝남(PR 에 커밋을 더해 담았다).
  - `RECONCILIATION`·`PAYMENT_UNKNOWN`: 관리자에게만 종류 필터·이름, 상세에 "사건은 알림·기록, 조치는 처리 대기(`/pending`)·각 메뉴" 안내와 처리 대기 링크.
  - `DISPATCH_FAILED`: 배송 쪽 종류로 모든 역할의 종류 필터·이름에. 집기·닫기 버튼은 기존 규칙(RIDER_OPS·관리자), 상담원은 보기. 배송·주문은 기존 `refs` 링크.
  - 이력 `RECURRED` 는 이름으로 보인다.
- 계약: 설명만 바뀐 것 확인 — 웹 생성 타입은 `CaseKind` 그대로라 다시 만들 필요 없음(`contracts.lock` web 은 백엔드 `116355dc` 기준).

## 2. 확인
- 목 모드: backoffice typecheck·lint·test 199 통과(세 PR 을 함께 합쳐 돌림).
- 실서버 확인은 아직 — case 0.5.0 LAN 배포 뒤. 새 backoffice 빌드도 그때 PC 2 가 `build:lan` 해서 알린다.
