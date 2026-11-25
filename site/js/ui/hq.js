// 본사 운영 어드민(A): 월 정산 마감 · 본사 대기열 · 예외 · 재심 · 미션 합계 · 감사 기록
import { h, card, table, chip, stat, button, won, when, lossText, CAUSE, STATUS_CLASS, OWNER } from './dom.js';
import { days } from '../core/labels.js';

const ROLE = { hq: '본사', contractor: '시공사', complex: '관리주체', system: '시스템', viewer: '보는 사람' };

export function renderHq(v, api, ui, seed) {
  const st = v.settlement;
  const locked = st.lockReasons.length > 0;
  const contractors = seed.contractors.filter((c) => !c.contractEnd);
  return h('div', { class: 'grid' },
    h('div', { class: 'stats' },
      stat('본사 대기', String(v.queue.length), v.queue.length ? 'warn' : ''),
      stat('미판정 예외', String(v.exceptions.filter((e) => !e.decision).length)),
      stat('재심 대기', String(v.appeals.length)),
      stat(`${st.month} 청구 합계`, won(st.totalBilledWon))),
    card(`${st.month} 월 정산 마감`,
      st.closed ? h('p', { class: 'okbox' }, `마감 완료 ${when(st.closed.closedH)} · 청구 ${won(st.closed.totalBilledWon)} · 이의 기한 ${days(v.rawRetentionHours)} 뒤 15분 원본 삭제`) : null,
      table(['시공사', '개소', '요금', '감면', '청구'], st.lines.map((l) => [l.contractorId, `${l.sites}곳`, won(l.feeWon), won(l.creditWon), won(l.billedWon)])),
      h('p', null, `합계: 요금 ${won(st.totalFeeWon)} − 감면 ${won(st.totalCreditWon)} = 청구 ${won(st.totalBilledWon)}`),
      locked ? h('div', { class: 'warnbox' }, h('strong', null, `마감 잠김 — 남은 일 ${st.lockReasons.length}건`), h('ul', null, st.lockReasons.map((r) => h('li', null, r)))) : null,
      st.closed ? null : ui.closeConfirm
        ? h('div', { class: 'warnbox' }, h('p', null, `마감 전 확인 — ${v.closeCompare}`),
          h('span', { class: 'acts' }, button('마감 확정', () => { api.ui({ closeConfirm: false }); api.closeMonth(st.month, st.totalBilledWon, st.lockReasons); }), button('취소', () => api.ui({ closeConfirm: false }), { class: 'btn ghost' })))
        : button('마감', () => api.ui({ closeConfirm: true }), { disabled: locked, class: 'btn' }), // AC-89 한 번 더 확인
      ui.closeMsg ? h('p', { class: 'muted' }, ui.closeMsg) : null,
      h('details', null, h('summary', null, '개소별 내역'),
        table(['시공사', '설비', '쓴 날', '요금', '회사 장애', '감면', '청구'], st.detail.map((l) => [l.contractorId, l.assetId, `${l.days}일`, won(l.feeWon), `${l.outageH}시간`, l.creditWon ? `${won(l.creditWon)}(${l.creditRate * 100}%)` : '—', won(l.billedWon)])))),
    card('본사 대기열',
      h('p', { class: 'muted small' }, v.hqTakeLine), // AC-87
      ui.assignMsg ? h('p', { class: 'warnbox' }, ui.assignMsg) : null, // AC-86
      table(['설비', '원인', '상태', '올라온 이유', '담당', '손실', '담당 지정 · 출동 확정'],
      v.queue.map((q) => [q.assetId, CAUSE[q.cause], chip(q.status, STATUS_CLASS[q.status]), q.escalateReason ?? '', OWNER[q.owner] ?? q.owner, lossText(q),
        h('span', { class: 'acts' }, [...contractors.map((c) => button(c.id, () => api.assign(q.key, c.id), { class: 'btn ghost' })), button('본사 직접', () => api.assign(q.key, 'HQ'), { class: 'btn ghost' })])]))),
    card('예외 대기열 — 판정은 본사만 · 고르면 초안, 확정해야 반영',
      h('p', { class: 'muted small' }, '초안은 몇 번이든 다시 고를 수 있고 감사 기록에 남지 않습니다. 확정할 때 1줄만 남습니다.'),
      table(['종류', '대상', '메모', '판정'],
      v.exceptions.map((e) => [e.type, e.refId, e.note ?? '', e.decision
        ? chip(label(e.decision), 'st-done')
        : decisionCell(e.options, e.draft, e.warn, (o) => api.pickException(e.id, o), () => api.confirmException(e.id), ui.confirmFor === e.id, (on) => api.ui({ confirmFor: on ? e.id : null }))]))),
    card('재심 대기 — 가명 ID와 판정 근거만', table(['미션', '세대(가명)', '판정', '기준선 대비', '빈 칸', '재심'],
      v.appeals.map((a) => [when(a.missionDay * 24).slice(0, 10), a.householdId, a.verdict ?? '', a.ratioPct === null ? '—' : `${a.ratioPct}%`, String(a.blanks ?? ''),
        decisionCell(['overturn', 'uphold'], a.draft, a.warn, (o) => api.pickAppeal(a.missionDay, a.householdId, o), () => api.confirmAppeal(a.missionDay, a.householdId), false, () => {})]))),
    ui.resultFor ? resultForm(ui.resultFor, api) : null,
    card('전체 알람 — 본사가 맡은 것은 본사가 조치 입력', table(['설비', '담당', '원인', '상태', '손실', '처음 감지', '조치'],
      v.alarms.map((a) => [a.assetId, (OWNER[a.owner] ?? a.owner) + (a.assignee && a.assignee !== a.owner ? ` → 지정 ${OWNER[a.assignee] ?? a.assignee}` : ''), CAUSE[a.cause], chip(a.status, STATUS_CLASS[a.status]), lossText(a) + (a.estimated && a.lossWon !== null ? '(추정)' : ''), when(a.firstH),
        (a.owner === 'HQ' || a.assignee === 'HQ') && a.status === '출동확정' ? button('조치 입력', () => api.ui({ resultFor: a.key })) : '']))), // AC-72
    card('미션 합계(세대별 값 없음)',
      table(['승인 예산', '지급', '남은 예산'], [[won(v.budget.approvedWon), won(v.budget.spentWon), won(v.budget.remainingWon)]]),
      table(['날짜', '시간', '상태', '성공', '실패', '판정 불가', '지급'], v.missions.slice().reverse().slice(0, 10).map((m) => [when(m.day * 24).slice(0, 10), `${m.hour}시`, m.status === 'judged' ? '판정' : m.status === 'skipped_budget' ? '예산 소진' : m.status === 'open' ? '진행 중' : '예정',
        String(m.counts?.success ?? ''), String(m.counts?.fail ?? ''), String(m.counts?.undecidable ?? ''), m.paidWon === undefined ? '' : won(m.paidWon)]))),
    card('감사 기록 — 덧붙이기만, 고치기 · 지우기 없음', table(['#', '시각', '누가', '무엇', '대상', '규칙'],
      v.audit.slice().reverse().slice(0, 30).map((e) => [String(e.seq), when(e.at), ROLE[e.role] ?? e.role, e.action, e.target, e.rule]))),
  );
}

// 본사가 맡은 알람의 조치 결과 입력(AC-72). 글자로만, 500자까지.
function resultForm(key, api) {
  const input = h('input', { type: 'text', maxlength: 500, placeholder: '조치 내용(500자까지, 실제 개인정보는 넣지 마세요)', 'aria-label': '조치 내용' });
  return h('div', { class: 'form' }, h('strong', null, `${key} 조치 결과(본사)`), input,
    button('저장', () => api.enterResult(key, input.value)), button('닫기', () => api.ui({ resultFor: null }), { class: 'btn ghost' }));
}

const label = (o) => ({ company: '회사 책임', field: '현장 원인', overturn: '성공으로 변경', uphold: '판정 유지' }[o] ?? o);

// 판정 칸(AC-80~85): 고르기 → 초안 + 영향 1줄 → 확정(관리 종료는 한 번 더 확인)
function decisionCell(options, draft, warn, pick, confirm, asking, setAsking) {
  const picks = h('span', { class: 'acts' }, options.map((o) => button(label(o), () => pick(o), { class: draft?.decision === o ? 'btn' : 'btn ghost' })));
  if (!draft) return picks;
  const info = h('p', { class: warn?.confirm ? 'warnbox small' : 'muted small' }, `초안: ${label(draft.decision)}(${draft.picks}번 고름) · ${warn?.text ?? ''}`);
  if (warn?.confirm && asking) {
    return h('div', null, picks, info, h('span', { class: 'acts' }, button('정말 확정', () => { setAsking(false); confirm(); }), button('취소', () => setAsking(false), { class: 'btn ghost' })));
  }
  return h('div', null, picks, info, button('확정', () => (warn?.confirm ? setAsking(true) : confirm())));
}
