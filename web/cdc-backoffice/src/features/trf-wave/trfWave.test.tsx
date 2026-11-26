// TRF·Wave(cdc-outbound 0.11.0+) — 목록 거르기·쪽, 상세 줄, Wave 만들기(확보된 TRF 만), 릴리스(기대 버전·ACCEPTED 는 완료 아님).
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

describe('TRF 목록', () => {
  it('기한 순 목록, 부족 수량은 빨강, Wave 링크', async () => {
    renderAt('/c/CDC01/trf-wave');
    const rows = await screen.findAllByTestId('trf-row');
    expect(rows).toHaveLength(6);
    expect(within(rows[0]!).getByText('TRF-20261126-0001')).toBeInTheDocument();
    expect(within(rows[0]!).getByRole('link', { name: 'W4821' })).toHaveAttribute('href', '/c/CDC01/trf-wave/waves/WAVE-20261126-01');
    expect(within(rows[0]!).getAllByText('2').some((el) => el.classList.contains('text-error'))).toBe(true);
  });

  it('칸 이름: 줄 → 품목 수, 할당은 그대로 — 칸 이름에 마우스를 올리면 설명(2026-11-26)', async () => {
    renderAt('/c/CDC01/trf-wave');
    const table = await screen.findByTestId('trf-table');
    expect(within(table).getByRole('columnheader', { name: '품목 수' })).toHaveAttribute('title', '이 TRF 에 든 상품(SKU) 종류 수');
    expect(within(table).getByRole('columnheader', { name: '할당' }).getAttribute('title')).toContain('예약한');
    expect(within(table).queryByRole('columnheader', { name: '줄' })).not.toBeInTheDocument();
  });

  it('상태 거르기는 주소 쿼리로 서버에 보낸다', async () => {
    const view = renderAt('/c/CDC01/trf-wave');
    await screen.findAllByTestId('trf-row');
    await userEvent.selectOptions(screen.getByTestId('trf-state'), 'ALLOCATED');
    await waitFor(() => expect(screen.getAllByTestId('trf-row')).toHaveLength(1));
    expect(view.gets('/cdcs/CDC01/transfers').some((r) => new URL(r.url).searchParams.get('state') === 'ALLOCATED')).toBe(true);
  });

  it('조회 실패는 빈 목록이 아니라 실패로', async () => {
    server.use(http.get(`${API_BASE}/cdcs/:cdcId/transfers`, () => HttpResponse.json({ code: 'INTERNAL_ERROR', status: 500 }, { status: 500 })));
    renderAt('/c/CDC01/trf-wave');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('조건에 맞는 TRF 가 없어요.')).not.toBeInTheDocument();
  });

  it('품목별 수량에 상품 이름 — SKU 로 상품 서비스에 묻고, 못 찾으면 SKU 만(2026-11-26)', async () => {
    server.use(http.get(`${API_BASE}/products`, ({ request }) => {
      const q = new URL(request.url).searchParams.get('q');
      return HttpResponse.json({ items: q === 'SKU-1001' ? [{ productId: 'P1', internalName: '냉동 만두 1kg' }] : [], page: { nextCursor: null } });
    }));
    renderAt('/c/CDC01/trf-wave/trf/TRF-20261126-0001');
    const lines = await screen.findByTestId('trf-lines');
    expect(await within(lines).findByText('냉동 만두 1kg')).toBeInTheDocument();
    const other = within(lines).getByText('SKU-1002').closest('[data-testid="sku-name"]')!;
    expect(other.textContent).toBe('SKU-1002');
  });

  it('TRF 상세: 줄별 승인·할당·피킹·부족', async () => {
    renderAt('/c/CDC01/trf-wave/trf/TRF-20261126-0001');
    const lines = await screen.findByTestId('trf-lines');
    expect(within(lines).getByText('SKU-1002')).toBeInTheDocument();
    expect(screen.getByTestId('trf-fields')).toHaveTextContent('W4821');
  });
});

describe('Wave 만들기', () => {
  it('확보되고 Wave 에 없는 TRF 만 고를 수 있고, 만들면 그 Wave 상세로', async () => {
    const view = renderAt('/c/CDC01/trf-wave');
    await screen.findAllByTestId('trf-row');
    // 확보(0004)·일부 확보(0005)만 고르기 칸이 있다
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByTestId('wave-create')).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'TRF-20261126-0004 고르기' }));
    await userEvent.click(screen.getByTestId('wave-create'));
    expect(await screen.findByText('시스템 번호 WAVE-20261126-03')).toBeInTheDocument();
    const post = view.sent.find((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith('/waves'))!;
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(post.headers.get('X-Source-System')).toBe('cdc-backoffice-web');
    expect(await post.json()).toEqual({ cdcId: 'CDC01', trfIds: ['TRF-20261126-0004'] });
  });

  it('서버가 거절하면(이미 다른 Wave) 이유를 보이고 이동하지 않는다', async () => {
    server.use(http.post(`${API_BASE}/waves`, () => HttpResponse.json({ code: 'TRF_ALREADY_IN_WAVE', status: 409, title: 'x', type: 'about:blank' }, { status: 409, headers: { 'content-type': 'application/problem+json' } })));
    renderAt('/c/CDC01/trf-wave');
    await screen.findAllByTestId('trf-row');
    await userEvent.click(screen.getByRole('checkbox', { name: 'TRF-20261126-0004 고르기' }));
    await userEvent.click(screen.getByTestId('wave-create'));
    expect(await screen.findByText(/이미 다른 Wave 에 든 것이 있어요/)).toBeInTheDocument();
    expect(screen.getAllByTestId('trf-row')).toHaveLength(6);
  });
});

describe('Wave 릴리스', () => {
  it('PLANNED 만 릴리스 — 확인 뒤 기대 버전을 붙여 보내고, 서버 상태가 바뀐 뒤에만 "릴리스됐어요"', async () => {
    const view = renderAt('/c/CDC01/trf-wave/waves/WAVE-20261126-02');
    expect(await screen.findByText('시스템 번호 WAVE-20261126-02')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('wave-release'));
    await userEvent.click(screen.getByTestId('wave-release-go'));
    expect(await screen.findByText('릴리스됐어요. 피킹 작업이 만들어졌어요.')).toBeInTheDocument();
    const post = view.sent.find((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith('/releases'))!;
    expect(post.headers.get('X-Expected-Version')).toBe('1');
    expect(screen.getByTestId('wave-fields')).toHaveTextContent('전체 1');
  });

  it('ACCEPTED 만 받으면 "접수"로만 — 완료라고 하지 않는다', async () => {
    server.use(http.post(`${API_BASE}/waves/:waveId/releases`, () => HttpResponse.json({ status: 'ACCEPTED', requestId: 'r1' }, { status: 202 })));
    renderAt('/c/CDC01/trf-wave/waves/WAVE-20261126-02');
    await screen.findByText('시스템 번호 WAVE-20261126-02');
    await userEvent.click(screen.getByTestId('wave-release'));
    await userEvent.click(screen.getByTestId('wave-release-go'));
    expect(await screen.findByText('릴리스를 접수했어요. 상태가 바뀌면 여기에 보여요.')).toBeInTheDocument();
    expect(screen.queryByText('릴리스됐어요. 피킹 작업이 만들어졌어요.')).not.toBeInTheDocument();
  });

  it('Wave 상세: 무엇을 묶었는지 — 설명·받는 MFC·수량 합·TRF 표(2026-11-26)', async () => {
    renderAt('/c/CDC01/trf-wave/waves/WAVE-20261126-01');
    const summary = await screen.findByTestId('wave-summary');
    await waitFor(() => expect(summary).toHaveTextContent('MFC-BJG-01, MFC-BNG-01'));
    expect(summary).toHaveTextContent('94');
    expect(screen.getByText('묶은 TRF 2건')).toBeInTheDocument();
    expect(screen.getAllByTestId('wave-trf-row')).toHaveLength(2);
    expect(screen.getByText(/함께 피킹·출고하려고 묶은 단위/)).toBeInTheDocument();
  });

  it('진행 중 Wave 는 릴리스 단추가 꺼져 있다', async () => {
    renderAt('/c/CDC01/trf-wave/waves/WAVE-20261126-01');
    expect(await screen.findByTestId('wave-release')).toBeDisabled();
  });

  it('남의 DC 토큰이면 서버 403 을 권한 없음으로', async () => {
    renderAt('/c/CDC01/trf-wave', as.adminNoCenter);
    expect(await screen.findByText('맡은 DC 가 없어요.')).toBeInTheDocument();
  });
});

describe('Wave 조작', () => {
  it('보류는 사유가 있어야, 보류하면 안내와 [보류 풀기]', async () => {
    renderAt('/c/CDC01/trf-wave/waves/WAVE-20261126-02');
    await userEvent.click(await screen.findByTestId('wave-op-hold'));
    expect(screen.getByTestId('wave-op-go')).toBeDisabled();
    await userEvent.type(screen.getByTestId('wave-op-reason'), '차량 늦음');
    await userEvent.click(screen.getByTestId('wave-op-go'));
    expect(await screen.findByTestId('wave-held')).toHaveTextContent('차량 늦음');
    expect(screen.getByTestId('wave-op-resume')).toBeInTheDocument();
  });

  it('진행 중 Wave 는 취소·합치기·나누기 버튼이 없다', async () => {
    renderAt('/c/CDC01/trf-wave/waves/WAVE-20261126-01');
    await screen.findByTestId('wave-controls');
    expect(screen.getByTestId('wave-op-hold')).toBeInTheDocument();
    expect(screen.queryByTestId('wave-op-cancel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('wave-op-merge')).not.toBeInTheDocument();
  });
});
