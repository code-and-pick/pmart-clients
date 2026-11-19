// 상품 정보 수정(product 0.3.0~0.3.2 edit-drafts, 백엔드 요청 2026-11-17 request-product-edit)
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { http, HttpResponse } from 'msw';

import { API_BASE } from '../../api/client';
import { server } from '../../test/server';
import { as, renderAt } from '../../test/render';
import { gs1CheckDigitProblem } from './barcode';

describe('바코드 검사 숫자', () => {
  it('숫자만 8·12·13·14자리를 보고, 틀리면 맞는 끝자리를 준다', () => {
    expect(gs1CheckDigitProblem('4006381333931')).toBeNull();
    expect(gs1CheckDigitProblem('4006381333932')).toBe('1');
    expect(gs1CheckDigitProblem('880000000008')).toBeNull();
    expect(gs1CheckDigitProblem('0880000000012')).toBe('5');
    expect(gs1CheckDigitProblem('ABC123')).toBeNull(); // 문자 섞임 — 검사 안 함
    expect(gs1CheckDigitProblem('12345')).toBeNull(); // 다른 길이 — 검사 안 함
  });
});

describe('상품 정보 수정', () => {
  it('MD: 수정 시작 → 현재 값으로 채운 수정 초안, 판매 단위·입수 고정, 검사 숫자 틀린 바코드는 미리 경고', async () => {
    const view = renderAt('/products/P-00000001', as.md);
    await userEvent.click(await screen.findByRole('button', { name: '상품 정보 수정 시작' }));

    const note = await screen.findByTestId('product-edit-note');
    expect(note).toHaveTextContent('기존 상품 수정 — 사과 1.5kg'); // 시스템 ID 대신 상품 이름(ADR-0070)
    const sent = view.mutations('/edit-drafts');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers.get('Idempotency-Key')).toBeTruthy();
    expect(sent[0]!.headers.get('X-Source-System')).toBeTruthy();

    expect(screen.getByLabelText('관리용 명칭')).toHaveValue('사과 1.5kg');
    expect(screen.getByLabelText('판매 단위')).toBeDisabled();
    expect(screen.getByLabelText('구성 낱개 수')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'SKU 추가' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('상품 JSON 파일로 채우기')).not.toBeInTheDocument();
    // 목 시드 바코드 880000000001 은 검사 숫자가 틀림 — 처음 받은 초안이 INVALID 일 수 있다(요청서 §2)
    expect(screen.getByTestId('barcode-check-digit')).toHaveTextContent('끝자리가 8 이어야 해요');
    expect(screen.getByRole('list', { name: '검증 문제' })).toHaveTextContent('바코드 검사 숫자가 틀려요');
  });

  it('바코드 교체 후 저장 → 고친 input 전체를 PUT(targetProductId·보관·중량 유지) → VALID 면 제출', async () => {
    const view = renderAt('/products/P-00000001', as.md);
    await userEvent.click(await screen.findByRole('button', { name: '상품 정보 수정 시작' }));
    await screen.findByTestId('product-edit-note');

    const barcode = screen.getByLabelText('바코드(쉼표 구분, 앞자리 0 유지)');
    await userEvent.clear(barcode);
    await userEvent.type(barcode, '880000000008{Enter}');
    expect(barcode).toHaveValue('880000000008, '); // Enter 는 저장하지 않고 다음 자리를 만든다(스캐너)
    expect(view.mutations('/product-drafts/')).toHaveLength(0);
    await userEvent.type(barcode, '4006381333931');
    expect(screen.queryByTestId('barcode-check-digit')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '초안 수정' }));
    await waitFor(() => expect(view.mutations('/product-drafts/')).toHaveLength(1));
    const put = view.mutations('/product-drafts/')[0]!;
    expect(put.method).toBe('PUT');
    expect(await put.json()).toMatchObject({
      targetProductId: 'P-00000001',
      product: { internalName: '사과 1.5kg', baseProductId: 'BP-P-00000001', primaryCategoryId: 'p01-c01-l01' },
      skus: [{ unitType: 'E', unitsPerSku: 1, weightG: 300, storageType: 'CHILLED', alcohol: false, barcodes: ['880000000008', '4006381333931'] }],
    });

    const submit = await screen.findByRole('button', { name: '제출 준비(잠그기)' });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);
    expect(await screen.findByText('초안을 잠갔어요. 아래에서 승인 요청을 올려 주세요.')).toBeInTheDocument();
  });

  it('이미 열린 수정 초안이 있으면 409 EDIT_DRAFT_EXISTS → 그 초안으로 안내', async () => {
    renderAt('/products/P-00000002', as.md);
    await userEvent.click(await screen.findByRole('button', { name: '상품 정보 수정 시작' }));
    await screen.findByTestId('product-edit-note');
    await screen.findByRole('heading', { level: 1 });
    await userEvent.click(within(screen.getByTestId('product-edit-note')).getByRole('link', { name: '소고기 미역국 500g' })); // 고칠 상품은 이름으로(ADR-0070)
    await userEvent.click(await screen.findByRole('button', { name: '상품 정보 수정 시작' }));
    const exists = await screen.findByTestId('product-edit-exists');
    expect(exists).toHaveTextContent('이미 수정 중인 초안이 있어요');
    expect(within(exists).getByRole('link').getAttribute('href')).toMatch(/^\/products\/drafts\/pd-/);
  });

  it('MD 가 아니면 수정 시작 버튼이 없다(서버 403 역할)', async () => {
    renderAt('/products/P-00000001', as.admin);
    expect(await screen.findByText('상품 정보 수정은 MD 만 시작할 수 있어요.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '상품 정보 수정 시작' })).not.toBeInTheDocument();
  });

  it('서버가 MD 아님 403 이면 일반 권한 문구 대신 "MD 만" 안내(세션 역할이 바뀐 경우)', async () => {
    server.use(
      http.post(`${API_BASE}/products/:id/edit-drafts`, () =>
        HttpResponse.json({ type: 'about:blank', title: 'x', status: 403, code: 'FORBIDDEN' }, { status: 403, headers: { 'content-type': 'application/problem+json' } }),
      ),
    );
    renderAt('/products/P-00000001', as.md);
    await userEvent.click(await screen.findByRole('button', { name: '상품 정보 수정 시작' }));
    expect(await screen.findByTestId('product-edit-not-md')).toHaveTextContent('MD 만 수정을 시작할 수 있어요');
  });
});
