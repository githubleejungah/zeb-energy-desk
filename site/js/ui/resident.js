// 입주민 앱(B): 1시간 합계 · 단지 태양광 비율 · 미션 · 포인트 · 이의 제기
import { h, s, card, table, chip, stat, button, when } from './dom.js';

const dayLabel = (d) => when(d * 24).slice(0, 10);

const VERDICT = { success: ['성공', 'st-done'], fail: ['실패', 'st-open'], undecidable: ['판정 불가', 'al-est'] };

function bars(values) {
  const max = Math.max(0.1, ...values.filter((x) => x !== null));
  const w = 600 / 24;
  const svg = s('svg', { viewBox: '0 0 620 140', class: 'bars', role: 'img', 'aria-label': '오늘 시간별 사용량(1시간 합계)' });
  values.forEach((v, i) => {
    if (v === null) { svg.append(s('text', { x: 10 + i * w + w / 2, y: 110, 'text-anchor': 'middle', class: 'map-t' }, '빈')); return; }
    const bh = (v / max) * 100;
    const r = s('rect', { x: 10 + i * w + 2, y: 115 - bh, width: w - 4, height: bh, rx: 2, fill: 'var(--brand)' });
    r.append(s('title', null, `${i}시 ${v}kWh`));
    svg.append(r);
  });
  for (let i = 0; i < 24; i += 3) svg.append(s('text', { x: 10 + i * w + w / 2, y: 132, 'text-anchor': 'middle', class: 'map-t' }, `${i}시`));
  return svg;
}

export function renderResident(v, api) {
  const today = v.missions.find((m) => m.status === 'upcoming' || m.status === 'open') ?? null;
  const past = v.missions.filter((m) => m.status === 'judged').slice().reverse();
  return h('div', { class: 'grid' },
    h('div', { class: 'stats' },
      stat('우리 단지 태양광이 공용 전기를 채운 비율(오늘)', `${v.solarSharePct}%`),
      stat('단지 공용 설비', `${v.commonAssets.total}개 중 ${v.commonAssets.normal}개 정상`),
      stat('내 포인트(1점 = 1원)', `${v.pointsTotal.toLocaleString('ko-KR')}점`)),
    card(`오늘 우리 집 사용량 — ${v.householdId}(가명) · 1시간 합계`,
      v.todayHourly ? bars(v.todayHourly) : h('p', { class: 'muted' }, '보관 기간이 지나 원본이 삭제되었습니다.'),
      h('p', { class: 'muted small' }, '15분 단위로 모으지만 화면에는 1시간 합계만 보여 줍니다. 원본은 정산에만 쓰고 기한이 지나면 지웁니다.')),
    card('남는 전기 쓰기 미션',
      v.budgetExhausted ? h('p', { class: 'warnbox' }, '예산 소진 — 관리주체가 새 예산을 승인하면 미션이 다시 열립니다.') : null,
      today ? h('p', null, chip(today.status === 'open' ? '진행 중' : '예정', 'st-go'), ` 오늘 ${today.hour}:00 ~ ${today.hour + 1}:00 — 단지 태양광이 남는 시간입니다. 이때 세탁기 · 식기세척기를 돌려 보세요.`) : h('p', { class: 'muted' }, '오늘은 열린 미션이 없습니다(태양광이 남지 않거나 예산 소진).'),
      h('ul', { class: 'rules' },
        h('li', null, `기준선: 미션이 없던 직전 평일 ${v.rules.baselineDays}일(최대 ${v.rules.lookbackDays}일 전까지)의 같은 시간 평균. 못 채우면 판정 불가`),
        h('li', null, `성공: 미션 1시간 사용량이 기준선의 ${v.rules.successPct}% 이상 → ${v.rules.points}점(하루 1회)`),
        h('li', null, `판정 불가: ${v.rules.blanksRule}. 포인트도 실패도 아닙니다.`),
        h('li', null, `이의 제기: 결과 공개 뒤 ${v.rules.appealDays}일 안 1번, 재심 1번 뒤 종결`))),
    card('지난 미션', table(['날짜', '시간', '결과', '기준선 대비', '포인트', ''],
      past.slice(0, 12).map((m) => [
        dayLabel(m.day), `${m.hour}시`,
        chip(VERDICT[m.verdict][0] + (m.overturned ? '(재심)' : ''), VERDICT[m.verdict][1]),
        m.ratioPct === null ? `빈 칸 ${m.blanks}개` : `${m.ratioPct}%`,
        `${m.points}점`,
        m.appealPending ? chip('재심 대기', 'st-hq')
          : m.verdict !== 'success' && v.now <= m.appealDueH ? button('이의 제기', () => api.fileAppeal(m.day), { class: 'btn ghost', title: `기한 ${when(m.appealDueH)}` }) : '',
      ]))),
  );
}
