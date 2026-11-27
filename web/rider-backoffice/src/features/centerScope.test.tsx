// 머리줄 센터 고르기(RS-7, 2026-11-23 — 사용자 "센터를 고르면 그 해당 센터에 해당하는 라이더 정보를 볼 수 있게"). 목(MSW) 기준.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

const listCalls = (sent: readonly Request[], path: string) => sent.filter((r) => new URL(r.url).pathname.endsWith(path));

async function pickHeaderCenter() {
  const box = await screen.findByTestId('header-center');
  const picker = await within(box).findByRole('combobox', { name: '센터' });
  await waitFor(() => expect(picker).not.toBeDisabled());
  await userEvent.click(picker);
  const options = await screen.findAllByRole('option');
  await userEvent.click(options.find((o) => o.textContent?.includes('부산진구'))!);
}

describe('머리줄 센터 고르기(RS-7)', () => {
  it('모든 센터면 mfcId 없이, 센터를 고르면 라이더 목록·숫자 띠에 mfcId 를 붙인다', async () => {
    const view = renderAt('/riders', as.riderOps);
    await screen.findAllByTestId('rider-row');
    expect(listCalls(view.sent, '/riders').every((r) => !new URL(r.url).searchParams.has('mfcId'))).toBe(true);
    await pickHeaderCenter();
    await waitFor(() => expect(listCalls(view.sent, '/riders').some((r) => new URL(r.url).searchParams.get('mfcId') === 'MFC-BSJ-01')).toBe(true));
    await waitFor(() => expect(listCalls(view.sent, '/riders/stats').some((r) => new URL(r.url).searchParams.get('mfcId') === 'MFC-BSJ-01')).toBe(true));
  });

  it('고른 센터는 화면을 옮겨도 남는다 — 배송 목록도 그 센터로', async () => {
    const view = renderAt('/riders', as.riderOps);
    await screen.findAllByTestId('rider-row');
    await pickHeaderCenter();
    await userEvent.click(screen.getAllByRole('link', { name: '배송 관리' })[0]!);
    await waitFor(() => expect(listCalls(view.sent, '/deliveries').some((r) => new URL(r.url).searchParams.get('mfcId') === 'MFC-BSJ-01')).toBe(true));
  });
});

// 2026-11-27 사용자 "대시보드·관제는 부산진구인데 운영 통계·배송 관리는 모든 센터 — 같은 센터로 고정"
describe('처음 머리줄 센터 = 부산진구(2026-11-27)', () => {
  it('운영 통계·배송 관리도 처음부터 부산진구 센터로 묻는다', async () => {
    const view = renderAt('/deliveries', as.riderOps, '부산진구');
    await waitFor(() => expect(listCalls(view.sent, '/deliveries').some((r) => new URL(r.url).searchParams.get('mfcId') === 'MFC-BSJ-01')).toBe(true));
    await userEvent.click(screen.getAllByRole('link', { name: '운영 통계' })[0]!);
    await waitFor(() => expect(view.sent.some((r) => new URL(r.url).pathname.includes('metrics') && new URL(r.url).searchParams.get('mfcId') === 'MFC-BSJ-01')).toBe(true));
  });

  it('"모든 센터"를 고르면 다시 덮지 않는다', async () => {
    const view = renderAt('/riders', as.riderOps, '부산진구');
    await waitFor(() => expect(listCalls(view.sent, '/riders').some((r) => new URL(r.url).searchParams.get('mfcId') === 'MFC-BSJ-01')).toBe(true));
    const picker = within(await screen.findByTestId('header-center')).getByRole('combobox', { name: '센터' });
    await userEvent.click(picker);
    const options = await screen.findAllByRole('option');
    await userEvent.click(options.find((o) => o.textContent?.includes('모든 센터'))!);
    // 기본 센터로 다시 돌아가지 않는다 — 다른 화면으로 가도 모든 센터
    await userEvent.click(screen.getAllByRole('link', { name: '배송 관리' })[0]!);
    await waitFor(() => expect(listCalls(view.sent, '/deliveries').length).toBeGreaterThan(0));
    expect(listCalls(view.sent, '/deliveries').every((r) => !new URL(r.url).searchParams.has('mfcId'))).toBe(true);
  });
});
