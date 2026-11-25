// 끝 조건 · 담당 · 공정성 보강 (AC-69~79, AC-20 · AC-32 바뀐 문장) — 요구 Q18
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seed, D, fresh, run } from './helpers.mjs';
import { forRole } from '../site/js/views.js';
import * as act from '../site/js/core/actions.js';
import { alarmOrder } from '../site/js/core/alarms.js';
import { missions, joined } from '../site/js/core/settlement.js';
import { baselineHourly, BaselineExpiredError, householdIds } from '../site/js/core/raw.js';

const at = (h) => ({ ...fresh().state, clockH: h });
const alarmOf = (r, id) => r.snap.alarms.find((a) => a.assetId === id);
// 시험용 기준 데이터: 고장을 하나 더 넣는다(원본 seed는 그대로)
const withFault = (f) => ({ ...seed, faults: [...seed.faults, f] });

test('test_ac69_기한 넘긴 작업 지시: 본사 지정 뒤 새 기한 7일, 그 전에는 다시 안 올림', () => {
  let st = at(D(36, 0));
  let r = run(st);
  assert.equal(r.snap.workOrders.find((w) => w.assetId === 'PV-11').status, '본사대기');
  st = act.confirmDispatch(st, [], { keys: ['PV-11:comm'], by: 'K1', role: 'hq' }).state;
  for (const hours of [1, 24, 6 * 24]) {
    const w = run(act.advanceClock(st, hours)).snap.workOrders.find((x) => x.assetId === 'PV-11');
    assert.equal(w.status, '출동확정', `+${hours}시간`);
  }
  const w7 = run(act.advanceClock(st, 7 * 24)).snap.workOrders.find((x) => x.assetId === 'PV-11');
  assert.equal(w7.status, '본사대기'); // 새 기한에서 1번
  assert.equal(w7.dueH, D(36, 0) + seed.config.workOrderDueHours);
});

test('test_ac70_출동 확정 뒤 7일 조치 없으면 본사로 1번', () => {
  const st = act.confirmDispatch(fresh().state, [], { keys: ['PV-15:low'], by: 'K2', role: 'hq' }).state;
  assert.equal(alarmOf(run(act.advanceClock(st, 7 * 24 - 1)), 'PV-15').status, '출동확정');
  const a = alarmOf(run(act.advanceClock(st, 7 * 24)), 'PV-15');
  assert.equal(a.status, '본사대기');
  assert.match(a.escalateReason, /출동 확정 뒤 7일 조치 없음/);
});

test('test_ac71_본사가 지정한 시공사 화면에 보임 · 감사 기록 1줄', () => {
  const { state, audit } = act.confirmDispatch(fresh().state, [], { keys: ['PV-15:low'], by: 'K2', role: 'hq' });
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, 'assign.change');
  const r = run(state);
  const k2 = forRole(seed, r.snap, 'contractor', { contractorId: 'K2' });
  assert.ok(k2.alarms.some((a) => a.assetId === 'PV-15' && a.assignee === 'K2'));
});

test('test_ac72_본사가 맡은 알람은 본사가 조치 입력', () => {
  let st = act.confirmDispatch(fresh().state, [], { keys: ['PV-15:low'], by: 'HQ', role: 'hq' }).state;
  const hq = forRole(seed, run(st).snap, 'hq', { audit: [] });
  const a = hq.alarms.find((x) => x.assetId === 'PV-15');
  assert.equal(a.assignee, 'HQ');
  assert.equal(a.status, '출동확정');
  st = act.enterResult(st, { key: 'PV-15:low', memo: '본사 원격 재시작' });
  assert.equal(alarmOf(run(st), 'PV-15').status, '조치입력');
});

test('test_ac73_관리 종료(철거 안내) 설비는 일반 알람 0건 · 안전은 그대로 · 청구 안 함', () => {
  const s = withFault({ id: 'TX', assetId: 'PV-32', type: 'low', factor: 0, fromH: D(32, 10), toH: null });
  const s2 = { ...s, faults: [...s.faults, { id: 'TS', assetId: 'PV-32', type: 'safety', fromH: D(33, 9), toH: D(33, 11) }] };
  let st = act.decideException(at(D(31, 9)), [], { id: 'HT-PV-32', decision: '철거 안내' }).state;
  st = act.advanceClock(st, 2 * 24 + 1); // 9/3 10:00 — 저하 감지 뒤, 안전 신호 중
  const r = run(st, [], s2);
  assert.equal(r.snap.owners['PV-32'], 'END');
  const pv32 = r.snap.alarms.filter((a) => a.assetId === 'PV-32');
  assert.ok(pv32.every((a) => a.cause === 'safety'));
  assert.ok(pv32.some((a) => a.cause === 'safety' && a.status === '본사대기'));
  assert.ok(!r.snap.settlementPreview.lines.some((l) => l.assetId === 'PV-32'));
});

test('test_ac74_공공 기관 배정 → 일반 알람은 기관 전달, 본사 대기 0건', () => {
  const s = withFault({ id: 'TX', assetId: 'PV-32', type: 'low', factor: 0, fromH: D(32, 10), toH: null });
  let st = act.decideException(at(D(31, 9)), [], { id: 'HT-PV-32', decision: '공공 기관 배정' }).state;
  st = act.advanceClock(st, 5 * 24);
  const r = run(st, [], s);
  const a = r.snap.alarms.find((x) => x.assetId === 'PV-32');
  assert.equal(a.status, '기관전달'); // 48시간이 지나도 본사로 안 감
  const hq = forRole(seed, r.snap, 'hq', { audit: [] });
  assert.ok(!hq.queue.some((q) => q.assetId === 'PV-32'));
});

test('test_ac75_기준선용 1시간 합계: 30일 안은 읽고, 더 오래된 날은 거부 · 원본 삭제 뒤에도 판정', () => {
  const asOf = D(40, 11);
  assert.equal(baselineHourly(seed, 'H-0001', 40 - 30, asOf).length, 24);
  assert.throws(() => baselineHourly(seed, 'H-0001', 40 - 31, asOf), BaselineExpiredError);
  // 8월 15분 원본을 지운 뒤 9월 미션: 기준선(8월 평일)을 1시간 합계로 찾아 판정한다
  const m = missions(seed, fresh().state, D(38, 20), ['2026-08']);
  const sept = m.list.filter((x) => x.status === 'judged' && x.day >= 31);
  assert.ok(sept.length >= 1);
  for (const x of sept) assert.ok(x.counts.success > x.counts.undecidable, `day ${x.day}`);
});

test('test_ac76_신청한 세대만 판정 · 신청 전 미션은 판정 0건', () => {
  const ids = householdIds(seed.complex.households);
  const st = fresh().state;
  const off = ids.find((h) => !joined(seed, st, h, 0));
  const on = ids.find((h) => joined(seed, st, h, 0));
  const r = run(st);
  const judged = r.snap.missions.list.filter((m) => m.status === 'judged');
  assert.ok(judged.length > 0);
  for (const m of judged) { assert.ok(!(off in m.results)); assert.ok(on in m.results); }
  const v = forRole(seed, r.snap, 'resident', { householdId: off });
  assert.equal(v.joined, false);
  assert.ok(v.missions.filter((m) => m.status === 'judged').every((m) => m.verdict === 'not_joined' && m.points === 0));
  // 신청하면 그 뒤 미션부터
  const st2 = act.setOptIn(st, { householdId: off, on: true });
  assert.equal(joined(seed, st2, off, st2.clockH), true);
  assert.equal(joined(seed, st2, off, st2.clockH - 1), false);
});

test('test_ac77_지열 · 충전기는 금액 없이 시간으로', () => {
  const r = run(at(D(30, 12)));
  const geo = alarmOf(r, 'GEO-1');
  assert.equal(geo.lossWon, null);
  assert.equal(geo.dayLossWon, null);
  assert.ok(geo.impactHours > 0);
  const v = forRole(seed, r.snap, 'complex');
  assert.equal(v.commonAlarms.find((a) => a.assetId === 'GEO-1').dayLossWon, null);
});

test('test_ac78_정렬: 안전 → 금액 있는 알람(큰 순) → 금액 없는 알람(오래된 순)', () => {
  const list = [
    { cause: 'low', lossWon: null, firstH: 20 }, { cause: 'low', lossWon: 100, firstH: 5 }, { cause: 'safety', lossWon: 0, firstH: 30 },
    { cause: 'comm', lossWon: 900, firstH: 9 }, { cause: 'low', lossWon: null, firstH: 3 },
  ].sort(alarmOrder);
  assert.deepEqual(list.map((a) => [a.cause, a.lossWon, a.firstH]), [['safety', 0, 30], ['comm', 900, 9], ['low', 100, 5], ['low', null, 3], ['low', null, 20]]);
  const r = run(at(D(30, 12)));
  const idx = r.snap.alarms.findIndex((a) => a.assetId === 'GEO-1');
  assert.ok(r.snap.alarms.slice(0, idx).every((a) => a.cause === 'safety' || a.lossWon !== null));
});

test('test_ac79_24시간 이어서 정상이면 자동 회복 종결 · 감사 기록 1줄', () => {
  assert.equal(alarmOf(run(at(D(31, 7))), 'GEO-1')?.status, '열림'); // 회복 뒤 23시간
  const r = run(at(D(31, 8)));
  assert.ok(!alarmOf(r, 'GEO-1'));
  assert.ok(r.snap.closedAlarms.some((c) => c.assetId === 'GEO-1' && c.closeReason === '자동 회복'));
  assert.equal(r.audit.filter((e) => e.action === 'alarm.autoclose' && e.target === 'GEO-1:low').length, 1);
  const again = run(r.state, r.audit);
  assert.equal(again.audit.filter((e) => e.action === 'alarm.autoclose' && e.target === 'GEO-1:low').length, 1); // 한 번만
});

test('test_ac32_마감 잠금은 그달 말일까지 생긴 것만 · 재심 대기 포함', () => {
  const r = run(fresh().state);
  assert.ok(!r.snap.lockReasons.some((x) => x.includes('A-105'))); // 9/1 08시 안전 알람은 8월 마감을 막지 않음
  assert.ok(r.snap.lockReasons.some((x) => x.includes('PV-15')));
  const st = { ...fresh().state, appeals: [{ missionDay: 20, householdId: 'H-0002', filedH: D(25, 0), decision: null, decidedH: null }] };
  assert.ok(run(st).snap.lockReasons.some((x) => x.startsWith('재심 대기')));
});

test('test_ac20_지도 범례 색 4종 이름', () => {
  const src = readFileSync(new URL('../site/js/ui/map.js', import.meta.url), 'utf8');
  assert.match(src, /safety: '안전', fault: '고장', estimated: '손실 추정\(끊김\)', normal: '정상'/);
});

// 끝 조건 끝까지 돌리기: 사람이 아무것도 안 해도 모든 알람이 사람이 처리할 상태(본사 대기 등)에 닿고,
// 본사가 매일 처리하면 8월 마감이 풀린다.
test('test_ac15_ac65_ac70_끝 조건: 손대지 않으면 모두 본사 대기 · 보류 · 기관 전달로 모인다', () => {
  const r = run(act.advanceClock(fresh().state, 20 * 24));
  const cfg = seed.config;
  for (const a of r.snap.alarms) {
    if (a.status === '열림') assert.ok(r.snap.now - a.openedH < cfg.dispatchConfirmHours, `${a.id} 열림 ${r.snap.now - a.openedH}시간`);
    else if (a.status === '출동확정') assert.ok(r.snap.now - a.confirmedH < cfg.resultDueHours, a.id);
    else assert.ok(['본사대기', '보류', '기관전달', '묶임', '조치입력'].includes(a.status), `${a.id} ${a.status}`);
  }
});

test('test_ac32_ac69_ac72_끝 조건: 본사가 매일 처리하면 8월 마감이 풀린다', () => {
  let { state, audit } = fresh();
  let closed = false;
  for (let day = 0; day < 10 && !closed; day++) {
    let r = run(state, audit);
    ({ state, audit } = r);
    const hq = forRole(seed, r.snap, 'hq', { audit });
    for (const q of hq.queue) ({ state, audit } = act.confirmDispatch(state, audit, { keys: [q.key], by: 'HQ', role: 'hq' }));
    for (const e of hq.exceptions.filter((x) => !x.decision)) ({ state, audit } = act.decideException(state, audit, { id: e.id, decision: e.options[0] }));
    r = run(state, audit);
    for (const a of r.snap.alarms.filter((x) => x.assignee === 'HQ' && x.status === '출동확정')) state = act.enterResult(state, { key: a.key, memo: '본사 처리' });
    r = run(state, audit);
    ({ state, audit } = r);
    if (r.snap.lockReasons.length === 0) {
      const c = act.closeMonth(seed, state, audit, { month: r.snap.closeMonth, shownTotalWon: r.snap.settlementPreview.totalBilledWon, lockReasons: r.snap.lockReasons });
      closed = c.result.ok;
      ({ state, audit } = c);
    } else state = act.advanceClock(state, 24);
  }
  assert.equal(closed, true);
});
