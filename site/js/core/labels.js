// 설정값을 화면 · 기록 문구로 바꾸는 도우미. 문구에 숫자를 직접 쓰지 않는다(설정 한곳, ADR 0005).
export const manwon = (n) => (n % 10000 === 0 ? `${n / 10000}만 원` : `${Number(n).toLocaleString('ko-KR')}원`);
export const days = (hours) => `${hours / 24}일`;
