// search 0.5.0 동의어 규칙 목 저장소(ADR-0073 단계 B). 승인(SEARCH_SYNONYM)이 나면 effects.decide 가 applySynonyms 를 부른다.
// 서버와 같게: 기준 버전이 다르면 STALE_VERSION, 한 행이라도 어긋나면 LINE_REJECTED 로 아무것도 바꾸지 않는다(전부 아니면 없음).
import type { ApprovalDetail } from '../api/models';

interface Rule {
  readonly ruleId: string;
  readonly terms: readonly string[];
}
interface Application {
  readonly approvalId: string;
  readonly changeRequestId: string | null;
  readonly approverId: string | null;
  readonly result: 'APPLIED' | 'REJECTED';
  readonly reason: string | null;
  readonly baseVersion: number | null;
  readonly version: number;
  readonly lineReasons?: Readonly<Record<string, string>>;
  readonly at: string;
}

const SEED: readonly Rule[] = [
  { ruleId: 'egg', terms: ['계란', '달걀', '에그'] },
  { ruleId: 'scallion', terms: ['대파', '파'] },
];

export const synonyms = {
  version: 2,
  rules: [...SEED] as Rule[],
  lastApprovalId: null as string | null,
  updatedAt: null as string | null,
  applications: [] as Application[],
};

export function resetSynonyms(): void {
  synonyms.version = 2;
  synonyms.rules = [...SEED];
  synonyms.lastApprovalId = null;
  synonyms.updatedAt = null;
  synonyms.applications = [];
}

export function applySynonyms(a: ApprovalDetail, baseVersion: number | undefined, approverId: string | null): void {
  const base = { approvalId: a.approvalId ?? '', changeRequestId: a.changeRequestId ?? null, approverId, baseVersion: baseVersion ?? null, at: new Date().toISOString() };
  if (baseVersion !== synonyms.version) {
    synonyms.applications.unshift({ ...base, result: 'REJECTED', reason: 'STALE_VERSION', version: synonyms.version });
    return;
  }
  const next = new Map(synonyms.rules.map((r) => [r.ruleId, r]));
  const lineReasons: Record<string, string> = {};
  for (const l of a.lines ?? []) {
    const op = l.attributes?.['op'];
    const terms = l.attributes?.['terms'];
    if (op === 'DELETE') {
      if (!next.delete(l.lineKey)) lineReasons[l.lineKey] = 'RULE_NOT_FOUND';
    } else if (op === 'UPSERT' && Array.isArray(terms) && terms.length >= 2) {
      next.set(l.lineKey, { ruleId: l.lineKey, terms: terms.map((t) => String(t).trim().toLowerCase()) });
    } else lineReasons[l.lineKey] = op === 'UPSERT' ? 'INVALID_TERMS' : 'INVALID_OP';
  }
  if (Object.keys(lineReasons).length > 0) {
    synonyms.applications.unshift({ ...base, result: 'REJECTED', reason: 'LINE_REJECTED', version: synonyms.version, lineReasons });
    return;
  }
  synonyms.version += 1;
  synonyms.rules = [...next.values()];
  synonyms.lastApprovalId = base.approvalId;
  synonyms.updatedAt = base.at;
  synonyms.applications.unshift({ ...base, result: 'APPLIED', reason: null, version: synonyms.version });
}
