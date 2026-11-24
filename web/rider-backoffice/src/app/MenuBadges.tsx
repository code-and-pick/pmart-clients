// 왼쪽 메뉴 할 일 숫자(2026-11-24 사용자 "상담같은 거 왔을 때 상담관리 목록에 1 이런 알림 뜨게 해. 통합 백오피스 처럼").
// - 통합 백오피스 MenuAlerts 와 같은 모양(공용 .pm-count 칩, 0 이면 숨김, 못 읽으면 "?" — 0 으로 지어내지 않음).
// - 이미 쓰는 목록·통계 조회만(새 API 없음). 30초마다 다시 읽고 한 쪽(50건)까지 센다 — 다음 쪽이 있으면 "50+".
//   · 상담 관리: 아직 아무도 안 받은 도움요청(OPEN, 머리줄 센터) + 답변 대기 라이더 문의(RECEIVED) + 결정 대기 소명·이의(OPEN)
//   · 계정 제한: 제한 검토 대기(OPEN)
//   · 수행료 조정 / 추가 배달료: delivery-stats 의 조정 대기·신청 수(대시보드 "오늘의 할 일"과 같은 값)
import { useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { useApi } from './ApiContext';
import { useCenterQuery } from './CenterScope';
import { failedText, useFailedPayouts } from '../features/earnings/failedPayouts';

const REFRESH_MS = 30_000;
const PAGE = 50;

interface Count {
  readonly n: number;
  readonly more: boolean;
}
interface Part {
  readonly data?: Count | undefined;
  readonly isError: boolean;
}

const pageCount = (r: { readonly items?: readonly unknown[] | null; readonly page?: { readonly nextCursor?: string | null } | null }): Count => ({
  n: (r.items ?? []).length,
  more: !!r.page?.nextCursor,
});

function useConsultParts(enabled: boolean): readonly Part[] {
  const api = useApi();
  const cq = useCenterQuery();
  const help = useQuery({
    queryKey: ['menu-badge', 'help-open', cq.mfcId ?? ''],
    enabled,
    refetchInterval: REFRESH_MS,
    queryFn: async () => pageCount(await request('GET', api.execution.GET('/delivery-help-requests', { params: { query: { size: PAGE, state: 'OPEN', ...cq } } }))),
  });
  const inquiries = useQuery({
    queryKey: ['menu-badge', 'inquiries-received'],
    enabled,
    refetchInterval: REFRESH_MS,
    queryFn: async () => pageCount(await request('GET', api.cases.GET('/inquiries', { params: { query: { requesterType: 'RIDER', status: 'RECEIVED', size: PAGE } } }))),
  });
  const appeals = useQuery({
    queryKey: ['menu-badge', 'appeals-open'],
    enabled,
    refetchInterval: REFRESH_MS,
    queryFn: async () => pageCount(await request('GET', api.riders.GET('/rider-appeals', { params: { query: { state: 'OPEN' } } }))),
  });
  return [help, inquiries, appeals];
}

function useReviewParts(enabled: boolean): readonly Part[] {
  const api = useApi();
  const reviews = useQuery({
    queryKey: ['menu-badge', 'reviews-open'],
    enabled,
    refetchInterval: REFRESH_MS,
    queryFn: async () => pageCount(await request('GET', api.riders.GET('/riders/restriction-reviews', { params: { query: { state: 'OPEN' } } }))),
  });
  return [reviews];
}

function useStatPart(enabled: boolean, pick: 'adjustmentPending' | 'surchargeRequested'): readonly Part[] {
  const api = useApi();
  // 센터 없는 전체(대시보드 오늘의 할 일과 같은 값) — 두 메뉴가 같은 조회 하나를 나눠 쓴다
  const stats = useQuery({
    queryKey: ['menu-badge', 'delivery-stats'],
    enabled,
    refetchInterval: REFRESH_MS,
    queryFn: () => request('GET', api.execution.GET('/delivery-stats', { params: { query: {} } })),
  });
  const v = stats.data?.[pick];
  return [{ data: typeof v === 'number' ? { n: v, more: false } : undefined, isError: stats.isError }];
}

const TITLES: Readonly<Record<string, string>> = {
  consults: '처리를 기다리는 상담(받지 않은 도움요청·답변 대기 문의·결정 대기 소명·이의)',
  restrictionReviews: '제한 검토 대기',
  adjustments: '수행료 조정 대기',
  surcharges: '추가 배달료 신청',
};
const FAILED = '개수를 읽지 못했어요(0 이 아니에요)';

// 메뉴 링크 이름에 숫자가 섞이지 않게 화면 읽기에서는 뺀다(뜻은 title — 통합 백오피스와 같음)
function Chip({ parts, title, menuKey }: { readonly parts: readonly Part[]; readonly title: string; readonly menuKey: string }) {
  // 하나라도 읽는 중이면 숨긴다(일부만 더한 작은 숫자를 보이지 않게)
  if (parts.some((p) => !p.data && !p.isError)) return null;
  const failed = parts.some((p) => p.isError && !p.data);
  const sum = parts.reduce((n, p) => n + (p.data?.n ?? 0), 0);
  const more = parts.some((p) => p.data?.more);
  const text = `${sum}${more ? '+' : ''}`;
  if (failed)
    return (
      <span aria-hidden="true" className="pm-count" data-tone="unknown" title={FAILED} data-testid={`menu-badge-${menuKey}`}>
        {sum > 0 || more ? `${text}+?` : '?'}
      </span>
    );
  if (sum === 0) return null;
  return (
    <span aria-hidden="true" className="pm-count" data-tone="todo" title={`${title} ${text}건`} data-testid={`menu-badge-${menuKey}`}>
      {text}
    </span>
  );
}

function ConsultBadge() {
  return <Chip parts={useConsultParts(true)} title={TITLES['consults']!} menuKey="consults" />;
}
function ReviewBadge() {
  return <Chip parts={useReviewParts(true)} title={TITLES['restrictionReviews']!} menuKey="restrictionReviews" />;
}
function AdjustmentBadge() {
  return <Chip parts={useStatPart(true, 'adjustmentPending')} title={TITLES['adjustments']!} menuKey="adjustments" />;
}
/** 지급 관리: 다시 지급해야 할 지급 실패 묶음(빨강) — 2026-11-24 */
function PayoutFailBadge() {
  const f = useFailedPayouts();
  if (f.loading) return null;
  if (f.failed && f.count === 0)
    return (
      <span aria-hidden="true" className="pm-count" data-tone="unknown" title={FAILED} data-testid="menu-badge-payouts">
        ?
      </span>
    );
  if (f.count === 0) return null;
  return (
    <span aria-hidden="true" className="pm-count" data-tone="urgent" title={`${failedText.menuTitle} ${f.count}건`} data-testid="menu-badge-payouts">
      {f.count}
    </span>
  );
}

function SurchargeBadge() {
  return <Chip parts={useStatPart(true, 'surchargeRequested')} title={TITLES['surcharges']!} menuKey="surcharges" />;
}

/** 메뉴 키 → 그 메뉴 옆 숫자(없는 메뉴는 undefined) */
export function menuBadge(key: string) {
  switch (key) {
    case 'consults':
      return <ConsultBadge />;
    case 'restrictionReviews':
      return <ReviewBadge />;
    case 'adjustments':
      return <AdjustmentBadge />;
    case 'surcharges':
      return <SurchargeBadge />;
    case 'payouts':
      return <PayoutFailBadge />;
    default:
      return undefined;
  }
}
