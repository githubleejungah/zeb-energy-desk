// 알람 감지와 생애주기(AC-06~18 · AC-60~66). 순수 함수: 같은 입력이면 같은 결과.
import { reading, inServiceOutage } from './telemetry.js';
import { dayOf, hourOf, isDaytime, fromDateStr } from './time.js';
import { manwon, days } from './labels.js';

// 그 시각의 담당(시공사 id · 'HQ' · 'PUB'). 이관 · 계약 종료 · 등록 누락 · 이관 결정 반영(AC-16 · AC-67).
export function ownerAt(seed, asset, H, overrides = {}) {
  const o = overrides[asset.id];
  if (o && H >= o.atH) return o.to; // 'PUB' = 가상 공공 사후관리 기관, 'END' = 관리 종료(AC-73 · AC-74)
  let cid = asset.contractorId;
  for (const t of seed.transfers) if (t.assetId === asset.id && fromDateStr(t.atDate) <= H) cid = t.to;
  if (!cid) return 'HQ';
  const c = seed.contractors.find((x) => x.id === cid);
  if (!c) return 'HQ';
  if (c.contractEnd && H >= fromDateStr(c.contractEnd) + 24) return 'HQ';
  return cid;
}

export function makeCtx(seed) {
  const cache = new Map();
  const r = (a, H) => {
    const k = `${a.id}|${H}`;
    let v = cache.get(k);
    if (!v) { v = reading(seed, a, H); cache.set(k, v); }
    return v;
  };
  const zoneCache = new Map();
  const neighborYield = (a, H) => {
    const k = `${a.zone}|${H}`;
    let list = zoneCache.get(k);
    if (!list) {
      list = seed.assets
        .filter((b) => b.kind === 'pv' && b.zone === a.zone)
        .map((b) => { const g = r(b, H).gen; return { id: b.id, y: g === null ? null : g / b.capacityKw }; });
      zoneCache.set(k, list);
    }
    const ys = list.filter((x) => x.id !== a.id && x.y !== null).map((x) => x.y);
    if (ys.length < 2) return null;
    return ys.reduce((s, y) => s + y, 0) / ys.length;
  };
  const ownBaseline = (a, H) => {
    const vals = [];
    for (let d = 1; d <= seed.config.ownBaselineDays; d++) { const g = r(a, H - 24 * d).gen; if (g !== null) vals.push(g); }
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };
  return { r, neighborYield, ownBaseline };
}

// 설비 하나의 이상 구간(episode) 찾기. [0, now) 시간을 훑는다.
export function detectEpisodes(seed, asset, now, ctx) {
  const cfg = seed.config;
  const eps = [];
  const is24 = asset.kind !== 'pv'; // 지열 · 충전기는 24시간 기준(AC-09)
  let hbMiss = 0, hbStart = 0, dataMiss = 0, dataStart = 0, low = 0, lowStart = 0;
  let openComm = null, openLow = null, openSafety = null;
  for (let H = 0; H < now; H++) {
    const rd = ctx.r(asset, H);
    const outage = inServiceOutage(seed, asset, H); // 회사 쪽 수집 중단 시간은 현장 알람에서 뺀다
    const watch = is24 || isDaytime(H, cfg);
    if (!outage) {
      if (!rd.hb) { if (hbMiss === 0) hbStart = H; hbMiss++; } else hbMiss = 0;
      if (rd.hb && !rd.data && watch) { if (dataMiss === 0) dataStart = H; dataMiss++; } else if (rd.data) dataMiss = 0;
    }
    if (!openComm) {
      if (hbMiss >= cfg.heartbeatMissingHours) openComm = { cause: 'comm', via: 'heartbeat', startH: hbStart, detectedH: H, endH: null }; // AC-07
      else if (dataMiss >= cfg.commDataHours) openComm = { cause: 'comm', via: 'data', startH: dataStart, detectedH: H, endH: null }; // AC-06
    } else if (!outage && rd.hb && rd.data) {
      openComm.endH = H; eps.push(openComm); openComm = null; hbMiss = 0; dataMiss = 0;
    }
    if (rd.data && watch) {
      let isLow = false;
      if (asset.kind === 'pv') {
        const ny = ctx.neighborYield(asset, H);
        isLow = ny !== null && ny > cfg.minNeighborYield && rd.gen / asset.capacityKw < cfg.lowRatio * ny; // AC-08 이웃 평균 대비
      } else {
        const b = ctx.ownBaseline(asset, H);
        isLow = b !== null && b > 0 && rd.gen < cfg.lowRatio * b;
      }
      if (isLow) { if (low === 0) lowStart = H; low++; } else {
        low = 0;
        if (openLow) { openLow.endH = H; eps.push(openLow); openLow = null; }
      }
      if (!openLow && low >= cfg.lowHours) openLow = { cause: 'low', startH: lowStart, detectedH: H, endH: null };
    }
    if (rd.safety && !openSafety) openSafety = { cause: 'safety', startH: H, detectedH: H, endH: null }; // AC-11
    else if (!rd.safety && openSafety) { openSafety.endH = H; eps.push(openSafety); openSafety = null; }
  }
  for (const e of [openComm, openLow, openSafety]) if (e) eps.push(e);
  return eps.map((e) => ({ ...e, assetId: asset.id }));
}

// 한 시간의 못 만든 전기량(kWh). 통신 끊김은 기대 발전 전체를 손실로 추정(AC-10).
export function hourLossKwh(seed, asset, cause, H, ctx) {
  if (cause === 'safety') return 0;
  if (asset.kind === 'pv') {
    if (!isDaytime(H, seed.config)) return 0;
    const ny = ctx.neighborYield(asset, H);
    if (ny === null) return 0;
    const exp = ny * asset.capacityKw;
    const g = ctx.r(asset, H).gen;
    return cause === 'comm' || g === null ? exp : Math.max(0, exp - g);
  }
  const b = ctx.ownBaseline(asset, H) ?? 0;
  const g = ctx.r(asset, H).gen;
  return cause === 'comm' || g === null ? b : Math.max(0, b - g);
}

// 이상 구간 안에서 [from, to) 시간의 손실(원)
export function lossBetween(seed, asset, ep, from, to, ctx) {
  let kwh = 0;
  const end = Math.min(ep.endH ?? to, to);
  for (let H = Math.max(ep.startH, from); H < end; H++) kwh += hourLossKwh(seed, asset, ep.cause, H, ctx);
  return Math.round(kwh * seed.config.lossPriceWon);
}

// 손실 금액(원) — 구간 처음부터 지금까지
export function lossOf(seed, asset, ep, now, ctx) {
  if (ep.cause === 'safety') return { lossWon: 0, estimated: false };
  return { lossWon: lossBetween(seed, asset, ep, ep.startH, now, ctx), estimated: ep.cause === 'comm' };
}

const OPEN = ['열림', '본사대기', '묶임', '보류'];
const AUTO = ['열림', '본사대기', '보류', '출동확정', '기관전달'];

// 한 key(설비:원인)의 생애주기를 시간 순서로 계산한다(F1).
function lifecycle(seed, asset, key, eps, state, now, ctx) {
  const cfg = seed.config;
  const confirms = state.dispatches.filter((d) => d.alarmKeys.includes(key) && d.confirmedH != null && d.confirmedH <= now); // 지금 누른 행동은 바로 반영
  const results = state.results.filter((x) => x.alarmKey === key && x.atH <= now);
  const holds = (state.holds ?? []).filter((x) => x.alarmKey === key && x.atH <= now);
  const checks = (state.siteChecks ?? []).filter((x) => x.alarmKey === key && x.atH <= now);
  const overrides = state.ownerOverrides ?? {};
  const byH = (list, f) => { const m = new Map(); for (const x of list) { const h = f(x); if (!m.has(h)) m.set(h, []); m.get(h).push(x); } return m; };
  const detAt = byH(eps, (e) => e.detectedH);
  const confAt = byH(confirms, (d) => d.confirmedH);
  const resAt = byH(results, (x) => x.atH);
  const holdAt = byH(holds, (x) => x.atH);
  const checkAt = byH(checks, (x) => x.atH);
  let cur = null;
  let wo = null;
  const closed = [];
  const occ = [];
  let latestEp = null;
  const start = eps.length ? Math.min(...eps.map((e) => e.detectedH)) : now;
  const newCase = (H, ep) => {
    const owner = ownerAt(seed, asset, H, overrides);
    const safety = ep.cause === 'safety';
    return {
      id: `${key}@${H}`, key, assetId: asset.id, cause: ep.cause, via: ep.via ?? null, openedH: H, firstH: H,
      status: owner === 'HQ' || safety ? '본사대기' : owner === 'PUB' ? '기관전달' : '열림', escalatedH: owner === 'HQ' || safety ? H : null,
      escalateReason: safety ? '안전 알람 즉시' : owner === 'HQ' ? '담당 없음' : null,
      assignee: null, closeReason: null,
      confirmedH: null, resultH: null, resultMemo: null, checkH: null, closedH: null, reopenCount: 0, owner, ep,
    };
  };
  const recur = (H) => {
    occ.push(H);
    const n = occ.filter((t) => t > H - cfg.recurWindowHours).length;
    if (!wo && n >= cfg.recurCount && cur) {
      wo = {
        id: `WO-${key}@${H}`, key, assetId: asset.id, cause: cur.cause, openedH: H, dueH: H + cfg.workOrderDueHours,
        status: '열림', confirmedH: null, resultH: null, checkH: null, closedH: null, escalatedH: null,
        lossAtOpen: asset.kind === 'pv' ? lossOf(seed, asset, latestEp, H, ctx).lossWon : null, alarmIds: [cur.id], owner: ownerAt(seed, asset, H, overrides),
      };
      cur.status = '묶임';
      for (const c of closed) if (c.firstH > H - cfg.recurWindowHours) wo.alarmIds.push(c.id);
    }
  };
  for (let H = start; H <= now; H++) {
    for (const ep of detAt.get(H) ?? []) {
      latestEp = ep;
      if (ep.cause !== 'safety' && ownerAt(seed, asset, H, overrides) === 'END') continue; // AC-73 관리 종료: 일반 알람 0건
      if (wo && wo.status !== '종결') {
        cur = newCase(H, ep); cur.status = '묶임'; wo.alarmIds.push(cur.id);
        if (wo.status === '조치입력') { wo.status = '열림'; wo.resultH = null; }
        occ.push(H);
      } else if (cur && cur.status !== '종결') {
        cur.ep = ep;
        if (cur.status === '조치입력') { cur.status = '열림'; cur.openedH = H; cur.reopenCount++; }
        recur(H);
      } else {
        cur = newCase(H, ep);
        recur(H);
      }
    }
    const target = () => (wo && wo.status !== '종결' ? wo : cur);
    for (const d of confAt.get(H) ?? []) {
      const t = target();
      if (t && OPEN.includes(t.status)) {
        t.status = '출동확정'; t.confirmedH = H; t.confirmedBy = d.by ?? d.contractorId;
        if (d.byRole === 'hq') t.assignee = t.confirmedBy; // AC-71 지정받은 시공사(또는 본사 직접) 화면에 보임
        if (t === wo && d.byRole === 'hq' && H >= wo.dueH) wo.dueH = H + cfg.workOrderDueHours; // AC-69 새 기한
      }
    }
    const enterResult = (t, memo) => {
      if (!t.confirmedH) t.confirmedH = H;
      t.status = '조치입력'; t.resultH = H; t.resultMemo = memo;
      const sunrise = dayOf(H) * 24 + cfg.sunStartHour;
      t.checkH = H < sunrise ? sunrise : sunrise + 24; // 조치 뒤 첫 해 뜬 시간(AC-17)
    };
    for (const x of resAt.get(H) ?? []) {
      const t = target();
      if (t && t.status !== '종결') enterResult(t, x.memo);
    }
    // 관리주체 현장 1차 확인(AC-60~62): 공용 설비 · 안전 제외
    for (const x of checkAt.get(H) ?? []) {
      const t = target();
      if (!t || t.status === '종결' || t.cause === 'safety' || asset.owner !== 'common') continue;
      t.siteCheck = { result: x.result, atH: H };
      if (x.result === 'solved') enterResult(t, '현장 1차 확인: 해결(관리주체)');
    }
    // 보류(AC-64): 안전 제외, 열림 · 출동확정에서만
    for (const x of holdAt.get(H) ?? []) {
      const t = target();
      if (t && t.cause !== 'safety' && ['열림', '출동확정'].includes(t.status)) { t.status = '보류'; t.holdH = H; t.holdKwh = 0; t.heldBy = x.by; }
    }
    const t = target();
    if (t && t.status === '조치입력' && H === t.checkH) {
      const recovered = latestEp && latestEp.endH !== null && latestEp.endH <= H;
      if (recovered) {
        t.status = '종결'; t.closedH = H;
        if (t === wo) { if (cur) { cur.status = '종결'; cur.closedH = H; closed.push(cur); cur = null; } }
        else { closed.push(cur); cur = null; }
      } else {
        t.status = '열림'; t.openedH = H; t.reopenCount = (t.reopenCount ?? 0) + 1; t.resultH = null; // AC-18
        if (t === cur) recur(H);
      }
    }
    // 관리 종료 · 공공 기관 전달(AC-73 · AC-74): 안전이 아닌 알람만
    const ov = overrides[asset.id];
    const ownNow = ov && H >= ov.atH ? ov.to : null;
    if (ownNow === 'END') {
      if (cur && cur.cause !== 'safety' && cur.status !== '종결') { cur.status = '종결'; cur.closedH = H; cur.closeReason = '관리 종료'; closed.push(cur); cur = null; }
      if (wo && wo.cause !== 'safety' && wo.status !== '종결') { wo.status = '종결'; wo.closedH = H; wo.closeReason = '관리 종료'; }
    } else if (ownNow === 'PUB') {
      for (const x of [cur, wo]) if (x && x.cause !== 'safety' && !['종결', '조치입력', '기관전달', '묶임'].includes(x.status)) { x.status = '기관전달'; x.escalateReason = null; }
    }
    // 자동 회복(AC-79): 안전 · 작업 지시 · 묶임 제외, 24시간 이어서 정상이면 종결
    if (cur && cur.cause !== 'safety' && AUTO.includes(cur.status) && latestEp && latestEp.endH !== null && H - latestEp.endH >= cfg.autoRecoverHours) {
      cur.status = '종결'; cur.closedH = H; cur.closeReason = '자동 회복'; closed.push(cur); cur = null;
    }
    // 출동 확정 뒤 조치 없음(AC-70): 확정마다 1번
    if (cur && cur.status === '출동확정' && H - cur.confirmedH >= cfg.resultDueHours) {
      cur.status = '본사대기'; cur.escalatedH = H; cur.escalateReason = `출동 확정 뒤 ${days(cfg.resultDueHours)} 조치 없음`;
    }
    // 보류 끝 조건(AC-65): 14일 또는 보류 뒤 손실 3만 원 초과 → 본사로 1번
    const th = target();
    if (th && th.status === '보류' && H < now) {
      if (latestEp && H >= latestEp.startH && (latestEp.endH === null || H < latestEp.endH)) th.holdKwh += hourLossKwh(seed, asset, latestEp.cause, H, ctx);
      const holdWon = Math.round(th.holdKwh * cfg.lossPriceWon);
      if (H + 1 - th.holdH >= cfg.holdMaxHours) { th.status = '본사대기'; th.escalatedH = H + 1; th.escalateReason = `보류 ${days(cfg.holdMaxHours)} 지남`; }
      else if (asset.kind === 'pv' && holdWon > cfg.holdLossLimitWon) { th.status = '본사대기'; th.escalatedH = H + 1; th.escalateReason = `보류 뒤 손실 ${manwon(cfg.holdLossLimitWon)} 초과`; }
    }
    if (cur && cur.status === '열림' && H - cur.openedH >= cfg.dispatchConfirmHours) {
      cur.status = '본사대기'; cur.escalatedH = H; cur.escalateReason = `${cfg.dispatchConfirmHours}시간 출동 미확정`; // AC-15
    }
    if (wo && !['종결', '본사대기', '기관전달'].includes(wo.status) && H >= wo.dueH && wo.escalatedFor !== wo.dueH) {
      wo.status = '본사대기'; wo.escalatedH = H; wo.escalatedFor = wo.dueH; // 기한마다 1번(AC-13 · AC-69)
      wo.escalateReason = `작업 지시 ${days(cfg.workOrderDueHours)} 미종결`; // AC-13
    }
  }
  return { cur, wo, closed, latestEp, occurrences: occ.length };
}

// 정렬 순서(AC-78 · AC-10 · AC-11)
const group = (a) => (a.cause === 'safety' ? 0 : a.lossWon === null || a.lossWon === undefined ? 2 : 1);
export function alarmOrder(a, b) {
  const g = group(a) - group(b);
  if (g) return g;
  if (group(a) === 1) return b.lossWon - a.lossWon;
  return (a.firstH ?? a.openedH) - (b.firstH ?? b.openedH);
}

// 전체 알람 계산
export function evaluate(seed, state, now, ctx = makeCtx(seed)) {
  const alarms = [];
  const workOrders = [];
  const closedAlarms = [];
  for (const asset of seed.assets) {
    const eps = detectEpisodes(seed, asset, now, ctx);
    const keys = [...new Set(eps.map((e) => `${asset.id}:${e.cause}`))];
    for (const key of keys) {
      const keyEps = eps.filter((e) => `${asset.id}:${e.cause}` === key).sort((a, b) => a.detectedH - b.detectedH);
      const { cur, wo, closed, latestEp, occurrences } = lifecycle(seed, asset, key, keyEps, state, now, ctx);
      if (wo) wo.occurrences = occurrences;
      const priced = asset.kind === 'pv'; // AC-77 지열 · 충전기는 금액을 매기지 않음
      const withLoss = (x, ep) => ({
        ...x, ...lossOf(seed, asset, ep, now, ctx),
        ...(priced ? {} : { lossWon: null }),
        impactHours: Math.max(0, Math.min(ep.endH ?? now, x.closedH ?? now, now) - ep.startH), // 가동 저하 · 끊김 시간
        dayLossWon: priced ? lossBetween(seed, asset, ep, now - 24, now, ctx) : null, // AC-66 하루 손실
        holdLossWon: priced && x.status === '보류' ? Math.round((x.holdKwh ?? 0) * seed.config.lossPriceWon) : null,
        zone: asset.zone, kind: asset.kind, capacityKw: asset.capacityKw, x: asset.x, y: asset.y,
        common: asset.owner === 'common', owner: ownerAt(seed, asset, now, state.ownerOverrides ?? {}),
      });
      for (const c of closed) closedAlarms.push(withLoss(c, c.ep));
      if (wo) {
        const w = withLoss(wo, latestEp);
        if (wo.status === '종결') closedAlarms.push(w); else workOrders.push(w);
      }
      if (cur && cur.status !== '종결') {
        const a = withLoss(cur, cur.ep);
        // 묶인 알람은 따로 띄우지 않는다. 단 손실이 묶을 때보다 커지면 새로 띄운다(AC-12 · AC-14).
        if (a.status === '묶임') {
          if (wo && a.lossWon !== null && wo.lossAtOpen !== null && a.lossWon > wo.lossAtOpen && cur.firstH > wo.openedH) alarms.push({ ...a, status: '열림', note: '묶음 뒤 손실 증가' });
        } else alarms.push(a);
      }
    }
  }
  alarms.sort(alarmOrder); // AC-78 안전 → 금액 있는 알람(손실 큰 순) → 금액 없는 알람(오래된 순)
  workOrders.sort(alarmOrder);
  return { alarms, workOrders, closedAlarms };
}
