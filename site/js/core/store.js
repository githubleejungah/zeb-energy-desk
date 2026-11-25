// 브라우저 저장소: 가상 데이터만, 형식 버전, 깨지면 기본값(AC-52), 시연 초기화(AC-53).
import { append } from './audit.js';

export const KEYS = { state: 'zed:v1:state', audit: 'zed:v1:audit' };
export const VERSION = 1;

export function defaultState(seed) {
  const s = seed.seededActions;
  return {
    version: VERSION,
    clockH: seed.config.startH,
    dispatches: s.dispatches.map((d) => ({ ...d, by: d.contractorId })),
    results: s.results.map((r) => ({ ...r })),
    reports: s.reports.map((r) => ({ ...r })),
    budgets: s.budgets.map((b) => ({ ...b })),
    appeals: [],
    exceptionDecisions: {},
    settlements: {},
    missionLog: {},
    seen: {},
    holds: [],
    siteChecks: [],
    ownerOverrides: {},
    optIns: {},
  };
}

// 같은 형식 버전 안에서 나중에 더한 칸은 빈 값으로 채운다(어제 저장한 시연도 그대로 열리게).
export function normalize(x) {
  if (!x || typeof x !== 'object') return x;
  return { holds: [], siteChecks: [], ownerOverrides: {}, optIns: {}, ...x };
}

export function isValidState(x) {
  if (!x || typeof x !== 'object' || x.version !== VERSION || typeof x.clockH !== 'number') return false;
  for (const k of ['dispatches', 'results', 'reports', 'budgets', 'appeals', 'holds', 'siteChecks']) if (!Array.isArray(x[k])) return false;
  for (const k of ['exceptionDecisions', 'settlements', 'missionLog', 'seen', 'ownerOverrides', 'optIns']) if (!x[k] || typeof x[k] !== 'object' || Array.isArray(x[k])) return false;
  return true;
}

const isValidAudit = (a) => Array.isArray(a) && a.every((e) => e && typeof e.seq === 'number' && typeof e.action === 'string');

function safeGet(storage, k) {
  try { return storage.getItem(k); } catch { return null; }
}
function safeSet(storage, k, v) {
  try { storage.setItem(k, v); return true; } catch { return false; }
}

export function load(storage, seed) {
  const rawS = safeGet(storage, KEYS.state);
  const rawA = safeGet(storage, KEYS.audit);
  if (rawS === null) return { state: defaultState(seed), audit: [], notice: null };
  try {
    const state = normalize(JSON.parse(rawS));
    const audit = rawA ? JSON.parse(rawA) : [];
    if (isValidState(state) && isValidAudit(audit)) return { state, audit, notice: null };
  } catch { /* 아래에서 기본값으로 */ }
  return { state: defaultState(seed), audit: [], notice: '저장된 값을 읽을 수 없어 기본 가상 데이터로 되돌렸습니다.' };
}

export function save(storage, state, audit) {
  return safeSet(storage, KEYS.state, JSON.stringify(state)) && safeSet(storage, KEYS.audit, JSON.stringify(audit));
}

export function reset(storage, seed) {
  try { storage.removeItem(KEYS.state); storage.removeItem(KEYS.audit); } catch { /* 저장소가 없어도 진행 */ }
  const state = defaultState(seed);
  const audit = append([], { at: state.clockH, role: 'viewer', action: 'demo.reset', target: 'all', rule: 'AC-53' });
  save(storage, state, audit);
  return { state, audit };
}

export function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}
