// 역할 × 칸 노출표(docs/data-model.md 3절). 화면에 넘기기 전에 여기서 거른다(AC-02 · ADR 0003).
// 원칙: 허용한 칸만 골라 새 객체를 만든다(빼는 방식이 아니라 고르는 방식).
import { householdHourly } from './core/settlement.js';
import { dayOf, hourOf } from './core/time.js';

export const ROLES = ['contractor', 'resident', 'complex', 'hq'];

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const ALARM_KEYS = ['id', 'key', 'assetId', 'kind', 'zone', 'cause', 'via', 'status', 'lossWon', 'estimated', 'firstH', 'openedH', 'escalateReason', 'reopenCount', 'resultMemo', 'checkH', 'x', 'y', 'note', 'capacityKw', 'dayLossWon', 'holdH', 'holdLossWon', 'siteCheck', 'common'];
const WO_KEYS = ['id', 'key', 'assetId', 'kind', 'zone', 'cause', 'status', 'lossWon', 'openedH', 'dueH', 'occurrences', 'escalateReason', 'x', 'y'];

function assetStatus(snap, assetId) {
  const a = snap.alarms.find((x) => x.assetId === assetId) ?? snap.workOrders.find((x) => x.assetId === assetId);
  if (!a) return 'normal';
  if (a.cause === 'safety') return 'safety';
  if (a.estimated) return 'estimated';
  return 'fault';
}

function contractorView(seed, snap, contractorId) {
  const mine = (x) => snap.owners[x.assetId] === contractorId;
  const myAssets = seed.assets.filter((a) => snap.owners[a.id] === contractorId);
  const c = seed.contractors.find((x) => x.id === contractorId);
  return {
    role: 'contractor', now: snap.now,
    contractor: pick(c, ['id', 'name', 'plan']),
    alarms: snap.alarms.filter(mine).map((a) => pick(a, ALARM_KEYS)),
    workOrders: snap.workOrders.filter(mine).map((w) => pick(w, WO_KEYS)),
    proposals: snap.proposals[contractorId] ?? [],
    map: myAssets.map((a) => ({ id: a.id, kind: a.kind, x: a.x, y: a.y, zone: a.zone, status: assetStatus(snap, a.id) })),
    obligations: snap.obligations.filter((o) => snap.owners[o.assetId] === contractorId)
      .map((o) => pick(o, ['assetId', 'warrantyEnd', 'warrantyDaysLeft', 'report', 'reportDueSoon', 'reportOverdue', 'connectionEnd', 'connectionDaysLeft', 'warrantyClaims'])),
    bill: snap.settlementPreview.lines.filter((l) => l.contractorId === contractorId)
      .map((l) => pick(l, ['assetId', 'plan', 'days', 'monthDays', 'feeWon', 'creditRate', 'creditWon', 'billedWon'])),
    billMonth: snap.settlementPreview.month,
    sources: seed.obligationSources,
  };
}

function residentView(seed, snap, householdId) {
  const day = dayOf(snap.now);
  const hourly = householdHourly(seed, householdId, day, snap.deletedMonths);
  const upto = hourOf(snap.now);
  const gen = snap.complexHourly.reduce((s, h) => s + h.genKwh, 0);
  const load = snap.complexHourly.reduce((s, h) => s + h.loadKwh, 0);
  const common = seed.assets.filter((a) => a.owner === 'common');
  const statuses = common.map((a) => assetStatus(snap, a.id));
  const cfg = seed.config;
  const myMissions = snap.missions.list.map((m) => {
    const base = { day: m.day, hour: m.hour, status: m.status };
    if (m.status !== 'judged') return base;
    const r = m.results[householdId];
    const ap = snap.pendingAppeals.concat([]).find((a) => a.missionDay === m.day && a.householdId === householdId);
    return { ...base, verdict: r.verdict, points: r.points, ratioPct: r.ratioPct, blanks: r.blanks, overturned: Boolean(r.overturned), appealDueH: m.appealDueH, appealPending: Boolean(ap) };
  });
  return {
    role: 'resident', now: snap.now, householdId,
    todayHourly: hourly ? hourly.slice(0, upto) : null, // 1시간 합계만(AC-36 · AC-46)
    solarSharePct: load > 0 ? Math.round((Math.min(gen, load) / load) * 100) : 0,
    commonAssets: { total: common.length, normal: statuses.filter((s) => s === 'normal').length },
    missions: myMissions,
    pointsTotal: myMissions.reduce((s, m) => s + (m.points ?? 0), 0),
    rules: { baselineDays: cfg.missionBaselineDays, lookbackDays: cfg.missionBaselineLookbackDays, successPct: Math.round(cfg.missionSuccessRatio * 100), points: cfg.missionPoints, appealDays: cfg.appealHours / 24, blanksRule: '미션 1시간의 15분 검침 4칸 중 1칸이라도 비면 판정 불가' },
    budgetExhausted: snap.missions.remainingWon < snap.missions.maxPerMissionWon,
  };
}

function complexView(seed, snap) {
  const common = seed.assets.filter((a) => a.owner === 'common');
  const gen = snap.complexHourly.reduce((s, h) => s + h.genKwh, 0);
  const load = snap.complexHourly.reduce((s, h) => s + h.loadKwh, 0);
  return {
    role: 'complex', now: snap.now,
    complex: pick(seed.complex, ['name', 'households', 'buildings']),
    today: { genKwh: Math.round(gen), loadKwh: Math.round(load), solarSharePct: load > 0 ? Math.round((Math.min(gen, load) / load) * 100) : 0 },
    hourly: snap.complexHourly.map((h) => ({ hour: h.hour, genKwh: Math.round(h.genKwh), loadKwh: Math.round(h.loadKwh) })),
    commonAssets: common.map((a) => ({ id: a.id, kind: a.kind, building: a.building ?? null, status: assetStatus(snap, a.id) })),
    safetyAlarms: snap.alarms.filter((a) => a.cause === 'safety' && common.some((c) => c.id === a.assetId)).map((a) => pick(a, ['assetId', 'status', 'firstH'])), // AC-11
    // 공용 설비 알람과 현장 1차 확인(AC-60~63). 안전 알람은 체크리스트 0개.
    commonAlarms: snap.alarms.filter((a) => common.some((c) => c.id === a.assetId)).map((a) => ({
      ...pick(a, ['key', 'assetId', 'cause', 'status', 'firstH', 'dayLossWon', 'siteCheck']),
      checklist: a.cause === 'safety' ? [] : seed.config.siteCheckItems,
      expertOnly: a.cause === 'safety',
    })),
    budget: pick(snap.missions, ['approvedWon', 'spentWon', 'remainingWon', 'maxPerMissionWon']),
    partnerReport: pick(snap.partnerReport, ['participantHouseholds', 'successCount', 'paidWon', 'movedKwh', 'remainingWon']), // AC-45
    partners: seed.partners.map((p) => pick(p, ['id', 'name'])),
  };
}

function hqView(seed, snap, audit) {
  const p = snap.settlementPreview;
  const byContractor = {};
  for (const l of p.lines) {
    byContractor[l.contractorId] ??= { contractorId: l.contractorId, sites: 0, feeWon: 0, creditWon: 0, billedWon: 0 };
    const b = byContractor[l.contractorId];
    b.sites++; b.feeWon += l.feeWon; b.creditWon += l.creditWon; b.billedWon += l.billedWon;
  }
  const missionRow = (m) => (m.status === 'judged' ? { day: m.day, hour: m.hour, status: m.status, counts: m.counts, paidWon: m.paidWon } : pick(m, ['day', 'hour', 'status']));
  return {
    role: 'hq', now: snap.now,
    alarms: snap.alarms.map((a) => ({ ...pick(a, ALARM_KEYS), owner: snap.owners[a.assetId] })),
    workOrders: snap.workOrders.map((w) => ({ ...pick(w, WO_KEYS), owner: snap.owners[w.assetId] })),
    queue: [...snap.alarms, ...snap.workOrders].filter((x) => x.status === '본사대기').map((x) => ({ ...pick(x, ['id', 'key', 'assetId', 'cause', 'status', 'escalateReason', 'lossWon']), owner: snap.owners[x.assetId] })),
    exceptions: snap.exceptions.map((e) => pick(e, ['id', 'type', 'refId', 'note', 'options', 'decision', 'decidedH', 'openedH'])),
    settlement: {
      month: p.month, lines: Object.values(byContractor), detail: p.lines.map((l) => pick(l, ['contractorId', 'assetId', 'days', 'feeWon', 'outageH', 'creditRate', 'creditWon', 'billedWon'])),
      totalFeeWon: p.totalFeeWon, totalCreditWon: p.totalCreditWon, totalBilledWon: p.totalBilledWon,
      lockReasons: snap.lockReasons, closed: snap.settlementClosed ? pick(snap.settlementClosed, ['month', 'closedH', 'totalBilledWon']) : null,
    },
    // 재심은 가명 ID와 판정 근거(기준선 대비 % · 빈 칸 수)만(data-model 3절)
    appeals: snap.pendingAppeals.map((a) => {
      const m = snap.missions.list.find((x) => x.day === a.missionDay);
      const r = m?.results?.[a.householdId] ?? {};
      return { missionDay: a.missionDay, householdId: a.householdId, filedH: a.filedH, verdict: r.verdict ?? null, ratioPct: r.ratioPct ?? null, blanks: r.blanks ?? null };
    }),
    missions: snap.missions.list.map(missionRow),
    budget: pick(snap.missions, ['approvedWon', 'spentWon', 'remainingWon', 'maxPerMissionWon']),
    partnerReport: pick(snap.partnerReport, ['participantHouseholds', 'successCount', 'paidWon', 'movedKwh', 'remainingWon']),
    proposals: snap.proposals.HQ ?? [],
    deletedMonths: snap.deletedMonths,
    audit: audit.map((e) => pick(e, ['seq', 'at', 'role', 'action', 'target', 'rule'])),
  };
}

export function forRole(seed, snap, role, opts = {}) {
  switch (role) {
    case 'contractor': return contractorView(seed, snap, opts.contractorId ?? 'K1');
    case 'resident': return residentView(seed, snap, opts.householdId ?? 'H-0001');
    case 'complex': return complexView(seed, snap);
    case 'hq': return hqView(seed, snap, opts.audit ?? []);
    default: throw new Error(`알 수 없는 역할: ${role}`);
  }
}
