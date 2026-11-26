// 행사·쿠폰(promotion 0.2.0, ADR-0082 — 사용자 결정 2026-11-20)
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { http, HttpResponse } from 'msw';

import { API_BASE } from '../../api/client';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

/** 승인 대기 지정 발급 쿠폰 — 만들 때 받을 고객 둘(0.3.0). 응답을 직접 만든다(같은 주소를 다시 부르면 처리기가 자기 자신을 부른다) */
const WITH_RECIPIENTS = {
  promotionId: 'PRM-R1',
  kind: 'COUPON',
  name: '보상 쿠폰',
  state: 'APPROVED',
  phase: 'RUNNING',
  startsAt: '2026-11-24T00:00:00Z',
  endsAt: '2099-12-31T00:00:00Z',
  endedAt: null,
  discount: { type: 'AMOUNT', value: 2000, maxAmount: null },
  targets: [],
  coupon: { issueMode: 'ADMIN', minOrderAmount: 0, totalQuantity: null, perCustomerLimit: 1, useDays: 7, useUntil: null, recipients: { accountIds: ['CUS-1001', 'CUS-1005'], reason: '배송 지연 보상' } },
  recipientResults: [
    { accountId: 'CUS-1001', result: 'ISSUED', couponId: 'CPN-1', processedAt: '2026-11-24T01:00:00Z' },
    { accountId: 'CUS-1005', result: 'PENDING', couponId: null, processedAt: null },
  ],
  issuedCount: 1,
  usedCount: 0,
  problems: [],
  approvalId: 'apv-r1',
  version: 3,
  createdBy: 'op-admin-1',
  updatedAt: '2026-11-24T01:00:00Z',
};

/** datetime-local(서울) 값 — 지금에서 시간 더하기 */
const local = (hours: number) => {
  const d = new Date(Date.now() + hours * 3_600_000);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(' ', 'T');
};

describe('행사·쿠폰', () => {
  it('목록: 서버 상태·단계·할인·발급 수 그대로, 상담원은 보기만(만들기 단추 없음)', async () => {
    renderAt('/promotions', as.cs);
    const rows = await screen.findAllByTestId('promotion-row');
    expect(rows).toHaveLength(3);
    // 0.5.0 수량 행사 — 할인 칸 자리에 N+M(discount 는 null)
    const offer = rows.find((r) => r.textContent?.includes('우유 1+1'))!;
    expect(offer).toHaveTextContent('수량 행사 1+1·2+1');
    expect(offer).toHaveTextContent('1+1 (1개 사면 1개 더)');
    const coupon = rows.find((r) => r.textContent?.includes('첫 주문 3천원 쿠폰'))!;
    expect(coupon).toHaveTextContent('승인됨');
    expect(coupon).toHaveTextContent('진행 중');
    expect(coupon).toHaveTextContent('3,000원');
    expect(coupon).toHaveTextContent('12 / 1,000장 발급 · 4장 사용');
    expect(rows.find((r) => r.textContent?.includes('겨울 과일'))).toHaveTextContent('1곳'); // 서버 problems
    expect(screen.queryByRole('link', { name: '행사 만들기' })).not.toBeInTheDocument();
    expect(screen.getByTestId('promotion-stage-note')).toHaveTextContent('쿠폰은 주문서에서 써요'); // 2026-11-24 — 백엔드 적용 끝("다음 단계" 문구 없앰)
  });

  it('줄을 누르면 아래로 펼침(2026-11-25 화면 기준) — 대상·만든 사람·막히는 곳·"전체 상세 ›", 한 번에 한 줄, 다시 누르면 접힘', async () => {
    const user = userEvent.setup();
    renderAt('/promotions', as.cs);
    const rows = await screen.findAllByTestId('promotion-row');
    const fruit = rows.find((r) => r.textContent?.includes('겨울 과일'))!;
    expect(screen.queryByTestId('promotion-inline')).not.toBeInTheDocument();
    await user.click(within(fruit).getAllByRole('cell')[1]!);
    expect(fruit).toHaveAttribute('aria-expanded', 'true');
    const inline = screen.getByTestId('promotion-inline');
    expect(within(inline).getByText('만든 사람')).toBeInTheDocument();
    expect(within(inline).getByTestId('promotion-problems')).toHaveTextContent('1곳'); // 서버 problems 그대로
    expect(within(inline).getByRole('link', { name: '전체 상세 ›' })).toHaveAttribute('href', expect.stringMatching(/^\/promotions\//));
    const coupon = rows.find((r) => r.textContent?.includes('첫 주문 3천원 쿠폰'))!;
    await user.click(within(coupon).getAllByRole('cell')[1]!);
    expect(screen.getAllByTestId('promotion-inline')).toHaveLength(1); // 한 번에 한 줄
    expect(fruit).toHaveAttribute('aria-expanded', 'false');
    await user.click(within(coupon).getAllByRole('cell')[1]!);
    expect(screen.queryByTestId('promotion-inline')).not.toBeInTheDocument();
  });

  it('쿠폰 만들기 → 저장하고 승인 요청(제출 → change-requests PROMOTION) → 만든 본인은 승인 못 하고 다른 마케터가 승인 → 진행 중', async () => {
    const user = userEvent.setup();
    const view = renderAt('/promotions/new', as.marketing);
    const form = await screen.findByRole('form', { name: '행사 만들기' });
    await user.type(within(form).getByLabelText('이름(고객에게 보여요)'), '주말 5천원 쿠폰');
    fireEvent.change(within(form).getByLabelText('시작'), { target: { value: local(-1) } });
    fireEvent.change(within(form).getByLabelText('받기 끝'), { target: { value: local(72) } });
    await user.selectOptions(within(form).getByLabelText('할인 방식'), 'AMOUNT');
    await user.type(within(form).getByLabelText('할인액(원)'), '5000');
    await user.selectOptions(within(form).getByLabelText('받는 방법'), 'ADMIN');
    await user.click(within(form).getByRole('button', { name: '저장하고 승인 요청' }));
    expect(await screen.findByText('승인을 요청했어요')).toBeInTheDocument();
    const cr = view.mutations('/change-requests')[0]!;
    const body = (await cr.clone().json()) as { type: string; targetService: string; allowedActions: string[] };
    expect(body).toMatchObject({ type: 'PROMOTION', targetService: 'promotion-service', allowedActions: ['ACTIVATE_PROMOTION'] });
    expect(cr.headers.get('Idempotency-Key')).toBeTruthy();
    const href = screen.getByRole('link', { name: '승인 보기' }).getAttribute('href')!;
    view.unmount();

    // 만든 본인 — 승인 단추 꺼짐(자기 승인 금지)
    const mine = renderAt(href, as.marketing);
    await screen.findByTestId('promotion-line');
    expect(screen.getByTestId('promotion-line')).toHaveTextContent('주말 5천원 쿠폰');
    expect(screen.getByTestId('promotion-line')).toHaveTextContent('5,000원'); // discountType·discountValue
    expect(screen.getByRole('button', { name: '승인' })).toBeDisabled();
    mine.unmount();

    // 다른 마케터가 승인 → 행사 화면에서 승인됨·진행 중
    renderAt(href, as.marketing2);
    await user.click(await screen.findByRole('button', { name: '승인' }));
    await user.click(await screen.findByRole('link', { name: '행사 화면으로' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('승인됨'));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('진행 중');
  });

  it('수량 행사(1+1·2+1, promotion 0.5.0): 할인 대신 "N개 사면 M개 더" 두 칸 + 대상, 보내는 값 offer(discount 없음), 승인 화면은 0원 글 없이', async () => {
    const user = userEvent.setup();
    const view = renderAt('/promotions/new', as.marketing);
    const form = await screen.findByRole('form', { name: '행사 만들기' });
    await user.click(within(form).getByRole('radio', { name: '수량 행사 1+1·2+1' }));
    expect(within(form).queryByLabelText('할인 방식')).not.toBeInTheDocument();
    expect(within(form).queryByLabelText('할인율(%)')).not.toBeInTheDocument();
    await user.type(within(form).getByLabelText('이름(고객에게 보여요)'), '라면 2+1');
    fireEvent.change(within(form).getByLabelText('시작'), { target: { value: local(-1) } });
    fireEvent.change(within(form).getByLabelText('끝'), { target: { value: local(72) } });
    // 바로 고르기 2+1 → 두 칸이 2·1, 고른 단추만 눌림
    await user.click(within(form).getByRole('button', { name: '2+1' }));
    expect(within(form).getByLabelText('사는 수량(개)')).toHaveValue(2);
    expect(within(form).getByLabelText('더 주는 수량(개)')).toHaveValue(1);
    expect(within(form).getByRole('button', { name: '2+1' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(form).getByRole('button', { name: '1+1' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(form).getByTestId('offer-fields')).toHaveTextContent('개 사면');
    await user.click(within(form).getByRole('button', { name: '대상 더하기' }));
    await user.type(within(form).getByLabelText('SKU 코드'), 'SKU-RAMEN-5');
    await user.click(within(form).getByRole('button', { name: '저장하고 승인 요청' }));
    expect(await screen.findByText('승인을 요청했어요')).toBeInTheDocument();
    const body = (await view.mutations('/promotions')[0]!.clone().json()) as Record<string, unknown>;
    expect(body).toMatchObject({ kind: 'QUANTITY_OFFER', offer: { buyQuantity: 2, freeQuantity: 1 }, targets: [{ type: 'SKU', id: 'SKU-RAMEN-5' }] });
    expect(body).not.toHaveProperty('discount');
    expect(body).not.toHaveProperty('coupon');
    const href = screen.getByRole('link', { name: '승인 보기' }).getAttribute('href')!;
    view.unmount();

    renderAt(href, as.marketing2);
    const line = await screen.findByTestId('promotion-line');
    expect(line).toHaveTextContent('수량 행사 1+1·2+1');
    expect(line).toHaveTextContent('라면 2+1');
    expect(line).not.toHaveTextContent('0원'); // 서버는 discountType·discountValue 를 AMOUNT·0 으로 싣는다
  });

  it('수량 행사: 사는 수량을 비우면 저장은 되고 제출 422 — "사는 수량" 칸 이름으로(1~10·더 주는 수량 ≤ 사는 수량은 칸 min·max 와 서버 검사)', async () => {
    const user = userEvent.setup();
    const view = renderAt('/promotions/new', as.marketing);
    const form = await screen.findByRole('form', { name: '행사 만들기' });
    await user.click(within(form).getByRole('radio', { name: '수량 행사 1+1·2+1' }));
    await user.type(within(form).getByLabelText('이름(고객에게 보여요)'), '수량 빠진 행사');
    fireEvent.change(within(form).getByLabelText('시작'), { target: { value: local(1) } });
    fireEvent.change(within(form).getByLabelText('끝'), { target: { value: local(48) } });
    await user.clear(within(form).getByLabelText('사는 수량(개)'));
    await user.click(within(form).getByRole('button', { name: '대상 더하기' }));
    await user.type(within(form).getByLabelText('SKU 코드'), 'SKU-1');
    await user.click(within(form).getByRole('button', { name: '저장하고 승인 요청' }));
    expect(await screen.findByTestId('promotion-problems')).toHaveTextContent('사는 수량(개)');
    expect(view.mutations('/change-requests')).toHaveLength(0);
  });

  it('수량 행사 상세: 종류·N+M·대상 SKU, 기간 할인 만들기에는 "1+1 만 받아요" 안내', async () => {
    const view = renderAt('/promotions/PRM-seed-3', as.marketing);
    const summary = await screen.findByTestId('promotion-summary');
    expect(summary).toHaveTextContent('수량 행사 1+1·2+1');
    expect(summary).toHaveTextContent('1+1 (1개 사면 1개 더)');
    expect(screen.getByTestId('promotion-targets')).toHaveTextContent('SKU-MILK-900');
    expect(screen.getByRole('button', { name: '조기 종료 승인 요청' })).toBeInTheDocument();
    expect(screen.queryByText('받은 쿠폰은 기간까지 쓸 수 있어요')).not.toBeInTheDocument(); // 쿠폰 안내는 쿠폰만
    view.unmount();

    const user = userEvent.setup();
    renderAt('/promotions/new', as.marketing);
    const form = await screen.findByRole('form', { name: '행사 만들기' });
    await user.click(within(form).getByRole('radio', { name: '기간 할인' }));
    expect(within(form).getByTestId('price-with-offer-note')).toHaveTextContent('고객은 1+1 만 받아요');
  });

  it('기간 할인에 대상이 없으면 저장은 되고 제출은 422 PROMOTION_INVALID — 고칠 곳을 칸 이름으로, 승인 요청은 보내지 않는다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/promotions/new', as.marketing);
    const form = await screen.findByRole('form', { name: '행사 만들기' });
    await user.click(within(form).getByRole('radio', { name: '기간 할인' }));
    await user.type(within(form).getByLabelText('이름(고객에게 보여요)'), '사과 할인');
    fireEvent.change(within(form).getByLabelText('시작'), { target: { value: local(1) } });
    fireEvent.change(within(form).getByLabelText('끝'), { target: { value: local(48) } });
    await user.type(within(form).getByLabelText('할인율(%)'), '10');
    await user.click(within(form).getByRole('button', { name: '저장하고 승인 요청' }));
    const problems = await screen.findByTestId('promotion-problems');
    expect(problems).toHaveTextContent('대상');
    expect(view.mutations('/change-requests')).toHaveLength(0);
  });

  it('지정 발급(ADMIN 진행 중): 상담원이 고객별 결과 — 한도면 건너뜀', async () => {
    const user = userEvent.setup();
    const view = renderAt('/promotions/PRM-seed-1', as.cs);
    const form = await screen.findByRole('form', { name: '쿠폰 지정 발급' });
    await user.type(within(form).getByLabelText('고객 ID(줄바꿈·쉼표로 나눠 최대 100명)'), 'C-1, C-2');
    await user.type(within(form).getByLabelText('발급 사유(보상 등, 200자까지)'), '배송 지연 보상');
    await user.click(within(form).getByRole('button', { name: '발급하기' }));
    expect(await screen.findByText(/2명 중 2명 발급/)).toBeInTheDocument();
    const body = (await view.mutations('/coupon-grants')[0]!.clone().json()) as { accountIds: string[] };
    expect(body.accountIds).toEqual(['C-1', 'C-2']);
    // 같은 고객 다시 — 1인 1장이라 건너뜀
    await user.clear(within(form).getByLabelText('고객 ID(줄바꿈·쉼표로 나눠 최대 100명)'));
    await user.type(within(form).getByLabelText('고객 ID(줄바꿈·쉼표로 나눠 최대 100명)'), 'C-1');
    await user.click(within(form).getByRole('button', { name: '발급하기' }));
    expect(await screen.findByText('한도라 건너뜀')).toBeInTheDocument();
    // 상담원은 조기 종료 없음(만들기·종료는 MARKETING·OPERATOR_ADMIN)
    expect(screen.queryByRole('form', { name: '조기 종료' })).not.toBeInTheDocument();
  });

  it('지정 발급: 고객번호로 찾아 더하고 발급 — 화면은 가린 이름·번호, 보내는 값은 고객 ID(2026-11-24)', async () => {
    const user = userEvent.setup();
    const view = renderAt('/promotions/PRM-seed-1', as.cs);
    const finder = await screen.findByRole('search', { name: '받을 고객 찾기' });
    await user.type(within(finder).getByLabelText('값'), '4829');
    expect(within(finder).getByText('고객번호는 숫자 6자리예요.')).toBeInTheDocument(); // 모양이 틀리면 묻지 않는다
    await user.type(within(finder).getByLabelText('값'), '13');
    await user.click(within(finder).getByRole('button', { name: '조회' }));
    const item = await screen.findByTestId('grant-search-item');
    expect(item).toHaveTextContent('482913');
    expect(item).not.toHaveTextContent('김고객'); // 원문 이름은 없다
    await user.click(within(item).getByRole('button', { name: '추가' }));
    expect(within(item).getByRole('button', { name: '추가됨' })).toBeDisabled();
    expect(screen.getByTestId('grant-picked')).toHaveTextContent('받을 고객 1명 / 최대 100명');
    const form = screen.getByRole('form', { name: '쿠폰 지정 발급' });
    await user.type(within(form).getByLabelText('발급 사유(보상 등, 200자까지)'), '배송 지연 보상');
    await user.click(within(form).getByRole('button', { name: '발급하기' }));
    expect(await screen.findByText(/1명 중 1명 발급/)).toBeInTheDocument();
    const body = (await view.mutations('/coupon-grants')[0]!.clone().json()) as { accountIds: string[] };
    expect(body.accountIds).toEqual(['CUS-1001']);
  });

  it('지정 발급: 고객 찾기 권한이 없는 마케팅은 ID 직접 넣기로 안내(403 을 "없음"으로 보이지 않게)', async () => {
    const user = userEvent.setup();
    renderAt('/promotions/PRM-seed-1', as.marketing);
    const finder = await screen.findByRole('search', { name: '받을 고객 찾기' });
    await user.type(within(finder).getByLabelText('값'), '482913');
    await user.click(within(finder).getByRole('button', { name: '조회' }));
    expect(await screen.findByText(/이 역할은 고객 찾기를 쓸 수 없어요/)).toBeInTheDocument();
    expect(screen.queryByText('맞는 고객이 없어요.')).not.toBeInTheDocument();
  });

  it('만들기: 받는 방법마다 어떻게 받는지 — 지정 발급은 "승인 뒤 행사 화면에서 발급"', async () => {
    const user = userEvent.setup();
    renderAt('/promotions/new', as.marketing);
    const form = await screen.findByRole('form', { name: '행사 만들기' });
    await user.click(within(form).getByRole('radio', { name: /장바구니 쿠폰/ }));
    await user.selectOptions(within(form).getByLabelText('받는 방법'), 'ADMIN');
    expect(screen.getByTestId('issue-mode-hint')).toHaveTextContent('받을 고객을 고르면 시작 때 자동 발급');
    expect(screen.queryByText(/서버 다음 단계/)).not.toBeInTheDocument(); // 낡은 "반영은 다음 단계" 문구 없음
  });

  it('기간 할인 대상에 홈 진열 테마(0.3.0): 고를 수 있는 테마만(자동 랭킹 빠짐), 보내는 값 THEME·sectionId, 상세는 테마 이름', async () => {
    const user = userEvent.setup();
    const view = renderAt('/promotions/new', as.marketing);
    const form = await screen.findByRole('form', { name: '행사 만들기' });
    await user.click(within(form).getByRole('radio', { name: '기간 할인' }));
    await user.click(within(form).getByRole('button', { name: '대상 더하기' }));
    await user.selectOptions(within(form).getByLabelText('구분'), 'THEME');
    await user.click(await within(form).findByRole('combobox', { name: '테마 1' }));
    const list = await screen.findByRole('listbox', { name: '테마 1' });
    expect(within(list).queryByText('실시간 랭킹')).not.toBeInTheDocument();
    await user.click(within(list).getByRole('option', { name: /겨울 제철 채소/ }));
    await user.click(within(form).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(view.mutations('/promotions').length).toBeGreaterThan(0));
    const body = (await view.mutations('/promotions')[0]!.clone().json()) as { targets: { type: string; id: string }[] };
    expect(body.targets).toEqual([{ type: 'THEME', id: 'T-WINTER-VEG' }]);
  });

  it('지정 발급 쿠폰은 만들 때 받을 고객을 고른다(0.3.0) — 보내는 값 coupon.recipients, 상세는 고객별 "시작 때 발급"', async () => {
    const user = userEvent.setup();
    const view = renderAt('/promotions/new', as.admin);
    const form = await screen.findByRole('form', { name: '행사 만들기' });
    await user.click(within(form).getByRole('radio', { name: /장바구니 쿠폰/ }));
    await user.type(within(form).getByLabelText('이름(고객에게 보여요)'), '보상 쿠폰');
    fireEvent.change(within(form).getByLabelText('시작'), { target: { value: local(1) } });
    fireEvent.change(within(form).getByLabelText('받기 끝'), { target: { value: local(72) } });
    await user.selectOptions(within(form).getByLabelText('할인 방식'), 'AMOUNT');
    await user.type(within(form).getByLabelText('할인액(원)'), '2000');
    await user.selectOptions(within(form).getByLabelText('받는 방법'), 'ADMIN');
    const finder = within(form).getByRole('search', { name: '받을 고객 찾기' });
    await user.type(within(finder).getByLabelText('값'), '482913{Enter}'); // Enter 는 찾기만 — 행사 저장이 아니다
    await user.click(within(await screen.findByTestId('grant-search-item')).getByRole('button', { name: '추가' }));
    expect(view.mutations('/promotions')).toHaveLength(0);
    await user.type(within(form).getByLabelText('발급 사유(보상 등, 200자까지)'), '배송 지연 보상');
    await user.click(within(form).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(view.mutations('/promotions').length).toBeGreaterThan(0));
    const body = (await view.mutations('/promotions')[0]!.clone().json()) as { coupon: { issueMode: string; recipients: { accountIds: string[]; reason: string } | null } };
    expect(body.coupon.recipients).toEqual({ accountIds: ['CUS-1001'], reason: '배송 지연 보상' });
  });

  it('상세: 만들 때 지정한 받을 고객별 결과 — 서버 PENDING 은 "시작 때 발급"', async () => {
    server.use(http.get(`${API_BASE}/promotions/PRM-R1`, () => HttpResponse.json(WITH_RECIPIENTS)));
    renderAt('/promotions/PRM-R1', as.admin);
    const rows = await screen.findAllByTestId('recipient-result');
    expect(rows[0]).toHaveTextContent('CUS-1001발급됨');
    expect(rows[1]).toHaveTextContent('CUS-1005시작 때 발급');
    expect(screen.getByText('발급 사유 · 배송 지연 보상')).toBeInTheDocument();
  });

  it('조기 종료: 사유 → end-submissions → 승인 요청(END_PROMOTION)', async () => {
    const user = userEvent.setup();
    const view = renderAt('/promotions/PRM-seed-1', as.marketing);
    const form = await screen.findByRole('form', { name: '조기 종료' });
    await user.type(within(form).getByLabelText('종료 사유(200자까지)'), '예산 소진');
    await user.click(within(form).getByRole('button', { name: '조기 종료 승인 요청' }));
    expect(await screen.findByText('조기 종료 승인을 요청했어요.')).toBeInTheDocument();
    const body = (await view.mutations('/change-requests')[0]!.clone().json()) as { allowedActions: string[] };
    expect(body.allowedActions).toEqual(['END_PROMOTION']);
  });

  it('메뉴: 마케팅·관리자·상담원에게 행사·쿠폰 묶음, MD 에게는 없음', async () => {
    const view = renderAt('/promotions', as.marketing);
    await screen.findAllByTestId('promotion-row');
    expect(screen.getAllByRole('link', { name: '행사 만들기' }).length).toBeGreaterThan(0);
    expect(screen.getByTestId('nav-group-marketing')).toBeInTheDocument();
    view.unmount();
    renderAt('/products', as.md);
    await screen.findByTestId('side-menu');
    expect(screen.queryByTestId('nav-group-marketing')).not.toBeInTheDocument();
  });
});
