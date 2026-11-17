// 목 핸들러 공통: Problem 응답, 토큰 클레임, 멱등 재생, 기대 버전.
import { HttpResponse } from 'msw';

import { parseOperatorToken, type OperatorSession } from '@pmart/web-core';
import { db } from './db';

export function problem(
  status: number,
  code: string,
  details: ReadonlyArray<{ field?: string; reason?: string }> = [],
  detail?: string,
): HttpResponse<Record<string, unknown>> {
  return HttpResponse.json(
    { type: 'about:blank', title: code, status, code, traceId: 'mock-trace', details, ...(detail ? { detail } : {}) },
    { status, headers: { 'content-type': 'application/problem+json', 'x-request-id': `mock-${status}-${code}` } },
  );
}

/** 게이트웨이처럼 access token 을 확인한다: 만료(exp)·폐기된 세션(sid)이면 null(→ 401). */
export function operator(request: Request): OperatorSession | null {
  const auth = request.headers.get('Authorization');
  const who = auth?.startsWith('Bearer ') ? parseOperatorToken(auth.slice(7)) : null;
  if (!who) return null;
  if (who.expiresAtSeconds !== undefined && who.expiresAtSeconds * 1000 <= Date.now()) return null;
  if (who.sessionId && db.sessions.get(who.sessionId)?.revoked) return null;
  return who;
}

export const unauthorized = () => new HttpResponse(null, { status: 401 });

export const keyOf = (request: Request) => request.headers.get('Idempotency-Key') ?? '';

export function expectedVersion(request: Request): number | undefined {
  const v = request.headers.get('X-Expected-Version');
  return v === null ? undefined : Number(v);
}

type Reply = { status: number; body: unknown } | HttpResponse<Record<string, unknown>>;

/** 같은 키 = 저장된 응답 재생(서버 멱등 규칙). */
export function idempotent(request: Request, run: () => Reply) {
  const id = `${request.method} ${new URL(request.url).pathname} ${keyOf(request)}`;
  const saved = db.idempotent.get(id);
  if (saved) return HttpResponse.json(saved.body as Record<string, unknown>, { status: saved.status });
  const result = run();
  if (result instanceof Response) return result;
  db.idempotent.set(id, result);
  return HttpResponse.json(result.body as Record<string, unknown>, { status: result.status });
}
