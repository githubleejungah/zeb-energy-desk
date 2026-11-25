// 정산 모듈 — 요금 · 감면 · 포인트 계산은 이 파일에서만 한다(AC-30).
// 세대 15분 원본(raw.js)을 읽는 유일한 파일이다(AC-46 · SEC-08).
import { householdUsage, householdIds, baselineHourly, isResponsive, RawDeletedError, BaselineExpiredError } from './raw.js';
import { rand } from './prng.js';
import { missionHourOf } from './telemetry.js';
import { ownerAt } from './alarms.js';
import { dayOf, monthOfDay, monthRange, isWeekday, fromDateStr } from './time.js';

// ---------- 구독 요금 · 감면 ----------

function outageCause(seed, state, o) {
  if (o.cause) return o.cause;
  return state.exceptionDecisions[`OC-${o.id}`]?.decision ?? null; // 미판정이면 null → 감면 없음, 마감은 잠김
}

export function creditRate(seed, hours) {
  for (const t of seed.config.creditTiers) if (hours > t.overHours) return t.rate; // AC-27 (높은 구간부터)
  return 0;
}

export function feeLines(seed, state, month) {
  const { startDay, endDay, days } = monthRange(month);
  const lines = new Map(); // `${contractorId}|${assetId}` → line
  const lineOf = (cid, a) => {
    const k = `${cid}|${a.id}`;
    if (!lines.has(k)) {
      const plan = seed.contractors.find((c) => c.id === cid).plan;
      lines.set(k, { contractorId: cid, assetId: a.id, plan, days: 0, outageH: 0 });
    }
    return lines.get(k);
  };
  for (const a of seed.assets) {
    const installDay = dayOf(fromDateStr(a.install));
    for (let d = startDay; d < endDay; d++) {
      if (d < installDay) continue;
      const cid = ownerAt(seed, a, d * 24 + 12, state.ownerOverrides ?? {});
      if (cid === 'HQ' || cid === 'PUB') continue; // 본사 · 공공 기관 관리 설비는 청구하지 않는다
      lineOf(cid, a).days++; // AC-26 일할
    }
  }
  // 회사 책임 장애 시간(AC-27 · AC-28)
  for (const o of seed.serviceOutages) {
    if (outageCause(seed, state, o) !== 'company') continue;
    for (const a of seed.assets) {
      if (!(o.zone === a.zone || (o.assetIds && o.assetIds.includes(a.id)))) continue;
      for (let H = Math.max(o.fromH, startDay * 24); H < Math.min(o.toH, endDay * 24); H++) {
        const cid = ownerAt(seed, a, H, state.ownerOverrides ?? {});
        if (cid === 'HQ' || cid === 'PUB') continue;
        const k = `${cid}|${a.id}`;
        if (lines.has(k)) lines.get(k).outageH++;
      }
    }
  }
  return [...lines.values()]
    .map((l) => {
      const feeWon = Math.floor((seed.config.plans[l.plan] * l.days) / days); // 원 미만 버림(AC-25)
      const rate = creditRate(seed, l.outageH);
      const creditWon = Math.min(Math.floor(feeWon * rate), feeWon); // 상한(AC-29)
      return { ...l, monthDays: days, feeWon, creditRate: rate, creditWon, billedWon: feeWon - creditWon };
    })
    .sort((a, b) => (a.contractorId + a.assetId).localeCompare(b.contractorId + b.assetId));
}

export function preview(seed, state, month) {
  const lines = feeLines(seed, state, month);
  const sum = (f) => lines.reduce((s, l) => s + l[f], 0);
  return { month, lines, totalFeeWon: sum('feeWon'), totalCreditWon: sum('creditWon'), totalBilledWon: sum('billedWon') };
}

// ---------- 미션 · 포인트 ----------

const maxPerMission = (seed) => seed.complex.households * seed.config.missionPoints;

export function approvedBudget(state, H) {
  return state.budgets.filter((b) => b.approvedH <= H).reduce((s, b) => s + b.approvedWon, 0);
}

// 미션 참여 신청(AC-76): 기본은 반응 세대 전부 + 일부(가상, AS-14). 입주민이 바꾼 값이 있으면 그 시각부터 그 값.
export function joined(seed, state, hid, H) {
  const o = state.optIns?.[hid];
  if (o && o.atH <= H) return o.on;
  return isResponsive(hid) || rand('join', hid) < seed.config.optInExtraRate;
}

// isMissionDay(d): 그날 미션이 열렸는지. 기준선에서 뺀다(AC-38, 영국 Octopus 방식).
// baselineOf(hid, d): 기준선용 1시간 합계(AC-75). 없으면 usageOf에서 1시간 합계를 만든다(시험용).
export function judge(seed, hid, day, hour, usageOf, isMissionDay = () => false, baselineOf = null) {
  const cfg = seed.config;
  const sumHour = (arr) => {
    const q = arr.slice(hour * 4, hour * 4 + 4);
    return q.some((v) => v === null) ? null : q.reduce((s, v) => s + v, 0);
  };
  const today = usageOf(hid, day);
  const blanks = today.slice(hour * 4, hour * 4 + 4).filter((v) => v === null).length;
  const used = sumHour(today);
  if (used === null) return { verdict: 'undecidable', points: 0, ratioPct: null, blanks }; // AC-39
  const base = [];
  for (let d = day - 1; d >= day - cfg.missionBaselineLookbackDays && base.length < cfg.missionBaselineDays; d--) {
    if (!isWeekday(d) || isMissionDay(d)) continue;
    let v;
    try { v = baselineOf ? baselineOf(hid, d)[hour] : sumHour(usageOf(hid, d)); } catch (e) { if (e instanceof RawDeletedError || e instanceof BaselineExpiredError) continue; throw e; }
    if (v !== null) base.push(v);
  }
  if (base.length < cfg.missionBaselineDays) return { verdict: 'undecidable', points: 0, ratioPct: null, blanks, reason: 'baseline' }; // AC-59
  const baseline = base.reduce((s, v) => s + v, 0) / base.length;
  const ratio = baseline > 0 ? used / baseline : 0;
  const success = ratio >= cfg.missionSuccessRatio; // AC-38
  return { verdict: success ? 'success' : 'fail', points: success ? cfg.missionPoints : 0, ratioPct: Math.round(ratio * 100), blanks, movedKwh: success ? used - baseline : 0 };
}

// 판정 결과에 재심 결과를 덧씌운다(원래 판정은 그대로 둠).
function withAppeals(seed, state, m) {
  const results = {};
  const counts = { success: 0, fail: 0, undecidable: 0 };
  let paid = 0;
  for (const [hid, r0] of Object.entries(m.results)) {
    const ap = state.appeals.find((a) => a.missionDay === m.day && a.householdId === hid);
    const r = ap?.decision === 'overturn' ? { ...r0, verdict: 'success', points: seed.config.missionPoints, overturned: true } : r0;
    results[hid] = r;
    counts[r.verdict]++;
    paid += r.points;
  }
  return { ...m, results, counts, paidWon: paid };
}

// now까지의 미션을 날짜 순서로 계산한다.
// 한 번 판정한 미션은 state.missionLog의 기록(판정 · 포인트만)을 쓰고 다시 계산하지 않는다.
// 그래서 원본을 지운 뒤에도 공개한 판정이 바뀌지 않는다. fresh = 이번에 새로 판정해 기록할 것.
export function missions(seed, state, now, deletedMonths = []) {
  const ids = householdIds(seed.complex.households);
  const usageCache = new Map();
  const usageOf = (hid, d) => {
    const k = `${hid}|${d}`;
    if (!usageCache.has(k)) usageCache.set(k, householdUsage(seed, hid, d, deletedMonths));
    return usageCache.get(k);
  };
  const out = [];
  const fresh = [];
  const opened = new Set(); // 미션이 열린 날(판정 · 진행 중). 예산 소진으로 안 열린 날은 기준선에 쓴다.
  // 시연 기간 앞(7월)은 같은 규칙으로 미션이 열렸다고 본다.
  const isMissionDay = (d) => (d < 0 ? missionHourOf(seed, d) !== null : opened.has(d));
  let spent = 0;
  for (let day = 0; day <= dayOf(now); day++) {
    const logged = state.missionLog?.[day];
    if (logged) {
      const m = withAppeals(seed, state, logged);
      out.push(m); spent += m.paidWon; opened.add(day);
      continue;
    }
    if (deletedMonths.includes(monthOfDay(day))) continue;
    const hour = missionHourOf(seed, day);
    if (hour === null) continue;
    const startH = day * 24 + hour;
    if (startH > now) { out.push({ day, hour, status: 'upcoming' }); continue; }
    const remaining = approvedBudget(state, startH) - spent;
    if (remaining < maxPerMission(seed)) { out.push({ day, hour, status: 'skipped_budget', remaining }); continue; } // AC-41
    opened.add(day);
    if (startH + 1 > now) { out.push({ day, hour, status: 'open' }); continue; }
    const results = {};
    let moved = 0;
    const baselineOf = (hid, d) => baselineHourly(seed, hid, d, startH); // AC-75 판정 시각 앞 30일까지
    for (const hid of ids) {
      if (!joined(seed, state, hid, startH)) continue; // AC-76 신청 세대만 판정
      const r = judge(seed, hid, day, hour, usageOf, isMissionDay, baselineOf);
      moved += r.movedKwh ?? 0;
      results[hid] = { verdict: r.verdict, points: r.points, ratioPct: r.ratioPct, blanks: r.blanks };
    }
    const rec = { day, hour, status: 'judged', publishedH: startH + 1, appealDueH: startH + 1 + seed.config.appealHours, movedKwh: Math.round(moved * 10) / 10, results };
    fresh.push(rec);
    const m = withAppeals(seed, state, rec);
    out.push(m); spent += m.paidWon;
  }
  const approved = approvedBudget(state, now);
  return { list: out, fresh, approvedWon: approved, spentWon: spent, remainingWon: approved - spent, maxPerMissionWon: maxPerMission(seed) };
}

// 입주민 화면용 1시간 합계(AC-36). 15분 값은 밖으로 내보내지 않는다.
export function householdHourly(seed, hid, day, deletedMonths = []) {
  try {
    const q = householdUsage(seed, hid, day, deletedMonths);
    return Array.from({ length: 24 }, (_, h) => {
      const part = q.slice(h * 4, h * 4 + 4);
      return part.some((v) => v === null) ? null : Math.round(part.reduce((s, v) => s + v, 0) * 100) / 100;
    });
  } catch (e) {
    if (e instanceof RawDeletedError) return null;
    throw e;
  }
}

// 제휴사 리포트: 합계 5가지만(AC-45)
export function partnerReport(m) {
  const judged = m.list.filter((x) => x.status === 'judged');
  const participants = new Set();
  for (const x of judged) for (const [hid, r] of Object.entries(x.results)) if (r.verdict !== 'undecidable') participants.add(hid);
  return {
    participantHouseholds: participants.size,
    successCount: judged.reduce((s, x) => s + x.counts.success, 0),
    paidWon: m.spentWon,
    movedKwh: Math.round(judged.reduce((s, x) => s + x.movedKwh, 0) * 10) / 10,
    remainingWon: m.remainingWon,
  };
}

// 월 정산 마감(AC-30 · AC-32 · AC-33). 성공하면 그달 결과를 얼린다.
export function close(seed, state, month, now, shownTotalWon, lockReasons) {
  if (lockReasons.length) return { ok: false, reason: 'locked', lockReasons };
  if (state.settlements[month]?.closedH != null) return { ok: false, reason: 'already' };
  const p = preview(seed, state, month);
  if (p.totalBilledWon !== shownTotalWon) return { ok: false, reason: 'mismatch', diffWon: p.totalBilledWon - shownTotalWon };
  return { ok: true, settlement: { month, closedH: now, ...p } };
}

// 원본 삭제 대상 달(AC-47): 마감 + 이의 기한(7일)이 지난 달
export function deletedMonths(seed, state, now) {
  return Object.values(state.settlements)
    .filter((s) => s.closedH != null && now >= s.closedH + seed.config.rawRetentionHours)
    .map((s) => s.month);
}

export const rawDeletionCount = (seed, month) => seed.complex.households * monthRange(month).days * 96;
