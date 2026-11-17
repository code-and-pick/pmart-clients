import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';
import '../../checkout/data/mock_checkout_repository.dart';
import '../../checkout/presentation/checkout_controller.dart';
import '../../payment/data/payment_repository.dart' show tossUserCancelCode;
import '../../payment/domain/payment.dart';
import '../../payment/presentation/payment_controller.dart';
import '../../payment/presentation/toss_payment_page.dart' show TossPgLauncher;
import '../data/mock_redelivery_payments_repository.dart';
import '../data/redelivery_payments_repository.dart';
import '../domain/redelivery_payment.dart';

final redeliveryPaymentsRepositoryProvider =
    Provider<RedeliveryPaymentsRepository>(
      (ref) => switch (ref.watch(envProvider)) {
        PmartEnv.mock => () {
          final repo = MockRedeliveryPaymentsRepository(
            now: ref.watch(clockProvider),
          );
          // 목 결제 서비스(주문서 목)가 이 결제 시도도 승인하게 잇는다.
          if (ref.watch(checkoutRepositoryProvider)
              case final MockCheckoutRepository c) {
            c.external = repo;
          }
          return repo;
        }(),
        PmartEnv.local => ApiRedeliveryPaymentsRepository(
          ref.watch(dioProvider),
        ),
      },
    );

/// 이 주문의 다시 배송비 결제 건. 조회 실패는 오류로 남긴다(결제 건 없음으로 바꾸지 않는다).
final redeliveryPaymentsProvider = FutureProvider.autoDispose
    .family<List<RedeliveryPayment>, String>(
      (ref, orderId) =>
          ref.watch(redeliveryPaymentsRepositoryProvider).list(orderId),
    );

/// 결제 대기 목록을 다시 읽는 간격·횟수(결제 시도 준비 중·승인 결과 확인). 화면이 열려 있는 동안만.
final redeliveryPollPolicyProvider =
    Provider<({Duration interval, int attempts})>(
      (_) => (interval: const Duration(seconds: 2), attempts: 15),
    );

/// 승인 요청을 넘긴 결제 건의 저장 종류. 앱을 다시 켜도 결제창을 다시 열지 않고 결과만 확인한다.
const redeliveryAuthKind = 'redelivery-auth';

enum RedeliveryPhase {
  /// 결제 건을 읽는 중
  loading,

  /// 고를 수 있음(결제하기 / 환불받기)
  ready,

  /// 결제 시도 준비 중(paymentAttemptId 대기)
  preparing,

  /// 결제창
  authenticating,

  /// 승인 결과 확인 중 — 다시 결제·환불 고르기 없음
  confirming,

  /// 이번 결제 시도 실패 — 다시 결제할 수 있음(기한 안)
  failed,

  /// 환불 고르기 보내는 중·결과 확인 중
  declining,

  /// 서버가 끝난 상태를 줬다(결제됨·환불 고름·기한 지남) — [RedeliveryFlowState.payment] 의 status
  settled,

  /// 결제 건을 찾지 못했다(남의 것·없음)
  missing,
}

@immutable
class RedeliveryFlowState {
  const RedeliveryFlowState({
    required this.phase,
    this.payment,
    this.failureCode,
    this.stillChecking = false,
    this.loadFailed = false,
  });

  final RedeliveryPhase phase;

  /// 서버가 마지막으로 준 결제 건.
  final RedeliveryPayment? payment;
  final String? failureCode;

  /// 여러 번 확인했지만 결론이 없다. "다시 확인"만 보인다.
  final bool stillChecking;

  /// 결제 건을 읽지 못했다(결제 건 없음이 아니다).
  final bool loadFailed;

  bool get canChoose =>
      (phase == RedeliveryPhase.ready || phase == RedeliveryPhase.failed) &&
      payment?.status == RedeliveryPaymentStatus.waitingPayment;
}

typedef RedeliveryRef = ({String orderId, String id});

final redeliveryFlowProvider = NotifierProvider.autoDispose
    .family<RedeliveryFlowController, RedeliveryFlowState, RedeliveryRef>(
      RedeliveryFlowController.new,
    );

/// 다시 배송비 결제·환불 고르기. 결제창 복귀·승인 요청 접수는 완료가 아니다 —
/// 결제 건이 서버에서 PAID 가 될 때만 "결제됐어요". 결과를 모르는 동안 다시 결제·환불 고르기를 막는다.
class RedeliveryFlowController extends Notifier<RedeliveryFlowState> {
  RedeliveryFlowController(this.target);

  final RedeliveryRef target;
  bool _running = false;

  /// 결과를 모르는 환불 고르기의 키(다시 보낼 때 같은 키).
  IdempotencyKey? _declineKey;

  @override
  RedeliveryFlowState build() =>
      const RedeliveryFlowState(phase: RedeliveryPhase.loading);

  RedeliveryPaymentsRepository get _repo =>
      ref.read(redeliveryPaymentsRepositoryProvider);
  PendingCommandStore get _store => ref.read(pendingCommandStoreProvider);
  String get _pendingId => 'redelivery-${target.id}';

  void _set(RedeliveryFlowState s) {
    if (ref.mounted) state = s;
  }

  Future<T?> _guarded<T>(Future<T> Function() body) async {
    if (_running) return null;
    _running = true;
    try {
      return await body();
    } finally {
      _running = false;
    }
  }

  Future<RedeliveryPayment?> _read() async {
    final all = await _repo.list(target.orderId);
    return all.where((p) => p.id == target.id).firstOrNull;
  }

  /// 서버 상태를 화면 상태로. 결제 대기면 [whenWaiting].
  RedeliveryFlowState _from(
    RedeliveryPayment p, {
    RedeliveryPhase whenWaiting = RedeliveryPhase.ready,
    String? failureCode,
  }) => p.status == RedeliveryPaymentStatus.waitingPayment
      ? RedeliveryFlowState(
          phase: whenWaiting,
          payment: p,
          failureCode: failureCode,
        )
      : RedeliveryFlowState(phase: RedeliveryPhase.settled, payment: p);

  Future<bool> _authPending() async =>
      (await _store.list()).any((c) => c.requestId == _pendingId);

  Future<void> _forget() async {
    await _store.remove(_pendingId);
  }

  /// 화면 진입. 승인 요청을 이미 넘긴 건이면 결제창을 다시 열지 않고 결과만 확인한다.
  Future<void> load() => _guarded(() async {
    try {
      final p = await _read();
      if (p == null) {
        return _set(const RedeliveryFlowState(phase: RedeliveryPhase.missing));
      }
      if (p.status != RedeliveryPaymentStatus.waitingPayment) {
        await _forget();
        return _set(_from(p));
      }
      if (await _authPending()) {
        _set(
          RedeliveryFlowState(phase: RedeliveryPhase.confirming, payment: p),
        );
        return await _confirm();
      }
      _set(_from(p));
    } on PmartFailure {
      _set(
        RedeliveryFlowState(
          phase: RedeliveryPhase.loading,
          payment: state.payment,
          loadFailed: true,
        ),
      );
    }
  });

  /// "다시 확인" — 서버 상태만 다시 읽는다.
  Future<void> checkAgain() => _guarded(() async {
    if (_declineKey != null) return _sendDecline();
    if (state.phase == RedeliveryPhase.confirming) return _confirm(attempts: 1);
    _running = false;
    await load();
  });

  /// "결제하기". 실패한 시도 뒤면 새 결제 시도를 받고 결제창을 연다.
  Future<void> pay() => _guarded(() async {
    var p = state.payment;
    if (p == null || !state.canChoose) return;
    try {
      if (state.phase == RedeliveryPhase.failed) {
        _set(RedeliveryFlowState(phase: RedeliveryPhase.preparing, payment: p));
        p = await _repo.retry(p.id, key: IdempotencyKey.generate());
        if (p.status != RedeliveryPaymentStatus.waitingPayment) {
          return _set(_from(p));
        }
      }
      p = await _waitAttempt(p);
      if (p == null) return;
      await _open(p);
    } on PmartFailure {
      // 409(결제 대기가 아님)·결과 불명·조회 실패 — 서버 상태를 다시 읽는다.
      _running = false;
      await load();
    }
  });

  /// 결제 시도(paymentAttemptId)가 생길 때까지 목록을 다시 읽는다.
  Future<RedeliveryPayment?> _waitAttempt(RedeliveryPayment p) async {
    if (p.paymentAttemptId != null) return p;
    _set(RedeliveryFlowState(phase: RedeliveryPhase.preparing, payment: p));
    final policy = ref.read(redeliveryPollPolicyProvider);
    for (var i = 0; i < policy.attempts; i++) {
      await Future<void>.delayed(policy.interval);
      if (!ref.mounted) return null;
      final now = await _read();
      if (now == null) {
        _set(const RedeliveryFlowState(phase: RedeliveryPhase.missing));
        return null;
      }
      if (now.status != RedeliveryPaymentStatus.waitingPayment) {
        _set(_from(now));
        return null;
      }
      if (now.paymentAttemptId != null) return now;
    }
    _set(
      RedeliveryFlowState(
        phase: RedeliveryPhase.preparing,
        payment: p,
        stillChecking: true,
      ),
    );
    return null;
  }

  Future<void> _open(RedeliveryPayment p) async {
    // 기한이 지났으면 결제창을 열지 않는다(그 뒤 승인은 서버가 보상 취소한다).
    if (!ref.read(clockProvider)().isBefore(p.deadlineAt)) {
      return _set(
        RedeliveryFlowState(
          phase: RedeliveryPhase.ready,
          payment: p,
          failureCode: redeliveryDeadlinePassed,
        ),
      );
    }
    final config = await ref.read(paymentWidgetConfigProvider.future);
    if (!ref.mounted) return;
    if (config == null) {
      return _set(
        RedeliveryFlowState(
          phase: RedeliveryPhase.failed,
          payment: p,
          failureCode: TossPgLauncher.configMissing,
        ),
      );
    }
    final entry = PaymentEntry(
      clientKey: config.clientKey,
      pgOrderId: p.paymentAttemptId!,
      paymentAttemptId: p.paymentAttemptId,
      amount: p.amount,
      orderName: p.orderName ?? redeliveryDefaultOrderName,
      expiresAt: p.deadlineAt,
    );
    _set(
      RedeliveryFlowState(phase: RedeliveryPhase.authenticating, payment: p),
    );
    final ret = await ref.read(pgLauncherProvider).launch(entry);
    if (!ref.mounted) return;
    switch (ret) {
      case PgAuthenticated():
        _set(
          RedeliveryFlowState(phase: RedeliveryPhase.confirming, payment: p),
        );
        // 넘긴 뒤에는 결제창을 다시 열지 않는다(앱이 꺼져도 결과 조회로 복구).
        await _store.add(
          PendingCommand(
            requestId: _pendingId,
            kind: redeliveryAuthKind,
            targetId: target.id,
            startedAt: DateTime.now().toUtc(),
          ),
        );
        final AuthSubmitResult result;
        try {
          // 응답을 놓쳐도 다시 보내지 않는다. 결과는 결제 건 조회로 본다.
          result = await ref
              .read(paymentRepositoryProvider)
              .submitAuth(ret, key: IdempotencyKey.generate());
        } on PmartFailure {
          return _confirm();
        }
        if (result == AuthSubmitResult.rejected) {
          await _forget();
          return _set(
            RedeliveryFlowState(
              phase: RedeliveryPhase.failed,
              payment: p,
              failureCode: 'PAYMENT_FAILED',
            ),
          );
        }
        await _confirm();
      case PgCancelled():
        await _reportFailure(entry, tossUserCancelCode);
        _set(
          RedeliveryFlowState(
            phase: RedeliveryPhase.failed,
            payment: p,
            failureCode: 'USER_CANCELLED',
          ),
        );
      case PgFailed(:final code):
        await _reportFailure(entry, code);
        _set(
          RedeliveryFlowState(
            phase: RedeliveryPhase.failed,
            payment: p,
            failureCode: code,
          ),
        );
      case PgNoReturn():
        _set(
          RedeliveryFlowState(phase: RedeliveryPhase.confirming, payment: p),
        );
        await _confirm();
    }
  }

  Future<void> _reportFailure(PaymentEntry entry, String code) async {
    try {
      await ref
          .read(paymentRepositoryProvider)
          .reportAuthFailure(entry, code, key: IdempotencyKey.generate());
    } on PmartFailure {
      // 알리지 못해도 결제 시도가 만료로 끝난다. 다시 결제는 새 시도를 받는다.
    }
  }

  /// 결제 건이 결제 대기에서 벗어날 때까지 본다. 그대로면 "확인 중"(다시 결제 없음).
  Future<void> _confirm({int? attempts}) async {
    final policy = ref.read(redeliveryPollPolicyProvider);
    final n = attempts ?? policy.attempts;
    for (var i = 0; i < n; i++) {
      if (i > 0) await Future<void>.delayed(policy.interval);
      if (!ref.mounted) return;
      try {
        final p = await _read();
        if (!ref.mounted) return;
        if (p == null) {
          return _set(
            const RedeliveryFlowState(phase: RedeliveryPhase.missing),
          );
        }
        if (p.status != RedeliveryPaymentStatus.waitingPayment) {
          await _forget();
          return _settled(p);
        }
      } on PmartFailure {
        // 조회 실패는 계속 "확인 중"이다.
      }
    }
    _set(
      RedeliveryFlowState(
        phase: RedeliveryPhase.confirming,
        payment: state.payment,
        stillChecking: true,
      ),
    );
  }

  void _settled(RedeliveryPayment p) {
    _set(_from(p));
    if (ref.mounted) ref.invalidate(redeliveryPaymentsProvider(target.orderId));
  }

  /// "결제하지 않고 환불받기". 결과를 모르면 같은 키로만 다시 보낸다.
  Future<void> decline() => _guarded(() async {
    if (!state.canChoose) return;
    _declineKey = IdempotencyKey.generate();
    await _sendDecline();
  });

  Future<void> _sendDecline() async {
    final key = _declineKey;
    if (key == null) return;
    _set(
      RedeliveryFlowState(
        phase: RedeliveryPhase.declining,
        payment: state.payment,
      ),
    );
    try {
      final p = await _repo.decline(target.id, key: key);
      _declineKey = null;
      _settled(p);
    } on UnknownResultFailure {
      _set(
        RedeliveryFlowState(
          phase: RedeliveryPhase.declining,
          payment: state.payment,
          stillChecking: true,
        ),
      );
    } on PmartFailure catch (f) {
      _declineKey = null;
      // 409 ALREADY_PAID 등 — 고른 것이 반영되지 않았다. 서버 상태를 다시 읽어 보인다.
      final p = await _read().catchError((_) => null);
      if (p == null) {
        return _set(
          RedeliveryFlowState(
            phase: RedeliveryPhase.ready,
            payment: state.payment,
            failureCode: f is ProblemFailure
                ? f.problem.code
                : 'DECLINE_FAILED',
          ),
        );
      }
      _set(
        _from(
          p,
          failureCode: f is ProblemFailure ? f.problem.code : 'DECLINE_FAILED',
        ),
      );
    }
  }
}

/// 기한이 지나 결제창을 열지 않았다(앱 판단 — 상태는 서버가 바꾼다).
const redeliveryDeadlinePassed = 'DEADLINE_PASSED';

/// 서버가 주문명을 비워 줄 때 결제창에 쓰는 이름.
const redeliveryDefaultOrderName = '오배송 다시 배송비';
