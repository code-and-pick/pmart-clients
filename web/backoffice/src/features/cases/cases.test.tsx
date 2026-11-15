// 지원센터 사건함(case 0.4.0) — 탭(안 집은·내 것·기한 넘김·닫힌), 집기·닫기, 역할별 버튼, 오배송 열기.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

const rows = () => screen.findAllByTestId('case-row');

describe('지원센터 사건', () => {
  it('안 집은 것: 긴급 먼저, 기한 넘김 빨간 표시, 관련 배송·주문·라이더 링크', async () => {
    const view = renderAt('/cases', as.riderOps);
    const list = await rows();
    expect(list).toHaveLength(2);
    expect(list[0]).toHaveTextContent('라이더 도움요청');
    expect(within(list[0]!).getByText(/기한 넘김/)).toHaveAttribute('data-overdue', 'true');
    expect(within(list[0]!).getByRole('link', { name: '배송 DLV-MOCK-1' })).toHaveAttribute('href', '/deliveries/DLV-MOCK-1');
    expect(within(list[0]!).getByRole('link', { name: '주문 ORD-MOCK-1001' })).toHaveAttribute('href', '/orders/ORD-MOCK-1001');
    expect(within(list[0]!).getByRole('link', { name: '라이더 RID-MOCK-1' })).toHaveAttribute('href', '/riders/RID-MOCK-1');
    expect(new URL(view.sent.find((r) => new URL(r.url).pathname.endsWith('/cases'))!.url).searchParams.get('unassigned')).toBe('true');
  });

  it('탭: 내 것(assigneeId=나)·기한 넘김·닫힌 것', async () => {
    const view = renderAt('/cases', as.riderOps);
    await rows();
    await userEvent.click(screen.getByRole('tab', { name: '내 것' }));
    await waitFor(() => expect(screen.getAllByTestId('case-row')).toHaveLength(1));
    expect(screen.getByTestId('case-row')).toHaveTextContent('위치 끊김');
    expect(view.sent.some((r) => new URL(r.url).searchParams.get('assigneeId') === 'op-rider-ops-1')).toBe(true);
    await userEvent.click(screen.getByRole('tab', { name: '닫힌 것' }));
    await waitFor(() => expect(screen.getByTestId('case-row')).toHaveTextContent('오배송'));
  });

  it('집기: 내 운영자 ID 로 assignments → 담당이 나로 바뀌고 닫기 폼이 보인다', async () => {
    const view = renderAt('/cases/CASE-MOCK-2', as.riderOps);
    await userEvent.click(await screen.findByRole('button', { name: '내가 집기' }));
    await waitFor(() => expect(screen.getByTestId('case-assignee')).toHaveTextContent('op-rider-ops-1'));
    const sent = view.mutations('/cases/CASE-MOCK-2/assignments')[0]!;
    expect(sent.headers.get('Idempotency-Key')).toBeTruthy();
    expect(sent.headers.get('X-Source-System')).toBe('backoffice-web');
    expect(await sent.json()).toEqual({ assigneeId: 'op-rider-ops-1' });
    expect(screen.queryByRole('button', { name: '내가 집기' })).not.toBeInTheDocument();
  });

  it('닫기: 결과 + 요약(개인정보 안내) → closures → 닫힘·종결 기록', async () => {
    const view = renderAt('/cases/CASE-MOCK-3', as.riderOps); // 내가 집은 사건
    const form = await screen.findByRole('form', { name: '닫기' });
    expect(within(form).getByText(/고객 주소·연락처 원문은 적지 마세요/)).toBeInTheDocument();
    await userEvent.selectOptions(within(form).getByLabelText('결과'), 'NO_ACTION_REQUIRED');
    await userEvent.type(within(form).getByLabelText('종결 요약'), '위치 다시 들어옴');
    await userEvent.click(within(form).getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.getByTestId('case-state')).toHaveTextContent('닫힘'));
    expect(screen.getByTestId('case-closure')).toHaveTextContent('조치 필요 없음');
    expect(await view.mutations('/closures')[0]!.json()).toEqual({ resolution: 'NO_ACTION_REQUIRED', summary: '위치 다시 들어옴' });
  });

  it('상담원은 보기만 — 집기·닫기 없음', async () => {
    renderAt('/cases/CASE-MOCK-2', as.cs);
    expect(await screen.findByText('상담원은 사건을 보기만 해요(집기·닫기는 지원센터 담당).')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '내가 집기' })).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: '닫기' })).not.toBeInTheDocument();
  });

  it('관리자는 다른 사람에게 배정할 수 있다', async () => {
    const view = renderAt('/cases/CASE-MOCK-1', as.admin);
    const form = await screen.findByRole('form', { name: '다른 사람에게 배정(관리자)' });
    await userEvent.type(within(form).getByPlaceholderText('운영자 ID'), 'op-cs-rider-1');
    await userEvent.click(within(form).getByRole('button', { name: '배정' }));
    await waitFor(() => expect(screen.getByTestId('case-assignee')).toHaveTextContent('op-cs-rider-1'));
    expect(await view.mutations('/assignments')[0]!.json()).toEqual({ assigneeId: 'op-cs-rider-1' });
  });

  it('오배송 열기: MISDELIVERY·DELIVERY·배송 번호 → 새 사건 상세, 같은 배송 다시 열면 409 CASE_ALREADY_OPEN', async () => {
    const view = renderAt('/cases/new-misdelivery?deliveryId=DLV-MOCK-2', as.cs);
    expect(await screen.findByLabelText('배송 번호')).toHaveValue('DLV-MOCK-2');
    await userEvent.type(screen.getByLabelText('요약'), '옆 동 경비실로 전달됨(고객 확인)');
    await userEvent.click(screen.getByRole('button', { name: '오배송 사건 열기' }));
    expect(await screen.findByRole('heading', { name: /사건 CASE-MOCK-101/ })).toBeInTheDocument();
    expect(await view.mutations('/cases')[0]!.json()).toEqual({ kind: 'MISDELIVERY', subjectType: 'DELIVERY', subjectRef: 'DLV-MOCK-2', summary: '옆 동 경비실로 전달됨(고객 확인)' });

    view.unmount();
    renderAt('/cases/new-misdelivery?deliveryId=DLV-MOCK-2', as.cs);
    await userEvent.type(await screen.findByLabelText('요약'), '다시');
    await userEvent.click(screen.getByRole('button', { name: '오배송 사건 열기' }));
    expect(await screen.findByText('이 배송의 오배송 사건이 이미 열려 있어요.')).toBeInTheDocument();
  });
});
