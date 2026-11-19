import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { pick } from '../../test/pick';
import { renderAt } from '../../test/render';
import { server } from '../../test/server';

// 이미지 영역에도 같은 이름(상세설명 등)이 있어 입력란만 고른다.
const field = (name: string) => screen.getByRole('textbox', { name });

describe('콘텐츠 등록 — 승인된 상품 고르기(쳐서 찾기, 2026-11-19)', () => {
  it('칸을 누르면 상품 목록(이름 · 판매 상태, 시스템 ID 는 안 보임), 고르면 게시된 콘텐츠로 다섯 칸을 자동 기입한다', async () => {
    const user = userEvent.setup();
    renderAt('/contents/drafts/new');
    const box = await screen.findByRole('combobox', { name: '상품 ID(승인된 상품)' });
    await waitFor(() => expect(box).toBeEnabled());
    await user.click(box);
    const list = screen.getByRole('listbox', { name: '상품 ID(승인된 상품)' });
    expect(within(list).getAllByRole('option')).toHaveLength(2);
    expect(list).not.toHaveTextContent('P-00000001');

    await user.click(within(list).getByRole('option', { name: /사과 1.5kg/ }));

    expect(box).toHaveValue('사과 1.5kg');
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
    await pick(user, '상품 ID(승인된 상품)', /소고기 미역국/, '미역');

    expect(await screen.findByText('게시된 콘텐츠가 없어 상품명(관리용 명칭)만 채웠어요')).toBeInTheDocument();
    expect(field('고객용 상품명')).toHaveValue('소고기 미역국 500g');
    expect(field('상세설명')).toHaveValue('');
    expect(field('고시 정보("항목: 값", 줄마다 하나)')).toHaveValue('');
  });

  it('상품이 골라지면 오른쪽 X 가 보이고, 누르면 폼 전체가 비워진다', async () => {
    const user = userEvent.setup();
    renderAt('/contents/drafts/new');
    const box = await screen.findByRole('combobox', { name: '상품 ID(승인된 상품)' });
    await waitFor(() => expect(box).toBeEnabled());
    expect(screen.queryByRole('button', { name: '전체 지우기' })).not.toBeInTheDocument();

    await pick(user, '상품 ID(승인된 상품)', /사과 1.5kg/);
    await screen.findByText(/채웠어요/);
    await user.click(screen.getByRole('button', { name: '전체 지우기' }));

    expect(box).toHaveValue('');
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

  it('다 불러오지 않았으면 목록 아래 "더 불러오기", 누르면 다음 쪽 상품이 목록에 더해진다', async () => {
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
    const box = await screen.findByRole('combobox', { name: '상품 ID(승인된 상품)' });
    await waitFor(() => expect(box).toBeEnabled());
    await user.click(box);
    await screen.findByRole('option', { name: /사과 1.5kg/ });
    expect(screen.queryByRole('option', { name: /귤 3kg/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '더 불러오기(지금 1개)' }));

    expect(await screen.findByRole('option', { name: /귤 3kg/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /더 불러오기/ })).not.toBeInTheDocument();
  });
});

describe('쳐서 찾기', () => {
  it('글자·초성·상품 ID 로 좁힌다, ↓ Enter 로 고른다', async () => {
    const user = userEvent.setup();
    renderAt('/contents/drafts/new');
    const box = await screen.findByRole('combobox', { name: '상품 ID(승인된 상품)' });
    await waitFor(() => expect(box).toBeEnabled());
    await user.click(box);
    await user.type(box, 'ㅁㅇㄱ'); // 미역국 초성
    const list = screen.getByRole('listbox', { name: '상품 ID(승인된 상품)' });
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringMatching(/소고기 미역국/)]);
    await user.clear(box);
    await user.type(box, 'P-00000002');
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    expect(within(list).getByRole('option')).toHaveTextContent('소고기 미역국');
    await user.keyboard('{Enter}');
    expect(box).toHaveValue('소고기 미역국 500g');
  });
});
