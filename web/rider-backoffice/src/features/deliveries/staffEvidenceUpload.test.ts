// 직원 근거 사진 올리기(execution 0.22.0) — multipart 본문은 vitest+jsdom 의 fetch 가 보내지 못해(jsdom Blob) 가짜 API 객체로 호출만 본다.
import { describe, expect, it, vi } from 'vitest';

import { IdempotencyKey } from '@pmart/web-core';
import type { Api } from '../../api/client';
import { SOURCE_SYSTEM } from '../../api/command';
import { staffPhotoHint, uploadStaffEvidence } from './staffEvidenceUpload';

type Opts = { params: { header: Record<string, string>; path: { deliveryId: string } }; bodySerializer: () => FormData };

describe('직원 근거 사진 올리기', () => {
  it('multipart file 한 장을 Idempotency-Key·X-Source-System 과 함께 보내고 photoRef 를 돌려받는다', async () => {
    const POST = vi.fn<(path: string, opts: Opts) => Promise<unknown>>(async () => ({
      data: { photoRef: 'SEP-1', contentType: 'image/png', sizeBytes: 4, uploadedAt: '2026-11-18T00:00:00.000Z' },
      response: new Response(null, { status: 201 }),
    }));
    const api = { execution: { POST } } as unknown as Api;
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' });
    const key = IdempotencyKey.generate();

    const out = await uploadStaffEvidence(api, 'DLV-9', file, key);

    expect(out.photoRef).toBe('SEP-1');
    const [path, opts] = POST.mock.calls[0]!;
    expect(path).toBe('/deliveries/{deliveryId}/staff-evidence-photos');
    expect(opts.params.path.deliveryId).toBe('DLV-9');
    expect(opts.params.header['Idempotency-Key']).toBe(key.value);
    expect(opts.params.header['X-Source-System']).toBe(SOURCE_SYSTEM);
    expect((opts.bodySerializer().get('file') as File).name).toBe('a.png');
  });

  it('형식·크기 검사는 안내만(서버가 판정)', () => {
    expect(staffPhotoHint(new File(['x'], 'a.gif', { type: 'image/gif' }))).toBe('type');
    const big = new File(['x'], 'b.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });
    expect(staffPhotoHint(big)).toBe('size');
    expect(staffPhotoHint(new File(['x'], 'c.webp', { type: 'image/webp' }))).toBeNull();
  });
});
