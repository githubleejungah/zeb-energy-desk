// 출동 묶음 제안(AC-19): 같은 구역의 열린 알람 · 작업 지시를 알람 목록과 같은 순서(AC-78)로 최대 N곳.
import { alarmOrder } from './alarms.js';
const READY = ['열림', '본사대기'];

export function proposals(seed, alarmResult, owner) {
  const max = seed.config.dispatchMaxSites;
  const items = [
    ...alarmResult.alarms.filter((a) => a.owner === owner && READY.includes(a.status)),
    ...alarmResult.workOrders.filter((w) => w.owner === owner && READY.includes(w.status)),
  ];
  const byZone = new Map();
  for (const it of items) {
    if (!byZone.has(it.zone)) byZone.set(it.zone, []);
    byZone.get(it.zone).push(it);
  }
  const out = [];
  for (const [zone, list] of [...byZone.entries()].sort()) {
    list.sort(alarmOrder);
    for (let i = 0; i < list.length; i += max) {
      const chunk = list.slice(i, i + max);
      out.push({
        id: `P-${owner}-${zone}-${i / max + 1}`,
        zone,
        keys: [...new Set(chunk.map((c) => c.key))],
        stops: chunk.map((c) => ({ key: c.key, assetId: c.assetId, x: c.x, y: c.y, cause: c.cause, lossWon: c.lossWon })),
        lossWon: chunk.reduce((s, c) => s + (c.lossWon ?? 0), 0),
      });
    }
  }
  return out;
}
