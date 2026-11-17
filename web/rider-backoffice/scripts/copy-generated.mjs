// 생성 타입 가져오기: tools/web-tools gen-api 가 web/backoffice/src/api/generated 에 모든 계약을 만든다 —
// 이 앱이 쓰는 계약만 src/api/generated 로 복사한다(생성물은 커밋하지 않음 — .gitignore).
// gen-api.mjs 의 복사 대상(웹 공통, PC 2)을 고치지 않고 이 앱 안에서 가져온다(사용자 2026-11-17 "바로 가져올 수 있으면 가져와").
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = resolve(here, '../../backoffice/src/api/generated');
const to = resolve(here, '../src/api/generated');
const services = ['rider', 'delivery-execution', 'delivery-dispatch', 'delivery-tracking', 'case', 'backoffice-bff'];

mkdirSync(to, { recursive: true });
const missing = services.filter((s) => !existsSync(join(from, `${s}.ts`)));
if (missing.length > 0) {
  console.error(`생성 타입이 없다: ${missing.join(', ')} — 먼저 tools/web-tools gen-api 를 돌린다.`);
  process.exit(1);
}
for (const s of services) copyFileSync(join(from, `${s}.ts`), join(to, `${s}.ts`));
console.log(`web/rider-backoffice: ${services.join(', ')}`);
