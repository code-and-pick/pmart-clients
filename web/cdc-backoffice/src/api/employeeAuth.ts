// 직원 로그인 employee-auth-service(공통: @pmart/web-core employeeAuth) — DC 백오피스의 앱 이름·보관 키.
// 백엔드 요청 clients/all/2026-11-25-request-cdc-backoffice §1: app=cdc-backoffice, SSO(두 백오피스와 Keycloak 세션을 같이 쓴다).
import { createEmployeeAuth } from '@pmart/web-core';

import { SOURCE_SYSTEM } from './command';

export { browser, CALLBACK_PATH, EmployeeLoginError, type EmployeeLoginErrorCode, type EmployeeSession } from '@pmart/web-core';

/** employee-auth 설정의 앱 이름(pmart.employee-auth.apps.cdc-backoffice) */
export const EMPLOYEE_APP = 'cdc-backoffice';
export const LOGIN_PENDING_KEY = 'pmart.cdc-backoffice.login.pending';
/** 이 탭에서 조용한 로그인 확인(silent)을 이미 했다는 표시 */
export const LOGIN_SILENT_KEY = 'pmart.cdc-backoffice.login.silent';

export const { beginEmployeeLogin, canTrySilentLogin, beginSilentEmployeeLogin, completeEmployeeLogin, refreshEmployeeTokens, logoutEmployee } = createEmployeeAuth({
  app: EMPLOYEE_APP,
  sourceSystem: SOURCE_SYSTEM,
  pendingKey: LOGIN_PENDING_KEY,
  silentKey: LOGIN_SILENT_KEY,
});
