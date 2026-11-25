// 사전 경고(AC-84~90). 감사 기록은 고치지 않으므로, 돈 · 담당이 바뀌기 전에 영향을 숫자로 보여 준다.
// 경고는 아래 6가지 행동에만 둔다(AC-90). 근거 없는 기준값(몇 배 · 몇 %)은 두지 않고 바뀌는 금액 · 건수를 보여 준다.
import { fromDateStr, monthRange, monthOfDay } from './time.js';
import { days } from './labels.js';

export const WARN_ACTIONS = ['판정', '관리 종료', '담당 지정', '본사 직접', '예산 승인', '마감'];

const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
const signed = (n) => (n === 0 ? '변화 0원' : `${n > 0 ? '+' : '−'}${won(Math.abs(n))}`);
const END_DECISIONS = ['소유주 책임 안내', '철거 안내'];

// 예외 판정 영향(AC-84 · AC-85). previewOf(state, month) = 정산 미리보기(정산 모듈이 계산).
export function exceptionImpact(seed, state, ex, decision, openAlarms, previewOf) {
  if (ex.id.startsWith('OC-')) {
    const o = seed.serviceOutages.find((x) => `OC-${x.id}` === ex.id);
    const month = monthOfDay(Math.floor(o.fromH / 24));
    const before = previewOf(state, month);
    const after = previewOf({ ...state, exceptionDecisions: { ...state.exceptionDecisions, [ex.id]: { decision } } }, month);
    return { action: '판정', confirm: false, text: `${month} 감면 ${signed(after.totalCreditWon - before.totalCreditWon)} · 청구 ${won(before.totalBilledWon)} → ${won(after.totalBilledWon)}` };
  }
  if (ex.id.startsWith('HT-') && END_DECISIONS.includes(decision)) {
    const n = openAlarms.filter((a) => a.assetId === ex.refId && a.cause !== 'safety').length;
    return { action: '관리 종료', confirm: true, text: `관리 종료: 열린 일반 알람 ${n}건이 닫히고, 앞으로 일반 알람 0건 · 안전 알람만 본사로` };
  }
  if (ex.id.startsWith('HT-')) return { action: '판정', confirm: false, text: '담당이 공공 기관으로 바뀜 · 청구 변화 0원(본사 관리 설비는 원래 청구 안 함) · 일반 알람은 기관 전달' };
  return { action: '판정', confirm: false, text: '금액 변화 0원(감면 · 청구 · 포인트 · 예산 그대로)' };
}

// 재심 판정 영향(AC-84). result = 원래 판정, remainingWon = 지금 남은 예산.
export function appealImpact(seed, result, decision, remainingWon) {
  const add = decision === 'overturn' && result?.verdict !== 'success' ? seed.config.missionPoints : 0;
  return { action: '판정', confirm: false, text: add ? `포인트 +${add}점 · 남은 예산 ${won(remainingWon)} → ${won(remainingWon - add)}` : '포인트 변화 0점 · 남은 예산 그대로' };
}

// 담당 지정 막기(AC-86)
export function assignCheck(seed, contractorId, now) {
  if (contractorId === 'HQ') return { ok: true };
  const c = seed.contractors.find((x) => x.id === contractorId);
  if (!c) return { ok: false, reason: `${contractorId}: 등록되지 않은 시공사라 지정할 수 없습니다` };
  if (c.contractEnd && now >= fromDateStr(c.contractEnd) + 24) return { ok: false, reason: `${contractorId}: 계약이 ${c.contractEnd}에 끝나 지정할 수 없습니다` };
  return { ok: true };
}

// 본사 직접(AC-87)
export function hqTakeLine(seed, alarms) {
  const n = alarms.filter((a) => a.owner === 'HQ' || a.assignee === 'HQ').length;
  return `본사가 직접 맡으면 ${days(seed.config.resultDueHours)} 안에 조치를 넣어야 합니다 · 지금 본사가 맡은 알람 ${n}건`;
}

// 예산 승인(AC-88)
export function budgetLine(amountWon, perMissionWon) {
  const n = perMissionWon > 0 ? Math.floor(amountWon / perMissionWon) : 0;
  return `${won(amountWon)} = 미션 ${n}회분(1회 최대 지급 ${won(perMissionWon)} 기준)`;
}

// 월 마감 비교(AC-89)
export function closeCompare(state, month, p) {
  const prevMonth = monthOfDay(monthRange(month).startDay - 1);
  const prev = state.settlements?.[prevMonth];
  if (!prev || prev.closedH == null) return `${prevMonth} 마감 기록 없음 — 비교 없음 · 이번 청구 ${won(p.totalBilledWon)} · 감면 ${won(p.totalCreditWon)}`;
  return `${prevMonth} 대비 청구 ${signed(p.totalBilledWon - prev.totalBilledWon)} · 감면 ${signed(p.totalCreditWon - prev.totalCreditWon)}`;
}
