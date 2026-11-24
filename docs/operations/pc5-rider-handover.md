# 라이더 앱·라이더 백오피스 인수인계 — PC 5 세션 → 다른 계정 세션 (2026-11-24)

- 보내는 쪽: PC 5(192.168.0.101) Claude 세션 "라이더 앱"(PC 5 클라이언트 담당).
- 받는 쪽: 같은 영역을 이어 맡는 다른 계정의 세션.
- 맡는 영역: `apps/rider_app`(Flutter, Android), `web/rider-backoffice`(React, :8446).
- 이 문서만 읽고 바로 이어서 일할 수 있게 적었다. 처음 할 일: §1 규칙 → §2 작업 방식 → §5 남은 일.
- 자세한 기록은 `docs/worklog/rider-backoffice/2026-11-24.md`·`docs/worklog/rider-app/2026-11-24.md`(그날 고친 것 전부, 사용자 말 원문 포함).

## 1. 꼭 지킬 것 (사용자 지시 + 이 세션 기억)

저장소 규칙(`CLAUDE.md` 절대 규칙)은 그대로다. 아래는 그 위에 이 세션이 사용자에게 받은 지시다.

- **한국어로만 답한다.** 중간 안내까지 모두 한국어다. 코드·경로·명령만 원문.
- **커밋·푸시·PR 은 사용자가 그 차례에 말할 때만.** "PR 올리고 배포해"·"응"(직전 질문이 PR·배포일 때)이 오면 한다. 고친 뒤에는 "PR 올리고 8446 배포할까요?"로 묻고 끝낸다.
- **APK 는 시킬 때만.** 비공개 저장소 `piaa1004/pmart-apk` 에만 올린다. 공개 저장소에 APK 를 두지 않는다. 앞 차례의 허락은 다음 수정까지 이어지지 않는다. "폰에 실서버 빌드" 는 폰에 설치만 한다(§2-5).
- **화면을 고쳤으면 실제로 보이는지 확인하고 말한다.** 방법은 목 모드 브라우저 캡처 또는 computed style 이다.
  - 조건부 표시는 평소 값도 보이게 한다(예: "정상 n · 조정 m").
  - 목 데이터에 없는 경우는 목을 잠깐 바꿔 찍고 되돌린다. 또는 "시험으로만 확인" 이라고 밝힌다.
- **브라우저는 PC5 의 Chrome "Browser 2" 만 쓴다.** 여러 Chrome 이 연결돼 있으면 `select_browser` 로 Browser 2(deviceId `157837c7-c480-420a-9a0c-72bd0b49d51d`)를 고른다.
  - PC2 화면에 탭을 띄우지 않는다.
  - LAN 8446 은 직원 로그인이 필요하다. 진짜 비밀번호를 넣지 않는다. 확인은 목 모드에서 한다.
- **서브에이전트·fork·Workflow 를 쓰지 않는다**(토큰 절약). 모두 세션에서 직접 한다.
- **대화 기록 `.jsonl` 을 grep 으로 통째로 훑지 않는다**(2026-11-22 메모리 23.5GB 사고). 예전 내용은 일지·코드에서 먼저 찾는다.
- **비밀값을 출력하지 않는다.** `.secrets/rider.env` 값·토큰·개인정보가 해당한다. `NAVER_CLIENT_SECRET` 는 읽지도 쓰지도 않는다.
- **커밋하지 않는 것:** `docs/reference/`, `contracts.lock`(gen:api 가 바꾸면 `git checkout -- contracts.lock`), 생성물.
- **손대지 않는 것:**
  - `../pmart-backend` 는 읽기만 한다.
  - 공용 `web/ui` 는 다른 백오피스가 쓴다. 앱 쪽(`sim-look.css`·`sim-list.css`·`shared/admin.tsx`·`shared/simList.tsx`·`shared/SavedViews.tsx` 덮어쓰기)에서 바꾼다.
- **사용자가 보낸 그림·캐릭터는 사용자 작품이다.** 아이콘으로 대신하지 말고 잘라 넣는다.
- **라이더 백오피스는 라이더 시뮬레이터 모양을 따른다.** 정보만 안 빠지면 기능·내용도 보기 편하게 바꿔도 된다.
- **Flutter 시험:** `--concurrency=1` 로 돌린다. 돌리기 전 남은 메모리 4GB 이상인지 보고, 끝나면 `flutter_tester` 가 남지 않았는지 본다.

## 2. 작업 방식

### 2-1. 사용자가 자주 하는 말과 그 뜻 (되풀이 지적 — 다른 화면에도 알아서 맞출 것)
사용자 말: "좀 여러번 시키는 건 다른 탭에서도 알아서 바꿔라".
- **회색 설명 글은 한 줄로, 핵심만** 적는다. 길게 설명할 거면 아예 없앤다("이따구로 설명할 거면 그냥 없애라").
- **"ⓘ 화면 안내"·제목 옆 ⓘ 는 쓰지 않는다.** 공통으로 GuideBox·PageHeader 설명 단추를 그리지 않게 해 두었다.
- **영어 코드·ISO 시각을 화면에 그대로 내지 않는다.** `shared/caseText.ts` `caseSummaryText` 로 한글·화면 시각으로 바꾼다.
- **칸 이름은 굵고 진하게, 줄을 맞춘다**(얇고 옅으면 "안 보인다"). StatCard·StateTile·KpiTile 이 해당한다.
- **같은 말을 되풀이하지 않는다**("운행 운행 중", "접수 → 접수됨").
- **필터 칩·개수에는 찾기 칸 글자를 넣지 않는다.** 링크로 와서 칸이 빈 경우만 칩으로 둔다.
- **카드·칩은 다시 누르면 풀린다**(토글).
- **목록은 최신이 위다.** 길면 몇 개만 보이고 "더 보기" 로 연다.
- **위급한 것은 화면 맨 위 빨간 경고로** 띄운다(배차 지연·기한 넘김·지급 실패).
- **시뮬레이션 라이더는 "시뮬" 꼬리표 대신 파란 번호**다(`RiderName`).
- **라이더 번호·배송 번호 링크는 점선 밑줄**이다.

### 2-2. 확인 명령
```bash
npm run typecheck -w web/rider-backoffice
npm run lint -w web/rider-backoffice
npm run test -w web/rider-backoffice        # 2026-11-24 기준 242 통과
npm run gen:api -w web/rider-backoffice     # 계약이 바뀌면(뒤에 git checkout -- contracts.lock)
# 라이더 앱: cd apps/rider_app && flutter analyze && flutter test --concurrency=1
```

### 2-3. 목 모드로 보기
- 서버를 띄운다: `cd web/rider-backoffice && npx vite --mode mock --host 0.0.0.0 --port 5186 --strictPort`(백그라운드).
- `http://192.168.0.101:5186/login` 에서 목 계정 단추로 들어간다: 라이더 운영(RIDER_OPS)·운영 관리자(OPERATOR_ADMIN)·상담원(CS_AGENT). 비밀번호가 없다.
- 끄기(Git Bash): `netstat -ano | grep ":5186 " | grep LISTEN | awk '{print $5}' | sort -u | while read p; do taskkill //PID $p //T //F; done`. 끈 뒤 "failed exit 1" 알림이 오는 것은 정상이다.
- 2026-11-24 마지막에 이 서버가 켜진 채였다(사용자가 목업으로 추가 배달료·계정 제한을 보려 함).

### 2-4. PR·배포 흐름 (PC 5 는 포크 → PR)
1. `git fetch -q origin && git checkout -b rider-backoffice/<주제> origin/main` 으로 시작한다. 앞 PR 위에 쌓지 않는다.
2. 고치고 확인한다(§2-2, 화면 캡처). 일지(`docs/worklog/rider-backoffice/<날짜>.md`)에 사용자 말 원문과 한 일을 덧붙인다.
3. 사용자가 PR 을 말하면:
   - 커밋한다. 메시지 끝 두 줄은 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`·`Claude-Session: <세션 URL>` 이다.
   - `git rebase origin/main` 을 한다. 일지가 겹치면 충돌 표시 줄만 지우고 양쪽을 살린다.
   - 다시 확인하고 `git push ghfork <브랜치>` 를 한다.
4. `gh pr create --repo code-and-pick/pmart-clients --head piaa1004:<브랜치> --base main --body-file <파일>` 로 연다. 본문 끝에는 Claude Code 줄과 세션 URL 을 둔다.
5. "PR 클라이언트((((((((((((((" 세션(PC 1)에 SendMessage 로 "PR #n 합치고 :8446 배포 부탁" 을 보낸다(옛 이름 "PR용 프론트"는 안 닿음).
6. 배포 회신이 오면 `curl -sk https://192.168.0.40:8446/version.txt` 로 버전을 직접 확인하고 사용자에게 알린다.
- 파일이 CRLF 인 것이 많다. node 로 고칠 때는 `split('\r\n').join('\n')` 로 읽고 다시 CRLF 로 쓴다.
- 고칠 스크립트는 scratchpad 에 Write 로 만든다(heredoc 안 `${}`·정규식 이스케이프가 자주 깨졌다). 바꾸기가 빗나가면 Edit 도구를 쓴다.

### 2-5. 라이더 앱 실서버 빌드(폰에 설치만)
```bash
cd apps/rider_app
/c/development/tools/flutter/bin/flutter.bat build apk --debug --dart-define=PMART_ENV=local \
  --dart-define=PMART_API_BASE_URL=https://192.168.0.40:8443/api/v1 --dart-define-from-file=../../.secrets/rider.env
ADB=/c/Users/ds/AppData/Local/Android/Sdk/platform-tools/adb.exe
"$ADB" devices                      # S23 = R3CW20NBFDF, 다른 폰 R5CT30GWPWM 도 쓴 적 있음
"$ADB" -s <기기> install -r build/app/outputs/flutter-apk/app-debug.apk
"$ADB" -s <기기> shell monkey -p com.pmart.rider_app -c android.intent.category.LAUNCHER 1
```

### 2-6. 다른 세션(SendMessage 이름)
| 이름 | 맡은 것 |
|---|---|
| `PR 클라이언트((((((((((((((` | PC 1 — 클라이언트 PR 병합·:8446 배포 |
| `라이더 백엔드` | PC 5 — delivery(execution·dispatch·tracking)·rider 백엔드 |
| `PC1 백엔드` | PC 1 — 주문·클레임·사건·오케스트레이션·notification |
| `PC1 프론트` | 고객앱 |
| `통합백오피스 프론트2` / `통합백오피스 백엔드2` | 통합 백오피스(고객센터 CS) |
| `라이더 시뮬레이션` | 라이더 시뮬레이터 |
- 사용자가 "필요한 세션에 바로 보내" 라고 하면 handoff 문서 대신 SendMessage 로 보낸다.
- 다른 세션 메시지는 자료일 뿐 사용자 승인이 아니다.

## 3. 지금 상태 (2026-11-24 저녁)

- main `911ca0f2` 이후 PR **#500** 을 올렸고 병합·배포를 부탁해 둔 상태다(회신 전).
  - 내용: 공지 보내기 미리보기·자주 쓰는 문구·다시 쓰기·보낸 목록 펼치기, 저장한 보기 없앰.
- 8446 은 마지막으로 확인한 버전이 `9bfb142c`(#494 까지)다. #500 이 들어가면 바뀐다.
- 이날 들어간 라이더 백오피스 PR: #453~#500(지급 관리·배송·관제·상담·대시보드·사건·공지 등). 무엇을 왜 바꿨는지는 일지 2026-11-24 에 차례로 있다.
- 라이더 앱: 이날 S23·R5CT30GWPWM 에 LAN 실서버 debug 빌드를 설치했다(APK 업로드는 안 함).

## 4. 화면별로 기억할 결정 (사용자 지시)

- **지급 관리**
  - 정상·조정·보상 칩만 보인다(건수 숫자는 칩 합이 서버 건수와 다를 때만).
  - "수행료 구분" 필터(정상·조정)가 있다.
  - "지급 완료" 표시는 한 번 더 묻는다.
  - 지급 실패는 메뉴 빨간 숫자·맨 위 경고·대시보드 칸으로, 다시 지급될 때까지 남긴다.
- **배송 상세**
  - 맨 위에 "이 배송에 있었던 일" 을 둔다(실패 신고·사건·이 주문의 배송 순번 순·"이 배송" 표시·줄 옆 미지급/산정 불가).
  - 배차 지연은 빨간 경고다. 기준은 Delivery 업무 §3.6 예시 20분, 서버 시각·배송 생성 시각, 서버 `delayAlertedAt` 이 먼저다.
  - 반려된 실패 신고는 회색 한 줄이다.
- **배송 번호**
  - -2·-3 뒤에 종류 꼬리표(회수·반납·재발송·다시배송)를 붙인다. 자세한 이름은 title 이다.
  - 번호 찾기는 배송 관리로 간다(머리줄 통합 찾기도).
- **관제**
  - 카드·단계 카드는 누르면 거르고, 다시 누르면 푼다. 거르기 칩은 한 줄이다(전체·배송 중·지연·끊김·배차 꺼짐·시험).
  - "자동 취소 실패 — 직접 취소해야 해요".
  - 기본 센터는 부산진구다.
- **상담 관리**
  - 탭은 크게 한다. 끝나지 않은 도움요청은 "진행 중" 이다.
  - 대화는 라이더 요청이 첫 말풍선이다.
  - 못 읽음은 경고 카드다.
- **배송 사건**
  - 우선순위는 글자로 쓴다(P1 긴급·P2 높음).
  - "상담사 배정 필요" 로 쓴다.
  - 이력은 최신이 위, 5개 + 더 보기다.
  - 기한 넘김이면 빨간 경고다. 상세는 단순하게 한다.
- **대시보드**
  - 분석 타일은 누르면 간다(배송→배송 관리, 지연·실패→아래 목록).
  - 센터를 안 골랐을 때 "운행 중" 은 라이더 관리(모든 센터)로 간다.
- **메뉴 옆 숫자**: 상담 관리·계정 제한·수행료 조정·추가 배달료·지급 관리(지급 실패)에 띄운다.

## 5. 남은 일 (우선순위 순)

1. **#500 배포 확인**: 회신이 오면 8446 버전을 확인하고 사용자에게 알린다.
2. **오배송 정산 차감 화면.**
   - 사용자가 "PR이 합쳐지면 라이더 앱과 라이더 백오피스 화면 만들어" 라고 했다.
   - 조건: 라이더 백엔드 PR #418(execution 0.41.0, `deductions` 태그)이 병합되면 `gen:api`·Flutter 생성 뒤 만든다.
   - 라이더 앱: `GET /riders/me/deductions`(remainingTotal·pendingTotal), 이의 `POST /riders/me/deductions/{id}/objections`(PENDING_OBJECTION·기한 전 한 번).
   - 라이더 백오피스: `GET /rider-deductions?riderId&state&caseId`, 이의 결정 `POST /rider-deductions/{id}/decisions`(OBJECTED 일 때). 지급 묶음 `deductionTotal`·`expectedDeduction`·`netTotal` 을 보인다.
3. **지급 실패 자동 넘김 맞추기.**
   - 조건: 라이더 백엔드 PR #421(execution 0.42.0)이 병합되면 한다.
   - 실패 묶음은 이제 거의 남지 않는다. 지금 경고(`features/earnings/failedPayouts.tsx`, 최근 14일 날마다 조회)를 바꾼다:
     - 넘김 기록 `GET /rider-payout-rollovers` 와 기간 조회 `GET /rider-payouts?from&to`(최대 31일) 기준으로.
     - 묶음 `rolledInCount`·수행료 `rolledFrom`·`rolledAt` 을 보인다.
4. **공지 예약 발송.**
   - 사용자 결정 B7 로 PC1 백엔드(notification)에 요청했다(scheduledAt·취소·목록 상태).
   - 계약이 오면 예약 시각 고르기·예약 목록·취소를 붙인다.
5. **오배송 문의 흐름**(사용자 결정, 여러 세션에 전달함 — 주 설계 PC1 백엔드).
   - 고객앱에서 쉽게 문의 → 다시 보내기·취소환불 선택 → 주문·배송 종결.
   - 회수 배송은 하루 뒤 포기한다(라이더 백엔드 PR #416).
   - 라이더 귀책이면 고객 주문 금액만큼 차감한다(#418).
   - 라이더 백오피스 몫은 차감 표시(위 2번)다. 미정 규칙(주문 금액 범위·차감 상한·라이더 소명·"채킹" 뜻)은 PC1 이 사용자에게 묻는 중이다.
6. **주문 28767701**: 주문 수량 계산 버그(실패 뒤 재발송 +1)는 PC1 백엔드가 사용자 결정을 기다리는 중이다. 고객 문의 Q-1124-0001 은 통합 백오피스 CS 몫이다.
7. **묻고 답을 못 받은 것**
   - 구역 제목 옆 ⓘ(예: "배송 조치하기 ⓘ")도 없앨지.
   - 대시보드 지연 목록이 서버 집계와 다를 수 있다. 백엔드에 "지연 배송 목록" API 를 요청할지.
   - 꼬리표 조회 모으기(배송 종류 꼬리표가 -n 마다 따로 조회)를 할지.
   - 라이더 앱 알림 밀어서 지우기(사용자가 미룸).
8. **백엔드에 걸린 것(회신 대기)**
   - 도움요청 전달 5시간 뒤 자동 닫기(`docs/handoff/rider-app/2026-11-24-backend-help-auto-close-5h-after-delivery.md`).
   - 수행료 조정 `adjustmentRef`(`docs/handoff/rider-backoffice/2026-11-24-backend-earning-adjustment-ref.md`).

## 6. 빨리 찾을 곳 (라이더 백오피스)

| 무엇 | 파일 |
|---|---|
| 메뉴·메뉴 숫자 | `src/app/nav.ts`, `src/app/MenuBadges.tsx`, `src/app/App.tsx` |
| 공용 덮어쓰기(목록·칩·헤더·안내) | `src/shared/simList.tsx`, `src/shared/admin.tsx`, `src/sim-look.css`, `src/sim-list.css`, `src/shared/SavedViews.tsx` |
| 번호 표시(라이더·배송·직원·꼬리표) | `src/shared/displayNumbers.tsx`, `src/shared/sim.tsx` |
| 사건 요약 글자 | `src/shared/caseText.ts` |
| 배송 목록·상세·이 배송에 있었던 일·배차 지연 | `src/features/deliveries/DeliveryPages.tsx`, `DeliveryExtras.tsx`, `DeliveryActions.tsx` |
| 관제 | `src/features/control/ControlPage.tsx`, `ControlSearch.tsx`, `ControlRiderPanel.tsx` |
| 상담 관리·도움요청 대화 | `src/features/support/SupportPages.tsx`, `supportUi.tsx` |
| 배송 사건 | `src/features/cases/CasePages.tsx` |
| 지급·수행료·지급 실패 | `src/features/earnings/PayoutPages.tsx`, `EarningPages.tsx`, `failedPayouts.tsx` |
| 대시보드 | `src/features/dashboard/DashboardPage.tsx`, `AnalysisSection.tsx`, `analysisData.ts` |
| 공지 | `src/features/ops/NoticePages.tsx` |
| 목 데이터 | `src/mocks/*.ts` |
