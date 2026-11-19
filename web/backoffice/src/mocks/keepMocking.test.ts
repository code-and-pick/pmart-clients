// 목 모드: 대리 서버가 요청을 놓쳐 HTML 이 오면 다시 켜고 한 번만 다시 보낸다
import { afterEach, describe, expect, it, vi } from 'vitest';

import { keepMocking } from './keepMocking';

const html = () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } });
const json = (status = 200) => new Response('{"ok":true}', { status, headers: { 'content-type': 'application/json' } });

describe('keepMocking', () => {
  const realFetch = window.fetch.bind(window);
  afterEach(() => {
    window.fetch = realFetch;
  });

  it('/api 응답이 HTML 이면 다시 보내 목 응답을 돌려준다', async () => {
    const inner = vi.fn<typeof fetch>().mockResolvedValueOnce(html()).mockResolvedValueOnce(json());
    window.fetch = inner;
    keepMocking('/api/v1/');
    const res = await window.fetch('http://localhost/api/v1/products');
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it('JSON 아닌 404(POST 가 개발 서버로 간 것)도 한 번 다시 보낸다, 본문은 복사본으로', async () => {
    const bodies: string[] = [];
    const inner = vi.fn<typeof fetch>(async (input) => {
      bodies.push(await (input as Request).text());
      return bodies.length === 1 ? new Response('Not Found', { status: 404 }) : json(201);
    });
    window.fetch = inner;
    keepMocking('/api/v1/');
    const res = await window.fetch(new Request('http://localhost/api/v1/employee-auth/tokens', { method: 'POST', body: '{"a":1}' }));
    expect(res.status).toBe(201);
    expect(bodies).toEqual(['{"a":1}', '{"a":1}']);
  });

  it('목의 오류(problem+json 404·401)와 /api 밖 요청은 그대로 — 다시 보내지 않는다', async () => {
    const inner = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 404, headers: { 'content-type': 'application/problem+json' } }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(html());
    window.fetch = inner;
    keepMocking('/api/v1/');
    expect((await window.fetch('http://localhost/api/v1/x')).status).toBe(404);
    expect((await window.fetch('http://localhost/api/v1/y')).status).toBe(401);
    expect((await window.fetch('http://localhost/index.html')).status).toBe(200);
    expect(inner).toHaveBeenCalledTimes(3);
  });
});
