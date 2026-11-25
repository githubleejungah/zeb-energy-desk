// 시간 도구. H = 2026-08-01 00:00(UTC로 다룸)부터 센 시간 수.
const BASE = Date.UTC(2026, 7, 1, 0, 0, 0);
const HOUR = 3600 * 1000;

export const dayOf = (H) => Math.floor(H / 24);
export const hourOf = (H) => ((H % 24) + 24) % 24;
export const toDate = (H) => new Date(BASE + H * HOUR);
export const fromDateStr = (s) => Math.round((Date.parse(`${s}T00:00:00Z`) - BASE) / HOUR);
export const isWeekday = (day) => {
  const w = new Date(BASE + day * 24 * HOUR).getUTCDay();
  return w >= 1 && w <= 5;
};
export const monthOfDay = (day) => {
  const d = new Date(BASE + day * 24 * HOUR);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
export const monthRange = (month) => {
  const [y, m] = month.split('-').map(Number);
  const start = Math.round((Date.UTC(y, m - 1, 1) - BASE) / (24 * HOUR));
  const end = Math.round((Date.UTC(y, m, 1) - BASE) / (24 * HOUR));
  return { startDay: start, endDay: end, days: end - start }; // [startDay, endDay)
};
export const fmt = (H) => {
  const d = toDate(H);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:00`;
};
export const fmtDate = (H) => fmt(H).slice(0, 10);
export const isDaytime = (H, cfg) => {
  const h = hourOf(H);
  return h >= cfg.sunStartHour && h < cfg.sunEndHour;
};
