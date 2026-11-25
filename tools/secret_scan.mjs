// 비밀값 검사(AC-54). 찾은 값은 출력하지 않고 파일:줄과 규칙 이름만 적는다.
// 사용: node tools/secret_scan.mjs [폴더]  → 찾으면 종료 코드 1
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const RULES = [
  ['AWS 키', /AKIA[0-9A-Z]{16}/],
  ['개인 키', /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ['Anthropic 키', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['sk- 계열 키', /\bsk-[A-Za-z0-9]{32,}/],
  ['GitHub 토큰', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['Azure 계정 키', /AccountKey=[A-Za-z0-9+/=]{40,}/],
  ['비밀번호 든 주소', /[a-z]+:\/\/[^\s:@/]+:[^\s@/]+@/i],
  ['비밀번호 대입', /(password|passwd|secret|api[_-]?key)\s*[:=]\s*["'][^"']{6,}["']/i],
];
const SKIP_DIR = new Set(['.git', 'node_modules', 'tmp']);
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.zip', '.ico', '.woff', '.woff2']);

const root = process.argv[2] ?? '.';
const findings = [];
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    if (SKIP_DIR.has(f)) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (SKIP_EXT.has(extname(f).toLowerCase())) continue;
    if (p.endsWith(join('tools', 'secret_scan.mjs'))) continue; // 규칙 자신
    readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      for (const [name, re] of RULES) if (re.test(line)) findings.push(`${relative(root, p)}:${i + 1} ${name}`);
    });
  }
};
walk(root);
for (const f of findings) console.log(f);
console.log(`secret_scan: ${findings.length} finding(s)`);
process.exit(findings.length ? 1 : 0);
