import { describe, expect, it, vi } from 'vitest';

import { command, IdempotencyKey, resolveResult, type CommandResponse } from './command';
import {
  ContractViolationFailure,
  NetworkFailure,
  ProblemFailure,
  SessionExpiredFailure,
  UnknownResultFailure,
} from './failure';
import { createPmartFetch, parseRetryAfter, PUBLIC_HEADER, request } from './pmartFetch';
import { TokenStore } from './tokens';

const problem = (status: number, code: string, extra: Record<string, unknown> = {}, headers: HeadersInit = {}) =>
  new Response(JSON.stringify({ type: 'about:blank', title: 't', status, code, traceId: 'tr', ...extra }), {
    status,
    headers: { 'content-type': 'application/problem+json', ...headers },
  });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(replies: Array<(req: Request) => Response | Promise<Response>>, refresh = async () => null as string | null) {
  const sent: Request[] = [];
  const sleeps: number[] = [];
  const tokens = new TokenStore();
  tokens.accessToken = 'a-1';
  const onSessionExpired = vi.fn();
  const fetchImpl = vi.fn(async (req: Request) => {
    sent.push(req);
    const reply = replies[Math.min(sent.length - 1, replies.length - 1)];
    if (!reply) throw new Error('no reply');
    return reply(req);
  });
  const pmartFetch = createPmartFetch({
    sourceSystem: 'backoffice-web',
    tokens,
    refresh,
    onSessionExpired,
    fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => Date.UTC(2026, 9, 24, 8, 0, 0),
  });
  return { pmartFetch, sent, sleeps, tokens, onSessionExpired };
}

const url = 'http://test.invalid/api/v1/x';

describe('Accept', () => {
  it('기본은 JSON, 실시간 스트림(text/event-stream)을 달라고 하면 그대로 둔다', async () => {
    const { pmartFetch, sent } = setup([() => json({}), () => new Response('', { headers: { 'content-type': 'text/event-stream' } })]);
    await pmartFetch(new Request(url));
    await pmartFetch(new Request(url, { headers: { Accept: 'text/event-stream' } }));
    expect(sent[0]!.headers.get('Accept')).toBe('application/json, application/problem+json');
    expect(sent[1]!.headers.get('Accept')).toBe('text/event-stream');
    expect(sent[1]!.headers.get('Authorization')).toBe('Bearer a-1');
  });
});

describe('요청 헤더', () => {
  it('변경 요청에 멱등 키·출처·인증·기대 버전을 붙인다', async () => {
    const { pmartFetch, sent } = setup([() => json({ status: 'ACCEPTED', requestId: 'k' }, 202)]);
    const key = new IdempotencyKey('key-abc');
    await pmartFetch(new Request(url, { method: 'POST', ...command(key, 7) }));

    const h = sent[0]!.headers;
    expect(h.get('Idempotency-Key')).toBe('key-abc');
    expect(h.get('X-Source-System')).toBe('backoffice-web');
    expect(h.get('Authorization')).toBe('Bearer a-1');
    expect(h.get('X-Expected-Version')).toBe('7');
    expect(h.has('traceparent')).toBe(false);
  });

  it('멱등 키 없는 변경 요청은 보내지 않는다', async () => {
    const { pmartFetch, sent } = setup([() => json({})]);
    await expect(pmartFetch(new Request(url, { method: 'POST' }))).rejects.toThrow(/Idempotency-Key/);
    expect(sent).toHaveLength(0);
  });

  it('공개 경로에는 인증 헤더를 붙이지 않는다', async () => {
    const { pmartFetch, sent } = setup([() => json({})]);
    await pmartFetch(new Request(url, { headers: { [PUBLIC_HEADER]: '1' } }));
    expect(sent[0]!.headers.has('Authorization')).toBe(false);
    expect(sent[0]!.headers.has(PUBLIC_HEADER)).toBe(false);
  });
});

describe('429·재시도', () => {
  it('429 는 Retry-After 만큼 기다린 뒤 같은 멱등 키·같은 본문으로 다시 보낸다', async () => {
    const { pmartFetch, sent, sleeps } = setup([
      () => problem(429, 'RATE_LIMITED', { retryable: true }, { 'retry-after': '2' }),
      () => json({ status: 'APPLIED', requestId: 'k' }),
    ]);
    const key = IdempotencyKey.generate();
    const res = await pmartFetch(new Request(url, { method: 'POST', body: '{"a":1}', ...command(key) }));

    expect(res.status).toBe(200);
    expect(sleeps).toEqual([2000]);
    expect(sent.map((r) => r.headers.get('Idempotency-Key'))).toEqual([key.value, key.value]);
    expect(await sent[1]!.text()).toBe('{"a":1}');
  });

  it('Retry-After 가 30초보다 길면 기다리지 않는다', async () => {
    const { pmartFetch, sent, sleeps } = setup([
      () => problem(429, 'RATE_LIMITED', {}, { 'retry-after': '120' }),
    ]);
    const res = await pmartFetch(new Request(url));
    expect(res.status).toBe(429);
    expect(sent).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('retryable Problem 은 지수 백오프로 최대 3회', async () => {
    const { pmartFetch, sent, sleeps } = setup([() => problem(503, 'DEPENDENCY_UNAVAILABLE', { retryable: true })]);
    await pmartFetch(new Request(url));
    expect(sent).toHaveLength(4);
    expect(sleeps).toEqual([500, 1000, 2000]);
  });

  it('retryable=false 는 재시도하지 않는다', async () => {
    const { pmartFetch, sent } = setup([() => problem(409, 'VERSION_CONFLICT')]);
    await pmartFetch(new Request(url));
    expect(sent).toHaveLength(1);
  });
});

describe('401 토큰 갱신', () => {
  it('동시에 401 이어도 갱신은 한 번만 한다', async () => {
    let refreshCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { pmartFetch, tokens } = setup(
      [(req) => (req.headers.get('Authorization') === 'Bearer a-2' ? json({}) : new Response(null, { status: 401 }))],
      async () => {
        refreshCalls++;
        await gate;
        return 'a-2';
      },
    );

    const calls = [pmartFetch(new Request(`${url}/1`)), pmartFetch(new Request(`${url}/2`))];
    await new Promise((r) => setTimeout(r, 0));
    release();
    const results = await Promise.all(calls);

    expect(refreshCalls).toBe(1);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(tokens.accessToken).toBe('a-2');
  });

  it('갱신이 거절되면 토큰을 지우고 세션 만료로 끝낸다', async () => {
    const { pmartFetch, tokens, onSessionExpired } = setup([() => new Response(null, { status: 401 })]);
    await expect(pmartFetch(new Request(url))).rejects.toBeInstanceOf(SessionExpiredFailure);
    expect(tokens.accessToken).toBeNull();
    expect(onSessionExpired).toHaveBeenCalledOnce();
  });
});

describe('request(): 실패 분류', () => {
  // openapi-fetch 처럼: 성공이면 data, 실패면 읽은 본문을 error 로 준다.
  const call = async (response: Response): Promise<{ data?: unknown; error?: unknown; response: Response }> => {
    if (response.ok) {
      const text = await response.clone().text();
      return text ? { data: JSON.parse(text), response } : { response };
    }
    const text = await response.clone().text();
    let error: unknown = text;
    try {
      error = JSON.parse(text);
    } catch {
      // 텍스트 그대로
    }
    return { error, response };
  };

  it('변경 요청의 연결 오류는 결과 불명, 조회는 네트워크 실패', async () => {
    await expect(request('POST', Promise.reject(new TypeError('fetch failed')))).rejects.toBeInstanceOf(
      UnknownResultFailure,
    );
    await expect(request('GET', Promise.reject(new TypeError('fetch failed')))).rejects.toBeInstanceOf(
      NetworkFailure,
    );
  });

  it('변경 요청의 Problem 아닌 5xx 는 결과 불명이다', async () => {
    await expect(
      request('POST', call(new Response('<html>', { status: 502, headers: { 'content-type': 'text/html' } }))),
    ).rejects.toBeInstanceOf(UnknownResultFailure);
  });

  it('Problem 은 code 와 X-Request-Id 를 보존한다', async () => {
    const failure = await request('GET', call(problem(409, 'VERSION_CONFLICT', {}, { 'x-request-id': 'rid-9' }))).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(ProblemFailure);
    expect((failure as ProblemFailure).problem.code).toBe('VERSION_CONFLICT');
    expect((failure as ProblemFailure).requestId).toBe('rid-9');
  });

  it('2xx 인데 본문이 없으면: 조회는 계약 위반, 변경은 결과 불명', async () => {
    await expect(request('GET', call(new Response(null, { status: 200 })))).rejects.toBeInstanceOf(
      ContractViolationFailure,
    );
    await expect(request('POST', call(new Response(null, { status: 200 })))).rejects.toBeInstanceOf(
      UnknownResultFailure,
    );
  });
});

describe('resolveResult', () => {
  const cmd = (status: CommandResponse['status']): CommandResponse => ({ status, requestId: 'k' });

  it('ACCEPTED 뒤 APPLIED 면 확정한다', async () => {
    const answers = [cmd('ACCEPTED'), cmd('APPLIED')];
    const r = await resolveResult(async () => answers.shift()!, { sleep: async () => {} });
    expect(r).toEqual({ kind: 'resolved', response: cmd('APPLIED') });
  });

  it('끝까지 모르면 unknown — 실패로 확정하지 않는다', async () => {
    const r = await resolveResult(
      async () => {
        throw new NetworkFailure();
      },
      { maxAttempts: 2, sleep: async () => {} },
    );
    expect(r.kind).toBe('unknown');
  });
});

it('Retry-After HTTP-date 를 읽는다', () => {
  const now = Date.UTC(2026, 9, 24, 8, 0, 0);
  expect(parseRetryAfter('Sat, 24 Oct 2026 08:00:10 GMT', now)).toBe(10_000);
  expect(parseRetryAfter('soon', now)).toBeNull();
});
