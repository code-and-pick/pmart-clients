// 변경 명령 헬퍼(공통: @pmart/web-core) + DC 백오피스의 X-Source-System.
import { commandParamsFor } from '@pmart/web-core';

export { IdempotencyKey } from '@pmart/web-core';

/** 백엔드 요청 clients/all/2026-11-25-request-cdc-backoffice */
export const SOURCE_SYSTEM = 'cdc-backoffice-web';

/** openapi-fetch 호출용: `client.POST(path, { ...commandParams(key, { path: { operatorId }, version }), body })` */
export const commandParams = commandParamsFor(SOURCE_SYSTEM);
