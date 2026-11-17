# [pmart-clients → pmart-backend] 질문·요청: 고객앱 휴대폰 푸시(FCM) — 고객 발송 여부·Firebase 프로젝트 (2026-11-17)

- 보낸 앱: customer-app (PC 1)
- 받는 백엔드 영역: platform (notification-service)
- 근거: 사용자 2026-11-17 — 고객앱에 Firebase 를 넣는 목적은 "푸시알림", "백엔드 작업이 먼저 필요한거지?" → "일단 handoff 문서 써줘".
- 관련: `docs/backend-requests.md` BR-09(푸시 토큰), 백엔드 `clients/rider-app/2026-11-17-request-rider-push-fcm.md`(라이더 푸시 — 프로젝트 `pmart-123`), 계약 `notification-service.yaml` 0.4.0.

## 1. 지금 아는 것 (문서·계약에서 읽은 것 — 실서버로 확인하지 않음)

- 단말 토큰 API 는 고객도 쓸 수 있다: `PUT·DELETE /api/v1/me/push-tokens/{deviceId}`, `GET /api/v1/me/push-tokens` — `x-pmart-user-types: [CUSTOMER, RIDER]`.
- 라이더 푸시는 켜졌다고 적혀 있다(프로젝트 `pmart-123` 서비스 계정 키, LAN).
- **고객 발송은 문서에서 찾지 못했다.** 계약 설명에는 아직 "토큰만 저장한다 — 푸시 발송(FCM)은 아직 없다", "APP_PUSH 는 여전히 CHANNEL_NOT_APPROVED" 가 남아 있고(0.3.0·0.4.0 문단), `PUT /me/push-tokens` 설명 끝에도 "발송(FCM)은 아직 없다" 가 있다.
- 고객앱에는 Firebase 가 아직 없다(`firebase_core`·`firebase_messaging` 없음, google-services 플러그인 없음). 알림함(`/me/notifications`)만 쓴다.

## 2. 질문

| # | 질문 | 왜 |
|---|---|---|
| Q1 | **고객 알림을 휴대폰 푸시(FCM)로 보내는 코드가 지금 있나?** 없으면 만들 계획·순서. 있으면 어느 버전·어느 커밋부터, LAN 배포 여부 | 없으면 고객앱이 토큰을 등록해도 푸시가 오지 않는다. 앱 작업을 먼저 할지 정해야 한다 |
| Q2 | **고객앱의 Firebase 프로젝트를 라이더와 같은 `pmart-123` 으로 한다(사용자 결정 2026-11-17 "라이더쪽 프로젝트 한개로 앱 두개를 관리") — 서버 쪽에 걸리는 것이 있나?** 서버가 서비스 계정 키 하나로 고객·라이더 둘 다 보내는 구조인지 | 서버 키와 앱의 `google-services.json` 이 같은 프로젝트여야 한다. **오늘만은 고객앱이 따로 만들어진 `pmart-42b37` 설정으로 앱 쪽 작업을 할 수 있다**(사용자 "오늘만 지금 형태로") — 그 동안 등록되는 고객 토큰은 `pmart-42b37` 것이라 서버의 `pmart-123` 키로는 보낼 수 없다. `pmart-123` 으로 옮기면 앱이 같은 deviceId 로 새 토큰을 다시 PUT 한다 |
| Q3 | 고객에게 푸시로 보낼 알림의 범위 — 알림함에 쌓이는 것 전부(주문 확정·상품 준비 시작·배송 출발·배송 완료·주문 취소·품절 부분 취소·환불 결과·고객센터 답변)인가, 일부인가 | 화면의 수신 설정 문구·시험 범위 |
| Q4 | 푸시 `data` 에 실리는 값 — 라이더는 `notificationId`·`templateKey`·`destinationType`·`destinationRef`. 고객도 같은 모양인가, `destinationType` 값 목록은 | 푸시를 눌렀을 때 갈 화면(주문 상세·문의 상세·알림함) |
| Q5 | 수신 설정(`settings`)과 푸시의 관계 — 고객이 앱 알림을 끄면 서버가 푸시를 보내지 않나, 앱이 토큰을 `DELETE` 해야 하나. 마케팅 동의(customer `MARKETING`)와는 별개가 맞나 | 설정 화면 동작. 동의·수신 자격은 서버 값을 따른다 |
| Q6 | `PUT /me/push-tokens` 의 `pmart.notification.push-token.max-devices` 가 LAN 에 설정돼 있나(없으면 422 `CONFIG_REQUIRED`) | 실서버 확인 때 |
| Q7 | 계약 설명의 "발송(FCM)은 아직 없다"·"APP_PUSH 는 CHANNEL_NOT_APPROVED" 문구가 지금도 맞나(라이더 푸시가 켜진 뒤) | 계약이 정본이라 문구가 맞아야 클라이언트 문서를 고칠 수 있다 |
| Q8 | **서버가 받는 값이 FCM 등록 토큰이 맞나, Firebase 설치 ID(FID)도 되나?** | `firebase_messaging` 17.1.0 이 `getToken`·`onTokenRefresh`·`deleteToken` 을 "쓰지 말 것(deprecated)"으로 표시하고 `register()`·`onRegistered`(값이 토큰이 아니라 FID)를 권한다. 계약은 `token` = "FCM 등록 토큰"이라 고객앱은 지금 `getToken` 을 그대로 쓴다. 라이더 앱(PC 5)도 같은 패키지를 쓰면 같은 문제를 만난다 |


## 3. 고객앱이 한 것 (2026-11-17 — 사용자 "오늘만 지금 형태로", "고객앱쪽 작업만")

라이더 요청서와 같은 방식(Android 만, FlutterFire CLI·`firebase_options.dart` 없이 `google-services.json` 으로). 아직 커밋 전.

1. `apps/customer_app/android/app/google-services.json`(git 제외) — **오늘은 `pmart-42b37` 것**. Gradle google-services 플러그인 4.6.0 은 그 파일이 있을 때만 건다(없는 PC 에서도 빌드됨).
2. 새 패키지 `firebase_core` 5.2.0·`firebase_messaging` 17.1.0(사용자 승인).
3. 회원이 되면 `Firebase.initializeApp()` → 알림 권한 요청(Android 13+) → `getToken()` → `PUT /me/push-tokens/{deviceId}`(deviceId = 앱이 이미 쓰는 기기 ID, `Idempotency-Key`·`X-Source-System`, 본문 `token`·`platform: ANDROID`). 토큰이 바뀌면 다시 PUT. 결과 불명은 같은 키로 한 번 더.
4. 로그아웃은 회원 토큰을 지우기 전에 `DELETE /me/push-tokens/{deviceId}`, 비회원이 되면 단말 토큰도 버린다. 세션이 강제로 끝난 경우(갱신 거절)는 `DELETE` 를 부를 수 없어 단말 토큰만 버린다 — 서버에 남은 줄은 FCM 이 UNREGISTERED 로 답하면 서버가 지운다고 이해했다(라이더 요청서).
5. 푸시를 누르면 알림함으로(Q4 답을 받으면 대상 화면으로). 토큰 값은 로그·오류 문구·분석 이벤트에 남기지 않는다.

- 확인: `flutter analyze` 문제 없음, `flutter test` 410개 통과(새 10개 — 목), 디버그 APK 빌드 성공. **실기기 설치·실서버 PUT·푸시 수신은 확인하지 않았다.**
- 비회원(게스트)은 토큰을 등록하지 않는다(본인 알림함이 없다) — 다르면 알려 주세요.
- `appVersion` 은 보내지 않는다(선택 칸) — 필요하면 알려 주세요.

## 4. 회신에 적어 줄 것

- Q1~Q7 답(특히 Q1·Q2 — 앱 작업 시작 여부와 프로젝트).
- 고객 발송을 새로 만든다면 계약 버전·LAN 배포 시점.
