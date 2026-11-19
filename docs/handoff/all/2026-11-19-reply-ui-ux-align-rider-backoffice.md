# 회신 — 직원 웹 UI·UX 맞추기(라이더 백오피스, PC 5)

보낸 앱: rider-backoffice (PC 5)
받는 쪽: backoffice·web-common (PC 2) — 요청 문서 `docs/handoff/all/2026-11-19-request-ui-ux-align.md`

## 맞춘 것(main 에 있는 부품 기준, 이 앱 사본 — 머리 주석 "사본: … (sha)")
- 겉모습: 어두운 테마·밝게/어둡게 단추, 목록 한 카드 잇기, 불러오는 뼈대, 긴 표 머리 고정, admin.tsx(배지 점·필터 줄·칩 개수·색 막대 숫자 카드·StatStrip). 왼쪽 메뉴는 이미 기준 모양(파란 채움·흰 글자·P 배지).
- 목록: 서버가 센 숫자 띠("?"·"N건 이상"), '/' 키 검색, 최근 봄, 새 줄 강조, 내 보기(SavedViews) — 배송·라이더·상담함·접수 건·수행료 조정·추가 배달료·지급·소명·이의·가입 승인·제한 검토.
- 상세: 이전 · n/N · 다음([ ] 키), 내리면 제목 띠, 배송 진행 단계(ProgressSteps).
- 움직임: 바뀐 숫자 빛남 ▲▼, 새 줄, 접수 건 기한 15분 안 숨쉬기·남은 분(넘김은 서버 overdue), 새 메시지 표시, 움직임 줄이기면 끔.
- 기타: 탭 제목(급한 건 수 + 화면 이름), 인터넷 끊김 띠, 초성 찾기 고르기(센터).
- 직원 "이름 · 사번": hr 0.8.0 `GET /hr/employee-labels`(못 읽으면 "직원 …끝 6자리").
- 배송 번호는 execution 0.31.0 `GET /deliveries?deliveryIds=` 50개씩 묶음 조회.

## 아직(PR #224·#231 병합·web-ui 로 올린 뒤 맞춤)
- `data-skin="wing"` 본문 겉모습, 진행 단계 흰 선 체크 SVG, GuideBox, "수고하셨어요" 띠, 검색 조건 칩으로 접기, 가로형 숫자 카드, 떠 있는 고르기 목록(useFloatingPanel)·MultiSelectDropdown, 관제 두 줄 카드.
- 미리보기 Enter 로 상세: 이 앱 목록에는 미리보기 칸이 없어 넣지 않음.

## 공용(web-ui) 의견
- 모양만인 부품(StatStrip·ProgressSteps·StickyTitle·SearchSelect·motion·theme·GuideBox·AllDone)은 web-ui 로 올리는 데 동의 — 올라오면 이 앱 사본을 지우고 바꿔 쓴다.
- 앱 조회를 아는 것(탭 제목·이전·다음·최근 봄·화면 번호·직원 이름)은 앱 사본으로 둔다.

## 브라우저 저장소
- 테마·내 보기·최근 봄은 통합 백오피스처럼 localStorage(토큰·개인정보 없음, try/catch), 이전·다음 순서는 sessionStorage. 토큰은 메모리(ADR-0059 그대로).
