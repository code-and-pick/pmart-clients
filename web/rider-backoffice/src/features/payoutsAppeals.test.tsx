// 지급 관리·소명·이의(2026-11-19, PC 5) — 목(MSW) 기준. 실서버 확인은 아니다.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

const posts = (sent: readonly Request[], part: string) => sent.filter((r) => r.method === 'POST' && new URL(r.url).pathname.includes(part));

describe('지급 관리', () => {
  it('지급 완료 확인에서 취소하면 보내지 않는다(2026-11-24)', async () => {
    const view = renderAt('/payouts', as.admin);
    const rows = await screen.findAllByTestId('payout-row');
    const form = within(rows[0]!).getByRole('form', { name: /지급 결과 표시 RD-7/ });
    await userEvent.selectOptions(within(form).getByLabelText('결과'), 'PAID');
    await userEvent.click(within(form).getByRole('button', { name: '표시' }));
    await userEvent.click(within(await within(form).findByTestId('payout-paid-confirm')).getByRole('button', { name: '취소' }));
    expect(within(form).queryByTestId('payout-paid-confirm')).not.toBeInTheDocument();
    expect(within(form).getByRole('button', { name: '표시' })).toBeEnabled();
    expect(posts(view.sent, '/rider-payouts/RD-7/2026-11-19/results')).toHaveLength(0);
  });

  it('수행료 구분 필터: 조정을 고르면 조정 수행료가 든 묶음만, 펼친 칸도 조정만(2026-11-24)', async () => {
    renderAt('/payouts?payoutDate=2026-11-19&kind=adjusted', as.admin);
    const rows = await screen.findAllByTestId('payout-row');
    expect(rows).toHaveLength(1); // RD-7 묶음만(RD-8 은 정상만)
    expect(rows[0]).toHaveTextContent('10,500');
    await userEvent.click(rows[0]!);
    const box = await screen.findByTestId('payout-items');
    const items = await within(box).findAllByTestId('payout-item');
    expect(items).toHaveLength(1);
    expect(box).toHaveTextContent('조정 수행료');
  });

  it('수행료 구분 필터: 정상을 고르면 정상 수행료가 든 묶음', async () => {
    renderAt('/payouts?payoutDate=2026-11-19&kind=normal', as.admin);
    expect(await screen.findAllByTestId('payout-row')).toHaveLength(2);
  });

  it('줄을 펼치면 이 묶음의 배송(수행료·보상금)이 보이고, 건수가 맞으면 모자란다는 안내가 없다(2026-11-24)', async () => {
    renderAt('/payouts', as.admin);
    const rows = await screen.findAllByTestId('payout-row');
    // 펼치지 않아도 줄에 정상·조정 수가 늘(2026-11-24 "정상수행료인지 조정수행료인지 뜨게 하라고")
    expect(await within(rows[0]!).findByTestId('payout-adjusted-count')).toHaveTextContent('조정 1');
    expect(within(rows[0]!).getByTestId('payout-kinds')).toHaveTextContent('정상 1');
    // 조정이 없는 묶음은 "정상 2"만 — 0 은 적지 않는다(2026-11-24)
    await waitFor(() => expect(within(rows[1]!).getByTestId('payout-kinds')).toHaveTextContent('정상 2'));
    expect(within(rows[1]!).queryByTestId('payout-count')).not.toBeInTheDocument();
    expect(within(rows[1]!).queryByTestId('payout-adjusted-count')).not.toBeInTheDocument();
    await userEvent.click(rows[0]!);
    const box = await screen.findByTestId('payout-items');
    const items = await within(box).findAllByTestId('payout-item');
    expect(items).toHaveLength(3); // RD-7 11-19 묶음 3건(수행료 2 + 보상금 1)
    expect(box).toHaveTextContent('보상금');
    expect(box).toHaveTextContent('3,500원');
    expect(within(box).queryByTestId('payout-items-partial')).not.toBeInTheDocument();
    // 종류 칸에 늘 정상/조정 — 조정 1건, 정상 1건
    expect(within(box).getAllByTestId('payout-item-adjusted')).toHaveLength(1);
    expect(box).toHaveTextContent('조정 수행료');
    expect(box).toHaveTextContent('정상 수행료');
  });

  it('관리자: 묶음을 보고 지급 완료로 표시한다(멱등 키)', async () => {
    const view = renderAt('/payouts', as.admin);
    const rows = await screen.findAllByTestId('payout-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('확정(지급 전)');
    expect(rows[0]).toHaveTextContent('10,500');
    const form = within(rows[0]!).getByRole('form', { name: /지급 결과 표시 RD-7/ });
    await userEvent.selectOptions(within(form).getByLabelText('결과'), 'PAID');
    await userEvent.click(within(form).getByRole('button', { name: '표시' }));
    // 지급 완료는 한 번 더 묻는다 — 묻는 동안은 보내지 않는다(2026-11-24)
    const ask = await within(form).findByTestId('payout-paid-confirm');
    expect(ask).toHaveTextContent('되돌릴 수 없고');
    expect(posts(view.sent, '/rider-payouts/RD-7/2026-11-19/results')).toHaveLength(0);
    await userEvent.click(within(ask).getByRole('button', { name: '지급 완료로 표시' }));
    // 표시가 끝나면 줄이 지급 완료로 바뀌어 입력 칸이 없어진다 — 결과는 위 알림에 남는다
    expect(await screen.findByTestId('payout-done')).toHaveTextContent('R4829 · 2026-11-19 묶음을 지급 완료(으)로 표시했어요.');
    expect(await within(screen.getAllByTestId('payout-row')[0]!).findByText('지급 완료')).toBeInTheDocument();
    const req = posts(view.sent, '/rider-payouts/RD-7/2026-11-19/results')[0]!;
    expect(req.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await req.clone().json()).toEqual({ result: 'PAID' });
  });

  it('지급 실패는 사유가 있어야 표시할 수 있다', async () => {
    renderAt('/payouts', as.admin);
    const rows = await screen.findAllByTestId('payout-row');
    const form = within(rows[1]!).getByRole('form', { name: /RD-8/ });
    await userEvent.selectOptions(within(form).getByLabelText('결과'), 'FAILED');
    expect(within(form).getByRole('button', { name: '표시' })).toBeDisabled();
    await userEvent.type(within(form).getByLabelText(/실패 사유/), '은행 점검');
    await userEvent.click(within(form).getByRole('button', { name: '표시' }));
    expect(await screen.findByTestId('payout-done')).toHaveTextContent('지급 실패(으)로 표시했어요.');
  });

  it('예정일 전이면 서버 거절(PAYOUT_NOT_DUE)을 그대로 알린다', async () => {
    renderAt('/payouts?payoutDate=2026-11-21', as.admin);
    const row = (await screen.findAllByTestId('payout-row'))[0]!;
    const form = within(row).getByRole('form');
    await userEvent.selectOptions(within(form).getByLabelText('결과'), 'PAYING');
    await userEvent.click(within(form).getByRole('button', { name: '표시' }));
    expect(await within(form).findByText(/지급 예정일이 아직 안 됐어요/)).toBeInTheDocument();
  });

  it('줄을 누르면 아래에 라이더 요약이 펼쳐지고, 라이더 번호는 라이더 상세로 간다(2026-11-23 "클릭해도 안 열려")', async () => {
    renderAt('/payouts', as.riderOps);
    const rows = await screen.findAllByTestId('payout-row');
    expect(within(rows[0]!).getByTestId('payout-rider-link')).toHaveAttribute('href', '/riders/RD-7');
    await userEvent.click(rows[0]!.querySelector('td:nth-child(2)')!);
    const inline = await screen.findByTestId('payout-inline');
    expect(within(inline).getByRole('link', { name: /전체 상세/ })).toHaveAttribute('href', '/riders/RD-7');
    // 다시 누르면 접힌다
    await userEvent.click(screen.getAllByTestId('payout-row')[0]!.querySelector('td:nth-child(2)')!);
    expect(screen.queryByTestId('payout-inline')).toBeNull();
  });

  it('라이더 운영은 보기만(결과 표시는 관리자)', async () => {
    renderAt('/payouts', as.riderOps);
    const rows = await screen.findAllByTestId('payout-row');
    expect(within(rows[0]!).queryByRole('form')).not.toBeInTheDocument();
    expect(rows[0]).toHaveTextContent('관리자만 표시할 수 있어요');
  });
});

describe('소명·이의', () => {
  it('제한 소명을 인정하면 결정 메모와 함께 보낸다', async () => {
    const view = renderAt('/appeals', as.riderOps);
    const rows = await screen.findAllByTestId('appeal-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('계정 제한 소명');
    expect(rows[0]).toHaveTextContent('일시 중지');
    const form = within(rows[0]!).getByRole('form');
    expect(within(form).getByRole('button', { name: '인정' })).toBeDisabled();
    await userEvent.type(within(form).getByLabelText(/결정 메모/), '포장 불량 사진 확인 — 제한 풀어요');
    await userEvent.click(within(form).getByRole('button', { name: '인정' }));
    // 결정하면 "결정 대기" 목록에서 빠진다 — 결과는 위 알림에(제한 소명이면 조정 버튼 없음)
    expect(await screen.findByTestId('appeal-done')).toHaveTextContent('계정 제한 소명(R7301)을 인정(으)로 결정했어요.');
    expect(screen.queryByTestId('to-adjustment')).not.toBeInTheDocument();
    expect(await screen.findAllByTestId('appeal-row')).toHaveLength(1);
    expect(await posts(view.sent, '/rider-appeals/AP-1/decisions')[0]!.clone().json()).toEqual({ decision: 'ACCEPTED', note: '포장 불량 사진 확인 — 제한 풀어요' });
  });

  it('수행료 이의를 인정하면 그 배송 수행료 조정으로 가는 버튼', async () => {
    renderAt('/appeals', as.riderOps);
    const rows = await screen.findAllByTestId('appeal-row');
    const form = within(rows[1]!).getByRole('form');
    await userEvent.type(within(form).getByLabelText(/결정 메모/), '고장 확인');
    await userEvent.click(within(form).getByRole('button', { name: '인정' }));
    const link = await screen.findByTestId('to-adjustment');
    expect(link).toHaveAttribute('href', '/adjustments?deliveryId=DLV-3');
    await userEvent.click(link);
    // 조정 대기 목록에 없는 배송이면 숨기지 않고 이유를 알린다
    expect(await screen.findByTestId('adjust-only')).toHaveTextContent('DLV-3');
    expect(await screen.findByText(/조정 대기 목록에 없어요/)).toBeInTheDocument();
  });

  it('결정된 신청은 상태로 거르면 메모와 함께 보인다', async () => {
    renderAt('/appeals?state=UPHELD', as.riderOps);
    const row = (await screen.findAllByTestId('appeal-row'))[0]!;
    expect(within(row).getByTestId('appeal-decided')).toHaveTextContent('경로 확인 결과 정상 산정이에요.');
  });
});

describe('이의 인정 보상금', () => {
  it('수행료 이의를 인정하면 위 알림에서 보상금을 주고, 이미 준 보상금이 보인다', async () => {
    const view = renderAt('/appeals', as.riderOps);
    const rows = await screen.findAllByTestId('appeal-row');
    const form = within(rows[1]!).getByRole('form');
    await userEvent.type(within(form).getByLabelText(/결정 메모/), '고장 확인');
    await userEvent.click(within(form).getByRole('button', { name: '인정' }));
    const done = await screen.findByTestId('appeal-done');
    const give = await within(done).findByRole('form', { name: /보상금 주기 AP-2/ });
    expect(within(give).getByRole('button', { name: '보상금 주기' })).toBeDisabled();
    await userEvent.type(within(give).getByLabelText(/금액/), '1500');
    await userEvent.type(within(give).getByLabelText(/사유/), '엘리베이터 고장 확인');
    await userEvent.click(within(give).getByRole('button', { name: '보상금 주기' }));
    expect(await within(done).findByTestId('compensation-given')).toHaveTextContent('1,500원');
    const req = posts(view.sent, '/rider-compensations')[0]!;
    expect(req.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await req.clone().json()).toEqual({ appealId: 'AP-2', amount: 1500, reason: '엘리베이터 고장 확인' });
  });

  it('금액은 1~100,000원만', async () => {
    renderAt('/appeals', as.riderOps);
    const rows = await screen.findAllByTestId('appeal-row');
    const form = within(rows[1]!).getByRole('form');
    await userEvent.type(within(form).getByLabelText(/결정 메모/), '확인');
    await userEvent.click(within(form).getByRole('button', { name: '인정' }));
    const give = await within(await screen.findByTestId('appeal-done')).findByRole('form', { name: /보상금 주기/ });
    await userEvent.type(within(give).getByLabelText(/사유/), '사유');
    await userEvent.type(within(give).getByLabelText(/금액/), '100001');
    expect(within(give).getByRole('button', { name: '보상금 주기' })).toBeDisabled();
  });

  it('지급 묶음에 보상 건수', async () => {
    renderAt('/payouts', as.admin);
    const rows = await screen.findAllByTestId('payout-row');
    expect(rows[0]).toHaveTextContent('보상 1');
    // 정상·조정·보상을 더해 건수와 맞으면 따로 건수 숫자를 적지 않는다(2026-11-24 "건수 1이랑 정상1 둘 다 뜨는데 그냥 정상1 이것만")
    await within(rows[0]!).findByTestId('payout-adjusted-count');
    expect(within(rows[0]!).queryByTestId('payout-count')).not.toBeInTheDocument();
  });
});
