// 업무 도우미 연동 포트. 화면은 이 인터페이스만 안다.
// - 목 모드는 draftMock(계약 1.1.0 모양), 실서버 모드(local·lan)는 httpAssistant(생성 타입 + pmartFetch — 서비스 2026-11-09 LAN 배포).
// - notConnected 는 서버를 부르면 안 되는 구성용으로 남겨 둔다(기본 구성에서는 쓰지 않는다).
import type { IdempotencyKey } from '../../api/command';
import type { AssistantAnswer, ChatPage, ChatSession } from './model';

/** 화면 힌트(계약 PolicyQuestion.context) — 권한·검색 범위를 넓히지 않는다. 상담 접수 칸은 screen "cs-intake"(ADR-0093). */
export interface AskContext {
  readonly screen?: string;
}

export interface AssistantPort {
  /** connected=false 면 화면은 호출하지 않고 "연결 전" 안내만 보인다. */
  readonly connected: boolean;
  /** 목이면 화면에 목 표시를 붙인다. */
  readonly mock: boolean;
  /** 목만: 시나리오 꼬리표(화면 안내용). */
  readonly mockHints?: readonly string[];
  /**
   * 질의 POST /assistant/policy-questions. sessionId 를 주면 그 채팅에 이어 묻고, 없으면 새 채팅(응답 sessionId). 200 완료 또는 202 처리 중(state=PROCESSING)을 돌려준다.
   * 실패는 PmartFailure 로 던진다(api/failure 분류 그대로):
   * Problem(4xx: 403·409 IDEMPOTENCY_CONFLICT·422 CONFIG_REQUIRED) = 거절 확정,
   * UnknownResultFailure(타임아웃·503 DEPENDENCY_UNAVAILABLE·응답 유실) = 결과 불명 → 같은 키로 다시 보낸다.
   */
  ask(question: string, key: IdempotencyKey, sessionId?: string | null, context?: AskContext): Promise<AssistantAnswer>;
  /** 답변 다시 보기 GET /assistant/policy-questions/{answerId}. 없거나 남의 답변·현재 권한 없음 = NOT_FOUND. */
  get(answerId: string): Promise<AssistantAnswer>;
  /** 내 채팅 목록 GET /assistant/chat-sessions (마지막 질문 최근 순, 1.3.0). */
  chats(cursor?: string): Promise<ChatPage>;
  /** 채팅 하나 GET /assistant/chat-sessions/{sessionId}. 없거나 남의 채팅 = NOT_FOUND. */
  chat(sessionId: string): Promise<ChatSession>;
  /** 채팅 지우기 DELETE /assistant/chat-sessions/{sessionId} — 되돌릴 수 없다. 없거나 이미 지웠어도 204(성공). */
  deleteChat(sessionId: string, key: IdempotencyKey): Promise<void>;
}

export class AssistantNotConnectedError extends Error {
  constructor() {
    super('업무 도우미가 연결되지 않은 구성 — 호출하지 않는다');
  }
}

/** 서버를 부르지 않는 포트. 화면은 "연결 전" 안내만 보인다. */
export const notConnectedAssistant: AssistantPort = {
  connected: false,
  mock: false,
  ask: () => Promise.reject(new AssistantNotConnectedError()),
  get: () => Promise.reject(new AssistantNotConnectedError()),
  chats: () => Promise.reject(new AssistantNotConnectedError()),
  chat: () => Promise.reject(new AssistantNotConnectedError()),
  deleteChat: () => Promise.reject(new AssistantNotConnectedError()),
};
