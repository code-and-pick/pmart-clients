// 우리 센터 배송 현황(bff 0.3.1)·배차 실패 사건(case 0.5.2, 보기만) — 목(MSW) 기준. 실서버 확인은 아니다.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

const liveCalls = (sent: readonly Request[]) => sent.filter((r) => new URL(r.url).pathname.endsWith('/backoffice/views/live-delivery')).map((r) => new URL(r.url).searchParams);
const caseCalls = (sent: readonly Request[]) => sent.filter((r) => new URL(r.url).pathname.endsWith('/cases')).map((r) => new URL(r.url).searchParams);

describe('배송 현황(우리 센터)', () => {
  it('주소의 센터로 고정해 부르고, 진행 중 배송만 원천별 열로 — 배차 실패 사건은 이 앱의 사건 상세로', async () => {
    const view = renderAt('/c/MFC-BSN-01/deliveries');
    const rows = await screen.findAllByTestId('center-live-row');
    expect(rows).toHaveLength(2); // 끝난 배송·다른 센터 배송은 없다
    expect(screen.queryByText('DLV-C-3')).not.toBeInTheDocument();
    expect(screen.queryByText('DLV-S-1')).not.toBeInTheDocument();
    const failed = rows.find((r) => r.textContent?.includes('DLV-C-1'))!;
    expect(within(failed).getByText('미배정', { selector: 'td' })).toBeInTheDocument();
    expect(within(failed).getByTestId('dispatch-state')).toHaveTextContent('배차 실패');
    expect(within(failed).getByText('약속 지남')).toBeInTheDocument();
    expect(within(failed).getByRole('link', { name: '배차 실패 P2' })).toHaveAttribute('href', '/c/MFC-BSN-01/dispatch-failures/CASE-DF-1');
    // 화면 번호(ADR-0070): 번호가 있으면 배송 주문번호-순번·주문번호 8자리, 없으면 번호 없음.
    // 라이더: bff 는 센터 관리자에게 번호를 안 주지만(0.15.0) rider display-names(0.18.0 RS-MFC)로 "이*진 · 377102"
    const moving = rows.find((r) => r.textContent?.includes('20000002-1'))!;
    expect(moving).toHaveTextContent('20000002');
    await waitFor(() => expect(moving).toHaveTextContent('이*진 · 377102'));
    expect(moving).not.toHaveTextContent('RD-7');
    expect(failed).toHaveTextContent('번호 없음');
    const q = liveCalls(view.sent)[0]!;
    expect([q.get('mfcId'), q.get('size'), q.get('state'), q.get('cursor')]).toEqual(['MFC-BSN-01', '50', null, null]);
  });

  it('원천을 못 읽으면 "모름"·"조회 실패"(0건과 구분)와 못 읽은 원천 경고', async () => {
    renderAt('/c/MFC-BSN-01/deliveries');
    await screen.findAllByTestId('center-live-row');
    await userEvent.selectOptions(screen.getByLabelText('수행 상태'), 'SUSPENDED');
    // 목: SUSPENDED 배송은 없다 → 빈 목록이지만 원천 경고는 보인다
    expect(await screen.findByRole('alert')).toHaveTextContent('delivery-dispatch-service');
  });
});

describe('배차 실패(우리 센터, 보기만)', () => {
  it('처리 중: 우리 센터 DISPATCH_FAILED 만, 기한 넘김 표시, 처리는 지원센터 안내 — 맡기·닫기 버튼 없음', async () => {
    const view = renderAt('/c/MFC-BSN-01/dispatch-failures');
    const rows = await screen.findAllByTestId('dispatch-failure-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('응답 만료');
    // 목록에는 접수 번호만(ADR-0070 덧붙임) — 관련 배송·주문 시스템 ID 는 상세의 시스템 번호 칸
    expect(rows[0]).toHaveTextContent('C-1116-0007');
    expect(rows[0]).not.toHaveTextContent('DLV-C-1');
    expect(within(rows[0]!).getByText(/기한 넘김/)).toHaveAttribute('data-overdue', 'true');
    expect(screen.getByRole('note')).toHaveTextContent('지원센터');
    expect(screen.queryByRole('button', { name: /맡기|닫기/ })).not.toBeInTheDocument();
    const q = caseCalls(view.sent)[0]!;
    expect([q.get('kind'), q.get('centerId'), q.get('state')]).toEqual(['DISPATCH_FAILED', 'MFC-BSN-01', null]);
  });

  it('처리 끝남 탭은 state=CLOSED(주소에 남음)', async () => {
    const view = renderAt('/c/MFC-BSN-01/dispatch-failures');
    await screen.findAllByTestId('dispatch-failure-row');
    await userEvent.click(screen.getByRole('tab', { name: '처리 끝남' }));
    await waitFor(() => expect(screen.getByTestId('dispatch-failure-row')).toHaveTextContent('시스템 장애'));
    expect(caseCalls(view.sent).some((q) => q.get('state') === 'CLOSED')).toBe(true);
  });

  it('상세: 요약·관련·기한·이력(재발), 종결 — 보기만', async () => {
    renderAt('/c/MFC-BSN-01/dispatch-failures/CASE-DF-1');
    const detail = await screen.findByTestId('dispatch-failure-detail');
    expect(detail).toHaveTextContent('배차 실패 2번째');
    expect(detail).toHaveTextContent('아직 아무도 안 맡음');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('배차 실패 접수 건 C-1116-0007');
    expect(screen.getByTestId('system-numbers')).toHaveTextContent('CASE-DF-1');
    expect(screen.getByTestId('system-numbers')).toHaveTextContent('DLV-C-1');
    expect(screen.getByTestId('dispatch-failure-history')).toHaveTextContent('재발');
    // 명령 단추 없음(시스템 번호 복사 단추만 — 머리줄 단축키·앱 바꾸기(⋮⋮⋮, 링크 메뉴)·밝은/어두운 화면은 명령 아님)
    expect(screen.getAllByRole('button').every((b) => /복사|단축키|앱 바꾸기|화면으로/.test(b.getAttribute('aria-label') ?? ''))).toBe(true);
  });

  it('다른 센터 사건은 404 — 없음(권한 밖) 화면', async () => {
    renderAt('/c/MFC-BSN-01/dispatch-failures/CASE-DF-S');
    await waitFor(() => expect(document.querySelector('main [data-state]')).not.toBeNull());
    expect(screen.queryByTestId('dispatch-failure-detail')).not.toBeInTheDocument();
  });

  it('센터가 둘인 관리자는 고른 센터 것만', async () => {
    const view = renderAt('/c/MFC-SEL-01/dispatch-failures', as.sup2);
    const rows = await screen.findAllByTestId('dispatch-failure-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('다른 센터 배차 실패');
    expect(caseCalls(view.sent)[0]!.get('centerId')).toBe('MFC-SEL-01');
  });
});
