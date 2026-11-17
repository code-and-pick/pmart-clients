// 직원 근거 사진 올리기(execution 0.22.0 `POST /deliveries/{deliveryId}/staff-evidence-photos`, multipart `file`) — 상태 정정의 evidenceRefs 로 쓴다.
// 형식·크기(JPEG·PNG·WEBP, 10MB)는 서버가 판정(422 PHOTO_INVALID). 화면 검사는 고르기 전에 알려 주는 안내일 뿐이다.
import { request, type IdempotencyKey } from '@pmart/web-core';
import type { Api } from '../../api/client';
import { commandParams } from '../../api/command';

export const STAFF_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const STAFF_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
/** 상태 정정 evidenceRefs 최대(계약 maxItems 10) */
export const STAFF_PHOTO_MAX_COUNT = 10;

/** 안내용 검사 — 맞지 않으면 문구 키, 맞으면 null(최종 판정은 서버) */
export function staffPhotoHint(file: File): 'type' | 'size' | null {
  if (!(STAFF_PHOTO_TYPES as readonly string[]).includes(file.type)) return 'type';
  if (file.size > STAFF_PHOTO_MAX_BYTES) return 'size';
  return null;
}

/** 한 장 올리기 — 같은 키로 다시 보내면 같은 사진(서버 멱등). */
export function uploadStaffEvidence(api: Api, deliveryId: string, file: File, key: IdempotencyKey) {
  return request(
    'POST',
    api.execution.POST('/deliveries/{deliveryId}/staff-evidence-photos', {
      ...commandParams(key, { path: { deliveryId } }),
      body: { file: '' },
      bodySerializer: () => {
        const form = new FormData();
        form.append('file', file);
        return form;
      },
    }),
  );
}
