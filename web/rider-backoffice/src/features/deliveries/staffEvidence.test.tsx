// 상태 정정 근거 사진(execution 0.22.0) — 목(MSW) 기준. 실서버 확인은 아니다.
// multipart 올리기는 jsdom fetch 가 못 보내 올리기 함수만 바꿔 끼우고(호출 자체는 staffEvidenceUpload.test), 정정 요청은 MSW 로 본다.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProblemFailure, type IdempotencyKey } from '@pmart/web-core';
import { API_BASE } from '../../api/client';
import { registerStaffPhoto } from '../../mocks/staffEvidenceHandlers';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';
import { uploadStaffEvidence } from './staffEvidenceUpload';

vi.mock('./staffEvidenceUpload', async (importOriginal) => ({ ...(await importOriginal<typeof import('./staffEvidenceUpload')>()), uploadStaffEvidence: vi.fn() }));
const upload = vi.mocked(uploadStaffEvidence);

const picked = {
  deliveryId: 'DLV-9',
  orderId: 'ORD-9',
  type: 'FORWARD',
  purpose: 'DELIVERY',
  state: 'PICKED_UP',
  riderId: 'RD-7',
  mfcId: 'MFC-BSJ-01',
  history: [],
  version: 3,
};
const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'proof.png', { type: 'image/png' });
const photo = (photoRef: string) => ({ photoRef, contentType: 'image/png' as const, sizeBytes: 4, uploadedAt: '2026-11-18T00:00:00.000Z' });

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:photo');
  URL.revokeObjectURL = vi.fn();
  upload.mockReset();
  server.use(http.get(`${API_BASE}/deliveries/:deliveryId`, () => HttpResponse.json(picked)));
});

async function openForm() {
  const view = renderAt('/deliveries/DLV-9', as.riderOps);
  const form = await screen.findByRole('form', { name: '상태 정정' });
  return { view, form };
}

describe('상태 정정 근거 사진', () => {
  it('올린 사진의 photoRef 를 정정 evidenceRefs 로 보낸다(정정도 Idempotency-Key·X-Source-System)', async () => {
    const keys: IdempotencyKey[] = [];
    upload.mockImplementation(async (_api, deliveryId, _file, key) => {
      keys.push(key);
      registerStaffPhoto(deliveryId, 'SEP-T1');
      return photo('SEP-T1');
    });
    const { view, form } = await openForm();
    await userEvent.upload(within(form).getByLabelText('근거 사진'), png());
    expect(await within(form).findAllByTestId('photo')).toHaveLength(1);
    expect(within(form).getByText('1장 올림')).toBeInTheDocument();
    expect(upload.mock.calls[0]![1]).toBe('DLV-9');
    expect(keys[0]!.value).toBeTruthy();

    await userEvent.type(within(form).getByLabelText('사유(2~500자)'), '라이더 오입력 확인');
    await userEvent.click(within(form).getByRole('button', { name: '정정' }));
    expect(await within(form).findByTestId('action-result')).toHaveTextContent('반영했어요.');
    const req = view.sent.find((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith('/status-corrections'))!;
    expect(req.headers.get('Idempotency-Key')).toBeTruthy();
    expect(req.headers.get('Idempotency-Key')).not.toBe(keys[0]!.value);
    expect(req.headers.get('X-Source-System')).toBe('rider-backoffice-web');
    expect(await req.json()).toEqual({ targetState: 'ARRIVED_AT_CUSTOMER', reason: '라이더 오입력 확인', evidenceRefs: ['SEP-T1'] });
  });

  it('사진 없이도 정정할 수 있다(evidenceRefs 를 보내지 않는다)', async () => {
    const { view, form } = await openForm();
    await userEvent.type(within(form).getByLabelText('사유(2~500자)'), '확인함');
    await userEvent.click(within(form).getByRole('button', { name: '정정' }));
    await within(form).findByTestId('action-result');
    const req = view.sent.find((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith('/status-corrections'))!;
    expect(await req.json()).not.toHaveProperty('evidenceRefs');
    expect(upload).not.toHaveBeenCalled();
  });

  it('올리기를 서버가 거절하면(422 PHOTO_INVALID) 사진을 넣지 않고 알린다', async () => {
    upload.mockRejectedValue(
      new ProblemFailure({ status: 422, code: 'PHOTO_INVALID', type: 'about:blank', retryable: false, details: [], raw: {} }),
    );
    const { form } = await openForm();
    await userEvent.upload(within(form).getByLabelText('근거 사진'), png());
    expect(await within(form).findByText('사진을 받지 않았어요 — JPEG·PNG·WEBP, 10MB 이하인지 확인해 주세요.')).toBeInTheDocument();
    expect(within(form).getByRole('alert')).toHaveAttribute('data-code', 'PHOTO_INVALID');
    expect(within(form).queryAllByTestId('photo')).toHaveLength(0);
  });

  it('이 배송의 사진이 아니면 정정이 422 PHOTO_NOT_FOUND — 반영으로 보이지 않는다', async () => {
    upload.mockResolvedValue(photo('SEP-OTHER')); // 목 서버에 등록하지 않은 사진
    const { form } = await openForm();
    await userEvent.upload(within(form).getByLabelText('근거 사진'), png());
    await within(form).findAllByTestId('photo');
    await userEvent.type(within(form).getByLabelText('사유(2~500자)'), '확인함');
    await userEvent.click(within(form).getByRole('button', { name: '정정' }));
    expect(await within(form).findByTestId('photo-not-found')).toBeInTheDocument();
    expect(within(form).queryByTestId('action-result')).toBeNull();
    // 사진을 빼면 다시 보낼 수 있다
    await userEvent.click(within(form).getByRole('button', { name: '근거 사진 1 빼기' }));
    expect(within(form).queryAllByTestId('photo')).toHaveLength(0);
  });
});
