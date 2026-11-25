// 전체 계산: 기준 데이터 + 상태 + 시각 → 한 장의 계산 결과(snapshot).
// 화면은 이 결과를 직접 받지 않고 views.js의 역할 필터를 거친다(ADR 0003).
import { evaluate, makeCtx, ownerAt } from './alarms.js';
import { proposals } from './dispatch.js';
import { obligations } from './obligations.js';
import { exceptions, closeLockReasons } from './exceptions.js';
import { preview, missions, partnerReport, deletedMonths, rawDeletionCount } from './settlement.js';
import { complexGen, complexLoad } from './telemetry.js';
import { append, hasKey } from './audit.js';
import { days } from './labels.js';
import { exceptionImpact, appealImpact, hqTakeLine, closeCompare } from './warnings.js';
import { dayOf, hourOf, monthOfDay, monthRange, fromDateStr } from './time.js';

export function closeMonthOf(now) {
  const cur = monthOfDay(dayOf(now));
  return monthOfDay(monthRange(cur).startDay - 1); // 지난달
}

export function snapshot(seed, state) {
  const now = state.clockH;
  const ctx = makeCtx(seed);
  const deleted = deletedMonths(seed, state, now);
  const ar = evaluate(seed, state, now, ctx);
  const obl = obligations(seed, state, now, ar.closedAlarms);
  const exc = exceptions(seed, state, now, obl);
  const ms = missions(seed, state, now, deleted);
  const pendingAppeals = state.appeals.filter((a) => !a.decision);
  const closeMonth = closeMonthOf(now);
  const lockReasons = closeLockReasons(ar, exc, pendingAppeals, monthRange(monthOfDay(dayOf(now))).startDay * 24); // AC-32 지난달 말일까지 생긴 것
  const day = dayOf(now);
  const hoursToday = hourOf(now);
  const complexHourly = Array.from({ length: hoursToday }, (_, h) => ({ hour: h, genKwh: complexGen(seed, day, h), loadKwh: complexLoad(day, h) }));
  // 사전 경고(AC-84 · AC-85 · AC-87 · AC-89): 초안의 영향, 본사 직접, 마감 비교
  const previewOf = (st, month) => preview(seed, st, month);
  const exDrafts = state.exceptionDrafts ?? {};
  const apDrafts = state.appealDrafts ?? {};
  const warn = {
    exceptions: Object.fromEntries(exc.filter((e) => exDrafts[e.id] && !e.decision).map((e) => [e.id, exceptionImpact(seed, state, e, exDrafts[e.id].decision, ar.alarms, previewOf)])),
    appeals: Object.fromEntries(pendingAppeals.filter((a) => apDrafts[`${a.missionDay}|${a.householdId}`]).map((a) => {
      const k = `${a.missionDay}|${a.householdId}`;
      const m = ms.list.find((x) => x.day === a.missionDay);
      return [k, appealImpact(seed, m?.results?.[a.householdId], apDrafts[k].decision, ms.remainingWon)];
    })),
    closeCompare: closeCompare(state, closeMonth, preview(seed, state, closeMonth)),
  };
  const owners = Object.fromEntries(seed.assets.map((a) => [a.id, ownerAt(seed, a, now, state.ownerOverrides ?? {})]));
  const proposalsBy = Object.fromEntries([...seed.contractors.map((c) => c.id), 'HQ'].map((id) => [id, proposals(seed, ar, id)]));
  return {
    now, day, deletedMonths: deleted, owners, optIns: state.optIns ?? {},
    alarms: ar.alarms, workOrders: ar.workOrders, closedAlarms: ar.closedAlarms,
    proposals: proposalsBy, obligations: obl, exceptions: exc,
    missions: ms, partnerReport: partnerReport(ms), pendingAppeals,
    closeMonth, settlementPreview: preview(seed, state, closeMonth), settlementClosed: state.settlements[closeMonth] ?? null,
    lockReasons, complexHourly, warn, exceptionDrafts: exDrafts, appealDrafts: apDrafts,
  };
}

// 계산 결과를 상태 · 감사 기록에 반영(미션 판정 기록, 담당 변경, 원본 삭제). 같은 일은 한 번만(key).
export function reconcile(seed, state, audit, snap) {
  let st = state;
  let au = audit;
  if (snap.missions.fresh.length) {
    const log = { ...st.missionLog };
    for (const m of snap.missions.fresh) log[m.day] = m;
    st = { ...st, missionLog: log };
  }
  for (const a of seed.assets) {
    if (snap.owners[a.id] !== 'HQ') continue;
    const key = `assign:${a.id}`;
    if (hasKey(au, key)) continue;
    const c = seed.contractors.find((x) => x.id === a.contractorId);
    const at = c?.contractEnd ? fromDateStr(c.contractEnd) + 24 : 0;
    au = append(au, { at: Math.min(at, snap.now), role: 'system', action: 'assign.change', target: `${a.id}:HQ`, rule: 'AC-16 담당 없는 설비 0개', key });
  }
  // 자동 회복 종결(AC-79)은 계산으로 정해지므로 여기서 감사 기록 1줄을 남긴다.
  for (const c of snap.closedAlarms) {
    if (c.closeReason !== '자동 회복') continue;
    const key = `auto:${c.id}`;
    if (hasKey(au, key)) continue;
    au = append(au, { at: c.closedH, role: 'system', action: 'alarm.autoclose', target: c.key, rule: `AC-79 ${seed.config.autoRecoverHours}시간 이어서 정상 · 자동 회복`, key });
  }
  for (const month of snap.deletedMonths) {
    const key = `raw:${month}`;
    if (hasKey(au, key)) continue;
    au = append(au, { at: snap.now, role: 'system', action: 'raw.delete', target: `${month} n=${rawDeletionCount(seed, month)}`, rule: `AC-47 이의 기한 ${days(seed.config.rawRetentionHours)} 뒤`, key });
  }
  return { state: st, audit: au };
}
