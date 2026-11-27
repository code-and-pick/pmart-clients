// 머리줄 "센터 고르기"(2026-11-23, RS-7 — 사용자 "센터를 고르면 그 해당 센터에 해당하는 라이더 정보를 볼 수 있게 … 여러 센터 라이더 다
// 보면 헷갈리지 않을까?"). 보기 거르기일 뿐 권한은 그대로(라이더 운영·관리자는 모든 센터를 볼 수 있다). 고른 값은 이 탭의 메모리에만 —
// 화면을 옮겨도 남고, 새로고침하면 처음 기본으로 돌아간다(이 앱은 브라우저 저장소를 쓰지 않는다 — BR-03).
// 목록 화면은 useCenterQuery() 가 주는 { mfcId } 를 목록 호출에 붙인다("모든 센터"면 빈 객체라 붙지 않는다).
// 관제·대시보드는 주소의 ?mfcId= 가 먼저(찾기로 넘어온 센터) — 머리줄에서 바꾸면 주소도 그 센터로 바꾼다.
// 2026-11-27 사용자 "대시보드·관제는 부산진구인데 운영 통계·배송 관리는 모든 센터 — 같은 센터로 고정": 처음 열 때 머리줄 기본을
// 주소의 센터, 없으면 이름에 "부산진구"가 든 센터로(관제 기본과 같게, 없으면 모든 센터 그대로). 한 번 정한 뒤(사람이 "모든 센터"를
// 고른 것 포함)는 다시 덮지 않는다.
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { request } from '@pmart/web-core';
import { useApi } from './ApiContext';
import { CenterPicker } from '../shared/opsUi';

/** 처음 고를 센터 이름(관제 기본과 같음 — 2026-11-24 사용자 "기본은 부산 진구로 해") */
export const DEFAULT_CENTER_NAME = '부산진구';

interface CenterScopeValue {
  /** 고른 센터 ID, 모든 센터면 빈 글자 */
  readonly mfcId: string;
  readonly setMfcId: (v: string) => void;
  /** 처음 열 때 고를 센터 이름(빈 글자면 모든 센터 그대로) */
  readonly defaultCenterName: string;
}

const Ctx = createContext<CenterScopeValue>({ mfcId: '', setMfcId: () => {}, defaultCenterName: '' });

export function CenterScopeProvider({
  children,
  initial = '',
  defaultCenterName = DEFAULT_CENTER_NAME,
}: {
  readonly children: ReactNode;
  readonly initial?: string;
  readonly defaultCenterName?: string;
}) {
  const [mfcId, setMfcId] = useState(initial);
  const value = useMemo(() => ({ mfcId, setMfcId, defaultCenterName: initial ? '' : defaultCenterName }), [mfcId, initial, defaultCenterName]);
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
  const { mfcId, setMfcId, defaultCenterName } = useCenterScope();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const urlMfc = new URLSearchParams(search).get('mfcId');
  const api = useApi();
  const centers = useQuery({
    queryKey: ['centers', 'MFC'],
    queryFn: () => request('GET', api.center.GET('/centers', { params: { query: { type: 'MFC' } } })),
    staleTime: 5 * 60_000,
    enabled: defaultCenterName !== '',
  });
  // 처음 한 번만 — 이미 고른 값이 있으면 그대로, 주소에 센터가 있으면 그 센터, 아니면 기본 센터
  const defaulted = useRef(false);
  useEffect(() => {
    if (defaulted.current || !defaultCenterName || !centers.data) return;
    defaulted.current = true;
    if (mfcId) return;
    const hit = (centers.data.items ?? []).find((c) => (c.name ?? '').replace(/\s/g, '').includes(defaultCenterName));
    const pick = urlMfc || hit?.centerId;
    if (pick) setMfcId(pick);
  }, [centers.data, defaultCenterName, mfcId, urlMfc, setMfcId]);
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
