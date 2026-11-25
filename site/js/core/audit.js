// 감사 기록: 덧붙이기만 한다. 고치기 · 지우기 함수는 두지 않는다(AC-34).
// 대상(target)에는 ID만 넣는다. 사용량 값 · 이름 · 연락처는 넣지 않는다(AC-35).
const SAFE_TARGET = /^[A-Za-z0-9:@\-_. =]{1,80}$/;
const PHONE = /01[016789][-. ]?\d{3,4}[-. ]?\d{4}/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export function append(audit, { at, role, action, target, rule = '', key = null }) {
  const t = String(target);
  if (!SAFE_TARGET.test(t) || PHONE.test(t) || EMAIL.test(t)) throw new Error('감사 기록 대상은 ID만 넣을 수 있습니다');
  const seq = audit.length ? audit[audit.length - 1].seq + 1 : 1;
  const entry = Object.freeze({ seq, at, role, action, target: String(target), rule: String(rule).slice(0, 80), key });
  return Object.freeze([...audit, entry]);
}

export const hasKey = (audit, key) => audit.some((e) => e.key === key);
