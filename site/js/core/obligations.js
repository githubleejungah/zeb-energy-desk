// 시공사 의무 3가지(AC-21~24). 법률 검토가 아닌 확인 목록이다.
import { fromDateStr, fmtDate } from './time.js';

const addYears = (dateStr, n) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${y + n}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
const daysBetween = (fromH, toH) => Math.ceil((toH - fromH) / 24);

export function obligations(seed, state, now, closedAlarms) {
  const cfg = seed.config;
  return seed.assets.map((a) => {
    const warrantyEnd = addYears(a.install, a.warrantyYears);
    const connectionEnd = addYears(a.install, 5);
    // 사후관리: 설치 뒤 3년간 해마다 1번 보고. 다음 기한 = 아직 지나지 않은 첫 설치 기념일.
    let report = null;
    for (let k = 1; k <= 3; k++) {
      const submitted = state.reports.some((r) => r.assetId === a.id && r.year === k && r.submittedH != null && r.submittedH <= now);
      if (submitted) continue;
      const due = addYears(a.install, k);
      report = { year: k, due, daysLeft: daysBetween(now, fromDateStr(due)) };
      break;
    }
    const reportDueSoon = Boolean(report && report.daysLeft >= 0 && report.daysLeft <= cfg.reportDueSoonDays); // AC-22
    const reportOverdue = Boolean(report && report.daysLeft < 0);
    const warrantyEndH = fromDateStr(warrantyEnd);
    const warrantyClaims = closedAlarms
      .filter((c) => c.assetId === a.id && c.closedH != null && c.closedH < warrantyEndH)
      .map((c) => c.id); // AC-24
    return {
      assetId: a.id,
      warrantyEnd, warrantyDaysLeft: daysBetween(now, warrantyEndH),
      report, reportDueSoon, reportOverdue,
      connectionEnd, connectionDaysLeft: daysBetween(now, fromDateStr(connectionEnd)),
      warrantyClaims,
    };
  });
}

// 보고서 초안(AC-23): 설비 · 기간 · 알람 · 조치 이력만. 세대 정보 없음.
export function reportDraft(seed, assetId, year, alarmResult, now) {
  const a = seed.assets.find((x) => x.id === assetId);
  const hist = [...alarmResult.alarms, ...alarmResult.workOrders, ...alarmResult.closedAlarms]
    .filter((x) => x.assetId === assetId)
    .map((x) => ({ cause: x.cause, status: x.status, firstH: fmtDate(x.firstH ?? x.openedH), memo: x.resultMemo ?? '' }));
  return {
    title: `사후관리 보고서 초안(가상 양식) — ${assetId} · ${year}년 차`,
    asset: { id: a.id, kind: a.kind, capacityKw: a.capacityKw, install: a.install, zone: a.zone },
    period: `${addYears(a.install, year - 1)} ~ ${addYears(a.install, year)}`,
    history: hist,
    madeAt: fmtDate(now),
    notice: '공단 시스템으로 보내지 않습니다. 공식 서식이 아닌 가상 양식입니다.',
  };
}
