// 포장 인계 현황(bff 0.11.0) — 센터 필수, 단계는 서버 값(패킹 대기·막힘 보조), 수량, 원천 실패
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

const rowOf = async (text: RegExp) => (await screen.findAllByTestId('packing-row')).find((r) => text.test(r.textContent ?? ''))!;

describe('포장 인계 현황', () => {
  it('센터를 고르기 전에는 묻지 않는다 — 메뉴는 조회·현황에', async () => {
    const view = renderAt('/packing-handover', as.cs);
    expect(await screen.findByTestId('packing-pick-center')).toBeInTheDocument();
    expect(view.sent.some((r) => new URL(r.url).pathname.endsWith('/views/packing-handover'))).toBe(false);
    const lookup = screen.getByTestId('nav-group-lookup');
    expect(within(lookup).getAllByRole('link', { hidden: true }).map((a) => a.textContent)).toContain('포장 인계 현황');
  });

  it('단계는 서버 값 — 패킹 시작 전이면 "패킹 대기", 막히면 이유, null 이면 "—"+원천 값. 주문번호 없으면 주문 ID, 재발송 표시', async () => {
    const view = renderAt('/packing-handover?mfcId=MFC-BSN-01&state=PREPARING', as.cs);
    expect(within(await rowOf(/25111701/)).getByTestId('packing-stage')).toHaveTextContent('피킹중');
    const waiting = await rowOf(/ORD-MOCK-2002/);
    expect(within(waiting).getByTestId('packing-stage')).toHaveTextContent('패킹 대기');
    expect(waiting).toHaveTextContent('재발송');
    expect(within(await rowOf(/25111703/)).getByTestId('packing-stage')).toHaveTextContent('막힘: PACKAGE_MISMATCH');
    const q = new URL(view.sent.find((r) => new URL(r.url).pathname.endsWith('/views/packing-handover'))!.url).searchParams;
    expect(q.get('mfcId')).toBe('MFC-BSN-01');
    expect(q.getAll('state')).toEqual(['PREPARING']);
  });

  it('일부 인계: "포장 3 · 인계 1 · 남음 2", 펼치면 포장별 인계 시각·라이더, 배송 상태', async () => {
    renderAt('/packing-handover?mfcId=MFC-BSN-01', as.riderOps);
    const row = await rowOf(/25111704/);
    expect(within(row).getByTestId('packing-qty')).toHaveTextContent('포장 3 · 인계 1 · 남음 2');
    await userEvent.click(within(row).getByRole('button', { name: '포장 3개 보기' }));
    expect(within(row).getByTestId('packing-packages')).toHaveTextContent('PKG-4-1 · HANDED_OVER');
    expect(within(row).getByTestId('packing-packages')).toHaveTextContent('라이더 RID-MOCK-2');
    expect(within(row).getByTestId('packing-delivery')).toHaveTextContent('DLV-MOCK-24');
  });

  it('취소 출고는 단계 null — "—" 와 원천 값', async () => {
    renderAt('/packing-handover?mfcId=MFC-BSN-01&state=CANCELLED', as.admin);
    expect(within(await rowOf(/25111705/)).getByTestId('packing-stage')).toHaveTextContent('출고 CANCELLED · 피킹 CANCELLED · 패킹 -');
  });

  it('MFC 원천을 못 읽으면 0건이 아니라 실패, 배송 원천만 못 읽으면 배송 칸만 "—"', async () => {
    renderAt('/packing-handover?mfcId=MFC-MOCK-DOWN', as.admin);
    expect(await screen.findByTestId('packing-mfc-failed')).toHaveTextContent('0건이 아니에요');
    expect(screen.queryByText('이 조건의 출고가 없어요.')).not.toBeInTheDocument();
  });

  it('배송 원천만 실패하면 배송 칸만 "—"', async () => {
    renderAt('/packing-handover?mfcId=MFC-MOCK-NODLV', as.admin);
    const row = await rowOf(/25111704/);
    expect(within(row).getByTestId('packing-delivery')).toHaveTextContent('-');
    expect(within(row).getByTestId('packing-delivery')).not.toHaveTextContent('DLV-MOCK-24');
  });
});
