# 라이더앱 (rider_app, Flutter)

근거: `../pmart-backend/docs/business/Delivery-business-logic.md`(D, **Draft** — 외부 브랜드 수치는 참고값), `MFC-business-logic.md`(M), `domain-map.md` §3(DM), 계약 `rider-service`, `delivery-dispatch-service`, `delivery-execution-service`, `delivery-tracking-service`, `mfc-fulfillment-service`.
충돌 적용(DM): **시간 경과 자동 완료 없음**(D의 "5시간 후 자동 완료" 미적용), **주류 신분증·서명 화면 없음**(PG 인증 통합), 분할 기준 10,000g 초과.

## 1. 화면과 API

| 화면 | API | 비고 |
|---|---|---|
| 가입 | `POST /riders/signups`, `GET /riders/signups/{requestId}` | 전화 본인확인 API 없음(BR-02) |
| 로그인 | 없음 | BR-02. 1차는 목 로그인 |
| 홈·운행 상태 | `GET/PUT /riders/me/state`, `GET /riders/me` | 3상태 |
| 배차 설정 | `GET/PUT /riders/me/settings` | 하나씩 배달하기, 모드 일반/AI추천 |
| 배차 제안 | `GET /offers?state=`, `GET /offers/{offerId}`, `POST /offers/{offerId}/responses` | BR-06 부분 AGREED(`e817184`). 푸시·SSE와 일반배차 대기 목록은 보류 |
| 배송 수행 | `GET /deliveries/{id}`, `POST …/store-arrivals`, `…/pickups`, `…/customer-arrivals`, `…/completions`, `…/failures` | |
| QR 인계 | `POST /packages/{packageId}/handover-authorizations`, `…/handover-commits`, `GET …/handover-resolution` | mfc-fulfillment |
| 배차 취소 | `POST /deliveries/{id}/assignment-cancellations` (+짝 조회) | 픽업 전/후 다름 |
| 도움요청 | `POST /deliveries/{id}/help-requests` (+짝 조회) | case-service 로 연결 |
| 회수 | `POST /deliveries/{id}/returns/pickups`, `…/returns/store-deliveries` | |
| 위치 전송 | `POST /riders/me/locations`(배치), `GET /riders/me/locations/latest` | 5초마다 위치를 받아 10초마다 묶어 보냄(백엔드 안내 예시). 운행·배달 중에는 Android 상시 알림(위치 포그라운드 서비스)으로 앱을 내려도 보내고, 위치 권한 "항상 허용"을 안내한다 `[사용자 결정 2026-11-16]` |
| 내역·수익 | `GET /riders/me/deliveries`, `GET /riders/me/earnings` | 요율 미등록 = "산정 불가" |
| 탈퇴 | `POST /riders/me/withdrawals` (+짝 조회) | 진행 배송·미정산 없을 때만 |
| 전달 사진 | 업로드 API 없음 | BR-07 |

## 2. 규칙

**운행 상태** (D 109-154)
- `운행 종료 / 운행 중·신규배차 허용 / 운행 중·신규배차 중지`. 시작 시 본인·계정 제한·위치 권한 확인.
- 신규배차 OFF는 새 제안만 막음. 앱 종료·네트워크 끊김으로 진행 배송을 자동 취소하지 않음. 운행 종료 후에도 진행 배송은 완료·예외 처리 가능.
- 알림 ON/OFF ≠ 신규배차 ON/OFF.
- 계정 제한 `정상 / 신규배차 제한 / 일시 중지 / 계약 종료` 에 따라 수락·픽업 버튼을 막음(서버가 최종 판정).

**배차 제안** (D 188-298)
- 카드: 구간/한집, 배달료, 픽업지, 전달지, **남은 시간 카운트다운(응답 제한 1분, 서버 만료시각 기준)**. 상세: 봉투 수·부피·무게·주류·특별 운반 조건.
- 개인정보·포장번호는 단계별 최소 공개(수락 후에만 상세 수행 화면).
- 늦은 수락 안내 4종: 시간 만료 / 이미 배정 / 주문 취소 / 자격·용량 불충족.
- 거절은 사유 입력, AI모드에만 거절 버튼. 5회 연속 거절 시 신규배차 OFF 권유 팝업. 연속 배차 최대 3건.
- 수락 후 "배차취소"와 수락 전 "거절"은 다른 행위.

**제안 수신과 남은 시간** (계약 `listMyOffers`, 회신 `../pmart-backend/docs/handoff/2026-10-24-clients-reply-high.md` BR-06)
- 수신: 푸시·SSE가 정해질 때까지 `GET /offers`(state 생략 = SENT이면서 만료 전)를 폴링한다. 푸시를 도입한 뒤에도 offerId의 기준 경로는 이 조회다. 앱 실행·포그라운드 복귀·알림 탭 때마다 즉시 조회해서 유실을 복구한다.
- 폴링 간격 (회신 `../pmart-backend/docs/handoff/2026-10-24-clients-reply-br06-offer-polling.md`, 계약 `f4dd171`):
  - 응답의 `pollAfterSec` 을 따른다. 서버 잠정 기본값은 5초다. 클라이언트는 숫자를 하드코딩하지 않는다. 필드가 없거나 조회에 실패했을 때 쓸 대체값만 원격 설정으로 둔다.
  - `pollAfterSec: null` 이면 폴링을 멈춘다. 운행 종료, 신규배차 OFF, 하나씩 배달 진행 중, 계정 제한일 때 서버가 null을 준다. 배차 건수로 간격을 계산하지 않는다.
  - 다음 시점에는 간격과 관계없이 즉시 조회한다: 앱 실행, 포그라운드 복귀, 알림 탭, 운행 시작, 신규배차 ON 전환.
  - 실패하면 지수 백오프로 재시도하고 "연결 확인 중"으로 표시한다("제안 없음"으로 표시하지 않음). 429(`RATE_LIMITED`)를 받으면 `Retry-After` 를 따른다. 처리율 제한은 JWT subject 단위 단일 버킷이고 위치 전송과 같이 쓴다.
  - 백그라운드에서 제안을 놓쳐도 되는지: `[결정 필요]` 업무 결정 대기. 푸시(BR-06 보류분, BR-09)와 함께 팀에서 결정한다. 응답하지 못한 제안은 "미응답 만료"로 기록되며 연속 거절 5회에는 세지 않는다.
- 남은 시간: 단말 시계를 쓰지 않는다. 응답의 `remainingSec`(또는 `expiresAt - serverTime`)에서 출발해 단말의 경과 시간(monotonic)으로 줄여 표시하고, 다시 조회할 때마다 서버 값으로 맞춘다. 0이 돼도 만료 확정이 아니다. 판정은 서버 수신 시각 기준이며, 늦은 수락은 `outcome=LATE` 로 안내한다.
- 일반배차모드 대기 목록은 계약이 없다(BR-06 보류). 화면은 목으로만 둔다.

**수행 흐름** (D 312-412)
- `가게 도착 → QR 인계 → 픽업 완료 → 고객 도착 → 전달 완료`. GPS만으로 픽업·전달 완료 처리 안 함.
- 길찾기는 외부 지도앱(네이버/카카오/애플 설정 선택).
- 이동 중: 주문번호·포장 수량·준비 상태·픽업 요청사항. 픽업 후: 주소·상세주소·연락(안심번호 `[결정 필요]`).

**QR 인계** (D 219-232, M WK-08 ≈988, M 1978-1987)
- 포장마다 스캔(3개면 3개, 진행률 표시). 중복 스캔·다른 주문 QR·미배정 라이더·이미 인계·인식 실패는 차단하고 사유 표시.
- 스캔 → `handover-authorizations`(fence `HANDOVER_IN_PROGRESS`) → `handover-commits`. **서버가 재고 차감까지 확정한 뒤에만 인계 완료.** 불명이면 `handover-resolution` 조회, 재스캔으로 새 인계를 만들지 않음.
- 픽업 완료(`pickups`)에는 확정된 `handoverIds` 가 필요. 일부만 인계되면 부분 인계.
- 재배정되면 이전 라이더 권한 즉시 해제(서버 거절을 그대로 안내).

**전달 완료**
- 대면·비대면 모두 사진 업로드 성공 후에만 완료 버튼 활성. 보관 장소·촬영 시각 함께. 업로드 실패 시 재시도 또는 지원센터 승인 대체 증빙.
- 다른 고객·신분증·출입 비밀번호가 찍히지 않게 안내. 완료 연타는 같은 `Idempotency-Key`.
- 분할배송은 배송번호마다 완료.

**도움요청·실패·회수** (D 339-589)
- 유형: 배차취소, 점포 대기, 상품 이상, 전달 불가, 사고·고장, 상태 정정(배송번호·단계·사유·사진).
- 픽업 전 배차취소 → 재배차. 픽업 후 → 지원센터 처리(임의 인계 불가).
- 배차취소 확인 창에 반복 취소 영향을 안내한다: 최근 7일 배차취소 1건마다 AI 추천 제안 순서가 뒤로, 배달리스트 새 배송이 1분 늦게(제재 없음, 건수는 API 에 없어 표시하지 않음) `[사용자 결정 2026-11-16]`.
- 고객 부재: 연락 2회 이상 후 도움요청 또는 승인된 장소 비대면 전달. 배송 중 주소 변경 불가. 전달 실패는 자동 환불 없음.
- 회수: 고객 수거 → 점포 반납 → (점원 수령 확인은 MFC앱).

**위치** (D 101-107, 323-331): 좌표·시각·정확도를 배치 전송. 지연 시 "위치 확인 중". 권역 밖·권한 해제·GPS 오류는 서버에 기록되도록 상태 전송.

**정산**: `예상 / 확정 대기 / 지급 확정 / 지급중 / 지급 완료 / 지급 실패 / 조정`. 요율 미등록은 0원이 아니라 "산정 불가". 오늘 배달(완료·진행·수입·운행시간), 기간별 현황.

**공통**: 화면 상태는 서버 확정 결과로만 바꿈. 재접속 시 최신 상태 조회, 오래된 요청은 재검증. 오프라인 실적은 같은 키로 재전송(client-architecture §5.8).

## 3. `[결정 필요]`
위치 전송 주기, 수행료 표, 반복 배차취소 제한, 사진 보관 기간, 지연 기준, 배차 가능 시간(08/09시~24시), 로그인 방식(BR-02), 제안 수신 채널(BR-06), 업로드(BR-07), 푸시(BR-09).
