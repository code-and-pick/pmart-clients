// 앱 고유의 code → 문구 표를 공통 컴포넌트(FailureAlert)에 넘긴다. 분기는 code 로만 한다.
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';

import { watchTableFit } from './tableFit';

export interface UiText {
  /** Problem code → 문구. 없는 code 는 일반 문구 + code 표시 */
  readonly problem: Readonly<Record<string, string>>;
  /** 행별 거절·검증 사유 code → 문구. 없는 code 는 code 그대로 */
  readonly reason: Readonly<Record<string, string>>;
}

const UiTextContext = createContext<UiText>({ problem: {}, reason: {} });

export function UiTextProvider({
  problem,
  reason = {},
  children,
}: {
  readonly problem: Readonly<Record<string, string>>;
  readonly reason?: Readonly<Record<string, string>>;
  readonly children: ReactNode;
}) {
  const value = useMemo(() => ({ problem, reason }), [problem, reason]);
  // 넓은 표 표시(2026-11-21, tableFit.ts) — 네 앱 모두 맨 바깥에 이 공급자를 두므로 여기서 한 번 켠다
  useEffect(() => watchTableFit(), []);
  return <UiTextContext value={value}>{children}</UiTextContext>;
}

export const useUiText = () => useContext(UiTextContext);
