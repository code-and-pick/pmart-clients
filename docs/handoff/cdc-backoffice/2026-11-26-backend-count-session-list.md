보낸 앱: cdc-backoffice
받는 백엔드 영역: platform(cdc — PC 1)
작성: pmart-clients PC 5, 2026-11-26

# 요청: 실사 목록 조회

DC 백오피스 [재고관리 › 실사] 를 cdc-inventory 0.8.0 으로 붙였다(시작·번호로 열기·결정). `/cdcs/{cdcId}/count-sessions` 는 POST 와 `/{sessionId}` GET 뿐이라
**목록이 없다** — 결정 대기(PENDING_APPROVAL) 실사를 관리자가 찾을 길이 없다(현장 PDA 가 시작한 실사도 못 본다).

## CS-1 `GET /cdcs/{cdcId}/count-sessions?state=&page=&size=`(자기 센터 운영자)
- 줄 = `CountSession`(결정 전에는 lines 없이 — 지금 GET 과 같은 규칙), 만든 시각 최신 순, state 거르기(생략 = 전부), 쪽 나눔은 transfers·waves 와 같게(page 0부터·size ≤ 200·hasNext).
- 쓰는 곳: 실사 탭 목록, 대시보드 "결정 대기 실사 n건"(선택).

## 앱이 지금 하는 것
- 시작하면 그 실사로 바로 가고, 다른 실사는 번호로 연다. 화면에 "실사 목록 조회는 서버에 아직 없어요(요청함)" 를 적어 둔다.
