// 세대 사용량 15분 원본(하루 96칸, kWh). 저장하지 않고 씨앗값으로 만든다(ADR 0002).
// 이 파일을 불러 쓰는 곳은 settlement.js 하나뿐이어야 한다(SEC-08, 시험으로 검사).
import { rand, stream } from './prng.js';
import { monthOfDay } from './time.js';
import { missionHourOf } from './telemetry.js';

export class RawDeletedError extends Error {
  constructor(month) {
    super(`원본 삭제됨: ${month}`);
    this.month = month;
  }
}

const shape = (hour) => (hour < 6 ? 0.4 : hour < 9 ? 1.1 : hour < 17 ? 0.7 : hour < 23 ? 1.4 : 0.6);

export const householdIds = (n) => Array.from({ length: n }, (_, i) => `H-${String(i + 1).padStart(4, '0')}`);

// 미션에 반응하는 세대(가상): 약 4가구 중 1가구
export const isResponsive = (hid) => rand('resp', hid) < 0.25;

export function householdUsage(seed, hid, day, deletedMonths = []) {
  const month = monthOfDay(day);
  if (deletedMonths.includes(month)) throw new RawDeletedError(month);
  const base = 0.05 + 0.1 * rand('base', hid);
  const mh = missionHourOf(seed, day);
  const out = new Array(96);
  const next = stream('u', hid, day);
  for (let q = 0; q < 96; q++) {
    const hour = Math.floor(q / 4);
    let v = base * shape(hour) * (0.8 + 0.4 * next());
    if (mh !== null && hour === mh && isResponsive(hid)) v *= 1.5;
    out[q] = Math.round(v * 1000) / 1000;
  }
  // 가끔 검침이 빠진다(판정 불가 사례, AC-39)
  if (rand('miss', hid, day) < 0.04) {
    const q = 40 + Math.floor(rand('missq', hid, day) * 20); // 10~15시 사이
    out[q] = null;
  }
  return out;
}
