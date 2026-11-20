import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { db } from '../../mocks/db';
import { renderAt } from '../../test/render';
import { server } from '../../test/server';

const jsonFile = (obj: unknown) => new File([JSON.stringify(obj)], 'categories.json', { type: 'application/json' });
const upload = (input: HTMLElement, file: File) => fireEvent.change(input, { target: { files: [file] } });

/** seed-v1 묶음의 categories.json 모양 */
const seedCategories = (entries: { ids: string[] | null; path: string[] }[]) => ({
  format: 'seed-v1',
  categories: entries.map(({ ids, path }) => ({
    bmartPath: path,
    pmartCategoryIdLevels: ids,
    pmartCategoryId: ids ? ids[ids.length - 1] : null,
  })),
});

describe('카테고리 트리 — 기준파일(seed-v1) 카테고리 추가', () => {
  it('없는 노드만 더한 초안을 만들고 더한 id·건너뛴 경로·승인 요청을 보인다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/categories');
    await screen.findByText(/발효 버전 1/);

    upload(
      screen.getByLabelText('categories.json 또는 seed-v1 zip'),
      jsonFile(
        seedCategories([
          { ids: ['p01', 'p01-c01', 'p01-c01-l01'], path: ['과일·채소', '과일', '사과·배'] }, // 모두 있음
          { ids: ['p09', 'p09-c01', 'p09-c01-l01'], path: ['냉동·간편식', '만두', '고기만두'] }, // 셋 다 새로
          { ids: null, path: ['매핑 안 된', '경로'] }, // 건너뜀
        ]),
      ),
    );
    await user.click(screen.getByRole('button', { name: '없는 카테고리만 추가' }));

    expect(await screen.findByText('트리 버전 2 초안을 만들었어요(발효 버전 1 기준).')).toBeInTheDocument();
    expect(screen.getByText('새로 더한 카테고리 3개')).toBeInTheDocument();
    expect(screen.getByText(/p09, p09-c01, p09-c01-l01/)).toBeInTheDocument();
    expect(screen.getByText(/건너뛴 경로 1개.*매핑 안 된 > 경로/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '승인 요청' })).toBeInTheDocument();
    // 보낸 본문은 묶음의 categories 그대로
    const post = view.mutations('/category-tree-additions')[0]!;
    const body = (await post.json()) as { categories: unknown[] };
    expect(body.categories).toHaveLength(3);
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    // 기존 트리는 그대로이고 초안에만 더해졌다
    expect(db.tree?.nodes.some((n) => n.categoryId === 'p09')).toBe(false);
    expect(db.treeVersions.get(2)?.nodes.some((n) => n.categoryId === 'p09-c01-l01')).toBe(true);
    view.stop();
  });

  it('모두 이미 있으면 422 NOTHING_TO_ADD 를 "추가할 카테고리 없음"으로 보이고 오류로 다루지 않는다', async () => {
    const user = userEvent.setup();
    renderAt('/categories');
    await screen.findByText(/발효 버전 1/);

    upload(
      screen.getByLabelText('categories.json 또는 seed-v1 zip'),
      jsonFile(seedCategories([{ ids: ['p01', 'p01-c01'], path: ['과일·채소', '과일'] }])),
    );
    await user.click(screen.getByRole('button', { name: '없는 카테고리만 추가' }));

    // 2026-11-20: 전체 시험을 한꺼번에 돌릴 때 가끔 1초 안에 답이 안 와 실패했다 — 그 글자를 5초까지 기다리고, 그 글자가 status 안에 있는지 본다
    const note = await screen.findByText(/추가할 카테고리가 없어요/, {}, { timeout: 5000 });
    expect(note.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('서버가 500 INTERNAL_ERROR 를 주면 "거절됐어요"·코드 대신 서버 오류 안내와 문의 번호를 보인다(BR-48)', async () => {
    server.use(
      http.post(`${API_BASE}/category-tree-additions`, () =>
        HttpResponse.json(
          { type: 'about:blank', status: 500, code: 'INTERNAL_ERROR', retryable: false, traceId: 'trace-500' },
          { status: 500, headers: { 'content-type': 'application/problem+json', 'x-request-id': 'req-500' } },
        ),
      ),
    );
    const user = userEvent.setup();
    renderAt('/categories');
    await screen.findByText(/발효 버전 1/);

    upload(
      screen.getByLabelText('categories.json 또는 seed-v1 zip'),
      jsonFile(seedCategories([{ ids: ['p01', 'p01-c01'], path: ['과일·채소', '과일'] }])),
    );
    await user.click(screen.getByRole('button', { name: '없는 카테고리만 추가' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('서버가 카테고리 추가를 처리하지 못했어요');
    expect(alert).toHaveTextContent('req-500');
    expect(alert).not.toHaveTextContent('요청이 거절됐어요');
    expect(alert).not.toHaveTextContent('INTERNAL_ERROR');
  });

  it('형식이 아니면(categories 배열 없음) 보내지 않고 안내한다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/categories');
    await screen.findByText(/발효 버전 1/);

    upload(screen.getByLabelText('categories.json 또는 seed-v1 zip'), jsonFile({ nodes: [] }));
    await user.click(screen.getByRole('button', { name: '없는 카테고리만 추가' }));

    expect(await screen.findByText(/seed-v1 categories.json 의 categories 배열이 필요해요/)).toBeInTheDocument();
    expect(view.mutations('/category-tree-additions')).toHaveLength(0);
    view.stop();
  });

  it('seed-v1 zip 을 올리면 zip 업로드 경로로 보내고(묶음을 풀지 않음) 결과는 JSON 과 같다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/categories');
    await screen.findByText(/발효 버전 1/);

    upload(screen.getByLabelText('categories.json 또는 seed-v1 zip'), new File(['zip-bytes'], 'seed-v1.zip', { type: 'application/zip' }));
    await user.click(screen.getByRole('button', { name: '없는 카테고리만 추가' }));

    expect(await screen.findByText('트리 버전 2 초안을 만들었어요(발효 버전 1 기준).')).toBeInTheDocument();
    expect(screen.getByText('새로 더한 카테고리 3개')).toBeInTheDocument();
    expect(view.mutations('/category-tree-additions')).toHaveLength(0);
    const post = view.mutations('/category-tree-addition-uploads')[0]!;
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(post.headers.get('content-type')).toMatch(/^multipart\/form-data/);
    view.stop();
  });
});
