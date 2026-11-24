// 사건 요약 글자 다듬기(2026-11-24 사용자 "한글로 짧게 바로 알아볼 수 있게 적어 영어로 길게 복잡하게 적지 말고").
// 서버 요약은 "라이더 도움요청 — APP_ERROR (ASSIGNED)"·"… 마지막 2026-11-20T13:10:39Z …" 처럼 영문 코드·ISO 시각이 섞여 온다.
// - 영문 코드 → 화면 글자(도움요청 분류·배송 상태), ISO 시각 → 화면 시각
// - 종류 꼬리표가 따로 보이는 자리면 앞의 "종류 — " 를 뗀다
import { messages } from './messages';
import { when } from './opsUi';

const n = messages.names;
const CODE_WORDS: Readonly<Record<string, string>> = { ...n.helpCategory, ...n.executionState };
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/g;

export function caseSummaryText(text: string | null | undefined, kindLabel?: string): string {
  if (!text) return '';
  let s = text.replace(ISO, (iso) => when(iso)).replace(/\b[A-Z][A-Z_]{2,}\b/g, (code) => CODE_WORDS[code] ?? code);
  if (kindLabel && s.startsWith(kindLabel)) s = s.slice(kindLabel.length).replace(/^\s*[—\-:·]\s*/, '');
  return s.trim() || text;
}
