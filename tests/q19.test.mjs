// 판정 초안 → 확정 · 사전 경고 (AC-80~90) — 요구 Q19
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { seed, D, fresh, run } from './helpers.mjs';
import { forRole } from '../site/js/views.js';
import * as act from '../site/js/core/actions.js';
import { WARN_ACTIONS, budgetLine, closeCompare } from '../site/js/core/warnings.js';

const hqView = (r) => forRole(seed, r.snap, 'hq', { audit: r.audit });
const withAppeal = () => ({ ...fresh().state, appeals: [{ missionDay: 20, householdId: 'H-0002', filedH: D(25, 0), decision: null, decidedH: null }] });

test('test_ac80_판정을 고르면 초안 · 감사 기록 0줄', () => {
  const st = act.pickException(fresh().state, { id: 'OC-SO-3', decision: 'company' });
  assert.equal(st.exceptionDrafts['OC-SO-3'].decision, 'company');
  const st2 = act.pickAppeal(withAppeal(), { missionDay: 20, householdId: 'H-0002', decision: 'overturn' });
  assert.equal(st2.appealDrafts['20|H-0002'].decision, 'overturn');
  const r = run(st);
  assert.ok(!r.audit.some((e) => e.action === 'exception.decide' || e.action === 'appeal.decide'));
});

test('test_ac81_초안은 다시 고를 수 있음(고른 횟수 셈)', () => {
  let st = act.pickException(fresh().state, { id: 'OC-SO-3', decision: 'company' });
  st = act.pickException(st, { id: 'OC-SO-3', decision: 'field' });
  assert.deepEqual([st.exceptionDrafts['OC-SO-3'].decision, st.exceptionDrafts['OC-SO-3'].picks], ['field', 2]);
  const e = hqView(run(st)).exceptions.find((x) => x.id === 'OC-SO-3');
  assert.equal(e.decision, null);
  assert.equal(e.draft.decision, 'field');
});

test('test_ac82_초안은 감면 · 담당 · 포인트에 반영 0건', () => {
  const base = run(fresh().state).snap;
  const st = act.pickException(fresh().state, { id: 'OC-SO-3', decision: 'company' });
  const r = run(act.pickException(st, { id: 'HT-PV-32', decision: '철거 안내' })).snap;
  assert.equal(r.settlementPreview.totalBilledWon, base.settlementPreview.totalBilledWon);
  assert.equal(r.owners['PV-32'], base.owners['PV-32']);
  assert.ok(r.lockReasons.some((x) => x.includes('SO-3'))); // 초안은 미판정 → 마감 잠금(끝 조건)
  const ap = run(act.pickAppeal(withAppeal(), { missionDay: 20, householdId: 'H-0002', decision: 'overturn' })).snap;
  assert.equal(ap.missions.spentWon, run(withAppeal()).snap.missions.spentWon);
});

test('test_ac83_확정하면 반영 · 감사 기록 1줄(최종 판정 · 초안 고른 횟수)', () => {
  let st = act.pickException(fresh().state, { id: 'OC-SO-3', decision: 'field' });
  st = act.pickException(st, { id: 'OC-SO-3', decision: 'company' });
  const { state, audit } = act.confirmException(st, [], { id: 'OC-SO-3' });
  assert.equal(state.exceptionDecisions['OC-SO-3'].decision, 'company');
  assert.ok(!state.exceptionDrafts['OC-SO-3']);
  assert.equal(audit.length, 1);
  assert.match(audit[0].rule, /회사 책임 · 초안 2번 고름/);
  const a = act.confirmAppeal(act.pickAppeal(withAppeal(), { missionDay: 20, householdId: 'H-0002', decision: 'overturn' }), [], { missionDay: 20, householdId: 'H-0002' });
  assert.equal(a.state.appeals[0].decision, 'overturn');
  assert.match(a.audit[0].rule, /성공으로 변경 · 초안 1번 고름/);
});

test('test_ac84_초안의 영향(감면 · 청구 · 포인트 · 남은 예산)을 숫자 1줄로', () => {
  const r = run(act.pickException(fresh().state, { id: 'OC-SO-3', decision: 'company' }));
  const w = hqView(r).exceptions.find((x) => x.id === 'OC-SO-3').warn;
  assert.match(w.text, /감면 [+−]?[\d,]+원|감면 변화 0원/);
  assert.match(w.text, /청구 [\d,]+원 → [\d,]+원/);
  const ap = run(act.pickAppeal(withAppeal(), { missionDay: 20, householdId: 'H-0002', decision: 'overturn' }));
  const aw = hqView(ap).appeals.find((x) => x.householdId === 'H-0002').warn;
  assert.match(aw.text, /포인트 (\+100점|변화 0점)/);
});

test('test_ac85_관리 종료는 닫히는 알람 수 · 안전만 안내 · 한 번 더 확인', () => {
  const r = run(act.pickException(fresh().state, { id: 'HT-PV-32', decision: '철거 안내' }));
  const w = hqView(r).exceptions.find((x) => x.id === 'HT-PV-32').warn;
  assert.equal(w.confirm, true);
  assert.match(w.text, /열린 일반 알람 \d+건이 닫히고, 앞으로 일반 알람 0건 · 안전 알람만/);
  const pub = hqView(run(act.pickException(fresh().state, { id: 'HT-PV-32', decision: '공공 기관 배정' }))).exceptions.find((x) => x.id === 'HT-PV-32').warn;
  assert.equal(pub.confirm, false);
});

test('test_ac86_계약 끝난 시공사는 지정 막기 · 이유 1줄', () => {
  const r = act.confirmDispatch(fresh().state, [], { keys: ['PV-15:low'], by: 'K3', role: 'hq' });
  assert.match(r.blocked, /K3: 계약이 2026-08-25에 끝나 지정할 수 없습니다/);
  assert.equal(r.state.dispatches.length, fresh().state.dispatches.length);
  assert.equal(r.audit.length, 0);
  assert.equal(act.confirmDispatch(fresh().state, [], { keys: ['PV-15:low'], by: 'K2', role: 'hq' }).blocked, undefined);
});

test('test_ac87_본사 직접: 조치 기한 7일 · 지금 맡은 알람 수', () => {
  const v = hqView(run(fresh().state));
  assert.match(v.hqTakeLine, /7일 안에 조치를 넣어야 합니다 · 지금 본사가 맡은 알람 \d+건/);
  const n0 = Number(v.hqTakeLine.match(/(\d+)건/)[1]);
  const st = act.confirmDispatch(fresh().state, [], { keys: ['PV-15:low'], by: 'HQ', role: 'hq' }).state;
  assert.equal(Number(hqView(run(st)).hqTakeLine.match(/(\d+)건/)[1]), n0 + 1);
});

test('test_ac88_예산 승인: 미션 몇 회분인지', () => {
  const per = seed.complex.households * seed.config.missionPoints;
  assert.equal(budgetLine(100000, per), `100,000원 = 미션 3회분(1회 최대 지급 ${per.toLocaleString('ko-KR')}원 기준)`);
  const src = readFileSync(new URL('../site/js/ui/complex.js', import.meta.url), 'utf8');
  assert.match(src, /승인 확정/); // 한 번 더 확인
});

test('test_ac89_마감: 지난달 대비 차이(없으면 비교 없음) · 한 번 더 확인', () => {
  const r = run(fresh().state);
  assert.match(hqView(r).closeCompare, /2026-07 마감 기록 없음 — 비교 없음/);
  const p = { totalBilledWon: 150000, totalCreditWon: 9000 };
  const st = { settlements: { '2026-08': { closedH: 1, totalBilledWon: 151827, totalCreditWon: 6300 } } };
  assert.equal(closeCompare(st, '2026-09', p), '2026-08 대비 청구 −1,827원 · 감면 +2,700원');
  assert.match(readFileSync(new URL('../site/js/ui/hq.js', import.meta.url), 'utf8'), /마감 확정/);
});

test('test_ac90_사전 경고는 6가지 행동에만', () => {
  assert.deepEqual(WARN_ACTIONS, ['판정', '관리 종료', '담당 지정', '본사 직접', '예산 승인', '마감']);
  // 그 밖의 행동 화면(시공사 · 입주민 · 1차 확인)에는 경고 칸이 없다
  const r = run(fresh().state);
  for (const role of ['contractor', 'resident', 'complex']) {
    const json = JSON.stringify(forRole(seed, r.snap, role, {}));
    assert.ok(!/"warn"|hqTakeLine|closeCompare/.test(json), role);
  }
  const ui = readdirSync(new URL('../site/js/ui/', import.meta.url)).filter((f) => f.endsWith('.js'));
  for (const f of ui) {
    if (['hq.js', 'complex.js'].includes(f)) continue;
    assert.ok(!/warnings\.js|확인 —|정말 확정/.test(readFileSync(new URL(`../site/js/ui/${f}`, import.meta.url), 'utf8')), f);
  }
});
