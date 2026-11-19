// 고객센터·라이더 운영 메뉴(백엔드 요청 2026-11-15 cs-rider-menus) — 목(MSW) 기준. 실서버 확인은 아니다.
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../api/client';
import { as, renderAt } from '../test/render';
import { server } from '../test/server';

// 묶음 이름만(옆 업무 알림 숫자 빼고)
const groupLabels = () => [...document.querySelectorAll('[data-testid^="nav-group-"] > summary [data-group-label]')].map((s) => s.textContent);

describe('메뉴 묶음 — 역할로 보이고(합집합) 접고 편다', () => {
  it('역할마다 보이는 묶음', async () => {
    const cases: Array<[string, string[]]> = [
      [as.md, ['상품 관리', '업무 도우미']],
      [as.approver, ['승인', '업무 도우미']],
      [as.cs, ['조회·현황', '고객센터', '지원센터', '업무 도우미']],
      // 라이더 운영 묶음은 2026-11-18 라이더 백오피스로 옮겨 내렸다(ADR-0068)
      [as.riderOps, ['조회·현황', '지원센터', '업무 도우미']],
      [as.csRider, ['조회·현황', '고객센터', '지원센터', '업무 도우미']],
      [as.admin, ['상품 관리', '승인', '조회·현황', '고객센터', '지원센터', '처리 대기', '감사', '업무 도우미']], // 상품 관리는 2026-11-15 부터 OPERATOR_ADMIN 도
      [as.center, ['업무 도우미']],
    ];
    for (const [token, expected] of cases) {
      renderAt('/session', token);
      await screen.findByRole('link', { name: /내 세션/ });
      expect(groupLabels()).toEqual(expected);
      cleanup();
    }
  });

  it('지금 화면의 묶음만 펼친 채로 시작하고, 다른 묶음 이름을 누르면 그것만 펼친다(한 묶음만, 2026-11-18)', async () => {
    const user = userEvent.setup();
    renderAt('/inquiries', as.csRider);
    const cs = await screen.findByTestId('nav-group-cs');
    const support = screen.getByTestId('nav-group-support');
    expect(cs).toHaveAttribute('open');
    expect(support).not.toHaveAttribute('open');
    await user.click(within(support).getByText('지원센터'));
    expect(support).toHaveAttribute('open');
    expect(cs).not.toHaveAttribute('open'); // 전 묶음은 닫힘
    await user.click(within(support).getByText('지원센터'));
    expect(support).not.toHaveAttribute('open'); // 다시 누르면 닫힘
  });

  it('같은 화면은 메뉴에 한 번만 — 함께 쓰는 조회는 조회·현황 묶음에', async () => {
    const links = (g: string) => within(screen.getByTestId(`nav-group-${g}`)).getAllByRole('link', { hidden: true }).map((a) => a.childNodes[0]?.textContent); // 메뉴 이름만(업무 알림 숫자 빼고)
    renderAt('/session', as.admin);
    await screen.findByTestId('nav-group-lookup');
    expect(links('lookup')).toEqual(['주문 조회', '통합 조회', '실시간 배송 현황', '포장 인계 현황', '배송·배차 확인', '라이더 컴플레인']);
    expect(links('cs')).toEqual(['문의 답변', '전화·채팅 접수', '문의 만족도', '클레임 조회', '반품 접수', '고객센터 후속 처리']);
    expect(screen.queryByTestId('nav-group-riderOps')).not.toBeInTheDocument(); // 라이더 백오피스로 옮김(2026-11-18)
    const all = [...document.querySelectorAll('[data-testid^="nav-group-"] a')].map((a) => a.getAttribute('href'));
    expect(new Set(all).size).toBe(all.length);
  });

  // 2026-11-18 사용자: 첫 화면 = 대시보드(예전엔 역할 첫 메뉴로 바로 갔다). 숫자 카드는 역할로 보이는 메뉴의 것만.
  it('첫 화면은 대시보드 — 상담원은 오늘 주문·답변 대기 고객 문의, 라이더 운영은 기한 지난 접수 건·답변 대기 라이더 문의', async () => {
    renderAt('/', as.cs);
    expect(await screen.findByTestId('dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('dash-kpi-orders')).toBeInTheDocument();
    expect(screen.getByTestId('dash-kpi-inquiries')).toBeInTheDocument();
    expect(screen.queryByTestId('dash-kpi-casesOverdue')).not.toBeInTheDocument(); // 상담원은 접수 건을 맡지 않는다
    cleanup();
    renderAt('/', as.riderOps);
    expect(await screen.findByTestId('dash-kpi-casesOverdue')).toBeInTheDocument();
    expect(screen.getByTestId('dash-kpi-riderInquiries')).toBeInTheDocument();
    expect(screen.queryByTestId('dash-kpi-inquiries')).not.toBeInTheDocument();
  });
});

describe('주문 조회', () => {
  it('기본 기간(7일)으로 찾고, 목록 연락처는 서버가 가린 값만 보인다', async () => {
    const view = renderAt('/orders', as.cs);
    expect(await screen.findAllByTestId('order-row')).toHaveLength(4); // ORD-MOCK-1005(상품 준비 전 — 주문 취소 화면용) 더함
    expect(screen.getAllByText('010-****-5678')).toHaveLength(2);
    expect(document.body.textContent).not.toContain('01012345678');
    const sent = view.sent.find((r) => r.url.includes('/orders/lookups'));
    const q = new URL(sent?.url ?? '').searchParams;
    expect(q.get('createdFrom')).toBeTruthy();
    expect(q.get('createdTo')).toBeTruthy();
    view.stop();
  });

  it('주문 ID·고객 ID 없이 기간도 없으면 보내지 않고 안내한다 / 연락처는 숫자 9~11자리', async () => {
    const user = userEvent.setup();
    const view = renderAt('/orders?from=&to=', as.cs);
    expect(await screen.findByTestId('order-search-blocked')).toHaveTextContent('기간을 31일 안으로');
    expect(view.sent.filter((r) => r.url.includes('/orders/lookups'))).toHaveLength(0);

    await user.type(screen.getByLabelText('주문번호 또는 주문 ID'), 'ORD-MOCK-1002');
    await user.click(screen.getByRole('button', { name: '찾기' }));
    expect(await screen.findAllByTestId('order-row')).toHaveLength(1);

    await user.type(screen.getByLabelText('수령인 연락처'), '1234');
    await user.click(screen.getByRole('button', { name: '찾기' }));
    expect(await screen.findByTestId('order-search-blocked')).toHaveTextContent('숫자 9~11자리');
    view.stop();
  });

  it('연락처는 하이픈을 빼고 숫자만 완전 일치로 보낸다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/orders', as.cs);
    await screen.findAllByTestId('order-row');
    await user.type(screen.getByLabelText('수령인 연락처'), '010-5555-6666');
    await user.click(screen.getByRole('button', { name: '찾기' }));
    await waitFor(() => expect(screen.getAllByTestId('order-row')).toHaveLength(1));
    const last = view.sent.filter((r) => r.url.includes('/orders/lookups')).at(-1);
    expect(new URL(last?.url ?? '').searchParams.get('receiverPhone')).toBe('01055556666');
    view.stop();
  });

  it('상세: 배송지는 서버가 가린 값 그대로(0.4.0) — 이 주문의 클레임이 보인다. 취소 버튼 없음', async () => {
    renderAt('/orders/ORD-MOCK-1002', as.cs);
    const phone = await screen.findByTestId('order-receiver-phone');
    expect(phone).toHaveTextContent('010-****-6666');
    expect(screen.getByTestId('order-detail-address')).toHaveTextContent('***');
    expect(screen.getByTestId('order-entrance-note')).toHaveTextContent('가림');
    expect(screen.getByTestId('order-delivery-note')).toHaveTextContent('가림');
    expect(screen.queryByText('01055556666')).not.toBeInTheDocument();
    expect(await screen.findByText('74939002 취소')).toBeInTheDocument(); // 이 표는 줄을 누르면 클레임 상세 — ADR-0070 덧붙임(2026-11-19): 시스템 ID·끝 8자리를 보이지 않는다
    expect(screen.queryByRole('button', { name: /취소/ })).not.toBeInTheDocument();
  });

  it('원문 열람: 사유 2자 이상 + 고른 항목만 pii-reveals 로(키·출처 헤더) → 그 항목만 원문, 다시 가리기', async () => {
    const user = userEvent.setup();
    const view = renderAt('/orders/ORD-MOCK-1002', as.cs);
    await screen.findByTestId('order-receiver-phone');
    const form = screen.getByRole('form', { name: '원문 열람' });
    expect(within(form).getByRole('button', { name: '열람' })).toBeDisabled(); // 사유 없음
    for (const f of ['수령인 이름', '상세 주소·핀', '출입 메모·배송 요청사항']) await user.click(within(form).getByLabelText(f)); // 연락처만 남김
    await user.type(within(form).getByLabelText('열람 사유'), '고객 문의 — 연락처 확인');
    await user.click(within(form).getByRole('button', { name: '열람' }));

    expect(await screen.findByTestId('order-receiver-phone')).toHaveTextContent('01055556666');
    await waitFor(() => expect(screen.getByTestId('order-receiver-phone')).toHaveTextContent('01055556666'));
    expect(screen.getByTestId('order-detail-address')).toHaveTextContent('***'); // 열지 않은 항목은 그대로 가림
    expect(screen.getByText(/열람 기록 PAL-MOCK-/)).toBeInTheDocument();
    const sent = view.mutations('/pii-reveals');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers.get('Idempotency-Key')).toBeTruthy();
    expect(sent[0]!.headers.get('X-Source-System')).toBe('backoffice-web');
    expect(await sent[0]!.json()).toEqual({ reason: '고객 문의 — 연락처 확인', fields: ['PHONE'] });

    await user.click(screen.getByRole('button', { name: '다시 가리기' }));
    expect(screen.getByTestId('order-receiver-phone')).toHaveTextContent('010-****-6666');
  });

  it('열람 기록을 못 남기면(503) 원문 없이 결과 확인 — 같은 키로 다시 보내 원문을 받는다', async () => {
    const user = userEvent.setup();
    let fail = true;
    server.use(
      http.post(`${API_BASE}/orders/lookups/:orderId/pii-reveals`, () =>
        fail ? HttpResponse.json({ type: 'about:blank', title: 't', status: 503, code: 'UNKNOWN_RESULT', traceId: 't' }, { status: 503, headers: { 'content-type': 'application/problem+json' } }) : undefined,
      ),
    );
    const view = renderAt('/orders/ORD-MOCK-1002', as.cs);
    await screen.findByTestId('order-receiver-phone');
    const form = screen.getByRole('form', { name: '원문 열람' });
    await user.type(within(form).getByLabelText('열람 사유'), '배송지 확인');
    await user.click(within(form).getByRole('button', { name: '열람' }));
    expect(await screen.findByRole('button', { name: '같은 요청으로 결과 확인' })).toBeInTheDocument();
    expect(screen.getByTestId('order-receiver-phone')).toHaveTextContent('010-****-6666');
    fail = false;
    await user.click(screen.getByRole('button', { name: '같은 요청으로 결과 확인' }));
    await waitFor(() => expect(screen.getByTestId('order-receiver-phone')).toHaveTextContent('01055556666'));
    const keys = view.mutations('/pii-reveals').map((r) => r.headers.get('Idempotency-Key'));
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(new Set(keys).size).toBe(1);
  });

  it('권한 밖(MD)은 403 — 빈 목록이 아니라 오류로 보인다', async () => {
    renderAt('/orders', as.md);
    expect(await screen.findByRole('heading', { name: '이용할 수 없는 화면이에요' })).toBeInTheDocument();
    expect(screen.queryByText('조건에 맞는 주문이 없어요.')).not.toBeInTheDocument();
  });
});

describe('라이더 컴플레인', () => {
  it('기록: Idempotency-Key·X-Source-System, 라이더는 서버가 채운다 → 목록에 보인다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/rider-complaints/new?deliveryId=DLV-MOCK-1&orderId=ORD-MOCK-1001', as.cs);
    expect((await screen.findByLabelText('배송 번호'))).toHaveValue('DLV-MOCK-1');
    await user.click(screen.getByLabelText('파손'));
    await user.type(screen.getByLabelText('내부 메모'), '상자가 찌그러짐');
    await user.click(screen.getByRole('button', { name: '기록하기' }));
    await user.click(await screen.findByRole('link', { name: '기록한 컴플레인 보기' }));
    // 라이더는 화면 번호(ADR-0070) — 시스템 ID RID-MOCK-1 은 링크에만
    expect(await within(await screen.findByTestId('complaint-detail')).findAllByText(/482913/)).not.toHaveLength(0);
    expect(screen.getByTestId('complaint-note')).toHaveTextContent('상자가 찌그러짐');

    const [post] = view.mutations('/rider-complaints');
    expect(post?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(post?.headers.get('X-Source-System')).toBe('backoffice-web');
    expect(await post?.json()).toEqual({ deliveryId: 'DLV-MOCK-1', complaintType: 'DAMAGE', orderId: 'ORD-MOCK-1001', note: '상자가 찌그러짐' });
    view.stop();
  });

  it('배정 라이더가 없으면 422 RIDER_NOT_ASSIGNED 를 그대로 안내한다', async () => {
    const user = userEvent.setup();
    renderAt('/rider-complaints/new?deliveryId=DLV-MOCK-4', as.cs);
    await user.click((await screen.findByLabelText('신고')));
    await user.click(screen.getByRole('button', { name: '기록하기' }));
    expect(await screen.findByText('그 배송에 배정된 라이더가 없어요.')).toBeInTheDocument();
  });

  it('응답을 잃으면 결과 불명 — 같은 키로 확인해 한 건만 기록된다', async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(
      http.post(`${API_BASE}/rider-complaints`, () => {
        calls++;
        return calls === 1 ? new HttpResponse('<html>', { status: 502, headers: { 'content-type': 'text/html' } }) : undefined;
      }),
    );
    const view = renderAt('/rider-complaints/new?deliveryId=DLV-MOCK-1', as.cs);
    await user.click((await screen.findByLabelText('오배송')));
    await user.click(screen.getByRole('button', { name: '기록하기' }));
    expect(await screen.findByText('처리 결과를 확인하고 있어요')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '같은 요청으로 결과 확인' }));
    expect(await screen.findByRole('link', { name: '기록한 컴플레인 보기' })).toBeInTheDocument();
    const posts = view.mutations('/rider-complaints');
    expect(posts).toHaveLength(2);
    expect(posts[0]?.headers.get('Idempotency-Key')).toBe(posts[1]?.headers.get('Idempotency-Key'));
    view.stop();
  });

  it('라이더 운영은 목록을 보고, 기록은 서버가 403', async () => {
    const user = userEvent.setup();
    renderAt('/rider-complaints', as.riderOps);
    expect(await screen.findAllByTestId('complaint-row')).toHaveLength(2);
    await user.click(screen.getByRole('link', { name: '컴플레인 기록' }));
    await user.type(screen.getByLabelText('배송 번호'), 'DLV-MOCK-1');
    await user.click(screen.getByLabelText('신고'));
    await user.click(screen.getByRole('button', { name: '기록하기' }));
    expect(await screen.findByRole('alert')).toHaveAttribute('data-code', 'FORBIDDEN');
  });

  it('문의 상세에서 컴플레인 기록으로 가면 문의 ID·주문 ID 가 채워진다', async () => {
    const user = userEvent.setup();
    renderAt('/inquiries/INQ-MOCK-3', as.cs);
    await user.click(await screen.findByRole('link', { name: '이 문의로 라이더 컴플레인 기록' }));
    expect(await screen.findByLabelText('문의 ID')).toHaveValue('INQ-MOCK-3');
    expect(screen.getByLabelText('주문 ID')).toHaveValue('ORD-MOCK-1001');
  });
});

describe('클레임 조회', () => {
  it('목록 → 상세·환불. 결정 버튼 없음, PG 성공 전 환불은 완료로 보이지 않는다', async () => {
    const user = userEvent.setup();
    renderAt('/claims', as.cs);
    expect(await screen.findAllByTestId('claim-row')).toHaveLength(3);
    await user.click(screen.getByText('74939003 취소'));
    expect(await screen.findByTestId('claim-state')).toHaveTextContent('출고 중지 대기');
    expect(await screen.findByTestId('refund-row')).toHaveTextContent('실행 대기');
    expect(screen.queryByText('환불 완료')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /승인|거절|결정/ })).not.toBeInTheDocument();
  });
});

describe('배송 확인', () => {
  // 2026-11-19 사용자 "라이더 백오피스만"(delivery PR #255): 라이더·배송 일 처리는 관리자만, 그 밖은 보기만 + 이 배송의 접수 건
  it('상담원은 전달 실패를 보기만 — 결정·배차 취소 칸 없음, 이 배송의 접수 건(지원센터 처리 상태)으로 잇는다', async () => {
    renderAt('/deliveries/DLV-MOCK-2', as.cs);
    expect(await screen.findByTestId('execution-state')).toHaveTextContent('전달 실패 등록');
    expect(screen.getByTestId('delivery-failure')).toHaveTextContent('세 번 전화했지만');
    const box = screen.getByTestId('rider-ops-handoff');
    expect(box).toHaveTextContent('라이더 백오피스(지원센터)에서');
    const link = await within(box).findByTestId('rider-ops-case');
    expect(link).toHaveAttribute('href', '/cases/CASE-MOCK-2');
    expect(link).toHaveTextContent('전달 실패');
    expect(link).toHaveTextContent('지원센터 처리 중');
    expect(screen.queryByRole('button', { name: '결정 보내기' })).toBeNull();
    expect(screen.queryByTestId('next-action')).toBeNull();
  });

  it('라이더 운영도 이 앱에서는 배차 취소 칸 없음 — 접수 건이 없으면 안내만', async () => {
    renderAt('/deliveries/DLV-MOCK-1', as.riderOps);
    expect(await screen.findByTestId('rider-ops-handoff')).toBeInTheDocument();
    expect(await within(screen.getByTestId('dispatch-panel')).findByTestId('dispatch-state')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '배차 취소 보내기' })).toBeNull();
  });

  it('접수 건 목록을 못 읽으면 "확인하지 못했어요" — 없음으로 바꾸지 않는다', async () => {
    server.use(http.get(`${API_BASE}/cases`, () => HttpResponse.json({ code: 'UNAVAILABLE' }, { status: 503 })));
    renderAt('/deliveries/DLV-MOCK-2', as.cs);
    expect(await screen.findByTestId('rider-ops-cases-failed')).toBeInTheDocument();
    expect(screen.queryByTestId('rider-ops-no-case')).toBeNull();
  });

  it('전달 실패 확정(관리자): X-Expected-Version = 수행 version, 반영되면 상태가 바뀐다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/deliveries/DLV-MOCK-2', as.admin);
    expect(await screen.findByTestId('execution-state')).toHaveTextContent('전달 실패 등록');
    expect(screen.getByTestId('delivery-failure')).toHaveTextContent('세 번 전화했지만');
    // 다음 할 일(2026-11-18): 전달 실패 등록이면 확정·반려 칸으로
    expect(await screen.findByTestId('next-action')).toHaveTextContent('전달 실패를 확정하거나 반려해 주세요');
    expect(screen.getByRole('link', { name: '결정 칸으로' })).toHaveAttribute('href', '#failure-decision');
    await user.click(screen.getByLabelText('실패 확정'));
    await user.click(screen.getByRole('button', { name: '결정 보내기' }));
    expect(await screen.findByTestId('decision-result')).toHaveTextContent('반영됐어요.');
    await waitFor(() => expect(screen.getByTestId('execution-state')).toHaveTextContent('전달 실패 확정'));
    const [post] = view.mutations('/failure-decisions');
    expect(post?.headers.get('X-Expected-Version')).toBe('4');
    expect(await post?.json()).toEqual({ decision: 'CONFIRM' });
    view.stop();
  });

  it('상담원도 배차를 볼 수 있다(dispatch 0.3.2, BOD-2) — 수행·배차를 따로 읽는다', async () => {
    renderAt('/deliveries/DLV-MOCK-1', as.cs);
    expect(await screen.findByTestId('execution-state')).toHaveTextContent('픽업');
    expect(await within(screen.getByTestId('dispatch-panel')).findByTestId('dispatch-state')).toBeInTheDocument();
  });

  it('픽업 전 배차 취소: 202 접수 → 짝 조회로 결과 확인, 같은 키. 운영자 판단 사유는 승인 번호가 필요', async () => {
    const user = userEvent.setup();
    const view = renderAt('/deliveries/DLV-MOCK-3', as.admin);
    expect(await screen.findByTestId('dispatch-state')).toHaveTextContent('배정');
    await user.selectOptions(screen.getByLabelText('사유', { selector: 'select' }), 'OPERATOR');
    expect(screen.getByRole('button', { name: '배차 취소 보내기' })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('사유', { selector: 'select' }), 'RIDER_UNABLE');
    await user.click(screen.getByRole('button', { name: '배차 취소 보내기' }));
    expect(await screen.findByTestId('cancel-result')).toHaveTextContent('배차를 취소했어요.');
    await waitFor(() => expect(screen.getByTestId('dispatch-state')).toHaveTextContent('배차 중'));

    const [post] = view.mutations('/assignment-cancellations');
    const key = post?.headers.get('Idempotency-Key');
    expect(post?.headers.get('X-Expected-Version')).toBe('2');
    expect(await post?.json()).toEqual({ requestedBy: 'OPERATOR', reason: 'RIDER_UNABLE', reassign: true });
    const pairs = view.sent.filter((r) => r.method === 'GET' && r.url.includes(`/assignment-cancellations/${key ?? ''}`));
    expect(pairs.length).toBeGreaterThanOrEqual(2);
    view.stop();
  });

  it('픽업 뒤면 422 PICKED_UP_CASE_REQUIRED — 지원센터 안내', async () => {
    const user = userEvent.setup();
    server.use(http.post(`${API_BASE}/deliveries/:id/assignment-cancellations`, () => HttpResponse.json({ code: 'PICKED_UP_CASE_REQUIRED', status: 422, title: 'x' }, { status: 422, headers: { 'content-type': 'application/problem+json' } })));
    renderAt('/deliveries/DLV-MOCK-3', as.admin);
    await screen.findByTestId('dispatch-state');
    await user.selectOptions(screen.getByLabelText('사유', { selector: 'select' }), 'NO_SHOW');
    await user.click(screen.getByRole('button', { name: '배차 취소 보내기' }));
    expect(await screen.findByText(/지원센터로 처리해 주세요/)).toBeInTheDocument();
  });
});

describe('라이더 상세(보기만 — 라이더 운영 묶음은 2026-11-18 라이더 백오피스로)', () => {
  it('옛 찾기·제한 검토 주소는 라이더 백오피스 안내, 메뉴에는 없다', async () => {
    renderAt('/riders', as.riderOps);
    expect(await screen.findByRole('heading', { name: '라이더 운영은 라이더 백오피스로 옮겼어요' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '라이더 백오피스 열기' })).toHaveAttribute('href', 'http://localhost:5176/riders');
    expect(screen.queryByRole('link', { name: '라이더 찾기·계정 제한', hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '제한 검토', hidden: true })).not.toBeInTheDocument();
  });

  it('상세는 보기만 — 제한 걸기·풀기·제한 검토 없이 "라이더 백오피스에서" 안내와 그 앱 같은 라이더 링크, 상담원도 연다', async () => {
    renderAt('/riders/RID-MOCK-2', as.cs);
    expect(await screen.findByTestId('rider-basic')).toHaveTextContent('정상');
    expect(screen.getByTestId('rider-ops-moved')).toHaveTextContent('라이더 백오피스에서');
    expect(screen.getByRole('link', { name: '라이더 백오피스에서 이 라이더 열기' })).toHaveAttribute('href', 'http://localhost:5176/riders/RID-MOCK-2');
    expect(screen.queryByRole('button', { name: '제한 보내기' })).not.toBeInTheDocument();
    expect(screen.queryByText('이 라이더의 제한 검토')).not.toBeInTheDocument();
    expect(screen.getByRole('form', { name: '원문 열람' })).toBeInTheDocument(); // 개인정보 보기는 남김(서버가 CS_AGENT 허용)
  });

  it('라이더 상세: 가린 이름·전화 → 사유 + pii-reveals(전화만) → 전화만 원문, 다시 가리기', async () => {
    const user = userEvent.setup();
    const view = renderAt('/riders/RID-MOCK-1', as.riderOps);
    expect(await screen.findByTestId('rider-phone')).toHaveTextContent('010****2222');
    const form = screen.getByRole('form', { name: '원문 열람' });
    await user.click(within(form).getByLabelText('이름'));
    await user.type(within(form).getByLabelText('열람 사유'), '컴플레인 확인 — 연락');
    await user.click(within(form).getByRole('button', { name: '열람' }));
    await waitFor(() => expect(screen.getByTestId('rider-phone')).toHaveTextContent('01011112222'));
    expect(screen.getByTestId('rider-name')).toHaveAttribute('data-masked', 'true');
    expect(await view.mutations('/pii-reveals')[0]!.json()).toEqual({ reason: '컴플레인 확인 — 연락', fields: ['PHONE'] });
    await user.click(screen.getByRole('button', { name: '다시 가리기' }));
    expect(screen.getByTestId('rider-phone')).toHaveTextContent('010****2222');
  });

  it('라이더 상세의 "이 라이더의 배송"은 GET /deliveries?riderId=', async () => {
    const view = renderAt('/riders/RID-MOCK-1', as.riderOps);
    const rows = await screen.findAllByTestId('delivery-row');
    expect(rows.length).toBeGreaterThan(0);
    expect(view.sent.some((r) => new URL(r.url).pathname.endsWith('/deliveries') && new URL(r.url).searchParams.get('riderId') === 'RID-MOCK-1')).toBe(true);
  });

  it('배송 확인: "전달 실패 확정 대기" = state=FAILURE_REPORTED&sort=OLDEST', async () => {
    const user = userEvent.setup();
    const view = renderAt('/deliveries', as.riderOps);
    await user.click((await screen.findByRole('button', { name: '전달 실패 확정 대기' })));
    const rows = await screen.findAllByTestId('delivery-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('74939002-1'); // 화면 배송 번호(ADR-0070) — 시스템 ID DLV-MOCK-2 는 링크에만
    expect(within(rows[0]!).getAllByRole('link')[0]).toHaveAttribute('href', '/deliveries/DLV-MOCK-2');
    const get = view.sent.find((r) => new URL(r.url).pathname.endsWith('/deliveries'))!;
    expect(new URL(get.url).searchParams.get('state')).toBe('FAILURE_REPORTED');
    expect(new URL(get.url).searchParams.get('sort')).toBe('OLDEST');
  });

  it('주문 상세의 "이 주문의 배송"(BR-56 끝)', async () => {
    renderAt('/orders/ORD-MOCK-1003', as.cs);
    const rows = await screen.findAllByTestId('delivery-row');
    // 화면 배송 번호, 번호가 없으면 ID 끝 8자리 + "번호 없음"(ADR-0070)
    expect(rows.map((r) => within(r).getAllByRole('link')[0]!.textContent)).toEqual(expect.arrayContaining(['74939003-1', '번호 없음']));
  });

  it('도움요청 대기는 사건함으로 — 라이더 도움요청 사건 상세에 라이더가 쓴 내용', async () => {
    const user = userEvent.setup();
    renderAt('/delivery-help-requests', as.riderOps);
    const row = await screen.findByTestId('case-row');
    expect(row).toHaveTextContent('라이더 도움요청');
    await user.click(within(row).getByText(/라이더 도움요청 — 건물 출입 불가/));
    expect(await screen.findByTestId('case-help-request')).toHaveTextContent('공동현관이 잠겨');
  });
});
