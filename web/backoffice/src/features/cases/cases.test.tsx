// 지원센터 사건함(case 0.4.0) — 탭(아무도 안 맡은·내 것·기한 넘김·닫힌), 맡기·닫기, 역할별 버튼, 오배송 열기.
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE, BFF_BASE } from '../../api/client';
import { server } from '../../test/server';

import { as, renderAt } from '../../test/render';

const rows = () => screen.findAllByTestId('case-row');
/** 사건함 목록은 bff 0.5.0 views/case-inbox */
const inboxCalls = (sent: readonly Request[]) => sent.filter((r) => new URL(r.url).pathname.endsWith('/views/case-inbox')).map((r) => new URL(r.url).searchParams);

describe('지원센터 사건', () => {
  it('아무도 안 맡은 것: 긴급 먼저, 기한 넘김 빨간 표시, 관련 배송·주문·라이더 링크', async () => {
    const view = renderAt('/cases', as.riderOps);
    const list = await rows();
    // 미배정 배송 쪽 사건 3건(도움요청 P1·위치 끊김·배차 실패 0.5.0)
    expect(list).toHaveLength(3);
    expect(list[0]).toHaveTextContent('라이더 도움요청');
    expect(within(list[0]!).getByText(/기한 넘김/)).toHaveAttribute('data-overdue', 'true');
    expect(within(list[0]!).getByRole('link', { name: '배송 D74939255' })).toHaveAttribute('href', '/deliveries/DLV-MOCK-1');
    expect(within(list[0]!).getByRole('link', { name: '주문 번호 확인 불가' })).toHaveAttribute('href', '/orders/ORD-MOCK-1001');
    expect(within(list[0]!).getByRole('link', { name: '라이더 R4785' })).toHaveAttribute('href', '/riders/RID-MOCK-1');
    const q = inboxCalls(view.sent)[0]!;
    expect([q.get('unassigned'), q.get('size')]).toEqual(['true', '50']);
  });

  it('탭: 내 것(assigneeId=나)·기한 넘김·닫힌 것', async () => {
    const view = renderAt('/cases', as.riderOps);
    await rows();
    await userEvent.click(screen.getByRole('tab', { name: '내 것' }));
    await waitFor(() => expect(screen.getAllByTestId('case-row')).toHaveLength(1));
    expect(screen.getByTestId('case-row')).toHaveTextContent('위치 끊김');
    expect(inboxCalls(view.sent).some((q) => q.get('assignee') === 'op-rider-ops-1')).toBe(true);
    await userEvent.click(screen.getByRole('tab', { name: '처리 끝남' }));
    await waitFor(() => expect(screen.getByTestId('case-row')).toHaveTextContent('오배송'));
  });

  it('맡기: 내 운영자 ID 로 assignments → 담당이 나로 바뀌고 닫기 폼이 보인다', async () => {
    const view = renderAt('/cases/CASE-MOCK-2', as.riderOps);
    await userEvent.click(await screen.findByRole('button', { name: '내가 맡기' }));
    await waitFor(() => expect(screen.getByTestId('case-assignee')).toHaveTextContent('[목] 정운영 · P2026-00006')); // 직원은 이름 · 사번(ADR-0070 덧붙임)
    const sent = view.mutations('/cases/CASE-MOCK-2/assignments')[0]!;
    expect(sent.headers.get('Idempotency-Key')).toBeTruthy();
    expect(sent.headers.get('X-Source-System')).toBe('backoffice-web');
    expect(await sent.json()).toEqual({ assigneeId: 'op-rider-ops-1' });
    expect(screen.queryByRole('button', { name: '내가 맡기' })).not.toBeInTheDocument();
  });

  it('닫기: 결과 + 요약(개인정보 안내) → closures → 닫힘·종결 기록', async () => {
    const view = renderAt('/cases/CASE-MOCK-3', as.riderOps); // 내가 집은 사건
    const form = await screen.findByRole('form', { name: '완료 처리' });
    expect(within(form).getByText(/고객 주소·연락처 원문은 적지 마세요/)).toBeInTheDocument();
    await userEvent.selectOptions(within(form).getByLabelText('결과'), 'NO_ACTION_REQUIRED');
    await userEvent.type(within(form).getByLabelText('처리 결과 요약'), '위치 다시 들어옴');
    await userEvent.click(within(form).getByRole('button', { name: '완료 처리' }));
    await waitFor(() => expect(screen.getByTestId('case-state')).toHaveTextContent('처리 끝남'));
    expect(screen.getByTestId('case-closure')).toHaveTextContent('조치 필요 없음');
    expect(await view.mutations('/closures')[0]!.json()).toEqual({ resolution: 'NO_ACTION_REQUIRED', summary: '위치 다시 들어옴' });
  });

  it('상담원은 보기만 — 맡기·닫기 없음', async () => {
    renderAt('/cases/CASE-MOCK-2', as.cs);
    expect(await screen.findByText('상담원은 접수 건을 보기만 해요(맡기·완료 처리는 지원센터 담당).')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '내가 맡기' })).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: '완료 처리' })).not.toBeInTheDocument();
  });

  it('사가·결제 이상(case 0.5.0): 관리자에게만 종류·사건이 보이고, 상세는 처리 대기로 안내', async () => {
    const view = renderAt('/cases', as.admin);
    const list = await rows();
    const order = list.find((r) => r.textContent?.includes('결과 불일치 확인'))!;
    expect(order).toBeTruthy();
    expect(within(order).getByRole('link', { name: '주문 74939259' })).toHaveAttribute('href', '/orders/ORD-MOCK-1004');
    expect(within(order).getByText('주문 처리')).toBeInTheDocument(); // 사가 ID 는 글자로 안 보인다(ADR-0070 덧붙임)
    expect(order).not.toHaveTextContent('SAGA-MOCK-1');
    expect(screen.queryByText(/결과 불일치 확인·결제 결과 불명은 본사 관리자만 봐요/)).not.toBeInTheDocument(); // 목록 위 설명 줄은 뺐다(2026-11-20)
    await userEvent.selectOptions(screen.getByLabelText('종류'), 'PAYMENT_UNKNOWN');
    await waitFor(() => expect(view.sent.some((r) => new URL(r.url).searchParams.get('kind') === 'PAYMENT_UNKNOWN')).toBe(true));
    view.unmount();

    renderAt('/cases/CASE-MOCK-5', as.admin);
    const note = await screen.findByTestId('case-order-note');
    expect(within(note).getByRole('link', { name: '처리 대기에서 조치하기' })).toHaveAttribute('href', '/pending');
    expect(screen.getByRole('form', { name: '다른 사람에게 배정(관리자)' })).toBeInTheDocument();
  });

  it('배차 실패(case 0.5.0)는 배송 쪽 — 라이더 운영·상담원 모두 보고, 상세 이력의 재발(RECURRED)을 이름으로', async () => {
    for (const who of [as.riderOps, as.cs]) {
      const view = renderAt('/cases', who);
      const list = await rows();
      expect(list.some((r) => r.textContent?.includes('배차 실패'))).toBe(true);
      expect(within(screen.getByLabelText('종류')).getAllByRole('option').map((o) => o.textContent)).toContain('배차 실패');
      view.unmount();
    }
    renderAt('/cases/CASE-MOCK-6', as.riderOps);
    expect(await screen.findByText(/재발 · SYSTEM · 3번째 — NO_RIDER/)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: '배송 번호 없음' })).toHaveAttribute('href', '/deliveries/DLV-MOCK-6'); // 번호가 없는 배송 — ID 는 링크 대상으로만
  });

  it('사가·결제 이상은 배송 팀 목록·종류 필터에 없다', async () => {
    renderAt('/cases', as.riderOps);
    expect((await rows()).some((r) => r.textContent?.includes('대사 필요'))).toBe(false);
    const options = within(screen.getByLabelText('종류')).getAllByRole('option').map((o) => o.textContent);
    expect(options).not.toContain('대사 필요');
    expect(options).not.toContain('결제 결과 불명');
  });

  it('관리자는 다른 사람에게 배정할 수 있다', async () => {
    const view = renderAt('/cases/CASE-MOCK-1', as.admin);
    const form = await screen.findByRole('form', { name: '다른 사람에게 배정(관리자)' });
    await userEvent.type(within(form).getByPlaceholderText('사번(P2026-00012)'), 'P2026-00007');
    await userEvent.click(within(form).getByRole('button', { name: '배정' }));
    await waitFor(() => expect(screen.getByTestId('case-assignee')).toHaveTextContent('[목] 한상담 · P2026-00007'));
    expect(await view.mutations('/assignments')[0]!.json()).toEqual({ assigneeId: 'op-cs-rider-1' });
  });

  it('오배송 열기: MISDELIVERY·DELIVERY·배송 번호 → 새 사건 상세, 같은 배송 다시 열면 409 CASE_ALREADY_OPEN', async () => {
    const view = renderAt('/cases/new-misdelivery?deliveryId=DLV-MOCK-2', as.cs);
    // 배송 ID 로 넘어와도 칸에는 화면 배송 번호(2026-11-25 "저 긴거 뭔데"), 보내는 것은 찾은 배송 ID
    await waitFor(async () => expect(await screen.findByLabelText('배송 번호')).toHaveValue('D74939002'));
    expect(document.body.textContent).not.toContain('DLV-MOCK-2');
    await userEvent.type(screen.getByLabelText('요약'), '옆 동 경비실로 전달됨(고객 확인)');
    expect(screen.getByRole('button', { name: '오배송 접수하기' })).toBeDisabled(); // 귀책을 골라야
    await userEvent.click(screen.getByRole('radio', { name: '지도·시스템 오류' }));
    await userEvent.click(screen.getByRole('button', { name: '오배송 접수하기' }));
    expect(await screen.findByRole('heading', { name: /C-1119-0101/ })).toBeInTheDocument();
    expect(await view.mutations('/cases')[0]!.json()).toEqual({ kind: 'MISDELIVERY', subjectType: 'DELIVERY', subjectRef: 'DLV-MOCK-2', summary: '옆 동 경비실로 전달됨(고객 확인)', misdelivery: { fault: 'SYSTEM', resolution: 'RESHIP' } });
    expect(await screen.findByText('귀책 지도·시스템 오류')).toBeInTheDocument();
    expect(screen.getByText('고객 선택 재발송')).toBeInTheDocument();

    view.unmount();
    renderAt('/cases/new-misdelivery?deliveryId=DLV-MOCK-2', as.cs);
    await userEvent.type(await screen.findByLabelText('요약'), '다시');
    await userEvent.click(screen.getByRole('radio', { name: '지도·시스템 오류' }));
    await userEvent.click(screen.getByRole('button', { name: '오배송 접수하기' }));
    expect(await screen.findByText('같은 일로 처리 중인 접수 건이 이미 있어요. 그 접수 건에서 처리해 주세요.')).toBeInTheDocument();
  });

  it('배송 번호가 없는 배송(목 DLV-MOCK-4)으로 넘어오면 ID 그대로 — 지우지 않는다', async () => {
    renderAt('/cases/new-misdelivery?deliveryId=DLV-MOCK-4', as.cs);
    const input = await screen.findByLabelText('배송 번호');
    await new Promise((r) => setTimeout(r, 300));
    expect(input).toHaveValue('DLV-MOCK-4');
  });

  it('오배송 귀책(ADR-0065): 라이더 실수는 배달료 미지급 안내, 환불 선택은 그대로 보낸다', async () => {
    const view = renderAt('/cases/new-misdelivery?deliveryId=DLV-MOCK-3', as.riderOps);
    expect(await screen.findByRole('radio', { name: '고객 주소 오입력 등' })).toBeEnabled();
    expect(screen.queryByTestId('rider-fee-note')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: '라이더 실수' }));
    expect(screen.getByTestId('rider-fee-note')).toHaveTextContent('라이더 실수면 배달료가 안 나가요');
    await userEvent.selectOptions(screen.getByLabelText(/고객이 고른 처리/), 'REFUND');
    expect(screen.getByText(/전 품목을 환불해요/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('요약'), '다른 동에 놓음');
    await userEvent.click(screen.getByRole('button', { name: '오배송 접수하기' }));
    expect(await screen.findByText('귀책 라이더 실수')).toBeInTheDocument();
    expect(await view.mutations('/cases')[0]!.json()).toMatchObject({ misdelivery: { fault: 'RIDER', resolution: 'REFUND' } });
  });

  it('고객 잘못 + 다시 배송: 실제 주소 기록(배송 → 주문 번호) → 그 번호로 접수, 주소는 다시 보여 주지 않는다', async () => {
    const view = renderAt('/cases/new-misdelivery?deliveryId=DLV-MOCK-3', as.cs);
    await userEvent.click(await screen.findByRole('radio', { name: '고객 주소 오입력 등' }));
    const select = screen.getByLabelText('고객이 고른 처리');
    expect([...within(select).getAllByRole('option')].map((o) => o.textContent)).toEqual(['다시 배송', '환불(상품값 − 9,000원)']);
    expect(screen.getByTestId('choice-note')).toHaveTextContent('200m 안 무료, 넘으면 9,000원');
    const box = screen.getByTestId('redelivery-address');
    await userEvent.type(screen.getByLabelText('요약'), '고객이 동 호수를 잘못 입력');
    expect(screen.getByRole('button', { name: '오배송 접수하기' })).toBeDisabled(); // 주소·사유 필수
    await userEvent.type(within(box).getByLabelText('도로명 주소(필수)'), '부산 부산진구 시험로 1');
    await userEvent.type(within(box).getByLabelText('상세 주소'), '101동 1001호');
    await userEvent.type(within(box).getByLabelText('기록 사유(필수, 2~200자)'), '고객 통화 — 동 호수 잘못 입력');
    await userEvent.click(screen.getByRole('button', { name: '오배송 접수하기' }));
    expect(await screen.findByRole('heading', { name: /C-1119-0\d{3}/ })).toBeInTheDocument();
    const rec = view.mutations('/redelivery-destinations')[0]!;
    expect(new URL(rec.url).pathname).toContain('/orders/lookups/ORD-MOCK-');
    expect(await rec.json()).toEqual({ deliveryId: 'DLV-MOCK-3', roadAddress: '부산 부산진구 시험로 1', detailAddress: '101동 1001호', reason: '고객 통화 — 동 호수 잘못 입력' });
    const body = (await view.mutations('/cases').find((r) => new URL(r.url).pathname.endsWith('/cases'))!.json()) as { misdelivery?: Record<string, string> };
    expect(body.misdelivery).toMatchObject({ fault: 'CUSTOMER', resolution: 'REDELIVER' });
    expect(body.misdelivery?.['redeliveryDestinationId']).toMatch(/^RDD-MOCK-/);
    expect(document.body.textContent).not.toContain('시험로 1'); // 주소를 다시 보여 주지 않음
    expect(await screen.findByText('귀책 고객 주소 오입력 등')).toBeInTheDocument();
  });

  it('고객 잘못: 주소는 기록됐는데 접수가 실패하면, 주소를 다시 쓰지 않고 접수만 다시 보낸다', async () => {
    let fail = true;
    server.use(
      http.post(`${API_BASE}/cases`, () => {
        if (!fail) return undefined;
        fail = false;
        return HttpResponse.json({ type: 'about:blank', title: 'x', status: 409, code: 'CASE_ALREADY_OPEN' }, { status: 409, headers: { 'content-type': 'application/problem+json' } });
      }),
    );
    const view = renderAt('/cases/new-misdelivery?deliveryId=DLV-MOCK-3', as.cs);
    await userEvent.click(await screen.findByRole('radio', { name: '고객 주소 오입력 등' }));
    await userEvent.type(screen.getByLabelText('요약'), '주소 오입력');
    await userEvent.type(screen.getByLabelText('도로명 주소(필수)'), '부산 부산진구 시험로 2');
    await userEvent.type(screen.getByLabelText('기록 사유(필수, 2~200자)'), '고객 통화');
    await userEvent.click(screen.getByRole('button', { name: '오배송 접수하기' }));
    expect(await screen.findByTestId('address-recorded')).toHaveTextContent('실제 주소를 기록했어요');
    expect(screen.queryByLabelText('도로명 주소(필수)')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '오배송 접수하기' }));
    expect(await screen.findByRole('heading', { name: /C-1119-0\d{3}/ })).toBeInTheDocument();
    expect(view.mutations('/redelivery-destinations')).toHaveLength(1); // 주소는 한 번만 기록
  });

  it('요약이 없는 사건은 사건 번호 대신 종류 이름(백엔드 회신 reply-case-inbox-questions §2-1)', async () => {
    server.use(
      http.get(`${BFF_BASE}/views/case-inbox`, () =>
        HttpResponse.json({ sources: [], unavailableSources: [], items: [{ caseId: 'CASE-NOSUM', kind: 'RIDER_HELP', priority: 'P2', state: 'OPEN', openedAt: '2026-11-16T00:00:00.000Z', overdue: false, linked: [] }], page: { nextCursor: null, size: 1 } }),
      ),
    );
    renderAt('/cases', as.riderOps);
    const row = (await rows())[0]!;
    expect(within(row).getByTestId('case-summary')).toHaveTextContent('라이더 도움요청'); // 줄은 링크 없이 — 누르면 미리보기(2026-11-20)
    expect(within(row).queryByText('CASE-NOSUM')).not.toBeInTheDocument();
  });

  it('도움요청 사건은 따로 실린 requestId·deliveryId(case 0.4.1)로 라이더가 쓴 내용을 읽는다 — incidentId 없어도', async () => {
    server.use(
      http.get(`${API_BASE}/cases/:caseId`, () =>
        HttpResponse.json({
          caseId: 'CASE-NEW',
          kind: 'RIDER_HELP',
          priority: 'P1',
          state: 'OPEN',
          summary: '[목] 새 도움요청',
          openedAt: '2026-11-16T00:00:00.000Z',
          overdue: false,
          version: 1,
          history: [],
          refs: [{ refType: 'deliveryId', refId: 'DLV-MOCK-1' }, { refType: 'requestId', refId: 'HLP-MOCK-1' }],
        }),
      ),
    );
    renderAt('/cases/CASE-NEW', as.riderOps);
    expect(await screen.findByTestId('case-help-request')).toHaveTextContent('공동현관이 잠겨');
  });
  it('연결 상태: 배송·주문의 지금 상태를 원천 값 이름표로(bff 0.5.0)', async () => {
    renderAt('/cases', as.admin);
    const list = await rows();
    const help = list.find((r) => r.textContent?.includes('라이더 도움요청'))!;
    const linked = within(help).getAllByTestId('case-linked');
    expect(linked.map((l) => l.textContent)).toEqual(['배송 픽업', '주문 배송 중', '도움요청 대기새 메시지'] /* bff 0.6.0 HELP_REQUEST 칸 */);
  });

  it('지원센터(RIDER_OPS)는 주문 원천을 못 볼 수 있다 — 주문 칸 "확인 불가"(0건·정상 아님)와 못 읽은 원천 표시', async () => {
    renderAt('/cases', as.riderOps);
    const list = await rows();
    const order = within(list[0]!).getAllByTestId('case-linked').find((l) => l.getAttribute('data-kind') === 'ORDER')!;
    expect(order).toHaveTextContent('확인 불가');
    expect(screen.getByLabelText('가져온 곳')).toHaveTextContent(/못 불러온 정보: 주문/); // 업무 이름(2026-11-18)
    expect(screen.getByTitle(/조회하지 못한 원천: order-service/)).toBeInTheDocument(); // 원래 이름은 마우스를 올리면
  });

  it('case-service 를 못 읽었으면(unavailableSources) 빈 목록이 아니라 조회 실패', async () => {
    server.use(
      http.get(`${BFF_BASE}/views/case-inbox`, () => HttpResponse.json({ sources: [], unavailableSources: ['case-service'], items: [], page: { nextCursor: null, size: 0 } })),
    );
    renderAt('/cases', as.riderOps);
    await waitFor(() => expect(document.querySelector('[data-state="error"]')).not.toBeNull());
    expect(screen.queryByTestId('case-row')).not.toBeInTheDocument();
  });

  it('다음 쪽은 서버 nextCursor 로(주소에 남음), 처음 쪽으로 돌아간다', async () => {
    server.use(
      http.get(`${BFF_BASE}/views/case-inbox`, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        const item = (id: string) => ({ caseId: id, kind: 'RIDER_HELP', priority: 'P2', state: 'OPEN', summary: id, overdue: false, linked: [] });
        return HttpResponse.json({ sources: [], unavailableSources: [], items: [item(cursor ? 'CASE-P2' : 'CASE-P1')], page: { nextCursor: cursor ? null : 'CUR-2', size: 1 } });
      }),
    );
    const view = renderAt('/cases', as.riderOps);
    await rows();
    await userEvent.click(screen.getByRole('button', { name: '다음 쪽' }));
    expect(await screen.findByText('CASE-P2', { selector: '[data-testid="case-summary"]' })).toBeInTheDocument();
    expect(inboxCalls(view.sent).some((q) => q.get('cursor') === 'CUR-2')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: '처음 쪽' }));
    expect(await screen.findByText('CASE-P1', { selector: '[data-testid="case-summary"]' })).toBeInTheDocument();
  });
  it('연결 원천에 없으면(state null·DIRECT) "원천에 없음" — 상태를 지어내지 않는다', async () => {
    const stamp = { system: 'delivery-execution-service', confidence: 'DIRECT', asOf: { asOf: '2026-11-16T00:00:00Z', freshness: 'CURRENT' } };
    server.use(
      http.get(`${BFF_BASE}/views/case-inbox`, () =>
        HttpResponse.json({ sources: [stamp], unavailableSources: [], items: [{ caseId: 'CASE-GONE', kind: 'MISDELIVERY', priority: 'P2', state: 'OPEN', summary: '없는 배송', overdue: false, linked: [{ kind: 'DELIVERY', id: 'DLV-GONE', state: null, version: null, source: stamp }] }], page: { nextCursor: null, size: 1 } }),
      ),
    );
    renderAt('/cases', as.riderOps);
    expect(await screen.findByTestId('case-linked')).toHaveTextContent('배송 정보를 찾지 못함');
  });
});

describe('접수 건 목록 — 화면 번호(bff 0.14.0, ADR-0070)', () => {
  it('관련 칸은 linked 화면 번호·riders 표시만 — 시스템 ID 는 링크 대상으로만, 번호 없는 라이더는 끝 8자리 + 번호 없음', async () => {
    renderAt('/cases', as.cs);
    const list = await rows();
    const help = list.find((r) => r.textContent?.includes('라이더 도움요청'))!;
    expect(within(help).getByRole('link', { name: '주문 74939255' })).toHaveAttribute('href', '/orders/ORD-MOCK-1001');
    // 배송 링크 글자는 화면 번호만(사고 refs incidentId 는 화면 번호 대상이 아니라 그대로)
    expect(within(help).getByRole('link', { name: '배송 D74939255' })).not.toHaveTextContent('DLV-MOCK-1');
    expect(help).not.toHaveTextContent('ORD-MOCK-1001');
    expect(help).not.toHaveTextContent('RID-MOCK-1');
    // RID-MOCK-2 는 rider-service 에서 못 찾음(탈퇴 등) — 번호를 지어내지 않는다
    const failed = list.find((r) => r.textContent?.includes('전달 실패'));
    expect(failed).toBeDefined();
    expect(within(failed!).getByRole('link', { name: '라이더 번호 없음' })).toHaveAttribute('href', '/riders/RID-MOCK-2');
  });

  it('번호가 null 이면 ID 끝 8자리 + "번호 없음", rider-service 를 못 읽으면 라이더 "번호 확인 불가" + 실패 원천', async () => {
    const stamp = { system: 'case-service', confidence: 'DIRECT', asOf: { asOf: '2026-11-18T00:00:00Z', freshness: 'CURRENT' } };
    server.use(
      http.get(`${BFF_BASE}/views/case-inbox`, () =>
        HttpResponse.json({
          sources: [stamp],
          unavailableSources: ['rider-service'],
          items: [
            {
              caseId: 'CASE-NUM',
              kind: 'MISDELIVERY',
              priority: 'P2',
              state: 'OPEN',
              summary: '번호 없는 옛 배송',
              overdue: false,
              linkedRefs: [
                { kind: 'deliveryId', id: 'DLV-OLD-12345678' },
                { kind: 'riderId', id: 'RID-ABCDEFGH' },
              ],
              linked: [{ kind: 'DELIVERY', id: 'DLV-OLD-12345678', displayNumber: null, orderNumber: null, state: 'COMPLETED', version: 1, source: { ...stamp, system: 'delivery-execution-service' } }],
              riders: [{ riderId: 'RID-ABCDEFGH', riderNumber: null, nameMasked: null }],
            },
          ],
          page: { nextCursor: null, size: 1 },
        }),
      ),
    );
    renderAt('/cases', as.riderOps);
    const row = (await rows())[0]!;
    expect(within(row).getByRole('link', { name: '배송 번호 없음' })).toHaveAttribute('href', '/deliveries/DLV-OLD-12345678');
    expect(within(row).getByRole('link', { name: '라이더 번호 확인 불가' })).toHaveAttribute('href', '/riders/RID-ABCDEFGH');
    expect(row).not.toHaveTextContent('DLV-OLD-12345678');
    expect(screen.getByText(/못 불러온 정보: .*라이더/)).toHaveAttribute('title', expect.stringMatching(/조회하지 못한 원천: .*rider-service/)); // 원천 표시 한 줄(2026-11-18) — 업무 이름, 원래 이름은 마우스
  });
});

describe('사건 다시 열기(case 0.6.0)·넘기기(0.7.0)', () => {
  it('닫힌 사건 다시 열기: 사유 필수 → reopenings(키·사유) → 다시 열림·담당 비움, 이력에 사유', async () => {
    const view = renderAt('/cases/CASE-MOCK-4', as.riderOps);
    const form = await screen.findByTestId('case-reopen');
    expect(within(form).getByRole('button', { name: '다시 처리하기' })).toBeDisabled();
    await userEvent.type(within(form).getByLabelText('사유'), '고객이 다시 다른 집이라고 연락');
    await userEvent.click(within(form).getByRole('button', { name: '다시 처리하기' }));
    await waitFor(() => expect(screen.getByTestId('case-state')).toHaveTextContent('다시 처리 중'));
    expect(screen.getByTestId('case-assignee')).toHaveTextContent('아무도 안 맡음');
    expect(await screen.findByText(/다시 처리 · \[목\] 정운영 · P2026-00006 → 다시 처리 중 · 고객이 다시 다른 집이라고 연락/)).toBeInTheDocument();
    const sent = view.mutations('/cases/CASE-MOCK-4/reopenings')[0]!;
    expect(sent.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await sent.json()).toEqual({ reason: '고객이 다시 다른 집이라고 연락' });
    // 열린 사건이 되면 다시 열기 대신 닫기·넘기기
    expect(screen.queryByTestId('case-reopen')).not.toBeInTheDocument();
    expect(screen.getByTestId('case-transfer')).toBeInTheDocument();
  });

  it('같은 일로 열린 사건이 있으면(409 CASE_ALREADY_OPEN) 통합 조회로 그 대상의 사건을 찾게', async () => {
    server.use(http.post(`${API_BASE}/cases/:caseId/reopenings`, () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 409, code: 'CASE_ALREADY_OPEN' }, { status: 409, headers: { 'content-type': 'application/problem+json' } })));
    renderAt('/cases/CASE-MOCK-4', as.admin);
    const form = await screen.findByTestId('case-reopen');
    await userEvent.type(within(form).getByLabelText('사유'), '재확인');
    await userEvent.click(within(form).getByRole('button', { name: '다시 처리하기' }));
    expect(await within(form).findByTestId('case-open-elsewhere')).toHaveAttribute('href', expect.stringMatching(/^\/lookup\?q=DLV-/));
  });

  it('상담원은 닫힌 사건을 다시 열 수 없다(버튼 없음)', async () => {
    renderAt('/cases/CASE-MOCK-4', as.cs);
    await screen.findByTestId('case-facts');
    expect(screen.queryByTestId('case-reopen')).not.toBeInTheDocument();
  });

  it('지원센터 → 관리자에게 넘기기(사유) → 관리자 팀·담당 비움, 지원센터는 그 뒤 "관리자 처리 중"으로 보기만', async () => {
    const view = renderAt('/cases/CASE-MOCK-1', as.riderOps);
    expect(await screen.findByTestId('case-group')).toHaveTextContent('지원센터');
    const form = screen.getByTestId('case-transfer');
    await userEvent.type(within(form).getByLabelText('사유'), '환불이 얽힌 오배송');
    await userEvent.click(within(form).getByRole('button', { name: '관리자에게 넘기기' }));
    await waitFor(() => expect(screen.getByTestId('case-group')).toHaveTextContent('관리자 팀'));
    expect(screen.getByTestId('case-group')).toHaveTextContent('관리자 처리 중');
    expect(screen.getByTestId('next-action')).toHaveTextContent('관리자 팀이 처리 중이에요'); // 관리자 처리 중 안내는 다음 할 일 카드로(2026-11-18)
    // 지원센터에는 맡기·닫기·넘기기가 없다
    expect(screen.queryByRole('button', { name: '맡기' })).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: '완료 처리' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('case-transfer')).not.toBeInTheDocument();
    expect(await view.mutations('/cases/CASE-MOCK-1/transfers')[0]!.json()).toEqual({ toGroup: 'ORDER_OPS', reason: '환불이 얽힌 오배송' });
    expect(await screen.findByText(/넘김 · \[목\] 정운영 · P2026-00006 → 접수됨 · DELIVERY_OPS → ORDER_OPS: 환불이 얽힌 오배송/)).toBeInTheDocument();
    // 목록에도 "관리자 처리 중"
    cleanup();
    renderAt('/cases', as.riderOps);
    const row = (await screen.findAllByTestId('case-row')).find((r) => r.textContent?.includes('라이더 도움요청'))!;
    expect(within(row).getByTestId('case-admin-team')).toHaveTextContent('관리자 처리 중');
  });

  it('관리자는 관리자 팀 배송 사건을 지원센터로 돌려보낸다', async () => {
    const view = renderAt('/cases/CASE-MOCK-1', as.admin);
    let form = await screen.findByTestId('case-transfer');
    await userEvent.type(within(form).getByLabelText('사유'), '확인 필요');
    await userEvent.click(within(form).getByRole('button', { name: '관리자에게 넘기기' }));
    await waitFor(() => expect(screen.getByTestId('case-group')).toHaveTextContent('관리자 팀'));
    form = screen.getByTestId('case-transfer');
    await userEvent.type(within(form).getByLabelText('사유'), '배송 쪽 처리로 충분');
    await userEvent.click(within(form).getByRole('button', { name: '지원센터로 돌려보내기' }));
    await waitFor(() => expect(screen.getByTestId('case-group')).not.toHaveTextContent('관리자 팀'));
    expect(await view.mutations('/cases/CASE-MOCK-1/transfers')[1]!.json()).toEqual({ toGroup: 'DELIVERY_OPS', reason: '배송 쪽 처리로 충분' });
  });

  it('사가·결제 사건(관리자 팀)에는 넘기기가 없다', async () => {
    renderAt('/cases/CASE-MOCK-5', as.admin);
    await screen.findByTestId('case-facts');
    expect(screen.queryByTestId('case-transfer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('case-admin-team')).not.toBeInTheDocument();
  });

  it('refs previousCaseId 는 "이전 사건" 링크', async () => {
    server.use(
      http.get(`${API_BASE}/cases/:caseId`, () =>
        HttpResponse.json({ caseId: 'CASE-NEXT', kind: 'MISDELIVERY', priority: 'P2', state: 'OPEN', summary: '[목] 또 오배송', assigneeGroup: 'DELIVERY_OPS', openedAt: '2026-11-16T00:00:00.000Z', overdue: false, version: 1, history: [], refs: [{ refType: 'deliveryId', refId: 'DLV-MOCK-4' }, { refType: 'previousCaseId', refId: 'CASE-MOCK-4' }] }),
      ),
    );
    renderAt('/cases/CASE-NEXT', as.riderOps);
    // 이 시험의 목은 모든 접수 건 조회에 CASE-NEXT(번호 없음)를 돌려준다 — 이전 접수 건 글자는 번호(없으면 "번호 없음"), 시스템 ID 는 링크 대상으로만
    const prev = await screen.findByRole('link', { name: /^이전 접수 건 / });
    expect(prev).toHaveAttribute('href', '/cases/CASE-MOCK-4');
    await waitFor(() => expect(prev).toHaveTextContent('번호 없음'));
    expect(prev).not.toHaveTextContent('CASE-MOCK-4');
  });
});
