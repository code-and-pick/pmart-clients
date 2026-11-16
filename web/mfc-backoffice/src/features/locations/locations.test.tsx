// 위치(칸) 화면 — mfc-location-service 0.7.1 목으로 확인한다.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pollConfig } from '@pmart/web-core';
import { API_BASE } from '../../api/client';
import { db } from '../../mocks/db';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';
import { LOCATION_PAGE_SIZE } from './LocationPages';

const saved = { ...pollConfig };
beforeEach(() => {
  pollConfig.maxAttempts = 2;
  pollConfig.sleep = () => Promise.resolve();
});
afterEach(() => Object.assign(pollConfig, saved));

const rows = () => screen.getAllByTestId('location-row');
const codes = () => rows().map((r) => within(r).getAllByRole('cell')[0]!.textContent);
const sentBody = async (r: Request) => (await r.clone().json()) as Record<string, unknown>;

describe('칸 목록', () => {
  it('그 센터의 칸만, 코드 순 — 다른 센터 칸은 없다', async () => {
    const view = renderAt('/c/MFC-BSN-01/locations');
    await waitFor(() => expect(rows()).toHaveLength(6));
    expect(codes()).toEqual(['A-P1-01-1-01', 'C-S1-03-2-04', 'F-S2-02-1-03', 'OLD-SHELF-7', 'QRT-A-01', 'RCV-C-01']);
    expect(new URL(view.gets('/locations')[0]!.url).searchParams.get('mfcId')).toBe('MFC-BSN-01');
  });

  it('거르기는 URL 쿼리로 서버에 보낸다(상태 = 닫힘)', async () => {
    const view = renderAt('/c/MFC-BSN-01/locations?state=CLOSED');
    await waitFor(() => expect(codes()).toEqual(['F-S2-02-1-03', 'QRT-A-01']));
    expect(new URL(view.gets('/locations').at(-1)!.url).searchParams.get('state')).toBe('CLOSED');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '온도대' }), 'FROZEN');
    await waitFor(() => expect(codes()).toEqual(['F-S2-02-1-03']));
    const last = new URL(view.gets('/locations').at(-1)!.url).searchParams;
    expect([last.get('state'), last.get('temperatureZone')]).toEqual(['CLOSED', 'FROZEN']);
  });

  it('더 보기: 다음 커서로 이어 받는다', async () => {
    for (let i = 0; i < LOCATION_PAGE_SIZE; i++) {
      const id = `LOC-X${i}`;
      const n = String(i).padStart(2, '0');
      const base = db.locations.get('LOC-3')!;
      db.locations.set(id, { ...base, locationId: id, locationCode: `PAK-A-${n}`, zone: 'PACKING', temperatureZone: 'AMBIENT' });
    }
    renderAt('/c/MFC-BSN-01/locations');
    await waitFor(() => expect(rows()).toHaveLength(LOCATION_PAGE_SIZE));
    await userEvent.click(screen.getByRole('button', { name: '더 보기' }));
    await waitFor(() => expect(rows()).toHaveLength(LOCATION_PAGE_SIZE + 6));
    expect(screen.queryByRole('button', { name: '더 보기' })).not.toBeInTheDocument();
  });

  it('조회 실패는 빈 목록이 아니라 오류', async () => {
    server.use(http.get(`${API_BASE}/locations`, () => new HttpResponse(null, { status: 500 })));
    renderAt('/c/MFC-BSN-01/locations');
    expect(await screen.findByRole('alert')).toHaveAttribute('data-state', 'error');
    expect(screen.queryByText('조건에 맞는 칸이 없어요.')).not.toBeInTheDocument();
  });

  it('서버 403 은 "이용할 수 없는 화면"(센터 관리자가 아닌 역할)', async () => {
    server.use(
      http.get(`${API_BASE}/locations`, () =>
        HttpResponse.json({ type: 'about:blank', status: 403, code: 'FORBIDDEN' }, { status: 403, headers: { 'content-type': 'application/problem+json' } }),
      ),
    );
    renderAt('/c/MFC-BSN-01/locations', as.adminWithCenter);
    await waitFor(() => expect(document.querySelector('[data-state="forbidden"]')).not.toBeNull());
  });
});

describe('칸 등록', () => {
  it('등록 → 키·출처 헤더를 붙여 보내고, 만든 칸 상세로', async () => {
    const view = renderAt('/c/MFC-BSN-01/locations/new');
    await userEvent.type(await screen.findByRole('textbox', { name: /칸 코드/ }), 'c-s1-04-1-01');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '온도대' }), 'CHILLED');
    await userEvent.type(screen.getByRole('spinbutton', { name: '슬롯 수' }), '6');
    await userEvent.click(screen.getByRole('button', { name: '칸 등록' }));
    expect(await screen.findByRole('heading', { name: /C-S1-04-1-01/ })).toBeInTheDocument();
    const post = view.sent.find((r) => r.method === 'POST' && r.url.endsWith('/locations'))!;
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(post.headers.get('X-Source-System')).toBe('mfc-backoffice-web');
    expect(await sentBody(post)).toMatchObject({ mfcId: 'MFC-BSN-01', locationCode: 'C-S1-04-1-01', zone: 'STORAGE', temperatureZone: 'CHILLED', dimensions: { slotCount: 6 }, position: null });
    expect([...db.locations.values()].some((l) => l.locationCode === 'C-S1-04-1-01')).toBe(true);
  });

  it('같은 코드가 있으면 LOCATION_CODE_DUPLICATE 문구', async () => {
    renderAt('/c/MFC-BSN-01/locations/new');
    await userEvent.type(await screen.findByRole('textbox', { name: /칸 코드/ }), 'RCV-C-01');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '구역 종류' }), 'RECEIVING');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '온도대' }), 'CHILLED');
    await userEvent.click(screen.getByRole('button', { name: '칸 등록' }));
    expect(await screen.findByText('이 센터에 같은 칸 코드가 이미 있어요.')).toBeInTheDocument();
  });

  it('도면 좌표는 둘 다 넣거나 둘 다 비운다', async () => {
    renderAt('/c/MFC-BSN-01/locations/new');
    await userEvent.type(await screen.findByRole('textbox', { name: /칸 코드/ }), 'A-S1-01-1-02');
    await userEvent.type(screen.getByRole('spinbutton', { name: /도면 x/ }), '3');
    expect(screen.getByText('도면 x 와 z 는 둘 다 넣거나 둘 다 비워 주세요.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '칸 등록' })).toBeDisabled();
  });
});

describe('칸 상세', () => {
  it('속성 변경은 전체 교체 + X-Expected-Version — 고치지 않은 도면 좌표도 다시 보낸다', async () => {
    const view = renderAt('/c/MFC-BSN-01/locations/LOC-1');
    expect(await screen.findByRole('heading', { name: /C-S1-03-2-04/ })).toBeInTheDocument();
    await userEvent.click(screen.getByText('속성 고치기'));
    expect(screen.getByRole('textbox', { name: /칸 코드/ })).toHaveAttribute('readonly');
    const pick = screen.getByRole('spinbutton', { name: '피킹 순서' });
    await userEvent.clear(pick);
    await userEvent.type(pick, '20');
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('저장했어요.')).toBeInTheDocument();
    const put = view.sent.find((r) => r.method === 'PUT')!;
    expect(put.headers.get('X-Expected-Version')).toBe('1');
    expect(await sentBody(put)).toMatchObject({ pickSequence: 20, position: { xM: 4.5, zM: 12 }, categoryId: 'CAT-DAIRY' });
    expect(db.locations.get('LOC-1')!.version).toBe(2);
  });

  it('다른 사람이 먼저 바꿨으면 VERSION_CONFLICT 문구', async () => {
    renderAt('/c/MFC-BSN-01/locations/LOC-1');
    await screen.findByRole('heading', { name: /C-S1-03-2-04/ });
    db.locations.set('LOC-1', { ...db.locations.get('LOC-1')!, version: 5 });
    await userEvent.click(screen.getByText('속성 고치기'));
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('다른 사람이 먼저 바꿨어요. 새로 고침한 뒤 다시 해 주세요.')).toBeInTheDocument();
  });

  it('닫기: 사유가 있어야 보낸다 → 닫힘으로 다시 읽는다', async () => {
    const view = renderAt('/c/MFC-BSN-01/locations/LOC-3');
    await screen.findByRole('heading', { name: /RCV-C-01/ });
    const close = screen.getByRole('button', { name: '닫기' });
    expect(close).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: '닫기 사유' }), '바닥 공사');
    await userEvent.click(close);
    expect(await screen.findByText('닫았어요.')).toBeInTheDocument();
    const post = view.sent.find((r) => r.method === 'POST' && r.url.includes('/state-changes'))!;
    expect(await sentBody(post)).toEqual({ targetState: 'CLOSED', reason: '바닥 공사' });
    expect(post.headers.get('X-Expected-Version')).toBe('1');
    await waitFor(() => expect(screen.getByRole('heading', { name: /RCV-C-01/ })).toHaveTextContent('닫힘'));
  });

  it('닫기 응답이 ACCEPTED 면 완료로 보이지 않고 짝 조회(…/state-changes/{requestId})로 확정한다', async () => {
    server.use(
      http.post(`${API_BASE}/locations/:locationId/state-changes`, ({ request }) =>
        HttpResponse.json({ status: 'ACCEPTED', requestId: request.headers.get('Idempotency-Key') }, { status: 202 }),
      ),
      http.get(`${API_BASE}/locations/:locationId/state-changes/:requestId`, ({ params }) =>
        HttpResponse.json({ requestId: params.requestId, status: 'APPLIED', fromState: 'ACTIVE', toState: 'CLOSED', newVersion: 2 }),
      ),
    );
    const view = renderAt('/c/MFC-BSN-01/locations/LOC-3');
    await screen.findByRole('heading', { name: /RCV-C-01/ });
    await userEvent.type(screen.getByRole('textbox', { name: '닫기 사유' }), '점검');
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(await screen.findByText('닫았어요.')).toBeInTheDocument();
    const key = view.sent.find((r) => r.method === 'POST')!.headers.get('Idempotency-Key');
    expect(view.gets(`/state-changes/${key}`)).toHaveLength(1);
  });

  it('결과 불명이면 실패로 확정하지 않고, "다시 확인"은 같은 키로 보낸다', async () => {
    let calls = 0;
    server.use(
      http.post(`${API_BASE}/locations/:locationId/state-changes`, () => {
        calls += 1;
        return new HttpResponse(null, { status: 504 });
      }),
      http.get(`${API_BASE}/locations/:locationId/state-changes/:requestId`, () => new HttpResponse(null, { status: 404 })),
    );
    const view = renderAt('/c/MFC-BSN-01/locations/LOC-3');
    await screen.findByRole('heading', { name: /RCV-C-01/ });
    await userEvent.type(screen.getByRole('textbox', { name: '닫기 사유' }), '점검');
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    const unknown = await screen.findByText('결과를 확인하고 있어요', { exact: false });
    expect(unknown.closest('[data-state="unknown"]')).not.toBeNull();
    expect(screen.queryByText('닫았어요.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '닫기' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /같은 요청으로/ }));
    await waitFor(() => expect(calls).toBe(2));
    const keys = view.sent.filter((r) => r.method === 'POST').map((r) => r.headers.get('Idempotency-Key'));
    expect(new Set(keys).size).toBe(1);
  });

  it('닫힌 칸: 다시 열기와 폐지(확인 표시를 해야 누를 수 있다) — 폐지되면 바꿀 수 없다', async () => {
    renderAt('/c/MFC-BSN-01/locations/LOC-4');
    await screen.findByRole('heading', { name: /F-S2-02-1-03/ });
    expect(screen.getByRole('button', { name: '다시 열기' })).toBeInTheDocument();
    const retire = screen.getByRole('button', { name: '폐지' });
    expect(retire).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /이 칸을 폐지합니다/ }));
    await userEvent.click(retire);
    expect(await screen.findByText('폐지했어요.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('폐지된 칸이라 바꿀 수 없어요.')).toBeInTheDocument());
    expect(screen.queryByText('속성 고치기')).not.toBeInTheDocument();
    expect(db.locations.get('LOC-4')!.state).toBe('RETIRED');
  });

  it('재고가 남은 칸 폐지는 서버가 INVALID_STATE 로 거절 — 거절 문구', async () => {
    renderAt('/c/MFC-BSN-01/locations/LOC-5');
    await screen.findByRole('heading', { name: /QRT-A-01/ });
    await userEvent.click(screen.getByRole('checkbox', { name: /이 칸을 폐지합니다/ }));
    await userEvent.click(screen.getByRole('button', { name: '폐지' }));
    expect(await screen.findByText('지금 상태에서는 할 수 없는 요청이에요. 새로 불러온 뒤 확인해 주세요.')).toBeInTheDocument();
    expect(db.locations.get('LOC-5')!.state).toBe('CLOSED');
  });

  it('폐지 응답이 ACCEPTED 면 칸을 다시 읽어 RETIRED 일 때만 완료', async () => {
    server.use(
      http.delete(`${API_BASE}/locations/:locationId`, ({ request, params }) => {
        const loc = db.locations.get(String(params.locationId))!;
        db.locations.set(loc.locationId, { ...loc, state: 'RETIRED', version: loc.version + 1 });
        return HttpResponse.json({ status: 'ACCEPTED', requestId: request.headers.get('Idempotency-Key') }, { status: 202 });
      }),
    );
    const view = renderAt('/c/MFC-BSN-01/locations/LOC-4');
    await screen.findByRole('heading', { name: /F-S2-02-1-03/ });
    const before = view.gets('/locations/LOC-4').length;
    await userEvent.click(screen.getByRole('checkbox', { name: /이 칸을 폐지합니다/ }));
    await userEvent.click(screen.getByRole('button', { name: '폐지' }));
    expect(await screen.findByText('폐지했어요.')).toBeInTheDocument();
    expect(view.gets('/locations/LOC-4').length).toBeGreaterThan(before);
  });

  it('실사 잠금 칸은 이 화면에서 풀지 않는다', async () => {
    db.locations.set('LOC-3', { ...db.locations.get('LOC-3')!, state: 'COUNT_LOCKED' });
    renderAt('/c/MFC-BSN-01/locations/LOC-3');
    expect(await screen.findByText('실사 중이라 잠겼어요. 실사가 끝나면 풀려요.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '닫기' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '다시 열기' })).not.toBeInTheDocument();
  });
});
