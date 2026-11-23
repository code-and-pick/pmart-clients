// 공용으로 바꿈(2026-11-20 웹 백오피스 맞추기 4단계) — 정본은 web/ui/src/console/ (@pmart/web-ui/console). 이 앱 안의 가져오기 경로를 그대로 두려고 다시 내보낸다.
// 이 앱에만 남긴 것: DetailHeader — 최근 본 것 기록(seen → recentViews)·목록 순서대로 이전·다음(QueueNav)이 이 앱 기능이라. 모양은 공용 콘솔 상세 머리와 같다(상자 없이 24px 제목).
// 직접 내보낸 이름(DetailHeader)이 export * 보다 먼저다.
import { type ComponentProps, type ReactNode, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { StatCard as ConsoleStatCard, type Tone } from '@pmart/web-ui/console';

import { useRecordRecent } from './recentViews';
import { StickyTitle, useScrolledPast } from './StickyTitle';
import { ui } from './uiMessages';
import { QueueNav } from './workQueue';

export * from '@pmart/web-ui/console';
// 라이더 시뮬레이터 모양 2단계(2026-11-21 사용자 "기능·보이는 정보·내용도 라이더시뮬레이션 UI처럼") — 검색 조건은 찾기 칸 + 깔때기 팝업 + 칩,
// 화면 설명·안내 상자는 ⓘ 로 접기. 공용과 같은 이름으로 덮는다(shared/simList.tsx).
export { GuideBox, PageHeader, SearchPanel, SearchRow, Section } from './simList';

/*
 * 라이더 시뮬레이터 모양 시범(2026-11-21 사용자 "라이더 백오피스에만 라이더 시뮬레이션 UI 적용") — 겉모양만, 글자·동작은 그대로.
 * 상태 = 작은 점 + 글자. 평상시 값(정상·완료 = success, 회색·중립)은 회색 글자, 색 글자는 문제(빨강)·주의(주황)·진행 중(파랑)에만.
 * 공용 콘솔(web/ui)은 다른 백오피스가 써서 그대로 두고 이 앱에서만 덮는다(직접 내보낸 이름이 export * 보다 먼저다). 모양은 src/sim-look.css.
 */
export function StatusText({ tone = 'ghost', children, testId }: { readonly tone?: Tone; readonly children: ReactNode; readonly testId?: string | undefined }) {
  return (
    <span className="pm-status" data-tone={tone} data-testid={testId}>
      {children}
    </span>
  );
}

export function StatusBadge(p: { readonly tone?: Tone; readonly children: ReactNode; readonly testId?: string }) {
  return <StatusText {...p} />;
}

/**
 * 할 일 0건 — 초록 체크·"수고하셨어요!" 대신 조용한 한 줄(2026-11-21 사용자 "성공한 것처럼 수고하셨어요 초록 체크는 좀 고쳐라").
 * 할 일이 없다는 건 사실 안내일 뿐 성공 결과가 아니다. 제목이 그 인사말이면 빼고 본문(화면의 빈 안내)만, 뜻이 있는 제목(관제 "지금 먼저 볼 라이더가 없어요")은 본문과 함께.
 */
export function AllDone({ title, body, testId = 'all-done' }: { readonly title: string; readonly body?: string; readonly testId?: string }) {
  const lead = title === ui.allDone ? null : title;
  return (
    <p role="status" className="pm-empty-line" data-testid={testId}>
      {lead && <span className="font-semibold text-base-content">{lead}</span>}
      {lead && body && ' · '}
      {body ?? (lead ? null : title)}
    </p>
  );
}

/** 숫자 칸 — 값이 0 이면 숫자를 보조 글색으로(색은 0 이 아닐 때만). 숫자 바뀜 표시가 그대로 돌도록 값은 건드리지 않고 이름에 표시를 단다 */
export function StatCard(p: ComponentProps<typeof ConsoleStatCard>) {
  const zero = p.value === 0 || p.value === '0';
  return zero ? <ConsoleStatCard {...p} tone={undefined} label={<span data-zero="">{p.label}</span>} /> : <ConsoleStatCard {...p} />;
}

/** 상세 머리 — 공용 콘솔 모양(상자 없이 24px 제목 + 표시, 아래 회색 요약, 오른쪽 동작) + 이 앱의 최근 본 것 기록·이전·다음 */
export function DetailHeader({ back, title, badges, summary, actions, seen = false }: { readonly back: { readonly to: string; readonly label: string }; readonly title: ReactNode; readonly badges?: ReactNode; readonly summary?: ReactNode; readonly actions?: ReactNode; readonly seen?: boolean }) {
  // 제목이 화면 위로 지나가면 위에 얇은 제목 띠(2026-11-19)
  const card = useRef<HTMLDivElement>(null);
  const past = useScrolledPast(card);
  const { pathname } = useLocation();
  useRecordRecent(pathname, seen);
  const goBack = useGoBack(back.to);
  return (
    <header>
      <StickyTitle show={past} title={title} badges={badges} onBack={goBack} backLabel={back.label} />
      {/* 2026-11-24 사용자 "< 상담함 이건 왜 제목 위에 있는 거며" — 제목이 맨 위. 이전/다음은 오른쪽 위.
          같은 날 "세부 탭에 들어가고 나면 < 이런 뒤로가기 버튼이 어딘가에 있었으면" — 제목 바로 왼쪽에 둥근 ‹(내려가도 위 띠에 같은 단추) */}
      <div ref={card} className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <BackButton onClick={goBack} label={back.label} />
            <h1 className="text-2xl font-bold">{title}</h1>
            {badges}
          </div>
          {summary && <p className="text-[15px] text-base-content/80">{summary}</p>}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
            {/* 목록 순서대로 이전·n/N·다음([ ] 키) — 마지막으로 본 목록에 이 건이 있을 때만 */}
            <QueueNav />
          </div>
          {actions && <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>}
        </div>
      </div>
    </header>
  );
}

/**
 * 뒤로 — 앱 안에서 넘어왔으면 브라우저 뒤로(목록의 거르기·스크롤·펼친 줄이 그대로), 주소로 바로 열었으면 그 목록으로.
 * React Router 가 history.state.idx 에 앱 안 이동 순번을 적는다(0 = 이 탭의 첫 화면).
 */
export function useGoBack(fallback: string): () => void {
  const navigate = useNavigate();
  return () => {
    const idx = (window.history.state as { readonly idx?: number } | null)?.idx ?? 0;
    if (idx > 0) void navigate(-1);
    else void navigate(fallback);
  };
}

/** 제목 왼쪽 둥근 ‹ 단추(이름은 읽기 도구·마우스 올리면 — "라이더 찾기로" 등) */
export function BackButton({ onClick, label, small = false }: { readonly onClick: () => void; readonly label: string; readonly small?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid="detail-back"
      className={`btn btn-circle shrink-0 border-base-300 bg-base-100 ${small ? 'btn-xs text-base' : 'btn-sm text-xl'} leading-none`}
    >
      <span aria-hidden className="-mt-0.5">‹</span>
    </button>
  );
}

/**
 * 항목명/값(공용 FieldList 를 이 앱에서 덮음 — 2026-11-23 사용자 "칸으로 나눠놓은 건 좋은데 글이 2줄로 내려가니까 가독성이 떨어져").
 * 2026-11-23 사용자 "폰트 크기랑 색이 똑같아서 목록이랑 내용이 구분이 안 가" — 항목명은 작은 회색, 값은 조금 크고 굵은 짙은 글자.
 * 공용은 넓으면 4칸으로 고정이라, 반쪽 상자(배송 상세의 수행·배차 등)에서는 칸이 좁아 "11. 20. 오후 / 8:44" 처럼 꺾였다.
 * 여기서는 칸 폭을 최소 11rem 으로 두고 들어가는 만큼만 칸을 만든다(상자가 좁으면 2~3칸, 넓으면 4칸 이상). 모양(굵은 이름·값 아래·칸 사이 선)은 같다.
 */
export function FieldList({ rows, testId }: { readonly rows: ReadonlyArray<readonly [ReactNode, ReactNode] | false | null | undefined>; readonly testId?: string }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-y-4 text-sm [&>div]:border-l [&>div]:border-base-300 [&>div]:pl-4 [&>div]:pr-4" data-testid={testId}>
      {rows.map((r, i) =>
        r ? (
          <div key={i} className="min-w-0 space-y-0.5">
            <dt className="text-xs font-medium text-base-content/55">{r[0]}</dt>
            <dd className="min-w-0 break-words text-[15px] font-semibold text-base-content">{r[1]}</dd>
          </div>
        ) : null,
      )}
    </dl>
  );
}
