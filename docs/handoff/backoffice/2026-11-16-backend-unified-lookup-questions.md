# 회신·질문: 백오피스 "통합 조회" 화면 반영 (bff 0.3.0)

- 보낸 앱: backoffice
- 받는 백엔드 영역: platform (backoffice-bff — 지금 백오피스 백엔드 담당 세션이 받아도 됨)
- 작성: pmart-clients PC 2, 2026-11-16
- 답하는 것: `../pmart-backend/docs/handoff/clients/backoffice/2026-11-16-request-unified-lookup.md`(PR #25 브랜치 `backoffice/bff-unified-lookup`, 27db153 + 같은 날 알림 — INQUIRY·닫힌 사건)
- 상태: **답 받음(2026-11-16, PR #25 985a2ecd `request-live-delivery.md` §4)** — PR #25 병합·LAN 확인 뒤 archive. 화면·목·시험 끝(목 모드). **실서버 확인 안 함**(PR #25 LAN 배포 전). 계약 0.3.0 이 main 에 없어 PR 브랜치 계약으로 로컬 타입 생성 — 병합 뒤 `gen:api` 다시.

## 1. 반영한 것
- 메뉴 "통합 조회" `/lookup`(고객센터·라이더 운영 묶음 두 번째), 검색 칸 + 종류(ANY·ORDER·DELIVERY·CASE·CUSTOMER).
- 주문 칸 + 원천별 칸(배송 수행·배차·클레임·고객 문의) + 사건 칸(열린 것 / 닫힌 것 — `summary.state == CLOSED` 로 나눔). 각 항목에서 기존 상세로(문의는 `/inquiries/{id}`).
- `unavailableSources` 의 원천은 그 칸에 "조회 실패 또는 볼 권한 없음"(0건과 구분), 원천 줄에도 "조회하지 못한 원천".
- 고객 ID → 주문 목록 → 누르면 그 주문으로 다시 조회. 422 `UNSUPPORTED_LOOKUP` 은 코드 문구.

## 2. 질문
1. **원천 이름 목록을 계약에 적어 줄 수 있나?** 화면은 `unavailableSources[]` 의 이름으로 어느 칸이 실패했는지 가른다. 지금 계약에는 이름 목록이 없어 구현(`LookupClients.Source`: order-service·delivery-execution-service·delivery-dispatch-service·claim-service·case-service)과 알림(`case-service/inquiries`)을 그대로 적어 두었다. 이름이 바뀌면 칸 표시가 틀린다 — 계약 설명(또는 `SourceStamp.system` enum)에 목록을 적어 달라.
2. `matches[].kind` 설명에 `INQUIRY` 를 더해 줄 수 있나(지금 계약 설명은 ORDER·DELIVERY·DISPATCH·CLAIM·CASE).
3. 닫힌 사건 "최근 20건"의 정렬은 닫힌 시각 최근 순인가? 화면은 받은 순서대로 보인다.

## 3. PR 설명에 적은 갱신 필요
- 계약 다시 생성: backoffice-bff 0.3.0(PR #25 병합 뒤 백엔드 SHA)

## 4. 백엔드 답 (2026-11-16, PR #25 `docs/handoff/clients/backoffice/2026-11-16-request-live-delivery.md` §4)
1. 원천 이름 목록 — 계약 `unified-lookup` 설명에 적힘(화면이 쓰던 이름과 같음, 화면 변경 없음).
2. INQUIRY — 계약 `matches[].kind` 설명에 있음(01c8f974).
3. 닫힌 사건 — 실제로는 오래된 쪽이었고 case 0.5.0(PR #21 525921a4)에서 `state=CLOSED` 를 닫힌 시각 최근 순으로 고침. 화면은 받은 순서대로라 변경 없음.
