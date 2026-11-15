import 'package:dio/dio.dart';
import 'package:pmart_api_employee_auth/pmart_api_employee_auth.dart' as ea;
import 'package:pmart_core/pmart_core.dart';

import '../domain/employee_auth.dart';
import 'login_browser.dart';
import 'pkce.dart';

/// 직원 로그인(employee-auth-service, ADR-0056 6단계 — 백엔드 handoff 2026-11-13 mfc-app-employee-login,
/// 계약 employee-auth-service.yaml).
abstract interface class AuthRepository {
  /// 앱을 켰을 때의 상태. 실서버는 [AuthRestoring](→ [restore]).
  AuthState get initialState;

  /// 보관한 refresh token 으로 세션을 되살린다. 보관이 없거나 세션이 끝났으면 null.
  /// 네트워크 오류는 [PmartFailure] — 세션이 끝났다고 단정하지 않는다(보관은 그대로).
  Future<EmployeeSession?> restore();

  /// 브라우저로 로그인하고 토큰을 받는다. 실패는 [LoginFailure].
  Future<EmployeeSession> login();

  /// 서버 세션을 끝내고 토큰을 지운다. 서버 확인을 못 받아도 이 기기의 토큰은 지운다.
  Future<void> logout();
}

/// employee-auth 설정의 앱 이름(`pmart.employee-auth.apps.mfc` — SSO 없음, 무활동 30분).
const employeeApp = 'mfc';

/// 복귀 주소. 백엔드 허용 목록에 이 값 하나만 있다(다른 값은 400).
const loginCallbackScheme = 'pmart-mfc';
const loginReturnUri = '$loginCallbackScheme://login';

/// 세션이 끝난 이유를 로그인 화면이 안내할 수 있게 잠깐 들고 있는다.
final class SessionEndRecorder {
  SessionEnd? _last;

  /// 정지·퇴사([SessionEnd.accountBlocked])는 뒤에 오는 "만료"로 덮지 않는다 —
  /// 업무 요청이 `SUBJECT_BLOCKED` 로 막힌 뒤 갱신은 `TOKEN_INVALID`(만료와 같은 code)로 거절되기 때문이다.
  void record(SessionEnd end) {
    if (_last == SessionEnd.accountBlocked) return;
    _last = end;
  }

  /// 읽으면 비운다.
  SessionEnd? take() {
    final v = _last;
    _last = null;
    return v;
  }
}

String? _problemCode(DioException e) {
  final data = e.response?.data;
  return data is Map && data['code'] is String ? data['code'] as String : null;
}

/// 업무 요청이 401 `SUBJECT_BLOCKED` 로 막히면 "이용할 수 없는 계정"으로 기록한다.
///
/// 백엔드 회신 2026-11-13(mfc-app-login-and-https-build §1-2): 정지·퇴사된 직원의 access token 은 게이트웨이가
/// 바로 401 `SUBJECT_BLOCKED` 로 막고, 그 뒤 갱신은 401 `TOKEN_INVALID`(만료와 같은 code)로 거절된다 —
/// 그래서 갱신 응답이 아니라 **막힌 업무 요청**에서 이유를 읽는다.
/// 같은 code 가 로그아웃한 세션의 토큰에도 나오지만, 앱은 로그아웃할 때 토큰을 지워 그 뒤로 요청하지 않는다.
///
/// 인증 인터셉터(갱신 → 세션 종료 알림)보다 **먼저** 돌아야 한다 → [watchSubjectBlocked] 가 맨 앞에 넣는다.
final class SubjectBlockedInterceptor extends Interceptor {
  SubjectBlockedInterceptor(this.ended);

  final SessionEndRecorder ended;

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    if (err.response?.statusCode == 401 &&
        _problemCode(err) == 'SUBJECT_BLOCKED') {
      ended.record(SessionEnd.accountBlocked);
    }
    handler.next(err);
  }
}

/// 업무용 Dio 의 인터셉터 맨 앞에 [SubjectBlockedInterceptor] 를 넣는다.
Dio watchSubjectBlocked(Dio dio, SessionEndRecorder ended) {
  dio.interceptors.insert(0, SubjectBlockedInterceptor(ended));
  return dio;
}

/// `POST /employee-auth/tokens/refresh` 로 토큰을 회전한다(refresh token 은 한 번만 쓴다).
///
/// 인증 인터셉터를 거치지 않는 별도 Dio 를 쓴다(갱신 요청이 다시 갱신을 부르지 않게).
/// 동시 갱신은 [PmartAuthInterceptor] 가 한 번으로 모은다.
/// 401 이면 세션이 끝난 것이므로 null — 무활동 30분·최대 12시간·재사용 감지·정지/퇴사.
/// 정지·퇴사도 여기서는 `TOKEN_INVALID` 로 온다(세션이 이미 끝났다) — 그 구별은 [SubjectBlockedInterceptor] 가 한다.
/// `ACCOUNT_NOT_AVAILABLE` 분기는 백엔드가 갱신 응답을 그렇게 바꿀 때를 위해 둔다(지금은 오지 않는다).
TokenRefresher employeeAuthRefresher({
  required String baseUrl,
  required String sourceSystem,
  required DeviceIdProvider deviceId,
  SessionEndRecorder? ended,
  HttpClientAdapter? adapter,
}) {
  final dio = Dio(BaseOptions(baseUrl: baseUrl));
  if (adapter != null) dio.httpClientAdapter = adapter;
  final api = ea.PmartApiEmployeeAuth(dio: dio).getTokensApi();
  return (refreshToken) async {
    try {
      final res = await api.refreshEmployeeTokens(
        idempotencyKey: IdempotencyKey.generate().value,
        xSourceSystem: sourceSystem,
        xDeviceId: await deviceId.get(),
        refreshEmployeeTokensRequest: ea.RefreshEmployeeTokensRequest(
          refreshToken: refreshToken,
        ),
      );
      final pair = res.data;
      if (pair == null) {
        throw const ContractViolationFailure('TokenPair 본문 없음');
      }
      return AuthTokens(
        accessToken: pair.accessToken,
        refreshToken: pair.refreshToken,
      );
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 401 || status == 403) {
        ended?.record(
          _problemCode(e) == 'ACCOUNT_NOT_AVAILABLE'
              ? SessionEnd.accountBlocked
              : SessionEnd.expired,
        );
        return null;
      }
      throw PmartFailure.fromDioException(e);
    }
  };
}

final class ApiAuthRepository implements AuthRepository {
  ApiAuthRepository({
    required this.baseUrl,
    required this.sourceSystem,
    required this.tokens,
    required this.deviceId,
    required this.browser,
    required this.refresher,
    required Dio authedDio,
    HttpClientAdapter? adapter,
    String Function()? newVerifier,
  }) : _newVerifier = newVerifier ?? Pkce.newVerifier,
       _authed = ea.PmartApiEmployeeAuth(dio: authedDio).getTokensApi() {
    // 티켓 교환은 공개 요청이다(토큰 없이). 인증 인터셉터가 없는 Dio 로 보낸다.
    final plain = Dio(BaseOptions(baseUrl: baseUrl));
    if (adapter != null) plain.httpClientAdapter = adapter;
    _public = ea.PmartApiEmployeeAuth(dio: plain).getTokensApi();
  }

  final String baseUrl;
  final String sourceSystem;
  final TokenStore tokens;
  final DeviceIdProvider deviceId;
  final LoginBrowser browser;
  final TokenRefresher refresher;
  final String Function() _newVerifier;
  final ea.TokensApi _authed;
  late final ea.TokensApi _public;

  @override
  AuthState get initialState => const AuthRestoring();

  /// 게이트웨이의 로그인 시작 주소. 브라우저가 302 를 따라 Keycloak 화면으로 간다.
  Uri loginUri({required String device, required String challenge}) =>
      Uri.parse('$baseUrl/employee-auth/logins').replace(
        queryParameters: {
          'app': employeeApp,
          'deviceId': device,
          'codeChallenge': challenge,
          'codeChallengeMethod': 'S256',
          'returnUri': loginReturnUri,
        },
      );

  @override
  Future<EmployeeSession> login() async {
    // verifier 는 이 함수 안에만 있다(메모리). 끝나면 버려진다.
    final verifier = _newVerifier();
    final device = await deviceId.get();
    final back = await browser.open(
      loginUri(device: device, challenge: Pkce.challenge(verifier)),
      callbackScheme: loginCallbackScheme,
    );
    final error = back.queryParameters['error'];
    if (error != null) throw LoginFailure(LoginFailure.fromReturnCode(error));
    final ticket = back.queryParameters['ticket'];
    if (ticket == null || ticket.isEmpty) {
      throw const LoginFailure(LoginError.ticketInvalid);
    }

    // 티켓은 60초·1회용이다. 실패하면 같은 티켓을 다시 보내지 않고 로그인을 다시 한다.
    final ea.EmployeeLoginResult result;
    try {
      final res = await _public.exchangeLoginTicket(
        idempotencyKey: IdempotencyKey.generate().value,
        xSourceSystem: sourceSystem,
        xDeviceId: device,
        exchangeLoginTicketRequest: ea.ExchangeLoginTicketRequest(
          ticket: ticket,
          codeVerifier: verifier,
        ),
      );
      final body = res.data;
      if (body == null) throw const LoginFailure(LoginError.network);
      result = body;
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (_problemCode(e) == 'ACCOUNT_NOT_AVAILABLE') {
        throw const LoginFailure(LoginError.accountNotAvailable);
      }
      if (status == 401) throw const LoginFailure(LoginError.ticketInvalid);
      throw const LoginFailure(LoginError.network);
    }

    await tokens.save(
      AuthTokens(
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
      ),
    );
    return EmployeeSession(
      operatorId: result.operatorId,
      roles: result.roles,
      centers: result.centers,
    );
  }

  @override
  Future<EmployeeSession?> restore() async {
    final refreshToken = await tokens.readRefreshToken();
    if (refreshToken == null) return null;
    final next = await refresher(refreshToken);
    if (next == null) {
      await tokens.clear();
      return null;
    }
    await tokens.save(next);
    final session = EmployeeSession.fromAccessToken(next.accessToken);
    if (session == null) {
      throw const ContractViolationFailure('access token 클레임을 읽지 못함');
    }
    return session;
  }

  @override
  Future<void> logout() async {
    try {
      // PDA 는 SSO 가 없어 idpLogoutUri 가 비어 있다(Keycloak 세션은 로그인 직후 끝났다) — 응답은 쓰지 않는다.
      if (tokens.accessToken != null) {
        final key = IdempotencyKey.generate();
        await _authed.employeeLogout(
          idempotencyKey: key.value,
          xSourceSystem: sourceSystem,
          employeeLogoutRequest: ea.EmployeeLogoutRequest(allDevices: false),
          // 공통 Dio 는 변경 요청의 멱등 키를 extra 로 받는다(없으면 보내지 않는다).
          extra: {PmartExtra.idempotencyKey: key},
        );
      }
    } on DioException {
      // 서버 세션 종료를 확인하지 못해도 이 기기는 로그아웃한다(세션은 무활동 30분으로 끝난다).
    } finally {
      await tokens.clear();
    }
  }
}

/// 목 모드: 브라우저·네트워크 없이 로그인된 상태로 시작한다(앱을 다시 켜서 세션이 되살아난 것과 같다).
/// 로그아웃하면 로그인 화면이 나오고, 버튼을 누르면 바로 로그인된다.
final class MockAuthRepository implements AuthRepository {
  MockAuthRepository({EmployeeSession? session, this.signedIn = true})
    : session = session ?? mockSession;

  static const mockSession = EmployeeSession(
    operatorId: 'OP-mock-worker',
    roles: ['MFC_WORKER'],
    centers: ['MFC-MOCK-01'],
  );

  final EmployeeSession session;
  bool signedIn;

  /// 테스트용: 다음 로그인을 이 이유로 실패시킨다.
  LoginError? nextLoginError;
  int loginCalls = 0;
  int logoutCalls = 0;

  @override
  AuthState get initialState =>
      signedIn ? AuthSignedIn(session) : const AuthSignedOut();

  @override
  Future<EmployeeSession?> restore() async => signedIn ? session : null;

  @override
  Future<EmployeeSession> login() async {
    loginCalls += 1;
    final error = nextLoginError;
    if (error != null) {
      nextLoginError = null;
      throw LoginFailure(error);
    }
    signedIn = true;
    return session;
  }

  @override
  Future<void> logout() async {
    logoutCalls += 1;
    signedIn = false;
  }
}

/// **임시(목 전용)** — 앱 안에서 아이디·비밀번호를 받는 로그인(사용자 지시 2026-11-13: "원랜 Keycloak 외부 링크를
/// 열어야 하는데 임시로 아이디 비번 넣는 페이지").
///
/// 계약에 없다: 직원 로그인 계약(employee-auth-service, ADR-0056)은 Keycloak 화면에서 입력받고 앱은 비밀번호를
/// 받지 않는다. 그래서 실서버 구현([ApiAuthRepository])에는 없고, 서버로 보내는 것도 없다. 실서버에서 쓰려면
/// 백엔드에 로그인 경로를 요청해야 한다(BR 미등록 — PC 1 이 합칠 때).
abstract interface class TemporaryPasswordLogin {
  /// 실패는 [LoginFailure]([LoginError.badCredentials]).
  Future<EmployeeSession> loginWithPassword({
    required String loginId,
    required String password,
  });
}

/// 목 모드 앱이 쓰는 임시 아이디·비밀번호 로그인. 로그아웃 상태로 시작한다.
///
/// 아이디는 LAN 시험 계정의 모양만 확인한다 — 작업자 `mfcw-pp-01`~`30`, `mfcw-rcv|qc|mv|rtn-01`~`10`,
/// 센터 관리자 `claude-mfc-sup`(역할 `MFC_SUPERVISOR`, 백엔드 `dev-on-other-pcs.md` §2).
/// **비밀번호는 비어 있지 않은지만 본다** — 실제 값은 저장소에 두지 않는다(비밀값).
final class MockPasswordAuthRepository extends MockAuthRepository
    implements TemporaryPasswordLogin {
  MockPasswordAuthRepository() : super(signedIn: false);

  static final _account = RegExp(r'^mfcw-(pp|rcv|qc|mv|rtn)-(\d{2})$');

  /// LAN 시험 센터 관리자 계정.
  static const supervisorAccount = 'claude-mfc-sup';

  /// 시험 작업자 계정 아이디인지.
  static bool isTestWorker(String loginId) {
    final m = _account.firstMatch(loginId);
    if (m == null) return false;
    final n = int.parse(m.group(2)!);
    return n >= 1 && n <= (m.group(1) == 'pp' ? 30 : 10);
  }

  EmployeeSession? _current;

  @override
  AuthState get initialState =>
      signedIn ? AuthSignedIn(_current ?? session) : const AuthSignedOut();

  @override
  Future<EmployeeSession?> restore() async =>
      signedIn ? _current ?? session : null;

  @override
  Future<EmployeeSession> loginWithPassword({
    required String loginId,
    required String password,
  }) async {
    loginCalls += 1;
    final supervisor = loginId == supervisorAccount;
    if (!(supervisor || isTestWorker(loginId)) || password.isEmpty) {
      throw const LoginFailure(LoginError.badCredentials);
    }
    signedIn = true;
    return _current = EmployeeSession(
      operatorId: 'OP-mock-$loginId',
      roles: supervisor
          ? const [EmployeeSession.mfcSupervisorRole]
          : session.roles,
      centers: session.centers,
    );
  }

  @override
  Future<void> logout() async {
    await super.logout();
    _current = null;
  }
}
