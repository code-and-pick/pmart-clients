# 요청 — 라이더 카카오·네이버 로그인 + 휴대폰 본인 확인(OCTOMO)·한 번호 한 계정·기존 계정 안내

- 보낸 앱: rider-app (PC 5)
- 받는 백엔드 영역: platform(rider-auth-service) · delivery(rider-service)
- 계기: 사용자 2026-11-19 "구글, 카카오, 네이버로 소셜로그인하고 전화번호로 신원인증하는 건 옥토모 쓸 거야. 구글 소셜로그인 밑에 카카오랑 네이버 로그인 추가하고 전화번호 인증하는 것도 구현해 … 다른 이커머스에선 카카오로 한 번 로그인 하면 그 번호로 신원인증 완료한 계정으로 로그인하라고 안내 뜨잖아. 우리도 그렇게 진행할 거야."
- 고객 쪽 같은 요청(BR-64·BR-65): `docs/handoff/customer-app/2026-11-19-backend-social-login-identity.md` — 이미 auth-service 0.4.0(카카오·네이버)·customer-service 0.9.0(OCTOMO 휴대폰 확인)로 구현됨. **라이더도 같은 방식**으로 해 달라.

## 지금 계약(라이더)
- `rider-auth-service` 0.1.0 `POST /rider-auth/social-logins` — provider **GOOGLE 만**.
- `rider-service` — 가입 때 `POST /riders/phone-checks`(번호 중복 확인)만, 본인 확인 없음.

## 요청
- **R1. rider-auth 카카오·네이버** — auth-service 0.4.0 과 같은 검증(카카오 OIDC ID 토큰, 네이버 Android SDK 액세스 토큰 → `/v1/nid/me`). 앱 패키지 `com.pmart.rider_app`. 키(카카오 네이티브 앱 키·네이버 Client ID/Secret)는 사용자가 따로 넣는다.
- **R2. 라이더 휴대폰 본인 확인(OCTOMO)** — customer-service 0.9.0 `/me/phone-verifications` 와 같은 모양(시작 → `text`·`sendTo` → 라이더가 대표번호로 문자 → "보냈어요" 때만 확인 호출 → 결과 조회). 가입 단계(전화번호)에서 쓴다 — 지금 phone-checks 를 대신하거나 이어서.
- **R3. 한 번호 한 라이더 계정·기존 계정 안내** — 확인된 번호가 이미 다른 라이더 계정(다른 제공자로 가입)에 있으면 가입을 확정하지 않고 `IDENTITY_ALREADY_REGISTERED` + `{provider, joinedAt, emailMasked}`(본인 확인을 통과한 사람에게만, 계정 ID·전체 번호는 주지 않음). 앱은 "이 번호로 가입한 계정이 있어요 — 카카오로 로그인해 주세요" + 그 제공자 버튼.
- **R4. 탈퇴 번호 재가입 1달 금지** — 고객과 같게 할지 결정해 달라(`IDENTITY_REJOIN_BLOCKED` + `rejoinAvailableAt`).
- **R5. 계정 하나 = 제공자 하나** — 다른 제공자 연결 없음(고객과 같은 사용자 결정).

## 앱(PC 5)이 지금 하는 것
- 목 모드로 먼저: 로그인 화면 구글 아래 카카오·네이버, 가입 전화번호 단계에 OCTOMO 문자 확인 화면, 기존 계정 안내 화면. 실서버에서는 서버가 받기 전까지 카카오·네이버 버튼을 내지 않는다(고객 앱과 같은 규칙).
- 계약이 오면 생성 클라이언트로 바꿔 끼운다. 계약에 없는 필드는 짐작해 부르지 않는다.

## 회신 상태 (2026-11-19 저녁)
- 백엔드 PR #250(병합 전): rider-auth 0.2.0(GOOGLE·KAKAO·NAVER, providerToken = ID 토큰만 — 네이버는 인가 코드 + PKCE id_token, 앱 키 없으면 422 CONFIG_REQUIRED),
  rider 0.17.0(`/riders/me/phone-verifications` 시작·`…/{id}/confirmations {phone}`·`GET …/{id}`, 가입에 phoneVerificationId, 409 IDENTITY_ALREADY_REGISTERED·RIDER_REJOIN_BLOCKED(until)).
- 앱: 목·도메인 모양을 이 회신에 맞췄다. 병합 뒤 생성 코드로 실서버를 붙인다(그 전에는 실서버에서 카카오·네이버 버튼 숨김, 전화 단계는 phone-checks).
