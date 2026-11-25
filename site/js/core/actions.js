// 사람이 하는 행동. 상태를 직접 고치지 않고 새 상태를 돌려준다.
// 돈 · 의무와 관련된 행동은 감사 기록에 남긴다(AC-34).
import { append } from './audit.js';
import * as settlement from './settlement.js';

const MAX_MEMO = 500; // SEC-04

export function cleanMemo(text) {
  // 글자로만 다룬다(화면은 textContent). 길이 제한, 제어 문자 제거.
  return String(text ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, MAX_MEMO);
}

export function advanceClock(state, hours) {
  return { ...state, clockH: state.clockH + hours };
}

export function markSeen(state, key) {
  // '확인'은 종결이 아니다(AC-17): 상태는 그대로, 본 시각만 남긴다.
  return { ...state, seen: { ...state.seen, [key]: state.clockH } };
}

export function confirmDispatch(state, audit, { keys, by, role }) {
  const d = { id: `DS-${state.dispatches.length + 1}`, contractorId: by, by, alarmKeys: [...keys], proposedH: state.clockH, confirmedH: state.clockH };
  const au = role === 'hq' ? append(audit, { at: state.clockH, role, action: 'assign.change', target: `${keys[0]}:${by}`, rule: '본사 담당 지정 · 출동 확정' }) : audit;
  return { state: { ...state, dispatches: [...state.dispatches, d] }, audit: au };
}

// 보류(다음 정기 방문, AC-64). 안전 알람은 규칙에서 무시된다.
export function holdAlarm(state, audit, { key, by }) {
  const st = { ...state, holds: [...(state.holds ?? []), { alarmKey: key, atH: state.clockH, by }] };
  return { state: st, audit: append(audit, { at: state.clockH, role: 'contractor', action: 'alarm.hold', target: key, rule: 'AC-64 보류 · 끝 조건 14일 또는 3만 원' }) };
}

// 관리주체 현장 1차 확인(AC-60~62). result: 'solved' | 'failed'
export function siteCheck(state, { key, result, items = [] }) {
  if (!['solved', 'failed'].includes(result)) return state;
  return { ...state, siteChecks: [...(state.siteChecks ?? []), { alarmKey: key, atH: state.clockH, result, items: items.map(String).slice(0, 5) }] };
}

export function enterResult(state, { key, memo }) {
  return { ...state, results: [...state.results, { alarmKey: key, atH: state.clockH, memo: cleanMemo(memo) }] };
}

export function submitReport(state, audit, { assetId, year, role = 'contractor' }) {
  if (state.reports.some((r) => r.assetId === assetId && r.year === year)) return { state, audit };
  const st = { ...state, reports: [...state.reports, { assetId, year, submittedH: state.clockH }] };
  return { state: st, audit: append(audit, { at: state.clockH, role, action: 'report.submit', target: `${assetId}:Y${year}`, rule: 'AC-23 시공사 제출' }) };
}

export function decideException(state, audit, { id, decision }) {
  let st = { ...state, exceptionDecisions: { ...state.exceptionDecisions, [id]: { decision, decidedH: state.clockH } } };
  // 이관 결정 '공공 기관 배정' → 담당을 가상 공공 사후관리 기관으로(AC-67)
  if (id.startsWith('HT-') && decision === '공공 기관 배정') st = { ...st, ownerOverrides: { ...(st.ownerOverrides ?? {}), [id.slice(3)]: { to: 'PUB', atH: state.clockH } } };
  return { state: st, audit: append(audit, { at: state.clockH, role: 'hq', action: 'exception.decide', target: id, rule: `판정 ${decision === 'company' ? '회사 책임' : decision === 'field' ? '현장 원인' : '처리'}` }) };
}

export function approveBudget(state, audit, { partnerId, won }) {
  const amount = Math.max(0, Math.floor(Number(won) || 0));
  if (!amount) return { state, audit };
  const st = { ...state, budgets: [...state.budgets, { partnerId, approvedWon: amount, approvedH: state.clockH }] };
  return { state: st, audit: append(audit, { at: state.clockH, role: 'complex', action: 'budget.approve', target: `${partnerId}:${amount}`, rule: 'AC-44 관리주체 승인' }) };
}

// 이의 제기(AC-40): 결과 공개 뒤 7일 안, 미션마다 1번.
export function fileAppeal(state, mission, householdId) {
  if (!mission || mission.status !== 'judged') return { state, ok: false, reason: '판정된 미션이 아닙니다' };
  if (state.clockH > mission.appealDueH) return { state, ok: false, reason: '이의 기한(7일)이 지났습니다' };
  if (state.appeals.some((a) => a.missionDay === mission.day && a.householdId === householdId)) return { state, ok: false, reason: '이미 이의를 냈습니다' };
  return { state: { ...state, appeals: [...state.appeals, { missionDay: mission.day, householdId, filedH: state.clockH, decision: null, decidedH: null }] }, ok: true };
}

export function decideAppeal(state, audit, { missionDay, householdId, decision }) {
  const appeals = state.appeals.map((a) => (a.missionDay === missionDay && a.householdId === householdId && !a.decision ? { ...a, decision, decidedH: state.clockH } : a));
  const st = { ...state, appeals };
  return { state: st, audit: append(audit, { at: state.clockH, role: 'hq', action: 'appeal.decide', target: `${householdId}:D${missionDay}`, rule: decision === 'overturn' ? '재심: 성공으로 변경' : '재심: 판정 유지' }) };
}

export function closeMonth(seed, state, audit, { month, shownTotalWon, lockReasons }) {
  const r = settlement.close(seed, state, month, state.clockH, shownTotalWon, lockReasons);
  if (!r.ok) return { state, audit, result: r };
  let au = append(audit, { at: state.clockH, role: 'hq', action: 'settlement.close', target: month, rule: 'AC-32 잠금 0건 · AC-30 교차 검사 일치' });
  const credited = r.settlement.lines.filter((l) => l.creditWon > 0).length;
  au = append(au, { at: state.clockH, role: 'hq', action: 'credit.confirm', target: `${month} lines=${credited}`, rule: 'AC-27 회사 책임 장애 감면' });
  return { state: { ...state, settlements: { ...state.settlements, [month]: r.settlement } }, audit: au, result: r };
}
