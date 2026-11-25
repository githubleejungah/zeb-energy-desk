// 현장 1차 확인 · 보류 · 하루 손실 · 본사 임시 관리 기한 (AC-60~67)
import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, D, fresh, run } from './helpers.mjs';
import { forRole } from '../site/js/views.js';
import * as act from '../site/js/core/actions.js';

const now = seed.config.startH;
const complexView = (r) => forRole(seed, r.snap, 'complex');

test('test_ac60_공용 설비 일반 알람에 설비 종류별 1차 확인 체크리스트 3개', () => {
  const v = complexView(run({ ...fresh().state, clockH: D(30, 12) })); // GEO-1 저하가 열려 있는 때(8/31 12시)
  assert.deepEqual(v.commonAlarms.find((x) => x.assetId === 'GEO-1').checklist, ['운전 표시등', '차단기', '통신 장치 전원']);
  assert.deepEqual(complexView(run(fresh().state)).commonAlarms.find((x) => x.assetId === 'A-103').checklist, ['인버터 표시등', '차단기', '통신 장치 전원']);
  assert.ok(!v.commonAlarms.some((x) => x.assetId.startsWith('PV-'))); // 단독주택 설비는 관리주체 화면에 없음
});

test('test_ac61_해결 → 조치입력 → 조치 뒤 첫 해 뜬 시간 복귀 확인으로 종결', () => {
  // GEO-1 저하는 8/31 08시에 끝남 → 8/31 12시 '해결' → 9/1 07시 확인에서 종결(자동 회복 9/1 08시보다 먼저)
  let st = act.siteCheck({ ...fresh().state, clockH: D(30, 12) }, { key: 'GEO-1:low', result: 'solved', items: ['차단기'] });
  let r = run(st);
  assert.equal(r.snap.alarms.find((a) => a.assetId === 'GEO-1').status, '조치입력');
  st = act.advanceClock(st, 19); // 9/1 07시
  r = run(st);
  assert.ok(!r.snap.alarms.some((a) => a.assetId === 'GEO-1'));
  assert.ok(r.snap.closedAlarms.some((a) => a.assetId === 'GEO-1' && a.status === '종결' && a.closedH === D(31, 7) && !a.closeReason));
});

test('test_ac62_안 됨 → 시공사 화면에 1줄 · 상태 그대로', () => {
  const before = run(fresh().state).snap.alarms.find((a) => a.assetId === 'A-103').status;
  const r = run(act.siteCheck(fresh().state, { key: 'A-103:comm', result: 'failed' }));
  const a = forRole(seed, r.snap, 'contractor', { contractorId: 'K1' }).alarms.find((x) => x.assetId === 'A-103');
  assert.equal(a.siteCheck.result, 'failed');
  assert.equal(a.status, before);
});

test('test_ac63_안전 알람은 체크리스트 0개 · 전문가만', () => {
  const a = complexView(run(fresh().state)).commonAlarms.find((x) => x.assetId === 'A-105');
  assert.equal(a.checklist.length, 0);
  assert.equal(a.expertOnly, true);
  const r = run(act.siteCheck(fresh().state, { key: 'A-105:safety', result: 'solved' }));
  assert.equal(r.snap.alarms.find((x) => x.assetId === 'A-105').status, '본사대기'); // 규칙이 무시
});

test('test_ac64_보류 → 48시간 올림 멈춤 · 감사 기록', () => {
  let { state, audit } = fresh();
  ({ state, audit } = act.holdAlarm(state, audit, { key: 'PV-07:comm', by: 'K1' }));
  assert.equal(audit.at(-1).action, 'alarm.hold');
  const r = run(act.advanceClock(state, 72));
  const a = r.snap.alarms.find((x) => x.assetId === 'PV-07');
  assert.equal(a.status, '보류'); // 72시간이 지나도 본사로 안 감
  const s2 = act.holdAlarm(fresh().state, [], { key: 'A-105:safety', by: 'K1' }).state;
  assert.equal(run(s2).snap.alarms.find((x) => x.assetId === 'A-105').status, '본사대기'); // 안전은 보류 안 됨
});

test('test_ac65_보류 끝 조건: 손실 3만 원 초과 또는 14일', () => {
  // 큰 손실: PV-03(5kW, 발전 0) 보류 → 손실이 쌓여 3만 원을 넘으면 본사로
  let st = act.holdAlarm(fresh().state, [], { key: 'PV-03:low', by: 'K1' }).state;
  let r = run(act.advanceClock(st, 10 * 24));
  let a = r.snap.alarms.find((x) => x.assetId === 'PV-03');
  assert.equal(a.status, '본사대기');
  assert.equal(a.escalateReason, '보류 뒤 손실 3만 원 초과');
  // 작은 손실: PV-07(밤 통신 끊김, 8kW) — 손실 한도 전에 14일이 먼저
  st = act.holdAlarm(fresh().state, [], { key: 'PV-07:comm', by: 'K1' }).state;
  const s2 = { ...seed, config: { ...seed.config, holdLossLimitWon: 1e9 } };
  r = run(act.advanceClock(st, 14 * 24 + 1), [], s2);
  a = r.snap.alarms.find((x) => x.assetId === 'PV-07');
  assert.equal(a.status, '본사대기');
  assert.equal(a.escalateReason, '보류 14일 지남');
});

test('test_ac66_알람마다 하루 손실(최근 24시간)', () => {
  const r = run(fresh().state);
  for (const a of r.snap.alarms) {
    assert.equal(typeof a.dayLossWon, 'number');
    assert.ok(a.dayLossWon <= a.lossWon);
  }
});

test('test_ac67_본사 임시 관리 30일 초과 → 이관 결정 3갈래 · 공공 기관 배정', () => {
  let { state, audit } = run(fresh().state);
  const snap = run(state, audit).snap;
  const ex = snap.exceptions.find((e) => e.id === 'HT-PV-32');
  assert.ok(ex, '등록 누락 30일 초과');
  assert.deepEqual(ex.options, ['소유주 책임 안내', '철거 안내', '공공 기관 배정']);
  assert.ok(!snap.exceptions.some((e) => e.id === 'HT-PV-30')); // 계약 종료 8/26 → 아직 30일 안 됨
  assert.ok(run(act.advanceClock(state, 30 * 24), audit).snap.exceptions.some((e) => e.id === 'HT-PV-30'));
  ({ state, audit } = act.decideException(state, audit, { id: 'HT-PV-32', decision: '공공 기관 배정' }));
  assert.equal(audit.at(-1).action, 'exception.decide');
  const after = run(state, audit).snap;
  assert.equal(after.owners['PV-32'], 'PUB');
  assert.equal(after.settlementPreview.lines.filter((l) => l.assetId === 'PV-32').length, 0); // 청구 안 함
});
