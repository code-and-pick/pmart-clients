// ⚠ 화면 개발·시험용 목 — 직원 근거 사진 올리기(execution 0.22.0 POST /deliveries/{id}/staff-evidence-photos) 목. 실제 서버 동작이 아니다.
// 흉내: RIDER_OPS·OPERATOR_ADMIN 만(그 밖 403), JPEG·PNG·WEBP·10MB 아니면 422 PHOTO_INVALID, 같은 키 = 같은 사진.
// 올린 photoRef 는 배송별로 기억해 두고, 상태 정정 목(opsHandlers)이 "이 배송의 사진인지" 볼 때 쓴다.
import { http, type HttpHandler } from 'msw';

import { API_BASE } from '../api/client';
import { nextSeq, timestamp } from './db';
import { idempotent, operator, problem, unauthorized } from './support';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;

/** 배송 ID → 이 배송에 직원이 올린 photoRef */
const staffPhotos = new Map<string, Set<string>>();

export function registerStaffPhoto(deliveryId: string, photoRef: string) {
  const set = staffPhotos.get(deliveryId) ?? new Set<string>();
  set.add(photoRef);
  staffPhotos.set(deliveryId, set);
}

export const isStaffPhotoOf = (deliveryId: string, photoRef: string) => staffPhotos.get(deliveryId)?.has(photoRef) ?? false;

export const staffEvidenceHandlers: HttpHandler[] = [
  http.post(`${API_BASE}/deliveries/:deliveryId/staff-evidence-photos`, async ({ request, params }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!who.roles.some((r) => r === 'RIDER_OPS' || r === 'OPERATOR_ADMIN')) return problem(403, 'FORBIDDEN');
    const deliveryId = String(params['deliveryId']);
    const file = await request.formData().then(
      (form) => form.get('file'),
      () => null,
    );
    if (!(file instanceof Blob)) return problem(422, 'PHOTO_INVALID', [{ field: 'file', reason: 'REQUIRED' }]);
    if (!TYPES.includes(file.type) || file.size > MAX_BYTES) return problem(422, 'PHOTO_INVALID', [{ field: 'file', reason: 'NOT_ALLOWED' }]);
    const { type, size } = file;
    return idempotent(request, () => {
      const photoRef = `SEP-${nextSeq()}`;
      registerStaffPhoto(deliveryId, photoRef);
      return { status: 201, body: { photoRef, contentType: type, sizeBytes: size, uploadedAt: timestamp() } };
    });
  }),
];
