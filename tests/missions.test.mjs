// 입주민 미션 · 포인트 · 이의 · 예산 · 단지 화면 (AC-36~45)
import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, D, fresh, run } from './helpers.mjs';
import { judge, missions } from '../site/js/core/settlement.js';
import { missionHourOf, complexGen, complexLoad } from '../site/js/core/telemetry.js';
import { forRole } from '../site/js/views.js';
import * as act from '../site/js/core/actions.js';

// 가짜 사용량: 평일 기준선은 시간당 1.0kWh(15분 0.25 × 4)
const fake = (todayQ) => (hid, d) => {
  const arr = new Array(96).fill(0.25);
  if (d === 100) for (let i = 0; i < 4; i++) arr[44 + i] = todayQ[i];
  return arr;
};

test('test_ac38_기준선 110% 이상이면 성공 · 미만이면 실패', () => {
  assert.equal(judge(seed, 'H', 100, 11, fake([0.275, 0.275, 0.275, 0.275])).verdict, 'success'); // 1.10
  assert.equal(judge(seed, 'H', 100, 11, fake([0.27, 0.27, 0.27, 0.27])).verdict, 'fail'); // 1.08
});

test('test_ac38_기준선에서 미션이 열린 날은 뺀다', () => {
  // 미션 날(사용량 2배)이 기준선에 섞이면 실패해야 할 값이, 빼면 성공이어야 한다.
  const missionDays = new Set([99, 98, 97]);
  const usage = (hid, d) => {
    const arr = new Array(96).fill(0.25);
    if (missionDays.has(d)) for (let i = 0; i < 4; i++) arr[44 + i] = 0.5;
    if (d === 100) for (let i = 0; i < 4; i++) arr[44 + i] = 0.3; // 1.2kWh
    return arr;
  };
  assert.equal(judge(seed, 'H', 100, 11, usage).verdict, 'fail'); // 미션 날이 섞인 기준선
  assert.equal(judge(seed, 'H', 100, 11, usage, (d) => missionDays.has(d)).verdict, 'success'); // 뺀 기준선
});

test('test_ac59_30일 안에 미션 없던 평일 5일을 못 채우면 판정 불가', () => {
  const r = judge(seed, 'H', 100, 11, fake([0.3, 0.3, 0.3, 0.3]), (d) => d >= 74); // 30일 거의 전부 미션 날
  assert.equal(r.verdict, 'undecidable');
  assert.equal(r.points, 0);
  assert.equal(seed.config.missionBaselineLookbackDays, 30);
});

test('test_ac39_15분 4칸 중 1칸이라도 비면 판정 불가 · 포인트 0', () => {
  const r = judge(seed, 'H', 100, 11, fake([0.3, null, 0.3, 0.3]));
  assert.equal(r.verdict, 'undecidable');
  assert.equal(r.points, 0);
  assert.equal(r.blanks, 1);
});

test('test_ac37_발전이 공용 사용을 넘는 시간에만 미션', () => {
  for (let day = 0; day < 31; day++) {
    const h = missionHourOf(seed, day);
    if (h === null) for (let x = 10; x < 15; x++) assert.ok(complexGen(seed, day, x) <= complexLoad(day, x));
    else assert.ok(complexGen(seed, day, h) > complexLoad(day, h));
  }
});

test('test_ac38_세대당 하루 1회 · 고정 포인트', () => {
  const m = missions(seed, fresh().state, seed.config.startH);
  const days = m.list.filter((x) => x.status === 'judged').map((x) => x.day);
  assert.equal(new Set(days).size, days.length);
  for (const x of m.list.filter((y) => y.status === 'judged')) for (const r of Object.values(x.results)) assert.ok(r.points === 0 || r.points === seed.config.missionPoints);
});

test('test_ac40_이의 제기 7일 안 1번 · 재심 1번 뒤 잠금', () => {
  const r = run(fresh().state);
  const m = r.snap.missions.list.filter((x) => x.status === 'judged').at(-1);
  const hid = Object.entries(m.results).find(([, v]) => v.verdict === 'fail')[0];
  let a = act.fileAppeal(r.state, m, hid);
  assert.equal(a.ok, true);
  assert.equal(act.fileAppeal(a.state, m, hid).ok, false); // 두 번째 거부
  const late = act.fileAppeal({ ...r.state, clockH: m.appealDueH + 1 }, m, hid);
  assert.equal(late.ok, false);
  const d = act.decideAppeal(a.state, r.audit, { missionDay: m.day, householdId: hid, decision: 'overturn' });
  const after = run(d.state, d.audit);
  const mm = after.snap.missions.list.find((x) => x.day === m.day);
  assert.equal(mm.results[hid].verdict, 'success');
  assert.equal(act.fileAppeal(d.state, mm, hid).ok, false); // 재심 뒤 잠금
});

test('test_ac41_예산이 1회 최대 지급액보다 적으면 새 미션 0개', () => {
  const st = { ...fresh().state, budgets: [{ partnerId: 'P1', approvedWon: 20000, approvedH: 0 }] };
  const m = missions(seed, st, seed.config.startH);
  assert.equal(m.list.filter((x) => x.status === 'judged').length, 0);
  assert.ok(m.list.some((x) => x.status === 'skipped_budget'));
});

test('test_ac44_승인한 예산 안에서만 지급 · 감사 기록', () => {
  const m = missions(seed, fresh().state, D(40, 0));
  assert.ok(m.spentWon <= m.approvedWon);
  const { state, audit } = fresh();
  const r = act.approveBudget(state, audit, { partnerId: 'P1', won: 100000 });
  assert.equal(r.state.budgets.length, state.budgets.length + 1);
  assert.equal(r.audit.at(-1).action, 'budget.approve');
});

test('test_ac36_입주민 화면은 1시간 합계만 · 태양광 비율', () => {
  const r = run(fresh().state);
  const v = forRole(seed, r.snap, 'resident', { householdId: 'H-0001' });
  assert.ok(Array.isArray(v.todayHourly) && v.todayHourly.length <= 24);
  assert.ok(v.solarSharePct >= 0 && v.solarSharePct <= 100);
});

test('test_ac42_미션 안내에 숫자 4가지', () => {
  const v = forRole(seed, run(fresh().state).snap, 'resident', {});
  for (const k of ['baselineDays', 'successPct', 'blanksRule', 'appealDays']) assert.ok(v.rules[k] !== undefined, k);
});

test('test_ac43_관리주체 화면 4가지', () => {
  const v = forRole(seed, run(fresh().state).snap, 'complex');
  assert.ok(v.today && v.commonAssets.length && Array.isArray(v.safetyAlarms) && v.budget);
  assert.equal(v.safetyAlarms[0].assetId, 'A-105');
});

test('test_ac45_제휴사 리포트는 합계 5가지만', () => {
  const v = forRole(seed, run(fresh().state).snap, 'complex');
  assert.deepEqual(Object.keys(v.partnerReport).sort(), ['movedKwh', 'paidWon', 'participantHouseholds', 'remainingWon', 'successCount']);
  for (const x of Object.values(v.partnerReport)) assert.equal(typeof x, 'number');
});
