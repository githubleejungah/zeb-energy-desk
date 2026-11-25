// 예외 5종 분류(AC-31)와 월 정산 마감 잠금 조건(AC-32).
import { fromDateStr, fmtDate } from './time.js';
import { ownerAt } from './alarms.js';

export function exceptions(seed, state, now, obligationList) {
  const out = [];
  const dec = (id) => state.exceptionDecisions[id] ?? null;
  for (const e of seed.equipmentChanges) if (e.atH <= now) out.push({ id: `EQ-${e.assetId}`, type: '장비 교체로 데이터 끊김', refId: e.assetId, openedH: e.atH, options: ['확인 · 기준선 다시 잡기', '고장으로 처리'] });
  for (const o of seed.ownerChanges) if (o.atH <= now) out.push({ id: `OW-${o.assetId}`, type: '소유주 변경', refId: o.assetId, openedH: o.atH, options: ['권한 이전 완료', '보류'] });
  for (const c of seed.contractors) {
    if (c.contractEnd && fromDateStr(c.contractEnd) + 24 <= now) out.push({ id: `CE-${c.id}`, type: '시공사 계약 종료', refId: c.id, openedH: fromDateStr(c.contractEnd) + 24, options: ['본사 임시 관리 확인', '다른 시공사에 배정'] });
  }
  for (const ob of obligationList) {
    if (ob.warrantyDaysLeft >= 0 && ob.warrantyDaysLeft <= seed.config.warrantySoonDays) out.push({ id: `WR-${ob.assetId}`, type: '보증 만료 30일 이내', refId: ob.assetId, openedH: now, note: `만료 ${ob.warrantyEnd}`, options: ['보증 청구 검토 완료', '해당 없음'] });
  }
  for (const s of seed.serviceOutages) {
    if (s.cause === null && s.fromH <= now) out.push({ id: `OC-${s.id}`, type: '원인 미판정 장애', refId: s.id, openedH: s.fromH, note: `${fmtDate(s.fromH)} ${s.toH - s.fromH}시간`, options: ['company', 'field'] });
  }
  // 본사 임시 관리 30일 초과 → 이관 결정 필요(AC-67)
  const ov = state.ownerOverrides ?? {};
  for (const a of seed.assets) {
    const decided = dec(`HT-${a.id}`);
    if (ownerAt(seed, a, now, ov) !== 'HQ' && !decided) continue;
    const c = seed.contractors.find((x) => x.id === a.contractorId);
    const since = a.contractorId === null ? 0 : c?.contractEnd ? fromDateStr(c.contractEnd) + 24 : null;
    if (since === null || now - since < seed.config.hqTempMaxHours) continue;
    out.push({ id: `HT-${a.id}`, type: '본사 임시 관리 30일 초과 — 이관 결정 필요', refId: a.id, openedH: since + seed.config.hqTempMaxHours, note: a.contractorId === null ? '담당 등록 누락' : `시공사 ${a.contractorId} 계약 종료`, options: ['소유주 책임 안내', '철거 안내', '공공 기관 배정'] });
  }
  return out.map((x) => ({ ...x, decision: dec(x.id)?.decision ?? null, decidedH: dec(x.id)?.decidedH ?? null }));
}

// 마감을 막는 사유 목록. 0건이어야 마감 가능.
export function closeLockReasons(alarmResult, exceptionList, appeals) {
  const r = [];
  for (const a of alarmResult.alarms) {
    if (a.cause === 'safety') r.push(`열린 안전 알람 ${a.assetId}`);
    else if (a.status === '본사대기') r.push(`본사 대기 ${a.assetId}(${a.escalateReason})`);
  }
  for (const w of alarmResult.workOrders) if (w.status === '본사대기') r.push(`본사 대기 작업 지시 ${w.assetId}`);
  for (const e of exceptionList) if (!e.decision) r.push(`미판정 예외: ${e.type} ${e.refId}`);
  for (const ap of appeals) if (!ap.decision) r.push(`재심 대기 ${ap.householdId}`);
  return r;
}
