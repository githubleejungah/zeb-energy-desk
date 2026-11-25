// 구독 정산 · 감면 · 마감 · 감사 (AC-25~35)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seed, D, fresh, run } from './helpers.mjs';
import { feeLines, preview, close, creditRate } from '../site/js/core/settlement.js';
import * as act from '../site/js/core/actions.js';
import * as audit from '../site/js/core/audit.js';

const golden = JSON.parse(readFileSync(new URL('./golden/settlement.json', import.meta.url), 'utf8'));
const line = (lines, c) => lines.find((l) => l.contractorId === c.contractorId && l.assetId === c.assetId);

test('test_ac25_ac26_ac27_정산 골든셋 100% 일치', () => {
  const lines = feeLines(seed, fresh().state, golden.month);
  for (const c of golden.cases) {
    const l = line(lines, c);
    assert.ok(l, c.name);
    for (const k of ['days', 'feeWon', 'creditWon', 'billedWon']) assert.equal(l[k], c[k], `${c.name}: ${k}`);
  }
  for (const id of golden.notBilled) assert.equal(lines.filter((l) => l.assetId === id).length, 0);
});

test('test_ac28_현장 원인 판정이면 감면 0원', () => {
  for (const c of golden.decided) {
    const st = { ...fresh().state, exceptionDecisions: { 'OC-SO-3': { decision: c.decision, decidedH: 0 } } };
    assert.equal(line(feeLines(seed, st, golden.month), c).creditWon, c.creditWon, c.name);
  }
});

test('test_ac29_감면은 그달 요금을 넘지 않음', () => {
  const s2 = { ...seed, config: { ...seed.config, creditTiers: [{ overHours: 0, rate: 2 }] } };
  for (const l of feeLines(s2, fresh().state, golden.month)) assert.ok(l.creditWon <= l.feeWon);
  assert.equal(creditRate(seed, 4), 0);
  assert.equal(creditRate(seed, 5), 0.1);
  assert.equal(creditRate(seed, 25), 0.3);
});

test('test_ac30_보인 금액과 다시 계산한 금액이 다르면 마감 잠금', () => {
  const st = fresh().state;
  const p = preview(seed, st, golden.month);
  const bad = close(seed, st, golden.month, D(31, 9), p.totalBilledWon + 1, []);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'mismatch');
  const good = close(seed, st, golden.month, D(31, 9), p.totalBilledWon, []);
  assert.equal(good.ok, true);
});

test('test_ac31_예외 5종 자동 분류 · 판정은 본사만', () => {
  const r = run(fresh().state);
  const types = new Set(r.snap.exceptions.map((e) => e.type));
  for (const t of ['장비 교체로 데이터 끊김', '소유주 변경', '시공사 계약 종료', '보증 만료 30일 이내', '원인 미판정 장애']) assert.ok(types.has(t), t);
  assert.ok(r.snap.exceptions.every((e) => e.decision === null));
});

test('test_ac32_열린 위험 항목이 있으면 마감 잠금', () => {
  const r = run(fresh().state);
  assert.ok(r.snap.lockReasons.length > 0);
  const res = act.closeMonth(seed, r.state, r.audit, { month: r.snap.closeMonth, shownTotalWon: r.snap.settlementPreview.totalBilledWon, lockReasons: r.snap.lockReasons });
  assert.equal(res.result.reason, 'locked');
});

test('test_ac33_마감 3초 이내 · 감사 기록', () => {
  const r = run(fresh().state);
  const t0 = performance.now();
  const res = act.closeMonth(seed, r.state, r.audit, { month: r.snap.closeMonth, shownTotalWon: r.snap.settlementPreview.totalBilledWon, lockReasons: [] });
  assert.ok(performance.now() - t0 < 3000);
  assert.equal(res.result.ok, true);
  assert.ok(res.audit.some((e) => e.action === 'settlement.close'));
});

test('test_ac34_감사 기록은 덧붙이기만 · 고치기 · 지우기 없음', () => {
  assert.deepEqual(Object.keys(audit).sort(), ['append', 'hasKey']);
  const a1 = audit.append([], { at: 1, role: 'hq', action: 'x', target: 'PV-01' });
  assert.throws(() => { a1[0].target = 'y'; });
  assert.throws(() => { a1.pop(); });
});

test('test_ac35_감사 기록에 연락처 · 이름 넣기 거부', () => {
  for (const bad of ['010-1234-5678', 'kim@example.com', '홍길동']) assert.throws(() => audit.append([], { at: 1, role: 'hq', action: 'x', target: bad }), bad);
});
