// 고객센터·라이더 운영 메뉴(백엔드 요청 2026-11-15 cs-rider-menus) — 목(MSW) 기준. 실서버 확인은 아니다.
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../api/client';
import { as, renderAt } from '../test/render';
import { server } from '../test/server';

const groupLabels = () => [...document.querySelectorAll('[data-testid^="nav-group-"] > summary')].map((s) => s.textContent);

describe('메뉴 묶음 — 역할로 보이고(합집합) 접고 편다', () => {
  it('역할마다 보이는 묶음', async () => {
    const cases: Array<[string, string[]]> = [
      [as.md, ['상품 관리', '업무 도우미']],
      [as.approver, ['승인', '업무 도우미']],
      [as.cs, ['조회·현황', '고객센터', '지원센터', '업무 도우미']],
      [as.riderOps, ['조회·현황', '라이더 운영', '지원센터', '업무 도우미']],
      [as.csRider, ['조회·현황', '고객센터', '라이더 운영', '지원센터', '업무 도우미']],
      [as.admin, ['상품 관리', '승인', '조회·현황', '고객센터', '라이더 운영', '지원센터', '처리 대기', '감사', '업무 도우미']], // 상품 관리는 2026-11-15 부터 OPERATOR_ADMIN 도
      [as.center, ['업무 도우미']],
    ];
    for (const [token, expected] of cases) {
      renderAt('/session', token);
      await screen.findByRole('link', { name: /내 세션/ });
      expect(groupLabels()).toEqual(expected);
      cleanup();
    }
  });

  it('지금 화면의 묶음만 펼친 채로 시작하고, 묶음 이름을 누르면 접고 편다', async () => {
    const user = userEvent.setup();
    renderAt('/inquiries', as.csRider);
    const cs = await screen.findByTestId('nav-group-cs');
    const riderOps = screen.getByTestId('nav-group-riderOps');
    expect(cs).toHaveAttribute('open');
    expect(riderOps).not.toHaveAttribute('open');
    await user.click(within(riderOps).getByText('라이더 운영'));
    expect(riderOps).toHaveAttribute('open');
    await user.click(within(cs).getByText('고객센터'));
    expect(cs).not.toHaveAttribute('open');
  });

  it('같은 화면은 메뉴에 한 번만 — 함께 쓰는 조회는 조회·현황 묶음에', async () => {
    const links = (g: string) => within(screen.getByTestId(`nav-group-${g}`)).getAllByRole('link', { hidden: true }).map((a) => a.textContent);
    renderAt('/session', as.admin);
    await screen.findByTestId('nav-group-lookup');
    expect(links('lookup')).toEqual(['주문 조회', '통합 조회', '실시간 배송 현황', '포장 인계 현황', '배송·배차 확인', '라이더 컴플레인']);
    expect(links('cs')).toEqual(['문의 답변', '전화·채팅 접수', '문의 만족도', '클레임 조회', '고객센터 후속 처리']);
    expect(links('riderOps')).toEqual(['라이더 찾기·계정 제한', '제한 검토']);
    const all = [...document.querySelectorAll('[data-testid^="nav-group-"] a')].map((a) => a.getAttribute('href'));
    expect(new Set(all).size).toBe(all.length);
  });

  it('첫 화면은 역할로 보이는 첫 메뉴 — 상담원은 주문 조회, 라이더 운영은 라이더 찾기', async () => {
    renderAt('/', as.cs);
    expect(await screen.findByRole('heading', { name: '주문 조회' })).toBeInTheDocument();
    cleanup();
    renderAt('/', as.riderOps);
    expect(await screen.findByRole('heading', { name: '라이더 찾기·계정 제한' })).toBeInTheDocument();
  });
});

describe('주문 조회', () => {
  it('기본 기간(7일)으로 찾고, 목록 연락처는 서버가 가린 값만 보인다', async () => {
    const view = renderAt('/orders', as.cs);
    expect(await screen.findAllByTestId('order-row')).toHaveLength(3);
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

    await user.type(screen.getByLabelText('주문 ID'), 'ORD-MOCK-1002');
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
    expect(await screen.findByRole('link', { name: 'CLM-MOCK-1' })).toBeInTheDocument();
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
    expect(screen.getByLabelText('배송 번호')).toHaveValue('DLV-MOCK-1');
    await user.click(screen.getByLabelText('파손'));
    await user.type(screen.getByLabelText('내부 메모'), '상자가 찌그러짐');
    await user.click(screen.getByRole('button', { name: '기록하기' }));
    await user.click(await screen.findByRole('link', { name: '기록한 컴플레인 보기' }));
    expect(await screen.findByTestId('complaint-detail')).toHaveTextContent('RID-MOCK-1');
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
    await user.click(screen.getByLabelText('신고'));
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
    await user.click(screen.getByLabelText('오배송'));
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
    expect(await screen.findAllByTestId('claim-row')).toHaveLength(2);
    await user.click(screen.getByRole('link', { name: 'CLM-MOCK-2' }));
    expect(await screen.findByTestId('claim-state')).toHaveTextContent('출고 중지 대기');
    expect(await screen.findByTestId('refund-row')).toHaveTextContent('실행 대기');
    expect(screen.queryByText('환불 완료')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /승인|거절|결정/ })).not.toBeInTheDocument();
  });
});

describe('배송 확인', () => {
  it('전달 실패 확정: X-Expected-Version = 수행 version, 반영되면 상태가 바뀐다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/deliveries/DLV-MOCK-2', as.cs);
    expect(await screen.findByTestId('execution-state')).toHaveTextContent('전달 실패 등록');
    expect(screen.getByTestId('delivery-failure')).toHaveTextContent('세 번 전화했지만');
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

describe('라이더 운영', () => {
  it('계정 제한 걸기: X-Expected-Version = 라이더 version, 이력과 현재 제한이 바뀐다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/riders/RID-MOCK-2', as.admin);
    expect(await screen.findByTestId('rider-current-restriction')).toHaveTextContent('정상');
    expect(screen.getAllByTestId('restriction-row')).toHaveLength(2);
    await user.selectOptions(screen.getByLabelText('바꿀 제한'), 'DISPATCH_RESTRICTED');
    await user.type(screen.getByLabelText('사유', { selector: 'textarea' }), '오배송 3건 확인');
    await user.type(screen.getByLabelText('증빙'), 'RCP-MOCK-1, RCP-MOCK-2');
    await user.click(screen.getByRole('button', { name: '제한 보내기' }));
    expect(await screen.findByTestId('restriction-result')).toHaveTextContent('배차 제한');
    await waitFor(() => expect(screen.getByTestId('rider-current-restriction')).toHaveTextContent('배차 제한'));
    expect(screen.getAllByTestId('restriction-row')).toHaveLength(3);
    const [post] = view.mutations('/restrictions');
    expect(post?.headers.get('X-Expected-Version')).toBe('3');
    expect(await post?.json()).toEqual({ restriction: 'DISPATCH_RESTRICTED', reason: '오배송 3건 확인', evidenceRefs: ['RCP-MOCK-1', 'RCP-MOCK-2'] });
    view.stop();
  });

  it('라이더 운영 역할도 계정 제한을 보고 건다(rider 0.4.0, BOD-1)', async () => {
    renderAt('/riders/RID-MOCK-2', as.riderOps);
    expect(await screen.findByTestId('rider-current-restriction')).toHaveTextContent('정상');
    expect(screen.getByRole('button', { name: '제한 보내기' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '이용할 수 없는 화면이에요' })).not.toBeInTheDocument();
  });

  it('제한 검토: 제한 없이 "제한함"은 거절, 기각은 그 자리에서 닫힌다', async () => {
    const user = userEvent.setup();
    renderAt('/riders/restriction-reviews', as.admin);
    const row = await screen.findByTestId('review-row');
    await user.click(within(row).getByRole('button', { name: '제한함으로 결정' }));
    expect(await within(row).findByRole('alert')).toHaveAttribute('data-code', 'INVALID_STATE');
    cleanup();

    renderAt('/riders/restriction-reviews', as.admin);
    const again = await screen.findByTestId('review-row');
    await user.type(within(again).getByLabelText('메모'), '같은 주소 착오');
    await user.click(within(again).getByRole('button', { name: '기각' }));
    await waitFor(() => expect(screen.getByTestId('review-row')).toHaveTextContent('기각'));
  });

  it('라이더 찾기(rider 0.4.0): 전화번호 완전 일치(숫자만) → 이름·전화는 가린 값, 쪽 이동', async () => {
    const user = userEvent.setup();
    const view = renderAt('/riders', as.riderOps);
    await user.type(screen.getByLabelText('전화번호(완전 일치)'), '010-1111-2222');
    await user.click(screen.getByRole('button', { name: '찾기' }));
    const rows = await screen.findAllByTestId('rider-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('010****2222');
    expect(rows[0]).not.toHaveTextContent('김라이더'); // 이름은 가린 값
    expect(rows[0]).not.toHaveTextContent('01011112222');
    const get = view.sent.find((r) => r.method === 'GET' && new URL(r.url).pathname.endsWith('/riders'))!;
    expect(new URL(get.url).searchParams.get('phone')).toBe('01011112222');
    expect(screen.queryByLabelText('이름')).not.toBeInTheDocument(); // 이름 검색 없음
  });

  it('전화번호가 10~11자리가 아니면 보내기 전에 막는다', async () => {
    const user = userEvent.setup();
    renderAt('/riders', as.riderOps);
    await user.type(screen.getByLabelText('전화번호(완전 일치)'), '1234');
    expect(screen.getByRole('button', { name: '찾기' })).toBeDisabled();
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
    await user.click(screen.getByRole('button', { name: '전달 실패 확정 대기' }));
    const rows = await screen.findAllByTestId('delivery-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('DLV-MOCK-2');
    const get = view.sent.find((r) => new URL(r.url).pathname.endsWith('/deliveries'))!;
    expect(new URL(get.url).searchParams.get('state')).toBe('FAILURE_REPORTED');
    expect(new URL(get.url).searchParams.get('sort')).toBe('OLDEST');
  });

  it('주문 상세의 "이 주문의 배송"(BR-56 끝)', async () => {
    renderAt('/orders/ORD-MOCK-1003', as.cs);
    const rows = await screen.findAllByTestId('delivery-row');
    expect(rows.map((r) => within(r).getAllByRole('link')[0]!.textContent)).toEqual(expect.arrayContaining(['DLV-MOCK-3', 'DLV-MOCK-4']));
  });

  it('도움요청 대기는 사건함으로 — 라이더 도움요청 사건 상세에 라이더가 쓴 내용', async () => {
    const user = userEvent.setup();
    renderAt('/delivery-help-requests', as.riderOps);
    const row = await screen.findByTestId('case-row');
    expect(row).toHaveTextContent('라이더 도움요청');
    await user.click(within(row).getByRole('link', { name: /라이더 도움요청 — 건물 출입 불가/ }));
    expect(await screen.findByTestId('case-help-request')).toHaveTextContent('공동현관이 잠겨');
  });
});
