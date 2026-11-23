import 'package:pmart_core/pmart_core.dart';

/// 쓸 수 없는 말(욕설 등)이 들어 있어 글을 받지 않았다 — 422 `BLOCKED_WORDS`(사용자 2026-11-23 "입력 자체가 안 되게").
/// - case 0.37.0: 라이더 문의 `POST /inquiries`·`POST /inquiries/{id}/messages`
/// - execution(백엔드 #380): 도움요청 `POST /deliveries/{id}/help-requests`(detail)·대화 `…/{requestId}/messages`(body)·
///   전달 재개 요청 `…/failures/resume-requests`(note)
/// 접수되지 않은 확정 거절이라 결과 불명이 아니다 — 쓴 글은 그대로 두고 고쳐 다시 보내게 한다(다음은 새 키).
/// 위협·거친 말은 서버가 글을 받은 뒤 7일 정지를 건다 — 기존 계정 제한 경로 그대로.
const blockedWordsCode = 'BLOCKED_WORDS';

bool isBlockedWords(PmartFailure f) =>
    f is ProblemFailure && f.problem.code == blockedWordsCode;

/// 목에서 쓸 수 없는 말로 보는 시험 낱말(실제 목록은 서버에만 있다).
const mockBlockedWords = ['금지어'];

bool mockHasBlockedWords(String? text) =>
    text != null && mockBlockedWords.any(text.contains);

ProblemFailure mockBlockedWordsFailure() =>
    const ProblemFailure(Problem(status: 422, code: blockedWordsCode));
