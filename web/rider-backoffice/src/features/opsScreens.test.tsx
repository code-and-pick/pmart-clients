// 라이더 운영 화면(2026-11-17, PC 5) — 목(MSW) 기준. 실서버 확인은 아니다.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

const posts = (sent: readonly Request[], part: string) => sent.filter((r) => r.method === 'POST' && new URL(r.url).pathname.includes(part));

describe('대시보드', () => {
  it('라이더 수·배송 수·처리할 일을 원천마다 보인다', async () => {
    renderAt('/dashboard', as.riderOps);
    expect(await screen.findByTestId('stat-riders-total')).toHaveTextContent('2');
    expect(screen.getByTestId('stat-on-duty')).toHaveTextContent('1');
    expect(await screen.findByTestId('stat-in-progress')).toHaveTextContent('4');
    expect(screen.getByTestId('stat-surcharges')).toHaveTextContent('1');
    expect(screen.getByTestId('stat-by-state')).toHaveTextContent(/픽업\s*2/);
  });
});

describe('라이더', () => {
  it('찾기 목록에 가입 승인(자동 승인), 상세에 수행료·운행시간, 원문은 사유를 넣어야', async () => {
    const view = renderAt('/riders', as.riderOps);
    const rows = await screen.findAllByTestId('rider-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('자동 승인')).toBeInTheDocument();
    await userEvent.click(within(rows[0]!).getByRole('link', { name: 'R4829' }));
    expect(await screen.findByTestId('rider-detail')).toHaveTextContent('자동 승인');
    expect(await screen.findByTestId('operating-time')).toHaveTextContent('1시간 30분');
    expect(await screen.findByTestId('rider-earnings')).toHaveTextContent('D48213110'); // 배송 번호(ADR-0070) — 시스템 ID 대신
    const reveal = screen.getByRole('form', { name: '이름·전화 원문 보기' });
    expect(within(reveal).getByRole('button', { name: '원문 보기' })).toBeDisabled();
    await userEvent.type(within(reveal).getByLabelText('사유(2~200자)'), '컴플레인 확인');
    await userEvent.click(within(reveal).getByRole('button', { name: '원문 보기' }));
    expect(await screen.findByTestId('pii-revealed')).toHaveTextContent('김민수');
    expect(posts(view.sent, '/pii-reveals')[0]!.headers.get('Idempotency-Key')).toBeTruthy();
  });

  it('계정 제한을 바꾸면 행 버전을 X-Expected-Version 으로 보낸다', async () => {
    const view = renderAt('/riders/RD-7', as.riderOps);
    await screen.findByTestId('rider-detail');
    const form = await screen.findByRole('form', { name: '계정 제한 걸기·풀기' });
    await screen.findByText('—', { selector: 'p' }).catch(() => undefined);
    await userEvent.selectOptions(within(form).getByLabelText('바꿀 단계'), 'DISPATCH_RESTRICTED');
    await userEvent.type(within(form).getByLabelText('사유'), '반복 지연');
    await userEvent.click(within(form).getByRole('button', { name: '바꾸기' }));
    expect(await within(form).findByText('바꿨어요.')).toBeInTheDocument();
    expect(posts(view.sent, '/restrictions')[0]!.headers.get('X-Expected-Version')).toBe('2');
    expect(await screen.findByTestId('restriction-history')).toHaveTextContent('신규배차 제한');
  });
});

describe('배송 조치', () => {
  it('전달 실패 확정 — 상품 위치 라이더 + 다른 라이더 회수를 보낸다', async () => {
    const view = renderAt('/deliveries/DLV-1', as.riderOps);
    await screen.findByTestId('execution-detail');
    const form = await screen.findByRole('form', { name: '전달 실패 확정·반려' });
    await userEvent.click(within(form).getByLabelText('확정'));
    await userEvent.selectOptions(within(form).getByLabelText('반납할 사람'), 'OTHER_RIDER');
    await userEvent.click(within(form).getByRole('button', { name: '보내기' }));
    expect(await within(form).findByTestId('action-result')).toHaveTextContent('반영했어요.');
    const sent = (await posts(view.sent, '/failure-decisions')[0]!.json()) as Record<string, unknown>;
    expect(sent).toMatchObject({ decision: 'CONFIRM', custody: 'RIDER', returnBy: 'OTHER_RIDER' });
  });
});

describe('관제', () => {
  it('센터를 고르면 운행 중 라이더 위치·끊김', async () => {
    renderAt('/control?mfcId=MFC-BSJ-01', as.riderOps);
    const rows = await screen.findAllByTestId('control-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('35.15850, 129.06200');
    expect(rows[1]).toHaveTextContent('위치 없음');
    expect(screen.getByText('위치 끊김 1명')).toBeInTheDocument();
  });
  it('상담원은 서버가 막는다(403 그대로)', async () => {
    renderAt('/control?mfcId=MFC-BSJ-01', as.cs);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryAllByTestId('control-row')).toHaveLength(0);
  });
});

describe('지원센터', () => {
  it('도움요청 대화에 답장', async () => {
    const view = renderAt('/help-requests/DLV-1/HR-1', as.riderOps);
    expect(await screen.findByTestId('help-messages')).toHaveTextContent('공동현관 비밀번호가 틀려요');
    const form = screen.getByRole('form', { name: '답장' });
    await userEvent.type(within(form).getByRole('textbox'), '고객에게 연락해 볼게요');
    await userEvent.click(within(form).getByRole('button', { name: '보내기' }));
    expect(await screen.findByText('고객에게 연락해 볼게요')).toBeInTheDocument();
    expect(posts(view.sent, '/messages')).toHaveLength(1);
  });
  it('라이더 문의에 답한다', async () => {
    renderAt('/inquiries/INQ-1', as.riderOps);
    expect(await screen.findByText('지난주 정산이 빠졌어요')).toBeInTheDocument();
    const form = screen.getByRole('form', { name: '답변' });
    await userEvent.type(within(form).getByRole('textbox'), '다음 정산에 넣었어요');
    await userEvent.click(within(form).getByRole('button', { name: '보내기' }));
    expect(await screen.findByText('다음 정산에 넣었어요')).toBeInTheDocument();
  });
});

describe('수행료', () => {
  it('추가 배달료 승인', async () => {
    const view = renderAt('/surcharges', as.riderOps);
    const row = await screen.findByTestId('surcharge-row');
    expect(row).toHaveTextContent('22층');
    await userEvent.click(within(row).getByRole('button', { name: '승인' }));
    // 처리한 신청은 목록에서 빠진다
    expect(await screen.findByText('처리할 신청이 없어요.')).toBeInTheDocument();
    expect(((await posts(view.sent, '/decisions')[0]!.json()) as { decision: string }).decision).toBe('APPROVE');
  });
  it('산정 불가 조정 — 귀책·사유', async () => {
    renderAt('/adjustments', as.riderOps);
    const row = await screen.findByTestId('adjustment-row');
    await userEvent.selectOptions(within(row).getByLabelText('귀책'), 'CUSTOMER');
    await userEvent.type(within(row).getByLabelText('사유(2~300자)'), '고객 부재 확인');
    await userEvent.click(within(row).getByRole('button', { name: '조정' }));
    expect(await screen.findByText('조정할 수행료가 없어요.')).toBeInTheDocument();
  });
});
