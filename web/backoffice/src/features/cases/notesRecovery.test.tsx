// 접수 건 메모(case 0.10.0)·오배송 회수 진행(case 0.8.1·bff 0.5.1) — 목(MSW) 기준.
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

describe('접수 건 메모', () => {
  it('상담원이 메모를 남긴다 — 개인정보 안내, 고치기·지우기 없음, 처리 끝난 건에도', async () => {
    const view = renderAt('/cases/CASE-MOCK-4', as.cs); // 처리 끝난 오배송
    const section = await screen.findByRole('region', { name: '메모' });
    expect(await within(section).findByText('메모가 없어요.')).toBeInTheDocument();
    expect(within(section).getByText('개인정보(전화번호·주소)는 쓰지 마세요.')).toBeInTheDocument();
    await userEvent.type(within(section).getByLabelText('메모 남기기(1~500자)'), '고객이 재방문 요청');
    await userEvent.click(within(section).getByRole('button', { name: '메모 남기기' }));
    const note = await within(section).findByTestId('case-note');
    expect(note).toHaveTextContent('고객이 재방문 요청');
    await waitFor(() => expect(note).toHaveTextContent('[목] 최상담 · P2026-00005')); // 작성자는 이름 · 사번(ADR-0070 덧붙임)
    expect(within(note).queryByRole('button', { name: '가리기' })).not.toBeInTheDocument(); // 가림은 관리자만
    const sent = view.sent.find((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith('/cases/CASE-MOCK-4/notes'))!;
    expect(sent.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await sent.json()).toEqual({ text: '고객이 재방문 요청' });
  });

  it('관리자는 메모를 가린다(사유 필수) — 내용 대신 "가린 메모"', async () => {
    renderAt('/cases/CASE-MOCK-4', as.cs);
    const section = await screen.findByRole('region', { name: '메모' });
    await userEvent.type(within(section).getByLabelText('메모 남기기(1~500자)'), '전화 010 이라고 적음');
    await userEvent.click(within(section).getByRole('button', { name: '메모 남기기' }));
    await within(section).findByTestId('case-note');
    cleanup();
    renderAt('/cases/CASE-MOCK-4', as.admin);
    const note = await screen.findByTestId('case-note');
    await userEvent.click(within(note).getByRole('button', { name: '가리기' }));
    await userEvent.type(within(note).getByLabelText('가리는 사유'), '연락처가 들어감');
    await userEvent.click(within(note).getByRole('button', { name: '가리기' }));
    await waitFor(() => expect(screen.getByTestId('case-note')).toHaveAttribute('data-masked', 'true'));
    expect(screen.getByTestId('case-note')).toHaveTextContent('가린 메모 — [목] 관리자 · P2026-00001 · 연락처가 들어감'); // 가린 사람은 이름 · 사번(ID 아님)
    expect(screen.getByTestId('case-note')).not.toHaveTextContent('전화 010');
  });
});

describe('오배송 회수 진행', () => {
  it('상세: "회수 배송" 링크, 이력 회수 배송 생김·회수함·매장 반납, 저절로 끝나지 않는다는 안내', async () => {
    renderAt('/cases/CASE-MOCK-4', as.riderOps);
    expect(await screen.findByRole('link', { name: /^회수 배송 / })).toHaveAttribute('href', '/deliveries/DLV-MOCK-R1'); // 글자는 화면 번호(없으면 번호 없음), ID 는 링크 대상
    expect(screen.getByRole('link', { name: /^재발송 배송 / })).toHaveAttribute('href', '/deliveries/DLV-MOCK-S1');
    expect(screen.getByTestId('case-recovery-note')).toHaveTextContent('회수가 끝나도 직접 완료 처리해요');
    for (const t of ['회수 배송 생김', '회수함', '매장 반납 · SYSTEM · MFC-BSN-01', '재발송 배송 생김 · SYSTEM · DLV-MOCK-S1']) expect(screen.getByText(new RegExp(t))).toBeInTheDocument();
  });

  it('사건함 연결 상태: 원래 배송과 회수 배송을 나눠 보인다', async () => {
    renderAt('/cases?tab=closed', as.riderOps);
    const row = (await screen.findAllByTestId('case-row')).find((r) => r.textContent?.includes('오배송'))!;
    const linked = within(row).getAllByTestId('case-linked').map((l) => l.textContent);
    expect(linked).toContain('배송 전달 완료');
    expect(linked).toContain('회수 배송 회수 중');
    expect(linked).toContain('재발송 배송 배정');
  });
});
