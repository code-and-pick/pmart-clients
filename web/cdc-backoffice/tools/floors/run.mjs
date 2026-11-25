// 센터별 도면 JSON 만들기 — 시뮬레이터 평면이 바뀌면 다시 돌린다.
//   node tools/floors/run.mjs ../../../pmart-cdc-simulation/src "pmart-cdc-simulation <커밋>"
// 시뮬레이터 저장소는 읽기만 한다(로컬이 뒤처져 있으면 `git archive origin/main src | tar -x -C <임시>` 로 푼 폴더를 준다).
// 결과: src/features/floor/layouts/<센터 ID>.json (커밋한다 — DC 평면도 화면이 이 파일로 그린다).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'rolldown';

const here = dirname(fileURLToPath(import.meta.url));
const [, , simSrc, source = 'pmart-cdc-simulation'] = process.argv;
if (!simSrc) {
  console.error('사용: node tools/floors/run.mjs <시뮬레이터 src 폴더> [출처]');
  process.exit(2);
}
const outFile = join(tmpdir(), `pm-floors-${process.pid}.mjs`);
await build({
  input: join(here, 'export.ts'),
  resolve: { alias: { sim: resolve(simSrc) } },
  output: { file: outFile, format: 'esm' },
  logLevel: 'warn',
});
const { exportFloors } = await import(pathToFileURL(outFile).href);
rmSync(outFile, { force: true });
const outDir = join(here, '../../src/features/floor/layouts');
mkdirSync(outDir, { recursive: true });
for (const f of exportFloors(source)) {
  writeFileSync(join(outDir, `${f.id}.json`), JSON.stringify(f.json) + '\n');
  console.log(f.summary);
}
