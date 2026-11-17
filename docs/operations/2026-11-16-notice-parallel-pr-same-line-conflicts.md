# 알림: 같은 메뉴를 나란히 고친 PR 이 늘 충돌한다 — 앱 문서의 긴 한 줄을 나누기 (2026-11-16, PC 1)

- 받는 곳: PC 2(backoffice·hr-backoffice·mfc-backoffice·web-common). 다른 PC 도 같은 규칙.
- 보낸 곳: PC 1 (PR #40~#43 을 합치면서 봄)
- 쌓은 PR 의 squash 충돌(`stacked-pr-squash-conflicts.md`)과는 **다른 원인**이다.

## 1. 무슨 일이 있었나
- #41(재발송 배송)과 #43(오배송 귀책·고객 선택)은 쌓지 않았다. 둘 다 같은 main(`78ffaa0`)에서 따로 땄다.
- #41 을 먼저 합치자 #43 이 충돌했다. 충돌한 곳은 두 군데였다.
  1. `web/backoffice/src/shared/messages.ts` 의 `cases.refName` 목록 끝: #41 은 `reshipmentDeliveryId` 를, #43 은 `fault`·`resolution`·`redeliveryDestinationId` 를 같은 자리에 붙였다.
  2. `docs/apps/backoffice-web.md:93` "지원센터 사건" 설명: **한 줄이 4,485자**다. 두 PR 이 각자 이 줄 안에 기능 설명을 더했다.
- git 은 누가 만든 PR 인지가 아니라 **같은 줄을 서로 다르게 고쳤는지**만 본다. 같은 PC 가 만들었어도 브랜치 두 개가 같은 줄을 고치면 나중에 합치는 쪽이 충돌한다.
- 이번에는 PC 1 이 두 쪽을 모두 남겨 풀었다(#43 브랜치에 합치기 커밋 `cf6f64c` → squash `a5f0aa4`).

## 2. 왜 앞으로도 되풀이되나
- 기능 여러 개를 한 줄에 이어 쓰면, 그 메뉴에 무엇을 더하든 **같은 한 줄**이 바뀐다. 그래서 같은 메뉴를 고치는 PR 두 개는 반드시 충돌한다.
- 지금 600자가 넘는 줄(2026-11-16 기준):

| 파일:줄 | 길이 | 내용 |
|---|---|---|
| `docs/apps/backoffice-web.md:93` | 4,485자 | 지원센터 사건(사건함·다시 열기·넘기기·후속 처리·교대 인계·메모·회수·재발송·귀책…) |
| `docs/apps/backoffice-web.md:92` | 1,036자 | 처리 대기 |
| `docs/apps/backoffice-web.md:88` | 811자 | 메뉴 묶음 |
| `docs/apps/backoffice-web.md:64` | 692자 | 직원 로그인 |
| `docs/apps/mfc-backoffice-web.md:170` | 810자 | 목 핸들러 |

## 3. 부탁
1. **긴 줄을 기능별 하위 항목으로 나눈다.** 한 줄에 기능 하나씩 둔다. 예:
   ```markdown
   - **지원센터 사건** `/cases`·`/cases/:caseId`·`/cases/new-misdelivery`(2026-11-16, …) — case 0.4.0. 탭 …
     - **사건함 목록**(bff 0.5.0 `GET /backoffice/views/case-inbox`): …
     - **다시 열기·넘기기**(case 0.6.0·0.7.0): …
     - **후속 처리**(case 0.8.0): …
     - **교대 인계**(case 0.9.0): …
     - **메모**(case 0.10.0): …
     - **오배송 회수 진행**(case 0.8.1·bff 0.5.1): …
     - **재발송 배송**(case 0.11.2·bff 0.5.2): …
     - **오배송 귀책·고객 선택**(case 0.11.0·order 0.9.0, ADR-0065): …
   ```
   - 내용은 그대로 두고 줄만 나눈다. 새 기능은 **새 하위 항목 한 줄**로 더한다.
   - 이렇게 하면 서로 다른 기능을 더하는 PR 은 다른 줄을 고치므로 대부분 저절로 합쳐진다.
   - 나누는 일은 다른 PR 과 겹치지 않게 **문서만 바꾸는 PR 하나**로 먼저 올린다.
2. **같은 파일·같은 메뉴를 고치는 PR 은 앞 PR 이 합쳐진 뒤 올린다.** `git fetch origin && git rebase origin/main` 한 뒤 올리면 충돌이 남지 않는다. 꼭 나란히 올려야 하면 PR 설명에 "#N 과 같은 자리를 고침"이라고 적는다(#43 처럼).
3. 문구 목록(`messages.ts` 등)은 한 줄에 항목 하나씩 둔다. 목록 끝에 붙이는 충돌은 남지만 한두 줄이라 풀기 쉽다.
