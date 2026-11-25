// 시공사 콘솔(A): 알람 · 출동 묶음 · 지도 · 의무 · 청구
import { h, card, table, chip, stat, button, won, when, CAUSE, STATUS_CLASS } from './dom.js';
import { siteMap } from './map.js';

export function renderContractor(v, api, ui) {
  const sel = ui.proposalId ? v.proposals.find((p) => p.id === ui.proposalId) : v.proposals[0];
  const hqCount = v.alarms.filter((a) => a.status === '본사대기').length + v.workOrders.filter((w) => w.status === '본사대기').length;
  const due = v.obligations.filter((o) => o.reportDueSoon || o.reportOverdue).length;
  const billed = v.bill.reduce((s, l) => s + l.billedWon, 0);

  const alarmRows = v.alarms.map((a, i) => [
    String(i + 1),
    a.assetId,
    chip(CAUSE[a.cause], a.cause === 'safety' ? 'al-safety' : a.estimated ? 'al-est' : 'al-fault'),
    chip(a.status, STATUS_CLASS[a.status]),
    h('span', null, won(a.lossWon), a.estimated ? chip('추정', 'al-est') : null),
    won(a.dayLossWon),
    when(a.firstH),
    [a.escalateReason ? `본사로: ${a.escalateReason}` : '', a.reopenCount ? ` · 다시 열림 ${a.reopenCount}번` : '', a.note ? ` · ${a.note}` : '',
      a.siteCheck?.result === 'failed' ? ' · 현장 1차 확인: 안 됨' : '', a.status === '보류' ? ` · 보류 뒤 손실 ${won(a.holdLossWon)}(한도 3만 원 · 14일)` : ''].join('').replace(/^ · /, ''),
    h('span', { class: 'memo' }, a.resultMemo ?? ''),
    actionCell(a, api, ui),
  ]);
  const woRows = v.workOrders.map((w) => [
    w.assetId, chip(CAUSE[w.cause], 'al-fault'), chip(w.status, STATUS_CLASS[w.status]), `발생 ${w.occurrences}번`, won(w.lossWon), `기한 ${when(w.dueH)}`, actionCell(w, api, ui),
  ]);

  const proposalList = v.proposals.length
    ? h('ul', { class: 'plist' }, v.proposals.map((p) => h('li', { class: p.id === sel?.id ? 'on' : '' },
      button(`${p.zone} · ${p.stops.length}곳 · ${won(p.lossWon)}`, () => api.ui({ proposalId: p.id }), { class: 'btn ghost' }),
      button('출동 확정', () => api.confirmDispatch(p.keys), { class: 'btn' }))))
    : h('p', { class: 'muted' }, '출동할 곳이 없습니다.');

  const obRows = v.obligations.map((o) => [
    o.assetId,
    `${o.warrantyEnd} (${o.warrantyDaysLeft}일)`,
    o.report ? h('span', null, `${o.report.year}년 차 ${o.report.due} (${o.report.daysLeft}일) `, o.reportDueSoon ? chip('기한 임박', 'al-fault') : null, o.reportOverdue ? chip('기한 지남', 'al-safety') : null) : '3년 보고 완료',
    `${o.connectionEnd} (${o.connectionDaysLeft}일)`,
    o.warrantyClaims.length ? chip('보증 청구 대상', 'st-go') : '',
    o.report ? button('보고서 초안', () => api.ui({ draft: { assetId: o.assetId, year: o.report.year } }), { class: 'btn ghost' }) : '',
  ]);
  const draft = ui.draft ? api.reportDraft(ui.draft.assetId, ui.draft.year) : null;

  return h('div', { class: 'grid' },
    h('div', { class: 'stats' },
      stat('열린 알람', String(v.alarms.length)), stat('본사로 올라간 것', String(hqCount), hqCount ? 'warn' : ''),
      stat('보고 기한 임박 · 지남', String(due), due ? 'warn' : ''), stat(`${v.billMonth} 청구 예정`, won(billed))),
    card('알람 — 안전 먼저, 그다음 손실 큰 순',
      h('p', { class: 'muted small' }, "'확인'은 종결이 아닙니다. 조치 결과를 넣고 다음 날 해 뜬 시간에 정상으로 돌아와야 종결됩니다."),
      table(['#', '설비', '원인', '상태', '손실(누적)', '하루 손실', '처음 감지', '비고', '조치 내용', ''], alarmRows),
      h('p', { class: 'muted small' }, "손실이 작으면 '보류'로 다음 정기 방문 때 함께 갈 수 있습니다. 14일이 지나거나 보류 뒤 손실이 3만 원을 넘으면 본사로 올라갑니다. 안전 알람은 보류할 수 없습니다."),
      ui.resultFor ? resultForm(ui.resultFor, api) : null),
    card('작업 지시 — 같은 원인 7일 안 3번이면 하나로 묶음', table(['설비', '원인', '상태', '발생', '손실', '기한', ''], woRows)),
    card('출동 묶음 · 지도', h('div', { class: 'two' }, h('div', null, proposalList), siteMap(v.map, sel?.stops))),
    card('의무 기한 — 법률 검토가 아닌 확인 목록',
      h('p', { class: 'muted small' }, '출처: ', v.sources.map((src, i) => [i ? ' · ' : '', h('a', { href: src.url, target: '_blank', rel: 'noopener noreferrer' }, src.label)])),
      table(['설비', '하자보증 만료', '사후관리 보고(3년)', '통합모니터링 연계 유지(5년)', '보증', ''], obRows),
      draft ? draftPanel(draft, ui.draft, api) : null),
    card(`${v.billMonth} 구독 요금(가상 단가)`, table(['설비', '요금제', '쓴 날', '요금', '감면', '청구'],
      v.bill.map((l) => [l.assetId, l.plan === 'pro' ? '프로' : '운영대행', `${l.days}/${l.monthDays}일`, won(l.feeWon), l.creditWon ? `${won(l.creditWon)} (${l.creditRate * 100}%)` : '—', won(l.billedWon)]))),
  );
}

function actionCell(a, api) {
  const out = [button('확인', () => api.markSeen(a.key), { class: 'btn ghost', title: '본 것으로만 표시(종결 아님)' })];
  if (['열림', '본사대기', '보류'].includes(a.status)) out.push(button('출동 확정', () => api.confirmDispatch([a.key])));
  if (a.cause !== 'safety' && ['열림', '출동확정'].includes(a.status)) out.push(button('보류', () => api.holdAlarm(a.key), { class: 'btn ghost', title: '다음 정기 방문 때 함께' }));
  if (a.status === '출동확정') out.push(button('조치 입력', () => api.ui({ resultFor: a.key })));
  if (a.status === '조치입력') out.push(chip(`복귀 확인 ${when(a.checkH)}`, 'st-fix'));
  return h('span', { class: 'acts' }, out);
}

function resultForm(key, api) {
  const input = h('input', { type: 'text', maxlength: 500, placeholder: '조치 내용(500자까지, 실제 개인정보는 넣지 마세요)', 'aria-label': '조치 내용' });
  return h('div', { class: 'form' }, h('strong', null, `${key} 조치 결과`), input,
    button('저장', () => api.enterResult(key, input.value)), button('닫기', () => api.ui({ resultFor: null }), { class: 'btn ghost' }));
}

function draftPanel(d, ref, api) {
  return h('div', { class: 'draft' },
    h('h3', null, d.title),
    h('p', null, `설비 ${d.asset.id} · ${d.asset.kind} · ${d.asset.capacityKw}kW · 설치 ${d.asset.install} · 기간 ${d.period}`),
    table(['원인', '상태', '처음', '조치'], d.history.map((x) => [CAUSE[x.cause], x.status, x.firstH, x.memo])),
    h('p', { class: 'muted small' }, d.notice),
    button('제출(기록만 남김)', () => api.submitReport(ref.assetId, ref.year)),
    button('닫기', () => api.ui({ draft: null }), { class: 'btn ghost' }));
}
