// 목 모드 직원 계정(로그인 화면의 버튼). 역할 이름은 백엔드 handoff 2026-10-30 §2(설정값이라 바뀔 수 있음).
// 비밀번호는 없다 — 목 모드에는 Keycloak 이 없어 버튼이 목 티켓으로 바로 로그인한다(mocks/authHandlers.ts).
import { mockOperatorToken } from '@pmart/web-core';

export const mockAccounts = [
  { operatorId: 'op-admin-1', label: '관리자', roles: ['OPERATOR_ADMIN'], centers: [] },
  { operatorId: 'op-md-1', label: 'MD 김', roles: ['MD'], centers: [] },
  { operatorId: 'op-approver-1', label: '승인자 이', roles: ['PRODUCT_APPROVER', 'DISPLAY_APPROVER', 'PRICE_APPROVER'], centers: [] },
  { operatorId: 'op-center-1', label: '센터 박', roles: [], centers: ['MFC-BSN-01', 'CDC01'] },
  // 고객센터 상담원(백엔드 요청 2026-11-09 customer-inquiry-page §2)
  { operatorId: 'op-cs-1', label: '상담원 최', roles: ['CS_AGENT'], centers: [] },
  // 라이더 운영(백엔드 요청 2026-11-15 cs-rider-menus §4 — LAN 시험 계정 test-cs-rider 는 CS_AGENT·RIDER_OPS 둘 다)
  { operatorId: 'op-rider-ops-1', label: '라이더 운영 정', roles: ['RIDER_OPS'], centers: [] },
  { operatorId: 'op-cs-rider-1', label: '상담·라이더운영 한', roles: ['CS_AGENT', 'RIDER_OPS'], centers: [] },
  // 마케팅(행사·쿠폰, ADR-0082 — employee-auth 역할 MARKETING, 2026-11-20). 행사 만들기·제출·승인(남의 것)·지정 발급
  { operatorId: 'op-marketing-1', label: '마케팅 윤', roles: ['MARKETING'], centers: [] },
  { operatorId: 'op-marketing-2', label: '마케팅 서', roles: ['MARKETING'], centers: [] },
  // 두 번째 운영 관리자 — 운영자 RAG 문서 승인(자기 승인 금지라 다른 관리자가 승인, ADR-0092 2026-11-28)
  { operatorId: 'op-admin-2', label: '총괄 오', roles: ['OPERATOR_ADMIN'], centers: [] },
] as const;

/** 테스트용: 로그인 없이 바로 세션을 여는 목 access token */
export const mockOperators = mockAccounts;

export const mockTokenFor = (o: (typeof mockAccounts)[number], sid = `sess-${o.operatorId}`) =>
  mockOperatorToken({ sub: o.operatorId, roles: o.roles, centers: o.centers, sid });
