# 쌓은 PR 을 squash 로 합칠 때 생기는 충돌 — 내역과 해결 (2026-11-16)

- 대상: 포크 → PR 로 보내는 PC(`pc-split.md` "다른 PC 가 원본에 넣는 방법")와 합치는 PC 1
- 사례: mfc_app PR #5~#10 (YOO196, 2026-11-15 올림, 2026-11-16 PC 1 이 합침)

## 1. 무슨 일이 있었나
- PR #5~#10 은 **앞 PR 브랜치 위에 다음 브랜치를 쌓았고, 여섯 개 모두 base 가 `main`** 이었다. 그래서 #10 에는 #5~#9 의 커밋이 다 들어 있다.
- 원본은 PR 을 **squash** 로 합친다(#1~#4 와 같음). squash 는 PR 의 커밋들을 **새 커밋 하나**로 만들어 main 에 넣는다. 원래 커밋(`c483f0c` 등)은 main 에 들어가지 않는다.
- 그 결과 #5 를 합친 뒤 #6 을 보면, #6 안의 #5 원래 커밋과 main 의 #5 squash 커밋이 git 에게는 **다른 커밋**이다. 두 쪽이 같은 파일을 새로 만들거나 고친 것으로 보여 충돌이 난다. 같은 일이 #6 → #7 → … 로 매번 되풀이된다.
- 시작할 때 GitHub 표시: #10 만 `MERGEABLE`, #5~#9 는 `UNKNOWN`(아직 계산 안 됨). #5 를 합친 직후 #6 은 `CONFLICTING`.

## 2. 충돌 파일 (PR 원래 상태 vs 앞 PR 을 squash 한 직후 main)

| PR | 그때 main | 충돌 파일 | 종류 |
|---|---|---|---|
| #6 피킹 위치 스캔 화면 | `578b140` (#5) | `docs/worklog/mfc-app/2026-11-16.md` | add/add |
| #7 위치 줄 선반 칸 색 블록 | `42c3903` (#6) | `apps/mfc_app/lib/shared/location_guide.dart`, `apps/mfc_app/tool/screenshots.dart`, 일지 | add/add |
| #8 역할별 홈·관리 메뉴 | `c591125` (#7) | `apps/mfc_app/lib/l10n/app_ko.arb`(내용), `tool/screenshots.dart`, 일지 | 내용·add/add |
| #9 이동 지시 만들기·취소 | `4097737` (#8) | `lib/features/work/presentation/work_screens.dart`, `lib/l10n/app_ko.arb`, `lib/router.dart`, `docs/apps/mfc-app.md`, 일지 | 내용·add/add |
| #10 실사 시작·차이 승인 | `fea8240` (#9) | #9 와 같은 다섯 파일 | 내용·add/add |

- #5 는 충돌 없이 합쳐졌다(`578b140`).
- 모든 충돌은 **앞 PR 이 이미 바꾼 줄**에서 났다. 뒤 PR 은 앞 PR 을 포함하므로 뒤 PR 쪽 파일이 "앞 PR + 이번 변경"으로 맞는 내용이다.
- 매일 하나인 일지 파일은 PR 마다 아래에 절을 더하므로 **모든 PR 에서** 충돌했다.

## 3. 어떻게 풀었나 (PC 1)
1. **먼저 한꺼번에 시험**: 지금 main(`f50025c`) 위에 #10 을 합친 로컬 브랜치를 만들었다. 충돌 없이 합쳐졌다. PR 이 쓰는 클라이언트 4개(product·mfc-capacity 0.14.0·mfc-inbound 0.9.0·mfc-inventory 0.16.0)를 백엔드 `082f3d1` 계약으로 다시 만들었다. 그 위에서 `flutter analyze` 문제 없음, `flutter test` 165개 통과(목 모드).
2. **#5 squash**.
3. **#6~#10 을 차례로 처리**(PR 이 "maintainer 수정 허용"이라 PC 1 이 PR 브랜치에 올릴 수 있었다):
   - PR 브랜치에 `origin/main` 을 합친다(merge 커밋).
   - 충돌 파일은 **PR 쪽 파일을 그대로 택한다**(`git checkout <PR 머리> -- <파일>`). 단 충돌 파일이 `apps/mfc_app/`·mfc-app 일지·`docs/apps/mfc-app.md` 밖이면 멈추게 했다(그런 경우는 없었다).
   - **확인**: 합친 결과의 `apps/`·`docs/apps/mfc-app.md`·mfc-app 일지가 PR 원래 머리와 한 글자도 다르지 않아야 올린다.
   - 포크의 PR 브랜치에 올린다 → GitHub 가 `MERGEABLE` 로 바뀐 것을 보고 squash.
   - PR 브랜치에 생긴 합치기 커밋: #6 `8306b9e`, #7 `d59eaee`, #8 `b488fdd`, #9 `ba9b93d`, #10 `4bc7852`.
4. **끝 확인**: 합친 원본 main(`7bb6c70`)과 1번 시험 브랜치의 내용이 같다(`git diff` 빈 결과). 1번 시험이 곧 최종 main 시험이다.
5. 다시 만든 클라이언트를 `contracts.lock`(dart)에 적고 일지와 같이 커밋했다(`098e349`).

## 4. 앞으로 — PR 을 보내는 PC
충돌을 안 만드는 순서대로 적었다.

1. **PR 은 한 번에 하나.** 앞 PR 이 합쳐진 뒤 `git fetch origin && git rebase origin/main` 하고 다음 PR 을 올린다.
2. 꼭 쌓아야 하면, 앞 PR 이 squash 된 뒤 다음 브랜치를 **앞 PR 커밋을 빼고** 옮긴 다음 강제 push 한다.
   ```bash
   git fetch origin
   # <앞 브랜치 머리> = 앞 PR 의 마지막 커밋(squash 전 원래 것)
   git rebase --onto origin/main <앞 브랜치 머리> <다음 브랜치>
   git push --force-with-lease fork <다음 브랜치>
   ```
   이렇게 하면 다음 PR 에는 자기 변경만 남는다. 충돌이 남으면 그 PR 의 진짜 충돌이다.
3. 쌓은 PR 설명 첫 줄에 "PR #N 위에 쌓음 — #N 다음에 합칠 것"을 적는다(이번처럼). **묶음이 다 준비되면 PC 1 은 맨 위 PR 하나만 합치고 아래 PR 은 닫는다(§5).** 그러니 맨 위 PR 설명에 묶음 전체의 요약(PR 번호·한 일·시험)을 적어 둔다. 아래 PR 만 먼저 합쳐야 하면(위쪽이 백엔드 배포 대기 등) 설명에 그렇게 적는다.
4. 일지: 같은 날 여러 PR 이 같은 일지 파일 끝에 절을 더하면 늘 충돌한다. 위 1·2 를 지키면 rebase 한 번에 풀린다. 충돌이 나면 **두 쪽 절을 모두 남긴다**.
5. PR 설명에 "계약 다시 생성: <서비스>, 백엔드 SHA"를 적는다. `contracts.lock` 은 PC 1 이 합치면서 고친다(`pc-split.md` §5).

## 5. 앞으로 — 합치는 PC 1
- 쌓은 PR 묶음이 오면 맨 위 PR 을 main 위에 먼저 합쳐 analyze·test 를 한 번 돌린다(§3-1).
- **묶음이 모두 합칠 준비가 됐으면(사용자 결정 2026-11-16): 맨 위 PR 하나만 squash 로 합치고, 아래 PR 은 닫는다.**
  - 맨 위 PR 에 아래 PR 커밋이 다 들어 있으므로 시험한 그대로 main 에 들어간다. 충돌을 풀 일이 없다.
  - squash 커밋 메시지에 묶음의 PR 번호와 제목을 모두 적는다(예 `feat(mfc-backoffice): 작업 현황·배정·입고·재고·품질·운영 제한 (#29·#31·#32·#33·#34·#35)`).
  - 아래 PR 은 "#N 에 함께 들어가 합쳐짐 — main <커밋>" 댓글을 달고 닫는다. 각 PR 설명·리뷰는 닫힌 PR 에 그대로 남는다.
  - 되돌릴 때는 묶음 전체가 한 단위다.
- 묶음 중 일부만 준비됐으면(예: 위쪽 PR 이 백엔드 배포를 기다림) 준비된 데까지만 아래부터 squash 한다. 충돌은 아래 §6 의 방법으로 푼다.
- maintainer 수정이 허용되지 않은 PR 은 PC 1 이 브랜치에 올릴 수 없다. 그때는 보낸 PC 에 §4-2 를 부탁한다.

## 6. 두 번째 사례 — backoffice·mfc-backoffice PR #27~#38 (PC 2, 2026-11-16)
- 묶음: 백오피스 #27 → #28 → #30 → #37 → #38, MFC 백오피스 #29 → #31 → #32 → #33 → #34 → #35, 따로 #36(문서). 모두 base `main`.
- 이때는 PR 마다 squash 했다(§5 결정 전). 백오피스 줄은 §3-3 방법(충돌 파일은 PR 쪽)으로 풀렸다.
- **MFC 백오피스 줄에서 §3-3 방법이 틀렸다**: 그 사이 main 에 들어간 #28(화면 용어)이 `mfc-backoffice` 문구·문서도 바꿨다. 충돌 파일을 통째로 PR 쪽으로 하면 #28 변경이 사라지고, 충돌 덩어리만 PR 쪽으로 하면 squash 내용이 한 번 더 들어가 `mocks/db.ts` 가 중복됐다(typecheck 가 잡음 — 올리지 않음).
- **맞는 방법**: 앞 PR(이미 squash 됨)을 기준점으로 3-way 합치기.
  ```bash
  tree=$(git merge-tree --write-tree --merge-base=<앞 PR 머리> <이 PR 머리> origin/main)
  # 확인: git diff origin/main $tree  ==  git diff <앞 PR 머리> <이 PR 머리>  (줄 단위로 같아야 한다)
  git commit-tree $tree -p <이 PR 머리> -p origin/main -m "Merge origin/main …"   # → PR 브랜치에 올린 뒤 squash
  ```
  #31~#35 모두 충돌 없이 합쳐졌고, 차이가 PR 자체 변경과 같았고, 각 단계에서 mfc-backoffice typecheck·lint·test 가 통과했다.
- 끝 확인: 합친 main(`3a1e176`)이 처음 시험한 조합(#38·#35·#36 을 main 에 합친 것)과 `git diff` 빈 결과.
- 바로잡기: 뒤이은 lock 커밋 `8fb3058` 메시지는 "백엔드 17a99b65" 라고 적었지만, 그 사이 백엔드 작업본이 바뀌어 실제 lock 값은 `347ea90d`(case 0.11.0 — 오배송 귀책 필드 추가)다. 그 타입으로 다섯 웹 패키지를 다시 시험해 모두 통과했다.
