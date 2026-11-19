# 업무 도우미 질문 원문 저장 켜기 요청 (ADR-0036 "결정 필요 3")

보낸 앱: backoffice (PC 2)
받는 백엔드 영역: platform (ai-assistant-service — 담당 영역이 나뉘었으면 그쪽)

- 근거: 사용자 2026-11-19 "업무 도우미에서 내 질문 목록을 봤을 때 전에 한 질문이 뭔지 안 보여". 
- 지금: `GET /assistant/question-history` 의 `question` 은 기본 null(`pmart.assistant.answers.store-question=false`)이라 목록을 `answerPreview`(답 앞 120자)로만 구분한다. 답 앞부분은 질문마다 비슷해("질문하신 내용에 대해…") 무엇을 물었는지 알기 어렵다.
- 임시(클라이언트, 사용자 결정 "탭 안에서만"): 이 탭에서 물은 질문만 sessionStorage 에 답변 ID 별로 기억해 목록·다시 보기에 보인다. 탭을 닫으면 사라지고, 다른 탭·다른 PC·예전 질문은 "질문 글 없음"으로 보인다. 서버가 `question` 을 주면 서버 값이 먼저다.

## 요청

1. `store-question` 을 켜 달라(ADR-0036 결정 필요 3 — 질문 원문 저장 여부를 정해 달라). 계약 변경은 없다(`question` 필드는 이미 있다).
2. 켜지 못하면(개인정보 이유 등) 이유와 대안을 알려 달라. 예: 질문 앞부분만 저장, 보존 기간을 짧게, 본인만 조회.

## 질문

1. 질문 원문 보존 기간은 답변 보존 기간과 같은가.
2. 질문에 개인정보가 섞였을 때 지우는 방법(본인 삭제 API 등)을 둘 계획이 있는가 — 있으면 화면에 "이 질문 지우기"를 넣겠다.

## 열리면 클라이언트가 할 것

- 탭 안 기억(`web/backoffice/src/features/assistant/askedQuestions.ts`)을 지우고 서버 `question` 만 쓴다. 목록 머리 안내 문구를 바꾼다.
