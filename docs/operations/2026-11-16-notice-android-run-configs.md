# 알림: Android Studio 실행 설정 추가 — MFC 앱(PC 3)·라이더 앱(PC 5) (2026-11-16, PC 1)

- 받는 곳: PC 3(mfc-app), PC 5(rider-app)
- 보낸 곳: PC 1 (원본 main 커밋 `25e740f`·`bd0662e`)
- 바뀐 것: 실행 설정 파일만. 앱 코드는 손대지 않았다. 비밀값 없음.

## 1. 받는 법
```
git pull origin main
```
Android Studio 를 열어 두고 있었다면 프로젝트를 다시 열거나 File → Reload All from Disk. 위쪽 실행 설정 목록에 아래 이름이 보인다.

| 이름 | 저장소 루트(`pmart-clients`)로 열 때 | 앱 폴더만 열 때 |
|---|---|---|
| MFC앱 목 (전부터 있음) | `.run/mfc-mock.run.xml` | — |
| **MFC앱 LAN 서버** | `.run/mfc-lan.run.xml` | `apps/mfc_app/.run/mfc-lan.run.xml` |
| **라이더앱 목** | `.run/rider-mock.run.xml` | `apps/rider_app/.run/rider-mock.run.xml` |
| **라이더앱 LAN 서버** | `.run/rider-lan.run.xml` | `apps/rider_app/.run/rider-lan.run.xml` |

## 2. 설정 내용
- 목: `--dart-define=PMART_ENV=mock` — 가짜 데이터, 서버 호출 없음. (`PMART_ENV` 를 안 주면 기본도 목이다.)
- LAN 서버: `--dart-define=PMART_ENV=local --dart-define=PMART_API_BASE_URL=http://192.168.0.40:8080/api/v1` — LAN 게이트웨이(실서버).
- 모두 `--android-project-arg=kotlin.incremental=false` — 저장소와 pub 캐시가 다른 드라이브(C:/D:)면 Kotlin 증분 캐시가 실패해서(PC 3 에서 겪음). 같은 드라이브면 없어도 된다.
- 터미널로 APK 만 만들 때(앱 폴더에서): `flutter build apk --debug --dart-define=PMART_ENV=local --dart-define=PMART_API_BASE_URL=http://192.168.0.40:8080/api/v1` → `build/app/outputs/flutter-apk/app-debug.apk`

## 3. 주의
### MFC 앱(PC 3)
- 게이트웨이는 `http://…:8080`. 앱 안에 LAN 사설 CA 신뢰가 아직 없어서 `https://…:8443` 은 접속하지 못한다.
- **기기에 LAN 루트 CA 설치가 필요하다** — 직원 로그인 화면(Keycloak)을 기기의 Chrome 이 `https://192.168.0.40:8443` 으로 열기 때문. 방법: USB 연결 후 `pwsh tools/install_lan_ca.ps1` → 기기에서 설정 → 보안 → 인증서 설치 → **"CA 인증서"** → Download 의 `pmart-lan-root-ca.crt`(거절되면 `pmart-lan-root-ca-der.cer`). 확인: 기기 Chrome 에서 `https://192.168.0.40:8443/iam/realms/pmart-staff/.well-known/openid-configuration` 이 경고 없이 열린다.
- 시험 계정: 센터 관리자 `claude-mfc-sup`, 작업자 `mfcw-*`(비밀번호는 PC 1 에서 파일로 받는다).

### 라이더 앱(PC 5)
- **라이더 앱에는 아직 실제 로그인이 없다**(BR-02). LAN 서버 설정으로 띄우면 화면은 열리지만 토큰이 없어 서버 호출이 401 로 막힌다. 로그인을 붙인 뒤 쓰는 설정이다.
- 라이더 로그인은 rider-app 담당(PC 5)이 만든다(`pc-split.md` §1 — 로그인 코드 PC 1 만의 예외). 계약 `rider-auth-service` 0.1.0: 앱이 Google 로그인으로 받은 ID 토큰을 `POST /rider-auth/social-logins` 로 보내 라이더 토큰을 받는다 — 고객앱 Google 로그인(`apps/customer_app/lib/features/auth`)과 비슷한 흐름, 라이더용 Google 웹 클라이언트 ID 를 따로 쓴다.

### 둘 다
- 나중에 API 를 `https://…:8443` 으로 옮기려면 앱 `main` 에 `if (!kReleaseMode) trustPmartLanRootCa();`(`pmart_core`, 고객앱이 쓰는 것)를 더하고 설정의 주소를 바꾼다(`pc-split.md` "LAN 루트 CA" 줄). Dart HTTP 는 기기에 설치한 CA 를 쓰지 않는다.
- 이 설정으로 실제 빌드·실행은 PC 1 에서 하지 않았다(연결된 기기 없음). 안 되면 PC 1 에 알려 달라.
