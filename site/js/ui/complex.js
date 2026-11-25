// 단지 화면(C): 건설사 · 관리주체 — 단지 합계 · 공용 설비 · 안전 알람 · 제휴 예산 · 제휴사 리포트
import { h, s, card, table, chip, stat, button, won, when, CAUSE, STATUS_CLASS } from './dom.js';

const ST = { normal: ['정상', 'st-done'], fault: ['고장', 'al-fault'], estimated: ['통신 끊김', 'al-est'], safety: ['안전', 'al-safety'] };

function genLoad(hourly) {
  const max = Math.max(1, ...hourly.flatMap((x) => [x.genKwh, x.loadKwh]));
  const w = 600 / 24;
  const svg = s('svg', { viewBox: '0 0 620 140', class: 'bars', role: 'img', 'aria-label': '오늘 단지 발전량과 공용 사용량' });
  for (const x of hourly) {
    const gh = (x.genKwh / max) * 100;
    const lh = (x.loadKwh / max) * 100;
    svg.append(s('rect', { x: 10 + x.hour * w + 2, y: 115 - gh, width: (w - 4) / 2, height: gh, fill: 'var(--brand)' }));
    svg.append(s('rect', { x: 10 + x.hour * w + 2 + (w - 4) / 2, y: 115 - lh, width: (w - 4) / 2, height: lh, fill: 'var(--muted)' }));
  }
  for (let i = 0; i < 24; i += 3) svg.append(s('text', { x: 10 + i * w + w / 2, y: 132, 'text-anchor': 'middle', class: 'map-t' }, `${i}시`));
  return h('div', null, svg, h('div', { class: 'legend' }, h('span', { class: 'lg lg-brand' }, '태양광 발전'), h('span', { class: 'lg lg-muted' }, '공용 사용')));
}

export function renderComplex(v, api) {
  const amount = h('input', { type: 'number', min: 0, step: 10000, value: 100000, 'aria-label': '승인 금액(원)' });
  const r = v.partnerReport;
  return h('div', { class: 'grid' },
    h('div', { class: 'stats' },
      stat('오늘 태양광 발전', `${v.today.genKwh}kWh`), stat('오늘 공용 사용', `${v.today.loadKwh}kWh`),
      stat('태양광이 채운 비율', `${v.today.solarSharePct}%`), stat('열린 안전 알람', String(v.safetyAlarms.length), v.safetyAlarms.length ? 'danger' : '')),
    v.safetyAlarms.length ? h('div', { class: 'dangerbox' }, v.safetyAlarms.map((a) => h('p', null, `안전 알람: ${a.assetId} — ${when(a.firstH)}부터 · 본사에 바로 올라감(${a.status})`))) : null,
    card(`${v.complex.name} · ${v.complex.households}세대 · 오늘 시간별(단지 합계)`, genLoad(v.hourly),
      h('p', { class: 'muted small' }, '세대별 사용량은 이 화면에 보이지 않습니다.')),
    card('공용 설비 알람 — 현장 1차 확인',
      h('p', { class: 'muted small' }, '눈으로 확인하고 결과만 고르세요. 인버터 · 배선 안쪽 작업은 하지 마세요. 안전 알람은 전문가만 조치합니다.'),
      v.commonAlarms.length ? h('div', { class: 'grid' }, v.commonAlarms.map((a) => siteCheckBox(a, api))) : h('p', { class: 'muted' }, '열린 알람이 없습니다.')),
    card('공용 설비 상태', table(['설비', '종류', '동', '상태'], v.commonAssets.map((a) => [a.id, a.kind === 'pv' ? '지붕 태양광' : a.kind === 'geo' ? '지열' : '충전기', a.building ?? '—', chip(ST[a.status][0], ST[a.status][1])]))),
    card(`제휴 리워드 예산 — ${v.partners.map((p) => p.name).join(', ')}`,
      table(['승인 합계', '지급', '남은 예산', '1회 최대 지급'], [[won(v.budget.approvedWon), won(v.budget.spentWon), won(v.budget.remainingWon), won(v.budget.maxPerMissionWon)]]),
      v.budget.remainingWon < v.budget.maxPerMissionWon ? h('p', { class: 'warnbox' }, '남은 예산이 1회 최대 지급액보다 적어 새 미션이 열리지 않습니다.') : null,
      h('div', { class: 'form' }, h('span', null, '추가 예산 승인'), amount, button('승인', () => api.approveBudget(v.partners[0].id, amount.value)))),
    card('제휴사 리포트 — 합계 5가지만(세대별 내역 없음)', table(['참여 세대 수', '성공 건수', '지급 총액', '옮긴 전력량', '남은 예산'],
      [[`${r.participantHouseholds}세대`, `${r.successCount}건`, won(r.paidWon), `${r.movedKwh}kWh`, won(r.remainingWon)]])),
  );
}

function siteCheckBox(a, api) {
  const head = h('p', null, h('strong', null, a.assetId), ' ', chip(CAUSE[a.cause], a.cause === 'safety' ? 'al-safety' : a.cause === 'comm' ? 'al-est' : 'al-fault'), chip(a.status, STATUS_CLASS[a.status]), ` ${a.dayLossWon === null || a.dayLossWon === undefined ? `${a.cause === 'comm' ? '끊김' : '가동 저하'} ${a.impactHours ?? 0}시간` : `하루 손실 ${won(a.dayLossWon)}`} · ${when(a.firstH)}부터`);
  if (a.expertOnly) return h('div', { class: 'dangerbox' }, head, h('p', null, '전문가만 조치 — 가까이 가지 말고 시공사 · 본사 연락을 기다리세요.'));
  if (a.siteCheck) return h('div', { class: 'okbox' }, head, h('p', null, a.siteCheck.result === 'solved' ? `1차 확인: 해결(${when(a.siteCheck.atH)}) — 확인 뒤 첫 해 뜬 시간에 정상 복귀를 확인합니다.` : `1차 확인: 안 됨(${when(a.siteCheck.atH)}) — 시공사에 전달했습니다.`));
  const boxes = a.checklist.map((item) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', value: item }), ` ${item} 확인`));
  const picked = () => boxes.map((b) => b.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
  return h('div', { class: 'card' }, head, h('div', { class: 'acts' }, boxes),
    h('div', { class: 'acts' }, button('해결됨', () => api.siteCheck(a.key, 'solved', picked())), button('안 됨', () => api.siteCheck(a.key, 'failed', picked()), { class: 'btn ghost' })));
}
