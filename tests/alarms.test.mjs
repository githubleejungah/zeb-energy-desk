// 알람 · 출동 · 의무 (AC-06~24). Q4 점검표 10가지마다 사례 1개 이상(AC-56).
import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, D, fresh, run } from './helpers.mjs';
import { detectEpisodes, makeCtx, evaluate } from '../site/js/core/alarms.js';
import { proposals } from '../site/js/core/dispatch.js';
import { reportDraft } from '../site/js/core/obligations.js';
import * as act from '../site/js/core/actions.js';

const asset = (id) => seed.assets.find((a) => a.id === id);
const now = seed.config.startH;
const eps = (id, s = seed) => detectEpisodes(s, s.assets.find((a) => a.id === id), now, makeCtx(s));
const base = run(fresh().state);

test('test_ac06_해 뜬 시간 데이터 3시간 없음 → 통신 끊김(점검표 ①과 별개, 데이터 규칙)', () => {
  const e = eps('PV-11')[0];
  assert.equal(e.cause, 'comm');
  assert.equal(e.via, 'data');
  assert.equal(e.detectedH - e.startH, 2); // 3번째 시간에 감지
});

test('test_ac07_밤에도 살아 있음 신호 끊김 감지(점검표 ③)', () => {
  const e = eps('PV-07')[0];
  assert.equal(e.via, 'heartbeat');
  assert.equal(e.detectedH, D(30, 23)); // 밤 11시
});

test('test_ac08_데이터는 오는데 발전 0 → 발전 저하(점검표 ①)', () => {
  const e = eps('PV-03').find((x) => x.cause === 'low');
  assert.ok(e);
  assert.equal(e.detectedH, D(30, 11));
});

test('test_ac08_흐린 날은 고장으로 보지 않음 · 대조군(점검표 ②)', () => {
  for (const id of ['PV-13', 'PV-14', 'PV-16', 'PV-17', 'PV-18', 'PV-20', 'PV-22']) assert.equal(eps(id).length, 0, id);
});

test('test_ac09_지열은 해와 무관하게 24시간 기준(점검표 ④)', () => {
  const e = eps('GEO-1').find((x) => x.cause === 'low');
  assert.equal(e.detectedH, D(30, 3)); // 새벽 3시
});

test('test_ac10_손실 큰 순 정렬 · 손실 모름은 추정(점검표 ⑥)', () => {
  const list = base.snap.alarms.filter((a) => a.cause !== 'safety');
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].lossWon >= list[i].lossWon);
  const a103 = base.snap.alarms.find((a) => a.assetId === 'A-103');
  assert.equal(a103.estimated, true);
  assert.ok(a103.lossWon > 0);
});

test('test_ac11_안전 알람은 즉시 본사 · 관리주체(점검표 ⑧)', () => {
  const a = base.snap.alarms[0];
  assert.equal(a.cause, 'safety');
  assert.equal(a.status, '본사대기');
  assert.equal(a.firstH, a.escalatedH);
});

test('test_ac12_같은 원인 7일 3번 → 작업 지시 1건, 알람은 따로 안 띄움', () => {
  const wo = base.snap.workOrders.find((w) => w.assetId === 'PV-11');
  assert.equal(wo.occurrences, 3);
  assert.equal(base.snap.alarms.filter((a) => a.assetId === 'PV-11').length, 0);
});

test('test_ac13_작업 지시 7일 미종결 → 본사로(점검표 ⑤)', () => {
  const { state } = fresh();
  const later = run({ ...state, clockH: D(35, 12) });
  const wo = later.snap.workOrders.find((w) => w.assetId === 'PV-11');
  assert.equal(wo.status, '본사대기');
  assert.equal(wo.escalateReason, '작업 지시 7일 미종결');
});

test('test_ac14_묶인 뒤 손실이 커지면 새 알람(점검표 ⑤)', () => {
  const s2 = { ...seed, faults: [...seed.faults, { id: 'X', assetId: 'PV-11', type: 'data', fromH: D(29, 9), toH: D(29, 18) }] };
  const r = evaluate(s2, fresh().state, now, makeCtx(s2));
  const extra = r.alarms.find((a) => a.assetId === 'PV-11');
  assert.ok(extra, '새 알람이 떠야 함');
  assert.equal(extra.note, '묶음 뒤 손실 증가');
});

test('test_ac15_48시간 출동 미확정 → 본사로 1번(점검표 ⑦)', () => {
  const a = base.snap.alarms.find((x) => x.assetId === 'PV-15');
  assert.equal(a.status, '본사대기');
  assert.equal(a.escalatedH - a.openedH, 48);
});

test('test_ac16_담당 없는 설비 0개: 본사 배정 + 감사 기록(점검표 ⑨)', () => {
  assert.equal(base.snap.owners['PV-32'], 'HQ');
  assert.equal(base.snap.owners['PV-30'], 'HQ');
  const keys = base.audit.map((e) => e.key);
  assert.ok(keys.includes('assign:PV-32') && keys.includes('assign:PV-30'));
  for (const a of seed.assets) assert.ok(base.snap.owners[a.id], a.id);
});

test('test_ac17_확인은 종결이 아님 · 조치+복귀여야 종결(점검표 ⑩)', () => {
  const st = act.markSeen(fresh().state, 'PV-03:low');
  const r = run(st);
  assert.equal(r.snap.alarms.find((a) => a.assetId === 'PV-03').status, '열림');
  const closed = base.snap.closedAlarms.find((c) => c.assetId === 'PV-21');
  assert.equal(closed.status, '종결');
  assert.ok(closed.resultH && closed.closedH > closed.resultH);
});

test('test_ac18_조치 뒤 복귀 안 되면 다시 열고 재발 +1(점검표 ⑩)', () => {
  const a = base.snap.alarms.find((x) => x.assetId === 'PV-19');
  assert.equal(a.reopenCount, 1);
});

test('test_ac19_출동 묶음 최대 5곳 · 확정해야 출동', () => {
  const ps = proposals(seed, base.snap, 'K1');
  assert.ok(ps.length > 0);
  for (const p of ps) assert.ok(p.stops.length <= 5);
  let { state, audit } = fresh();
  ({ state } = act.confirmDispatch(state, audit, { keys: ['PV-03:low'], by: 'K1', role: 'contractor' }));
  const r = run(state); // 시각을 넘기지 않아도 바로 반영
  assert.equal(r.snap.alarms.find((a) => a.assetId === 'PV-03').status, '출동확정');
  ({ state } = act.confirmDispatch(state, audit, { keys: ['PV-15:low'], by: 'K1', role: 'hq' }));
  assert.equal(run(state).snap.alarms.find((a) => a.assetId === 'PV-15').status, '출동확정'); // 본사 담당 지정도 바로
  assert.equal(r.snap.alarms.find((a) => a.assetId === 'PV-03').status, '출동확정');
});

test('test_ac22_사후관리 보고 기한 30일 이하 → 기한 임박', () => {
  const o = base.snap.obligations.find((x) => x.assetId === 'PV-02');
  assert.equal(o.reportDueSoon, true);
  assert.equal(base.snap.obligations.find((x) => x.assetId === 'PV-06').reportOverdue, true);
});

test('test_ac23_보고서 초안 → 시공사 제출 때만 기록 1건 · 감사 1줄', () => {
  const d = reportDraft(seed, 'PV-02', 2, base.snap, now);
  assert.ok(d.period && d.history && d.notice.includes('가상 양식'));
  const { state, audit } = fresh();
  const n0 = state.reports.length;
  const r = act.submitReport(state, audit, { assetId: 'PV-02', year: 2 });
  assert.equal(r.state.reports.length, n0 + 1);
  assert.equal(r.audit.at(-1).action, 'report.submit');
});

test('test_ac24_보증 기간 안 고장 종결 → 보증 청구 대상', () => {
  const o = base.snap.obligations.find((x) => x.assetId === 'PV-21');
  assert.equal(o.warrantyClaims.length, 1);
});

test('test_ac21_의무 3가지 남은 날 · 출처 링크', () => {
  const o = base.snap.obligations.find((x) => x.assetId === 'A-101');
  assert.ok('warrantyDaysLeft' in o && o.report && 'connectionDaysLeft' in o);
  assert.ok(seed.obligationSources.length >= 1);
});
