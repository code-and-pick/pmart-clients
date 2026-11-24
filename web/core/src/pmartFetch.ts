// PMart 규약을 적용한 fetch. openapi-fetch 의 `fetch` 옵션으로 넘긴다.
// pmart_core(Dart) interceptors.dart 와 같은 규칙이다.
//
// - 변경 요청은 Idempotency-Key 가 없으면 보내지 않는다(키는 command() 로 붙인다)
// - 401 → 토큰 갱신 1회(single-flight). 이미 다른 요청이 갱신했으면 다시 갱신하지 않는다
// - 429 → Retry-After(상한 30초) 뒤 같은 요청. retryable Problem → 지수 백오프. 최대 3회
// - 타임아웃·연결 오류는 재전송하지 않는다(변경이면 결과 불명으로 넘긴다)
import {
  ContractViolationFailure,
  failureFromResponse,
  failureFromTransport,
  isMutation,
  parseProblem,
  SessionExpiredFailure,
  UnknownResultFailure,
} from './failure';
import type { TokenStore } from './tokens';

export const PUBLIC_HEADER = 'X-Pmart-Public';
/** 계약이 Idempotency-Key 를 받지 않는 변경 요청(운영자 로그인). 보내기 전에 지운다. */
export const NO_IDEMPOTENCY_HEADER = 'X-Pmart-No-Idempotency';

export interface PmartFetchOptions {
  /** `X-Source-System` (값 확정은 BR-08) */
  readonly sourceSystem: string;
  readonly tokens: TokenStore;
  /** 새 access token 을 돌려준다. 갱신이 거절되면 null. 네트워크 오류는 throw. */
  readonly refresh: () => Promise<string | null>;
  readonly onSessionExpired?: () => void;
  readonly fetchImpl?: (input: Request) => Promise<Response>;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly maxRetries?: number;
  readonly baseBackoffMs?: number;
  readonly maxWaitMs?: number;
}

export type PmartFetch = (input: Request) => Promise<Response>;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createPmartFetch(options: PmartFetchOptions): PmartFetch {
  const {
    sourceSystem,
    tokens,
    refresh,
    onSessionExpired,
    fetchImpl = (input) => fetch(input),
    sleep = realSleep,
    now = Date.now,
    maxRetries = 3,
    baseBackoffMs = 500,
    maxWaitMs = 30_000,
  } = options;

  let refreshing: Promise<boolean> | null = null;

  function prepare(original: Request): Request {
    const req = original.clone();
    const headers = new Headers(req.headers);
    const isPublic = headers.has(PUBLIC_HEADER);
    headers.delete(PUBLIC_HEADER);
    const noIdempotency = headers.has(NO_IDEMPOTENCY_HEADER);
    headers.delete(NO_IDEMPOTENCY_HEADER);
    headers.set('X-Source-System', sourceSystem);
    // 실시간 스트림(SSE — mfc-inventory 0.46.0 `/stock-stream`, 2026-11-24)은 부른 쪽의 Accept: text/event-stream 을 그대로 둔다
    // (JSON 으로 덮으면 서버가 406). 오류 응답은 그래도 problem+json 으로 온다.
    if (!(headers.get('Accept') ?? '').includes('text/event-stream')) headers.set('Accept', 'application/json, application/problem+json');
    if (isMutation(req.method) && !noIdempotency && !headers.get('Idempotency-Key')) {
      throw new Error(`변경 요청에 Idempotency-Key 가 없다: ${req.method} ${new URL(req.url).pathname}`);
    }
    const access = tokens.accessToken;
    if (!isPublic && access) headers.set('Authorization', `Bearer ${access}`);
    // traceparent 는 게이트웨이가 발급한다.
    return new Request(req, { headers });
  }

  async function doRefresh(): Promise<boolean> {
    const next = await refresh();
    if (next === null) {
      tokens.clear();
      onSessionExpired?.();
      return false;
    }
    // refresh() 가 회전된 토큰 쌍을 이미 넣었으면 다시 쓰지 않는다.
    if (tokens.accessToken !== next) tokens.accessToken = next;
    return true;
  }

  async function waitFor(res: Response, attempt: number): Promise<number | null> {
    if (res.status === 429) {
      const after = parseRetryAfter(res.headers.get('retry-after'), now());
      const wait = after ?? baseBackoffMs * 2 ** attempt;
      return wait > maxWaitMs ? null : wait;
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) return null;
    try {
      const problem = parseProblem(await res.clone().json(), res.status);
      if (problem?.retryable && problem.code !== 'IDEMPOTENCY_CONFLICT') {
        return baseBackoffMs * 2 ** attempt;
      }
    } catch {
      return null;
    }
    return null;
  }

  return async function pmartFetch(original: Request): Promise<Response> {
    const isPublic = original.headers.has(PUBLIC_HEADER);
    let refreshed = false;
    let attempt = 0;
    for (;;) {
      const req = prepare(original);
      const sentWith = req.headers.get('Authorization');
      const res = await fetchImpl(req);

      if (res.status === 401 && !isPublic && !refreshed) {
        refreshed = true;
        const current = tokens.accessToken;
        const alreadyRefreshed = refreshing === null && current !== null && sentWith !== `Bearer ${current}`;
        let ok: boolean;
        try {
          ok = alreadyRefreshed || (await (refreshing ??= doRefresh().finally(() => (refreshing = null))));
        } catch {
          // 갱신 요청 자체의 네트워크 오류: 세션 만료로 단정하지 않는다.
          return res;
        }
        if (!ok) throw new SessionExpiredFailure('SESSION_EXPIRED', res.headers.get('x-request-id') ?? undefined);
        continue;
      }

      if (!res.ok && attempt < maxRetries) {
        const wait = await waitFor(res, attempt);
        if (wait !== null) {
          await sleep(wait);
          attempt += 1;
          continue;
        }
      }
      return res;
    }
  };
}

/** `Retry-After`: 초 또는 HTTP-date. 밀리초로 돌려준다. */
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - nowMs);
}

/**
 * openapi-fetch 호출을 감싸 데이터 또는 PmartFailure 로 바꾼다.
 *   const view = await request('GET', api.bff.GET('/views/approval-inbox', {}));
 */
export async function request<T>(
  method: string,
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result: { data?: T; error?: unknown; response: Response };
  try {
    result = await call;
  } catch (e) {
    throw failureFromTransport(e, method);
  }
  const { data, error, response } = result;
  const requestId = response.headers.get('x-request-id') ?? undefined;
  if (!response.ok) throw failureFromResponse(response, error, method);
  if (data === undefined) {
    // 2xx 인데 본문이 없다. 변경 요청이면 반영됐을 수 있다.
    throw isMutation(method)
      ? new UnknownResultFailure('본문 없음', requestId)
      : new ContractViolationFailure('본문 없음', requestId);
  }
  return data;
}

/**
 * 계약이 204(본문 없음)로 성공을 알리는 변경 요청용. 2xx 면 반영됐다고 본다(본문이 없어도 결과 불명이 아니다).
 *   await requestNoContent('POST', api.auth.POST('/auth/password-changes', {...}))
 */
export async function requestNoContent(
  method: string,
  call: Promise<{ error?: unknown; response: Response }>,
): Promise<void> {
  let result: { error?: unknown; response: Response };
  try {
    result = await call;
  } catch (e) {
    throw failureFromTransport(e, method);
  }
  if (!result.response.ok) throw failureFromResponse(result.response, result.error, method);
}
