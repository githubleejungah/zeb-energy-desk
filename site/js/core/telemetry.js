// 설비 계측(1시간 단위): 발전량 · 데이터 수신 · 살아 있음 신호 · 안전 신호.
// 세대 개인정보가 아니다. 세대 15분 원본은 raw.js(정산 전용)에 있다.
import { rand } from './prng.js';
import { dayOf, hourOf } from './time.js';

const active = (f, H) => f.fromH <= H && (f.toH === null || H < f.toH);

export function sunCurve(hour) {
  if (hour < 6 || hour >= 19) return 0;
  return Math.max(0, Math.sin((Math.PI * (hour + 0.5 - 6)) / 13));
}

export function weather(seed, zone, day) {
  const cloudy = seed.faults.find((f) => f.type === 'cloudy' && f.zone === zone && active(f, day * 24 + 12));
  if (cloudy) return cloudy.factor;
  return 0.35 + 0.65 * rand('wx', zone, day);
}

export function inServiceOutage(seed, asset, H) {
  return seed.serviceOutages.some(
    (o) => (o.zone === asset.zone || (o.assetIds && o.assetIds.includes(asset.id))) && o.fromH <= H && H < o.toH,
  );
}

// 한 설비의 한 시간 계측
export function reading(seed, asset, H) {
  const day = dayOf(H);
  const hour = hourOf(H);
  const fs = seed.faults.filter((f) => f.assetId === asset.id && active(f, H));
  let factor = 1;
  let data = true;
  let hb = true;
  let safety = false;
  for (const f of fs) {
    if (f.type === 'low') factor = Math.min(factor, f.factor);
    if (f.type === 'data') data = false;
    if (f.type === 'heartbeat') { data = false; hb = false; }
    if (f.type === 'safety') safety = true;
  }
  if (inServiceOutage(seed, asset, H)) { data = false; hb = false; }
  const noise = 0.95 + 0.1 * rand('n', asset.id, H);
  let gen;
  if (asset.kind === 'pv') gen = asset.capacityKw * sunCurve(hour) * weather(seed, asset.zone, day) * noise * factor;
  else if (asset.kind === 'geo') gen = asset.capacityKw * 0.6 * noise * factor;
  else gen = asset.capacityKw * (hour >= 8 && hour < 22 ? 0.5 : 0.1) * noise * factor; // 충전기 가동
  return { data, hb, safety, gen: data ? gen : null };
}

// 단지 공용 사용(kWh, 1시간) — 단지 합계, 세대 값 아님
export function complexLoad(day, hour) {
  // 가상 공용 사용(승강기 · 조명 · 펌프 · 환기). 맑은 날 낮에만 태양광이 넘치도록 잡았다.
  const base = hour >= 6 && hour < 24 ? 115 : 60;
  return base + 25 * rand('load', day, hour);
}

export function complexGen(seed, day, hour) {
  return seed.assets
    .filter((a) => a.kind === 'pv' && a.owner === 'common')
    .reduce((s, a) => s + (reading(seed, a, day * 24 + hour).gen ?? 0), 0);
}

// 그날 미션 시간: 10~15시 중 단지 태양광 발전이 공용 사용을 처음 넘는 시간(AC-37). 없으면 null.
const mhCache = new WeakMap();
export function missionHourOf(seed, day) {
  let m = mhCache.get(seed);
  if (!m) { m = new Map(); mhCache.set(seed, m); }
  if (m.has(day)) return m.get(day);
  let found = null;
  for (let h = 10; h < 15; h++) {
    if (complexGen(seed, day, h) > complexLoad(day, h)) { found = h; break; }
  }
  m.set(day, found);
  return found;
}
