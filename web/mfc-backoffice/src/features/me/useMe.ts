// 내 인사 정보(GET /hr/employees/me — 모든 직원). 인사 기록이 없는 계정은 404 → 오류가 아니라 "기록 없음"(null).
// 내 정보 화면과 머리줄 내 정보 메뉴가 같은 queryKey 로 함께 쓴다(2026-11-23).
import { useQuery } from '@tanstack/react-query';

import { ProblemCode, ProblemFailure, request } from '@pmart/web-core';
import type { components } from '../../api/generated/hr';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';

export type EmployeeSelf = components['schemas']['EmployeeSelf'];

export function useMe() {
  const api = useApi();
  const { session } = useSession();
  return useQuery({
    queryKey: ['hr', 'me', session?.subject],
    enabled: session !== null,
    queryFn: async (): Promise<EmployeeSelf | null> => {
      try {
        return await request('GET', api.hr.GET('/hr/employees/me', {}));
      } catch (e) {
        if (e instanceof ProblemFailure && e.problem.code === ProblemCode.notFound) return null;
        throw e;
      }
    },
  });
}
