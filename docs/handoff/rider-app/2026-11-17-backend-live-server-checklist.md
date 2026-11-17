# 회신 — 라이더 앱 실서버 전환 체크리스트

보낸 앱: rider-app (PC 5)
받는 백엔드 영역: delivery (rider·execution·dispatch) · platform (case·notification)
- 작성: 2026-11-17
- 원 문서: `../pmart-backend/docs/handoff/clients/rider-app/2026-11-17-request-live-server-checklist.md`
- 앱 코드: PR #84(브랜치 `rider-app/backend-replies`, main `270b1c8` 위). 목 시험 99개 통과.
- 표시: ✅ 코드가 실서버 경로를 부름 · 📱 LAN 실기기 확인함 · ⏳ 실기기 확인 대기(폰 연결 대기, 2026-11-17)

## 1. 로그인·가입
| 항목 | 앱 |
|---|---|
| Google 로그인 → 라이더 토큰·토큰 갱신 | ✅ 📱(2026-11-17 로그인·가입·갱신 logcat 확인) |
| 지점 `deliveryAreas[].mfcId` = `GET /mfc-pickup-points` | ✅ 📱 |
| 수단 E_BIKE·KICKBOARD, 면허 `license-checks` | ✅ ⏳ — **고침**: 면허 확인이 Idempotency-Key 없이 나가 공통 인터셉터에 막혀 서버로 가지 않았다(이번 PR 에서 키 붙임) |
| 번호 `phone-checks`·계좌 `account-checks`(키 포함) | ✅ ⏳ — 서버에 경로가 없으면(404·405·501) "가입할 때 확인", 그 밖 실패는 "확인 못 함"(통과로 바꾸지 않음) |
| 은행 = 금융결제원 코드(`GET /riders/bank-codes`) | ✅ ⏳ — 못 읽으면 앱 목록(같은 코드) |
| 거주지 = 우편번호 서비스 도로명주소 | ✅ — 422 INVALID_ADDRESS 안내는 가입 오류 문구로(⏳) |
| 약관 `consents[].version` = `2026-11-17` | ✅ |
| 탈퇴 — 409 blockers 별 안내, 202 뒤 로그아웃, 503 "잠시 뒤" | ✅ ⏳ — 앞서 LAN 에서 501 을 본 것은 그 배포 전 빌드였다(회신 §1). 다시 확인한다 |

## 2. 운행·배차
| 항목 | 앱 |
|---|---|
| 운행 시작·신규배차 `PUT /riders/me/state`, 위치 `POST /riders/me/locations` | ✅ 📱(위치 202 logcat) |
| 제안 `summary.order`·`pickupPoint`·`dropAreaPoint`·`dropEtaSeconds` | ✅ |
| 회수 제안 `deliveryType RETURN` + `purpose` | ✅ ⏳ — "반품 회수"/"오배송 회수" 표시 |
| (추가) 수락 뒤 예정 시각 `GET /deliveries/{id}/eta` | ✅ ⏳ — AVAILABLE·FINAL 만, 계산 전이면 숫자 없음, 1분마다 다시 |
| (추가) 가게 전화 `mfcPhone` | ✅ — 없으면 버튼 숨김 |

## 3. 배송 수행
| 항목 | 앱 |
|---|---|
| 배송 조회 `orderSummary`·`orderNumber`·`mfcName` | ✅ |
| 전달지 `drop-info`(일반은 픽업 뒤) | ✅ |
| 회수: `recovery-contact` + `dispatch recovery.pickup` 좌표, `returnLines[].name` | ✅ ⏳ — 반품 회수도 `drop-info` 대신 `recovery-contact` |
| 고객 반품 회수 화면(받음 `returns/pickups` → 반납 `returns/store-deliveries`, 받기 전 실패) | ✅ ⏳ — 회수 배송 화면 한 벌(회신 `2026-11-17-backend-recovery-screen-done.md`) |
| 전달 불가 `failures` 한 번 → 대화(`resultId`), 도움요청 따로 안 보냄, 재개 `resume-requests` | ✅ ⏳ |
| 연락 기록 `PHONE_CALL` | ✅ |

## 4. 지원센터·알림·기록
| 항목 | 앱 |
|---|---|
| 도움요청 대화·배송별 목록 | ✅ 📱(대화 화면) |
| 배송 밖 문의 `POST/GET /inquiries` | ✅ 📱 |
| (추가) 문의 대화 case 0.21.0(실시간 채팅 상담) | ✅ ⏳ |
| 알림함 `GET /me/notifications` | ✅ 📱 |
| (추가) 푸시 토큰 `PUT/DELETE /me/push-tokens/{deviceId}` | ✅ 📱(PUT 200·DELETE 204) — 수신은 ⏳ |
| 운행시간·수행료·내 배송 | ✅ ⏳ |

## 막힌 것 / 남은 것
- 실기기 확인(⏳) 전부 — 폰을 연결하면 LAN 빌드로 위 순서대로 확인하고 이 문서에 적는다.
- 전달 불가 확정(CONFIRM) 뒤 회수 흐름 — 질문 보냄(같은 라이더 배정인지, 받음 생략인지, `FAILED_DELIVERY_RETURN` 계약 시기).
- 포장 라벨 숫자로 인계 — mfc(PC 3) 요청 대기, 지금은 목에서만.

## 같이 확인하기
위 ⏳ 를 앱 혼자 확인한 뒤, PC 5 실제 주문 한 건으로 가입 → 배차 → 픽업 → 전달·실패 → 반품 회수 순서로 같이 확인하고 싶다. 폰 연결이 되면 다시 알린다.
