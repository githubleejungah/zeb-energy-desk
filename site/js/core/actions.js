// 사람이 하는 행동. 상태를 직접 고치지 않고 새 상태를 돌려준다.
// 돈 · 의무와 관련된 행동은 감사 기록에 남긴다(AC-34).
import { append } from './audit.js';
import * as settlement from './settlement.js';
import * as seedData from '../data/seed.js';
import { assignCheck } from './warnings.js';
const { config } = seedData;
import { manwon, days } from './labels.js';

const MAX_MEMO = config.memoMaxChars; // SEC-04

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
  if (role === 'hq') { const ck = assignCheck(seedData, by, state.clockH); if (!ck.ok) return { state, audit, blocked: ck.reason }; } // AC-86
  const d = { id: `DS-${state.dispatches.length + 1}`, contractorId: by, by, byRole: role === 'hq' ? 'hq' : 'contractor', alarmKeys: [...keys], proposedH: state.clockH, confirmedH: state.clockH };
  const au = role === 'hq' ? append(audit, { at: state.clockH, role, action: 'assign.change', target: `${keys[0]}:${by}`, rule: 'AC-71 본사 담당 지정 · 출동 확정' }) : audit;
  return { state: { ...state, dispatches: [...state.dispatches, d] }, audit: au };
}

// 보류(다음 정기 방문, AC-64). 안전 알람은 규칙에서 무시된다.
export function holdAlarm(state, audit, { key, by }) {
  const st = { ...state, holds: [...(state.holds ?? []), { alarmKey: key, atH: state.clockH, by }] };
  return { state: st, audit: append(audit, { at: state.clockH, role: 'contractor', action: 'alarm.hold', target: key, rule: `AC-64 보류 · 끝 조건 ${days(config.holdMaxHours)} 또는 ${manwon(config.holdLossLimitWon)}` }) };
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

// 예외 판정 초안(AC-80~82): 다시 고를 수 있고, 감사 기록 0줄 · 계산 반영 0건
export function pickException(state, { id, decision }) {
  const prev = state.exceptionDrafts?.[id];
  return { ...state, exceptionDrafts: { ...(state.exceptionDrafts ?? {}), [id]: { decision, picks: (prev?.picks ?? 0) + 1, atH: state.clockH } } };
}

// 초안 확정(AC-83): 판정 반영 + 감사 기록 1줄(최종 판정 · 초안 고른 횟수)
export function confirmException(state, audit, { id }) {
  const d = state.exceptionDrafts?.[id];
  if (!d) return { state, audit };
  const { [id]: _, ...rest } = state.exceptionDrafts;
  return decideException({ ...state, exceptionDrafts: rest }, audit, { id, decision: d.decision, picks: d.picks });
}

export function decideException(state, audit, { id, decision, picks = null }) {
  let st = { ...state, exceptionDecisions: { ...state.exceptionDecisions, [id]: { decision, decidedH: state.clockH } } };
  // 이관 결정(AC-67): 공공 기관 배정 → PUB(AC-74), 소유주 책임 안내 · 철거 안내 → END 관리 종료(AC-73)
  const to = decision === '공공 기관 배정' ? 'PUB' : ['소유주 책임 안내', '철거 안내'].includes(decision) ? 'END' : null;
  if (id.startsWith('HT-') && to) st = { ...st, ownerOverrides: { ...(st.ownerOverrides ?? {}), [id.slice(3)]: { to, atH: state.clockH } } };
  return { state: st, audit: append(audit, { at: state.clockH, role: 'hq', action: 'exception.decide', target: id, rule: `판정 ${decision === 'company' ? '회사 책임' : decision === 'field' ? '현장 원인' : decision}${picks ? ` · 초안 ${picks}번 고름` : ''}` }) };
}

export function approveBudget(state, audit, { partnerId, won }) {
  const amount = Math.max(0, Math.floor(Number(won) || 0));
  if (!amount) return { state, audit };
  const st = { ...state, budgets: [...state.budgets, { partnerId, approvedWon: amount, approvedH: state.clockH }] };
  return { state: st, audit: append(audit, { at: state.clockH, role: 'complex', action: 'budget.approve', target: `${partnerId}:${amount}`, rule: 'AC-44 관리주체 승인' }) };
}

// 미션 참여 신청 · 취소(AC-76). 기본값과 다른 것만 남긴다. 다음 미션부터 적용.
export function setOptIn(state, { householdId, on }) {
  return { ...state, optIns: { ...(state.optIns ?? {}), [householdId]: { on: Boolean(on), atH: state.clockH } } };
}

// 이의 제기(AC-40): 결과 공개 뒤 7일 안, 미션마다 1번.
export function fileAppeal(state, mission, householdId) {
  if (!mission || mission.status !== 'judged') return { state, ok: false, reason: '판정된 미션이 아닙니다' };
  if (!mission.results?.[householdId]) return { state, ok: false, reason: '참여 신청 전 미션입니다' };
  if (state.clockH > mission.appealDueH) return { state, ok: false, reason: '이의 기한(7일)이 지났습니다' };
  if (state.appeals.some((a) => a.missionDay === mission.day && a.householdId === householdId)) return { state, ok: false, reason: '이미 이의를 냈습니다' };
  return { state: { ...state, appeals: [...state.appeals, { missionDay: mission.day, householdId, filedH: state.clockH, decision: null, decidedH: null }] }, ok: true };
}

// 재심 판정 초안 · 확정(AC-80~83). 키 = 미션 날|가명
const appealKey = (day, hid) => `${day}|${hid}`;
export function pickAppeal(state, { missionDay, householdId, decision }) {
  const k = appealKey(missionDay, householdId);
  const prev = state.appealDrafts?.[k];
  return { ...state, appealDrafts: { ...(state.appealDrafts ?? {}), [k]: { decision, picks: (prev?.picks ?? 0) + 1, atH: state.clockH } } };
}

export function confirmAppeal(state, audit, { missionDay, householdId }) {
  const k = appealKey(missionDay, householdId);
  const d = state.appealDrafts?.[k];
  if (!d) return { state, audit };
  const { [k]: _, ...rest } = state.appealDrafts;
  return decideAppeal({ ...state, appealDrafts: rest }, audit, { missionDay, householdId, decision: d.decision, picks: d.picks });
}

export function decideAppeal(state, audit, { missionDay, householdId, decision, picks = null }) {
  const appeals = state.appeals.map((a) => (a.missionDay === missionDay && a.householdId === householdId && !a.decision ? { ...a, decision, decidedH: state.clockH } : a));
  const st = { ...state, appeals };
  return { state: st, audit: append(audit, { at: state.clockH, role: 'hq', action: 'appeal.decide', target: `${householdId}:D${missionDay}`, rule: (decision === 'overturn' ? '재심: 성공으로 변경' : '재심: 판정 유지') + (picks ? ` · 초안 ${picks}번 고름` : '') }) };
}

export function closeMonth(seed, state, audit, { month, shownTotalWon, lockReasons }) {
  const r = settlement.close(seed, state, month, state.clockH, shownTotalWon, lockReasons);
  if (!r.ok) return { state, audit, result: r };
  let au = append(audit, { at: state.clockH, role: 'hq', action: 'settlement.close', target: month, rule: 'AC-32 잠금 0건 · AC-30 교차 검사 일치' });
  const credited = r.settlement.lines.filter((l) => l.creditWon > 0).length;
  au = append(au, { at: state.clockH, role: 'hq', action: 'credit.confirm', target: `${month} lines=${credited}`, rule: 'AC-27 회사 책임 장애 감면' });
  return { state: { ...state, settlements: { ...state.settlements, [month]: r.settlement } }, audit: au, result: r };
}
