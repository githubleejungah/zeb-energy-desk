import * as seed from '../site/js/data/seed.js';
import { defaultState } from '../site/js/core/store.js';
import { snapshot, reconcile } from '../site/js/core/engine.js';

export { seed };
export const D = (day, hour = 0) => day * 24 + hour;

export function fresh() {
  return { state: defaultState(seed), audit: [] };
}

export function run(state, audit = [], s = seed) {
  const snap = snapshot(s, state);
  const r = reconcile(s, state, audit, snap);
  return { snap: snapshot(s, r.state), state: r.state, audit: r.audit };
}

// 모든 키를 깊게 모은다(보안 시험용)
export function allKeys(obj, out = new Set()) {
  if (Array.isArray(obj)) { for (const x of obj) allKeys(x, out); return out; }
  if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) { out.add(k); allKeys(v, out); }
  return out;
}

export function arrays(obj, out = []) {
  if (Array.isArray(obj)) { out.push(obj); for (const x of obj) arrays(x, out); return out; }
  if (obj && typeof obj === 'object') for (const v of Object.values(obj)) arrays(v, out);
  return out;
}
