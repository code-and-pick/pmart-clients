import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { BFF_BASE } from '../../api/client';
import { App } from '../../app/App';
import { approvalInbox } from '../../mocks/fixtures';
import { as } from '../../test/render';
import { server } from '../../test/server';

const inbox = `${BFF_BASE}/views/approval-inbox`;

describe('승인함 (목 모드, MSW)', () => {
  it('원천·신선도와 함께 목록을 보여 준다', async () => {
    render(<App memory initialPath="/views/approval-inbox" initialToken={as.md} />);

    // 건 ID 는 승인 상세(승인·반려 버튼이 있는 화면)로 가는 링크다.
    expect(await screen.findByRole('link', { name: 'dos-mock-1' })).toHaveAttribute('href', '/approvals/dos-mock-1');
    expect(screen.getByText(/approval-service · 원래 정보 · 최신/)).toBeInTheDocument();
    expect(screen.getByText(/order-service · 옮겨 온 정보 · 지연/)).toBeInTheDocument();
    expect(screen.getByText('목 데이터')).toBeInTheDocument();
  });

  it('조회 실패는 빈 목록이 아니라 오류로 보인다', async () => {
    server.use(
      http.get(inbox, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 't', status: 409, code: 'INVALID_STATE', traceId: 'tr' },
          { status: 409, headers: { 'content-type': 'application/problem+json', 'x-request-id': 'rid-1' } },
        ),
      ),
    );
    render(<App memory initialPath="/views/approval-inbox" initialToken={as.md} />);

    expect(await screen.findByText('정보를 불러오지 못했어요')).toBeInTheDocument();
    expect(screen.getByText('문의 번호 rid-1')).toBeInTheDocument();
    expect(screen.queryByText('심사할 건이 없어요')).not.toBeInTheDocument();
  });

  it('권한 없음은 FORBIDDEN 화면이다', async () => {
    server.use(
      http.get(inbox, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 't', status: 403, code: 'FORBIDDEN', traceId: 'tr' },
          { status: 403, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    render(<App memory initialPath="/views/approval-inbox" initialToken={as.md} />);
    expect(await screen.findByText('이용할 수 없는 화면이에요')).toBeInTheDocument();
  });

  it('정상 0건만 빈 화면이다', async () => {
    server.use(http.get(inbox, () => HttpResponse.json({ ...approvalInbox, items: [] })));
    render(<App memory initialPath="/views/approval-inbox" initialToken={as.md} />);
    expect(await screen.findByText('심사할 건이 없어요')).toBeInTheDocument();
  });

  it('일부 원천을 못 받으면 받은 내용과 함께 PARTIAL 안내를 붙인다', async () => {
    server.use(
      http.get(inbox, () => HttpResponse.json({ ...approvalInbox, unavailableSources: ['order-service'] })),
    );
    render(<App memory initialPath="/views/approval-inbox" initialToken={as.md} />);
    expect(await screen.findByText('dos-mock-1')).toBeInTheDocument();
    expect(screen.getAllByText(/조회하지 못한 원천: order-service/).length).toBeGreaterThan(0);
  });
});
