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

  it('단계는 서버 값 — 패킹 시작 전이면 "패킹 대기", 막히면 이유, null 이면 "—"+원천 값. 주문번호 없으면 주문 ID 끝 8자리 + 번호 없음, 재발송 표시', async () => {
    const view = renderAt('/packing-handover?mfcId=MFC-BSN-01&state=PREPARING', as.cs);
    expect(within(await rowOf(/25111701/)).getByTestId('packing-stage')).toHaveTextContent('피킹중');
    const waiting = await rowOf(/OCK-2002 번호 없음/);
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
    expect(within(row).getByTestId('packing-packages')).toHaveTextContent('PKG-4-1 · 인계됨'); // 원천 코드는 이름으로, 코드는 마우스를 올리면(2026-11-18)
    expect(within(within(row).getByTestId('packing-packages')).getAllByTitle('HANDED_OVER')[0]).toHaveTextContent('인계됨');
    expect(within(row).getByTestId('packing-packages')).toHaveTextContent('라이더 이*영 · 517204'); // 화면 번호(ADR-0070)
    expect(within(row).getByTestId('packing-delivery')).toHaveTextContent('25111704-1');
  });

  it('취소 출고는 단계 null — "—" 와 원천 값', async () => {
    renderAt('/packing-handover?mfcId=MFC-BSN-01&state=CANCELLED', as.admin);
    const stage = within(await rowOf(/25111705/)).getByTestId('packing-stage');
    expect(stage).toHaveTextContent('출고 취소 · 피킹 취소 · 패킹 -'); // 원천 값은 이름으로(2026-11-18), 코드는 title
    expect(within(stage).getAllByTitle('CANCELLED')).toHaveLength(2);
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
    expect(within(row).getByTestId('packing-delivery')).not.toHaveTextContent('25111704-1');
    expect(within(row).getByTestId('packing-delivery')).not.toHaveTextContent('DLV-MOCK-24');
  });
});

describe('포장 인계 현황 — 화면 번호(bff 0.14.0, ADR-0070)', () => {
  it('주문·배송 번호와 배정 라이더(가린 이름 · 번호) — 시스템 ID 는 링크 대상으로만', async () => {
    renderAt('/packing-handover?mfcId=MFC-BSN-01', as.riderOps);
    const row = await rowOf(/25111704/);
    const delivery = within(row).getByTestId('packing-delivery');
    expect(within(delivery).getByRole('link', { name: '25111704-1' })).toHaveAttribute('href', '/deliveries/DLV-MOCK-24');
    expect(delivery).toHaveTextContent('라이더 이*영 · 517204');
    expect(within(row).getByRole('link', { name: '25111704' })).toHaveAttribute('href', '/orders/ORD-MOCK-2004');
    expect(row).not.toHaveTextContent('DLV-MOCK-24');
    expect(row).not.toHaveTextContent('ORD-MOCK-2004');
    expect(row).not.toHaveTextContent('RID-MOCK-2');
  });

  it('배송 번호가 null 이면 배송 ID 끝 8자리 + "번호 없음"', async () => {
    renderAt('/packing-handover?mfcId=MFC-BSN-01&state=PREPARING', as.cs);
    const delivery = within(await rowOf(/25111701/)).getByTestId('packing-delivery');
    expect(delivery).toHaveTextContent('MOCK-21 번호 없음');
    expect(delivery).not.toHaveTextContent('DLV-MOCK-21');
    expect(delivery).toHaveTextContent('김*수 · 482913');
  });

  it('rider-service 를 못 읽으면 라이더는 "번호 확인 불가"(없음과 구분) — 실패 원천으로 보이고 번호는 그대로', async () => {
    renderAt('/packing-handover?mfcId=MFC-MOCK-NORIDER', as.admin);
    const row = await rowOf(/25111704/);
    expect(within(row).getByTestId('packing-delivery')).toHaveTextContent('D-MOCK-2 번호 확인 불가');
    expect(within(row).getByTestId('packing-delivery')).toHaveTextContent('25111704-1');
    await userEvent.click(within(row).getByRole('button', { name: '포장 3개 보기' }));
    expect(within(row).getByTestId('packing-packages')).toHaveTextContent('라이더 D-MOCK-2 번호 확인 불가');
    expect(screen.getByText(/못 읽음: .*라이더/)).toHaveAttribute('title', expect.stringMatching(/조회하지 못한 원천: .*rider-service/)); // 원천 표시 한 줄(2026-11-18) — 업무 이름, 원래 이름은 마우스
  });
});
