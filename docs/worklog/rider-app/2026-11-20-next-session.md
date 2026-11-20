# PC 5 다음 세션 이어받기 (2026-11-20 작성)

> 새 세션은 이 파일부터 읽고 "바로 할 일"부터 시작한다.
> 답은 늘 한국어로 한다. 규칙은 `CLAUDE.md`·`docs/operations/pc-split.md` 를 따른다.

## 시작할 때 보낼 말 (복사용)
```
docs/worklog/rider-app/2026-11-20-next-session.md 읽고 이어서 해. 먼저 git pull 하고, 새 요청 있는지 확인한 다음 "바로 할 일" 1번부터.
```

## 내 담당 (PC 5)
- `apps/rider_app`
- `web/rider-backoffice`
- 형제 저장소 `../pmart-rider-simulation`(라이더 시뮬레이터)

## 지켜야 할 것
- `../pmart-backend` 는 읽기만 한다.
- 커밋·푸시는 사용자가 시킬 때만 한다.
- 키·토큰·개인정보는 화면과 로그에 찍지 않는다. `.secrets/rider.env` 값도 출력하지 않는다.
- 브라우저 확인은 PC5 Chrome 에서만 한다. 비밀번호와 실제 계정 정보는 입력하지 않는다.
- `docs/reference/` 와 `contracts.lock` 은 커밋하지 않는다.
- 목 테스트 통과만으로 끝내지 말고, 실서버(LAN)에서 직접 확인한다. 사용자에게 지적받은 적이 있다.

## 지금 상태 (2026-11-20 오전 기준)
- pmart-clients main 은 `de600c34` 이다. 라이더 앱 관련 변경은 모두 main 에 들어가 있다.
  - #268 포장 라벨 번호(4자리)로 인계: 실서버 연결, 남은 횟수 안내, 5번 틀리면 잠김.
  - #128 배차 수락 직후 "배송정보를 불러오지 못했어요"가 뜨던 것: 수락 직후 404 면 잠깐 다시 묻게 고침.
  - 대기 목록 "취소" 버튼 = 이 목록에서 숨기기(화면에서만).
  - 실좌표 핀(#124): 좌표가 없으면 0,0 을 만들지 않는다.
- 라이더 앱 LAN APK 를 `de600c34` 로 빌드해 휴대폰 두 대에 설치했다.
  - 갤럭시 S23(`R3CW20NBFDF`)
  - `R5CT30GWPWM`
- 시뮬레이터 main 은 `effaaff` 이고 푸시까지 했다.
  - 번호로 인계: 막히면(400·409) QR 로 다시 받는다. 틀린 번호는 배송당 한 번만 넣는다. 번호가 겹치지 않게 했다. 확정은 응답의 packageId 로 보낸다.
  - 주소 `?codeRate=0~1` 로 번호 인계 비율을 정한다. 실서버는 조절 바가 없어 이것으로만 바꾼다.
  - "배정 반영 N초" 기록이 있다.
  - typecheck 통과, vitest 154 통과.
- 라이더 백오피스: LAN `https://192.168.0.40:8446` 에 배포했고 실서버에서 확인을 마쳤다.
  - 관제 화면: 주문번호 검색, 라이더 한눈 칸(위치·전달 상황·접속/대기/운행 시간), 지도 경로·전달지 핀
  - 라이더 표기 "이* · 478597"
  - 배송번호 "주문번호-순번"

## 바로 할 일
### 1. 실기기 확인 (#128·#268)
실서버 주문이 하나 있어야 한다. 시뮬레이터는 주문을 만들 수 없으니, 사용자에게 고객앱 주문을 부탁하거나 MFC 시뮬레이터가 넣어 주길 기다린다.
1. 휴대폰 라이더 앱으로 운행을 시작한다.
2. 배차를 수락하자마자 픽업지가 바로 뜨는지 본다(#128). 예전에는 "다시 시도"를 눌러야 떴다.
3. 픽업 화면 "번호로 인계"에 포장 라벨 4자리를 넣어 인계되는지 본다(#268).
   - 틀린 번호를 넣으면 남은 횟수가 나오는지도 본다. 5번 틀리면 잠기니 한두 번만 시험한다.
4. 결과를 PR #268 에 댓글로 남긴다. PR 처리 세션이 요청했다. 댓글은 밖으로 나가는 글이니 올리기 전에 사용자에게 문구를 보여 준다.

연결된 휴대폰 확인:
```bash
/c/Users/ds/AppData/Local/Android/Sdk/platform-tools/adb.exe devices -l
```

### 2. 시뮬레이터로 실서버 번호 인계 확인
주문이 있을 때 한다.
1. 시뮬레이터 개발 서버를 띄운다: `cd ../pmart-rider-simulation && npm run dev`
2. PC5 브라우저에서 `http://localhost:5181/?mode=http&codeRate=1` 을 연다.
   - 운행(쓰기)은 이 PC localhost 에서만 된다. 다른 기기는 읽기만 된다.
3. 기록에서 아래 세 가지를 보고 사용자에게 보고한다.
   - "번호 NNNN 로 인계 허가"
   - 막혔다면 "번호 인계 막힘(…) — QR 로 다시"
   - "배정 반영 N초"
4. 끝나면 운행 종료를 누른다. ON_DUTY 로 남겨 두면 실제 제안이 간다.

### 3. 새 요청 확인
아래 폴더에서 `rider-app`·`rider-backoffice`·`all` 앞으로 온 새 문서를 본다.
- 백엔드 회신: `../pmart-backend/docs/handoff/clients/<rider-app|rider-backoffice|all>/`
- 클라이언트 쪽 요청: `docs/handoff/`

2026-11-20 오전까지 온 것은 처리를 마쳤다.
- `2026-11-20-request-rider-display-names-mfc.md` 는 PC 3(mfc-backoffice·mfc-app) 몫이다. PC 5 는 할 일이 없다.

## 미뤄 둔 일 (사용자가 "나중에 이어서"라고 함)
고객센터·지원센터가 백오피스에서 보고 바로 대응하는 흐름에 빈 곳이 있다.
- 라이더 백오피스: 배송별 도움요청·접수 건을 보여 줘야 한다.
- 통합 백오피스(PC 2): 상담원이 볼 ETA·라이더 위치
- 백엔드: 상담 → 라이더 운영 넘기기, 직원이 먼저 라이더에게 연락하기

사용자가 "대충 하지 말라"고 했다. 화면을 만들기 전에 실제 대응 순서부터 정리해서 보여 준다.

## 정리할 것 (사용자 확인 뒤에)
- 브랜치 `rider-app/handover-code-wip`(`c3e7ba46`, 푸시 안 함): 번호 인계를 만들다 멈춘 것이다. #268 로 대신했으니 사용자 확인 뒤 지워도 된다.
- 브랜치 `rider-app/handover-rider-id`(작업트리 `../pmart-clients-rider`): 내용은 이미 main 에 있다(`currentRiderIdProvider` 가 세션 riderId 를 씀). 지워도 된다.
- 작업트리 `../pmart-clients-rbo`·`../pmart-clients-rn`·`../pmart-clients-wt5`: 예전 PR 용이다. 남은 변경이 없는지 보고 정리한다.

## 자주 쓰는 명령
### 라이더 앱 LAN(실서버) APK 빌드·설치
pull 뒤 공용 UI 문구가 늘었으면 생성 번역이 낡아 빌드가 깨진다(`stateScreenLoadFailed` 없음 등). 그래서 `gen-l10n` 을 먼저 한다.
```bash
cd /d/development/pmart-project/pmart-clients/packages/pmart_ui && /c/development/tools/flutter/bin/flutter.bat gen-l10n
cd ../../apps/rider_app && /c/development/tools/flutter/bin/flutter.bat gen-l10n
set -a && . ../../.secrets/rider.env && set +a
/c/development/tools/flutter/bin/flutter.bat build apk --debug \
  --dart-define=PMART_ENV=local \
  --dart-define=PMART_API_BASE_URL=https://192.168.0.40:8443/api/v1 \
  --dart-define=KAKAO_NATIVE_APP_KEY="$KAKAO_NATIVE_APP_KEY" \
  --dart-define=NAVER_CLIENT_ID="$NAVER_CLIENT_ID"
/c/Users/ds/AppData/Local/Android/Sdk/platform-tools/adb.exe -s <기기번호> install -r build/app/outputs/flutter-apk/app-debug.apk
```
`flutter` 는 PATH 에 없으니 전체 경로로 부른다.

### 라이더 앱 검사
```bash
cd apps/rider_app && /c/development/tools/flutter/bin/flutter.bat analyze && /c/development/tools/flutter/bin/flutter.bat test
```

### 라이더 백오피스
```bash
npm run typecheck -w web/rider-backoffice && npm run lint -w web/rider-backoffice && npm run test -w web/rider-backoffice
```
- 실서버로 띄우기: `vite --mode lan`
- LAN 배포는 PC 1 의 PR 처리(백엔드) 세션에 요청한다(`deploy/lan/lan.sh publish-rider-backoffice`).

### 계약 타입 다시 만들기 (웹)
1. 백엔드 `origin/main` 계약을 `git archive --format=zip` 으로 스크래치에 푼다.
2. 경로만 바꾼 `gen-api.mjs` 임시 사본으로 생성한다.
3. `copy-generated.mjs` 로 옮긴다.
4. `git checkout -- contracts.lock` 으로 되돌린다.

### PR 올리기
1. 포크 `ghfork`(piaa1004)로 푸시한다.
2. PR 을 만든다:
   ```bash
   "/c/Program Files/GitHub CLI/gh.exe" pr create --repo code-and-pick/pmart-clients --head piaa1004:<브랜치>
   ```
3. 커밋 메시지는 스크래치 파일에 써서 `git commit -F` 로 넣는다.

PC 1 이 main 에 직접 넣고 PR 을 닫는 일이 많다. 그래서 커밋 해시가 바뀐다.

### 시뮬레이터 저장소
`../pmart-rider-simulation` 은 main 에 바로 커밋하고 푸시한다. 파일 경로를 하나씩 지정해 `git add` 한다.
```bash
npm run typecheck && npx vitest run
```
