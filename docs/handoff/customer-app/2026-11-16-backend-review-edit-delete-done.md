# [pmart-clients → pmart-backend] 회신: 고객 앱 리뷰 수정·삭제 화면 반영 (2026-11-16)

- 보낸 앱: customer-app (PC 1)
- 받는 백엔드 영역: platform
- 원 문서: pmart-backend `docs/handoff/clients/customer-app/2026-11-16-request-review-edit-delete.md`
- 계약: `review-service.yaml` 0.2.0 그대로(클라이언트 `contracts.lock` dart 변경 없음)

## 1. 반영
- 들어가는 곳: "내가 쓴 리뷰"(자격 목록의 `reviewId`, 상태 PUBLISHED·LOCKED) → 리뷰 하나 화면(`GET /reviews/{reviewId}`) 아래 **삭제**·**수정**. 다른 곳(상품 리뷰 목록)에는 버튼 없음.
- 수정 `PATCH /reviews/{reviewId}`
  - `state == PUBLISHED` 일 때만. `LOCKED` 면 버튼을 막고 "등록 후 3일이 지나 고칠 수 없어요". 기한은 `editableUntil` 그대로 표시(앱 계산 없음).
  - 헤더 `Idempotency-Key`·`X-Source-System`·`X-Expected-Version`(상세 `version`).
  - 바뀐 것만 보낸다. 바뀐 것이 없으면 보내지 않는다. 사진이 그대로(순서까지)면 `photoIds` 를 빼고, 바꾸면 그 목록으로. 새 사진은 `POST /review-photos` 로 먼저 올린다.
  - 200 → 응답 리뷰로 화면을 바꾼다. 409 `INVALID_STATE`·`VERSION_CONFLICT` → 안내 + "다시 불러오기"(상세 다시 읽기). 422 `PHOTO_NOT_FOUND`·404 → 코드별 안내. 결과 불명 → 같은 키·같은 본문으로만 "다시 확인".
- 삭제 `DELETE /reviews/{reviewId}`: 확인 창 "삭제하면 이 상품의 리뷰를 다시 쓸 수 없어요." 뒤 보낸다. 204 → 목록에서 빠지고 그 품목은 다시 쓰기 없음(`DELETED`). 결과 불명 → 같은 키로만 "다시 확인".

## 2. 확인
- 목 모드: 별점만 수정(사진 빼고 보냄)·사진 바꾸기·LOCKED 막힘·버전 충돌·삭제 확인 창(취소면 안 보냄)·삭제 뒤 다시 쓰기 없음·수정/삭제 결과 불명 같은 키 — 시험 통과(customer_app 374).
- 실서버: 아직. LAN 에 전달 완료된 배송이 생긴 뒤 확인한다.

## 3. 질문
- 수정에서 글을 다 지우면 `text: ""` 를 보낸다. 계약에 `minLength` 가 없는데, 빈 글로 바꾸는 것을 받는가? 안 받으면 400 코드(`VALIDATION_FAILED`?)를 알려 주면 그 안내를 붙인다.
