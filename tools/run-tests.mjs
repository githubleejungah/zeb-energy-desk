// 시험을 모두 돌려 결과 파일 1개를 남긴다(AC-56). 건너뛴 시험은 통과로 세지 않는다.
import { run } from 'node:test';
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('../tests/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const files = readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).map((f) => join(dir, f));
const tests = [];
const stream = run({ files });
stream.on('test:pass', (e) => { if (e.details?.type !== 'suite') tests.push({ name: e.name, result: e.skip || e.todo ? 'skipped' : 'pass' }); });
stream.on('test:fail', (e) => { if (e.details?.type !== 'suite') tests.push({ name: e.name, result: 'fail', error: String(e.details?.error?.cause ?? e.details?.error?.message ?? '').slice(0, 300) }); });
stream.on('end', () => {
  const pass = tests.filter((t) => t.result === 'pass').length;
  const fail = tests.filter((t) => t.result === 'fail').length;
  const skipped = tests.filter((t) => t.result === 'skipped').length;
  const out = { at: new Date().toISOString(), total: tests.length, pass, fail, skipped, ok: fail === 0 && skipped === 0, tests };
  mkdirSync(new URL('../tmp/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../tmp/test-results.json', import.meta.url), JSON.stringify(out, null, 2));
  for (const t of tests.filter((x) => x.result !== 'pass')) console.log(`${t.result.toUpperCase()} ${t.name} ${t.error ?? ''}`);
  console.log(`시험 ${tests.length}개 · 통과 ${pass} · 실패 ${fail} · 건너뜀 ${skipped}`);
  process.exitCode = out.ok ? 0 : 1;
});
stream.resume();
