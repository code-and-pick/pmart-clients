import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { renderAt } from '../../test/render';
import { server } from '../../test/server';

// 이미지 영역에도 같은 이름(상세설명 등)이 있어 입력란만 고른다.
const field = (name: string) => screen.getByRole('textbox', { name });

describe('콘텐츠 등록 — 승인된 상품 고르기(드롭다운)', () => {
  it('드롭다운에서 상품을 고르면 상품 ID 가 채워지고, 게시된 콘텐츠가 있으면 다섯 칸을 자동 기입한다', async () => {
    const user = userEvent.setup();
    renderAt('/contents/drafts/new');
    const select = (await screen.findByRole('combobox', { name: '상품 ID(승인된 상품)' }));
    await screen.findByRole('option', { name: /사과 1.5kg/ });
    expect(within(select).getAllByRole('option')).toHaveLength(3); // 안내 1 + 상품 2

    await user.selectOptions(select, 'P-00000001');

    expect(select).toHaveValue('P-00000001');
    expect(await screen.findByText('게시된 콘텐츠로 상품명·상세설명·고시 정보·보관 안내·반품 안내를 채웠어요')).toBeInTheDocument();
    expect(field('고객용 상품명')).toHaveValue('사과 1.5kg');
    expect(field('상세설명')).toHaveValue('아삭한 부사 사과');
    expect(field('고시 정보("항목: 값", 줄마다 하나)')).toHaveValue('원산지: 국산\n품종: 부사');
    expect(field('보관 안내')).toHaveValue('냉장 보관');
    expect(field('반품 안내')).toHaveValue('신선식품은 받은 뒤 24시간 안에');
  });

  it('게시된 콘텐츠가 없는 상품은 상품명(관리용 명칭)만 채우고 나머지는 비워 둔다', async () => {
    const user = userEvent.setup();
    renderAt('/contents/drafts/new');
    const select = (await screen.findByRole('combobox', { name: '상품 ID(승인된 상품)' }));
    await screen.findByRole('option', { name: /소고기 미역국/ });

    await user.selectOptions(select, 'P-00000002');

    expect(await screen.findByText('게시된 콘텐츠가 없어 상품명(관리용 명칭)만 채웠어요')).toBeInTheDocument();
    expect(field('고객용 상품명')).toHaveValue('소고기 미역국 500g');
    expect(field('상세설명')).toHaveValue('');
    expect(field('고시 정보("항목: 값", 줄마다 하나)')).toHaveValue('');
  });

  it('상품이 골라지면 오른쪽 X 가 보이고, 누르면 폼 전체가 비워진다', async () => {
    const user = userEvent.setup();
    renderAt('/contents/drafts/new');
    const select = (await screen.findByRole('combobox', { name: '상품 ID(승인된 상품)' }));
    await screen.findByRole('option', { name: /사과 1.5kg/ });
    expect(screen.queryByRole('button', { name: '전체 지우기' })).not.toBeInTheDocument();

    await user.selectOptions(select, 'P-00000001');
    await screen.findByText(/채웠어요/);
    await user.click(screen.getByRole('button', { name: '전체 지우기' }));

    expect(select).toHaveValue('');
    expect(field('고객용 상품명')).toHaveValue('');
    expect(field('고시 정보("항목: 값", 줄마다 하나)')).toHaveValue('');
    expect(screen.queryByRole('button', { name: '전체 지우기' })).not.toBeInTheDocument();
  });

  it('목록 조회 실패는 빈 드롭다운이 아니라 오류로 보인다', async () => {
    server.use(
      http.get(`${API_BASE}/products`, () =>
        HttpResponse.json({ status: 503, code: 'DEPENDENCY_UNAVAILABLE', retryable: false }, { status: 503 }),
      ),
    );
    renderAt('/contents/drafts/new');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('다 불러오지 않았으면 "더 불러오기"가 보이고, 누르면 다음 쪽 상품이 드롭다운에 더해진다', async () => {
    server.use(
      http.get(`${API_BASE}/products`, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        return HttpResponse.json(
          cursor
            ? { items: [{ productId: 'P-00000099', internalName: '귤 3kg', saleState: 'ON_SALE', version: 1 }], page: { nextCursor: null, size: 1 } }
            : { items: [{ productId: 'P-00000001', internalName: '사과 1.5kg', saleState: 'ON_SALE', version: 1 }], page: { nextCursor: 'c2', size: 1 } },
        );
      }),
    );
    const user = userEvent.setup();
    renderAt('/contents/drafts/new');
    await screen.findByRole('option', { name: /사과 1.5kg/ });
    expect(screen.queryByRole('option', { name: /귤 3kg/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '더 불러오기(지금 1개)' }));

    expect(await screen.findByRole('option', { name: /귤 3kg/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /더 불러오기/ })).not.toBeInTheDocument();
  });
});
