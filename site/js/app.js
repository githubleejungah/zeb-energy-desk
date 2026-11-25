// 시작 · 역할 전환 · 행동 연결 · 다시 그리기(AC-01 · AC-55)
import * as seed from './data/seed.js';
import { load, save, reset } from './core/store.js';
import { snapshot, reconcile } from './core/engine.js';
import { reportDraft } from './core/obligations.js';
import * as act from './core/actions.js';
import { forRole } from './views.js';
import { fmt } from './core/time.js';
import { h } from './ui/dom.js';
import { renderContractor } from './ui/contractor.js';
import { renderResident } from './ui/resident.js';
import { renderComplex } from './ui/complex.js';
import { renderHq } from './ui/hq.js';

let storage;
try { storage = window.localStorage; } catch { storage = null; }
const mem = new Map();
const safeStorage = storage ?? { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };

let { state, audit, notice } = load(safeStorage, seed);
let role = 'contractor'; // 역할은 버튼 상태로만 정한다(저장소 값은 믿지 않음, SEC-01)
let ui = {};
let snap;
let contractorId = 'K1';
let householdId = 'H-0002';

function commit(next) {
  if (next.state) state = next.state;
  if (next.audit) audit = next.audit;
  render();
}

const api = {
  ui: (patch) => { ui = { ...ui, ...patch }; render(false); },
  markSeen: (key) => commit({ state: act.markSeen(state, key) }),
  confirmDispatch: (keys) => commit(act.confirmDispatch(state, audit, { keys, by: contractorId, role: 'contractor' })),
  assign: (key, by) => { const r = act.confirmDispatch(state, audit, { keys: [key], by, role: 'hq' }); ui = { ...ui, assignMsg: r.blocked ?? null }; commit(r); },
  holdAlarm: (key) => commit(act.holdAlarm(state, audit, { key, by: contractorId })),
  siteCheck: (key, result, items) => commit({ state: act.siteCheck(state, { key, result, items }) }),
  enterResult: (key, memo) => { ui = { ...ui, resultFor: null }; commit({ state: act.enterResult(state, { key, memo }) }); },
  reportDraft: (assetId, year) => reportDraft(seed, assetId, year, snap, state.clockH),
  submitReport: (assetId, year) => { ui = { ...ui, draft: null }; commit(act.submitReport(state, audit, { assetId, year })); },
  pickException: (id, decision) => commit({ state: act.pickException(state, { id, decision }) }),
  confirmException: (id) => commit(act.confirmException(state, audit, { id })),
  approveBudget: (partnerId, won) => commit(act.approveBudget(state, audit, { partnerId, won })),
  fileAppeal: (day) => {
    const m = snap.missions.list.find((x) => x.day === day);
    const r = act.fileAppeal(state, m, householdId);
    commit({ state: r.state });
  },
  setOptIn: (on) => commit({ state: act.setOptIn(state, { householdId, on }) }),
  pickAppeal: (missionDay, hid, decision) => commit({ state: act.pickAppeal(state, { missionDay, householdId: hid, decision }) }),
  confirmAppeal: (missionDay, hid) => commit(act.confirmAppeal(state, audit, { missionDay, householdId: hid })),
  closeMonth: (month, shownTotalWon, lockReasons) => {
    const r = act.closeMonth(seed, state, audit, { month, shownTotalWon, lockReasons });
    ui = { ...ui, closeMsg: r.result.ok ? '마감했습니다.' : r.result.reason === 'mismatch' ? `금액이 다시 계산한 값과 ${r.result.diffWon}원 다릅니다. 마감하지 않았습니다.` : '마감할 수 없습니다.' };
    commit(r);
  },
};

function render(recompute = true) {
  const t0 = performance.now();
  if (recompute || !snap) {
    snap = snapshot(seed, state);
    const r = reconcile(seed, state, audit, snap);
    if (r.state !== state || r.audit !== audit) { state = r.state; audit = r.audit; snap = snapshot(seed, state); }
    save(safeStorage, state, audit);
  }
  const view = forRole(seed, snap, role, { contractorId, householdId, audit });
  const main = document.getElementById('main');
  let body;
  if (role === 'contractor') body = renderContractor(view, api, ui);
  else if (role === 'resident') body = renderResident(view, api, ui);
  else if (role === 'complex') body = renderComplex(view, api, ui);
  else body = renderHq(view, api, ui, seed);
  main.replaceChildren(scopeBar(), body);
  document.getElementById('clock').textContent = `${fmt(state.clockH)} (시연 시각)`;
  for (const b of document.querySelectorAll('[data-role]')) b.setAttribute('aria-pressed', String(b.dataset.role === role));
  const n = document.getElementById('notice');
  n.textContent = notice ?? '';
  n.hidden = !notice;
  document.getElementById('perf').textContent = `화면 계산 ${Math.round(performance.now() - t0)}ms`;
}

function scopeBar() {
  if (role === 'contractor') {
    const sel = h('select', { 'aria-label': '시공사 고르기', on: { change: (e) => { contractorId = e.target.value; ui = {}; render(false); } } },
      seed.contractors.filter((c) => !c.contractEnd).map((c) => h('option', { value: c.id, selected: c.id === contractorId }, `${c.name}(${c.plan === 'pro' ? '프로' : '운영대행'})`)));
    return h('div', { class: 'scope' }, '보는 시공사: ', sel, ' — 자기가 맡은 설비만 보입니다.');
  }
  if (role === 'resident') {
    const sel = h('select', { 'aria-label': '세대 고르기', on: { change: (e) => { householdId = e.target.value; render(false); } } },
      ['H-0002', 'H-0004', 'H-0001', 'H-0012', 'H-0042'].map((id) => h('option', { value: id, selected: id === householdId }, `${id}(가명)`)));
    return h('div', { class: 'scope' }, '보는 세대: ', sel, ' — 자기 세대만 보입니다.');
  }
  if (role === 'complex') return h('div', { class: 'scope' }, '건설사 · 관리주체 화면 — 단지 합계만 보입니다.');
  return h('div', { class: 'scope' }, '본사 운영자 화면 — 세대 사용량은 합계만 보입니다.');
}

for (const b of document.querySelectorAll('[data-role]')) b.addEventListener('click', () => { role = b.dataset.role; ui = {}; render(false); });
document.getElementById('plus1h').addEventListener('click', () => commit({ state: act.advanceClock(state, 1) }));
document.getElementById('plus1d').addEventListener('click', () => commit({ state: act.advanceClock(state, 24) }));
document.getElementById('reset').addEventListener('click', () => { const r = reset(safeStorage, seed); notice = null; ui = {}; commit(r); });
render();
