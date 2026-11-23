// 머리줄 "센터 고르기"(2026-11-23, RS-7 — 사용자 "센터를 고르면 그 해당 센터에 해당하는 라이더 정보를 볼 수 있게 … 여러 센터 라이더 다
// 보면 헷갈리지 않을까?"). 보기 거르기일 뿐 권한은 그대로(라이더 운영·관리자는 모든 센터를 볼 수 있다). 고른 값은 이 탭의 메모리에만 —
// 화면을 옮겨도 남고, 새로고침하면 "모든 센터"로 돌아간다(이 앱은 브라우저 저장소를 쓰지 않는다 — BR-03).
// 목록 화면은 useCenterQuery() 가 주는 { mfcId } 를 목록 호출에 붙인다("모든 센터"면 빈 객체라 붙지 않는다).
// 관제·대시보드는 주소의 ?mfcId= 가 먼저(찾기로 넘어온 센터) — 머리줄에서 바꾸면 주소도 그 센터로 바꾼다.
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { CenterPicker } from '../shared/opsUi';

interface CenterScopeValue {
  /** 고른 센터 ID, 모든 센터면 빈 글자 */
  readonly mfcId: string;
  readonly setMfcId: (v: string) => void;
}

const Ctx = createContext<CenterScopeValue>({ mfcId: '', setMfcId: () => {} });

export function CenterScopeProvider({ children, initial = '' }: { readonly children: ReactNode; readonly initial?: string }) {
  const [mfcId, setMfcId] = useState(initial);
  const value = useMemo(() => ({ mfcId, setMfcId }), [mfcId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useCenterScope = () => useContext(Ctx);

/** 목록 query 에 붙일 조각 — 모든 센터면 빈 객체 */
export function useCenterQuery(): { readonly mfcId?: string } {
  const { mfcId } = useCenterScope();
  return mfcId ? { mfcId } : {};
}

/** 주소에 ?mfcId= 를 쓰는 화면(관제·대시보드) — 머리줄에서 바꾸면 주소도 바꾼다 */
const URL_CENTER_PAGES = ['/control', '/dashboard'];

/** 머리줄 센터 고르기(모든 센터 + center-master MFC 목록) */
export function HeaderCenterPicker() {
  const { mfcId, setMfcId } = useCenterScope();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const urlMfc = new URLSearchParams(search).get('mfcId');
  const onUrlPage = URL_CENTER_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  return (
    // 좁은 화면에서는 칸을 줄인다(2026-11-23 — 390px 머리줄 넘침)
    <div data-testid="header-center" className="w-28 sm:w-auto">
      <CenterPicker
        value={onUrlPage && urlMfc ? urlMfc : mfcId}
        allowAll
        compact
        onChange={(v) => {
          setMfcId(v);
          if (onUrlPage && urlMfc !== null) void navigate(v ? `${pathname}?mfcId=${encodeURIComponent(v)}` : pathname, { replace: true });
        }}
      />
    </div>
  );
}
