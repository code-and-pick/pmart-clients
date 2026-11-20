// 진행 단계 줄 — 2026-11-20 AWS 개편 때 공용(web/ui/src/ProgressSteps.tsx)에서 이 앱 사본으로(공용은 다른 앱이 써서 그대로).
// 주문 진행(OrderProgress)과 승인 진행이 같이 쓴다. 서버 상태를 단계 자리로 바꾸는 일은 부르는 쪽이 한다.
// 모양(AWS Status indicator 줄): 큰 동그라미·고리 대신 한 줄에 작은 아이콘 + 이름, 단계 사이 가는 선. 끝난 단계 초록 ✓, 지금 단계 파랑(주의면 노랑), 남은 단계 회색.
// 모르는 상태는 단계를 칠하지 않고 아래에 그 값을 그대로 적는다. 시험이 찾는 표시(data-step-state·step-check·step-pulse·aria-current)는 공용과 같다.
export interface StepPlace {
  readonly step: number;
  readonly done: boolean;
  readonly note?: string;
  readonly warn?: boolean;
}

export function ProgressSteps({
  steps,
  place,
  ended,
  unknownText,
  label,
  testId,
  endedTestId,
}: {
  readonly steps: readonly string[];
  readonly place: StepPlace | null;
  /** 단계 밖으로 끝남(취소·반려 등) — 끝에 빨강 ✕ */
  readonly ended?: string | undefined;
  readonly unknownText?: string | undefined;
  readonly label: string;
  readonly testId: string;
  readonly endedTestId: string;
}) {
  return (
    <section aria-label={label} className="rounded-box border border-base-300 bg-base-100 px-5 py-3" data-testid={testId}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {steps.map((name, i) => {
          const state = !place ? 'todo' : i < place.step || (i === place.step && place.done) ? 'done' : i === place.step ? 'now' : 'todo';
          const warnText = 'text-[color-mix(in_oklab,var(--color-warning)_60%,var(--color-base-content))]';
          const tone = state === 'done' ? 'text-success' : state === 'now' ? (place?.warn ? warnText : 'text-primary') : 'text-base-content/45';
          // 앞 단계와 잇는 선 — 이 단계에 닿았으면 초록
          const line = place && i <= place.step ? 'bg-success' : 'bg-base-300';
          return (
            <li key={name} className="flex items-center gap-2" aria-current={state === 'now' ? 'step' : undefined} data-step-state={state}>
              {i > 0 && <span className={`h-px w-6 sm:w-10 ${line}`} aria-hidden="true" data-step-line />}
              <span className={`inline-flex items-center gap-1.5 text-sm ${tone} ${state === 'now' ? 'font-bold' : ''}`}>
                <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
                  {state === 'done' ? (
                    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" data-testid="step-check">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M8 12.5l2.5 2.5L16 9.5" />
                    </svg>
                  ) : state === 'now' ? (
                    <>
                      {/* 진행 중 표시 — 지금 단계에서만 고리가 천천히 퍼진다(움직임 줄이기면 없음) */}
                      <span className="step-pulse" data-testid="step-pulse" />
                      <span className={`relative flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white ${place?.warn ? 'bg-warning' : 'bg-primary'}`}>{i + 1}</span>
                    </>
                  ) : (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-[11px]">{i + 1}</span>
                  )}
                </span>
                <span className={state === 'done' ? 'text-base-content/80' : ''}>{name}</span>
              </span>
              {state === 'now' && place?.note && <span className={`text-xs ${place.warn ? warnText : 'text-base-content/60'}`}>({place.note})</span>}
            </li>
          );
        })}
        {ended && (
          <li className="flex items-center gap-2" data-testid={endedTestId}>
            <span className="h-px w-6 bg-error sm:w-10" aria-hidden="true" />
            <span className="inline-flex items-center gap-1.5 text-sm font-bold text-error">
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M9 9l6 6M15 9l-6 6" />
              </svg>
              {ended}
            </span>
          </li>
        )}
      </ol>
      {!place && !ended && unknownText && <p className="mt-2 text-xs text-base-content/55">{unknownText}</p>}
    </section>
  );
}
