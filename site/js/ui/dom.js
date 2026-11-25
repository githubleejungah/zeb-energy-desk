// 화면 도우미. 글자는 언제나 텍스트 노드(textContent)로만 넣는다(AC-49 · AC-50).
import { fmt } from '../core/time.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function apply(node, attrs) {
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else if (k === 'class') node.setAttribute('class', v);
    else if (k === 'text') node.textContent = String(v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
}

function add(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  apply(node, attrs);
  add(node, children);
  return node;
}

export function s(tag, attrs, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  apply(node, attrs);
  add(node, children);
  return node;
}

export const won = (n) => `${Number(n ?? 0).toLocaleString('ko-KR')}원`;
export const when = (H) => (H === null || H === undefined ? '—' : fmt(H));

export const CAUSE = { safety: '안전', low: '발전 · 가동 저하', comm: '통신 끊김' };
export const STATUS_CLASS = { 열림: 'st-open', 본사대기: 'st-hq', 묶임: 'st-bundle', 보류: 'st-bundle', 출동확정: 'st-go', 조치입력: 'st-fix', 종결: 'st-done', 기관전달: 'st-bundle' };
// 손실 칸: 태양광은 원, 지열 · 충전기는 영향 시간(AC-77)
export const lossText = (a) => (a.lossWon === null || a.lossWon === undefined ? `${a.cause === 'comm' ? '끊김' : '가동 저하'} ${a.impactHours ?? 0}시간` : won(a.lossWon));
export const dayLossText = (a) => (a.dayLossWon === null || a.dayLossWon === undefined ? '—(금액 없음)' : won(a.dayLossWon));
export const OWNER = { HQ: '본사', PUB: '공공 사후관리 기관(가상)', END: '관리 종료' };

export function chip(text, cls) {
  return h('span', { class: `chip ${cls ?? ''}` }, text);
}

export function card(title, ...body) {
  return h('section', { class: 'card' }, h('h2', null, title), ...body);
}

export function table(headers, rows) {
  return h('div', { class: 'table-wrap' },
    h('table', null,
      h('thead', null, h('tr', null, headers.map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', null, rows.length ? rows.map((r) => h('tr', null, r.map((c) => h('td', null, c)))) : h('tr', null, h('td', { colspan: headers.length, class: 'muted' }, '없음')))));
}

export function stat(label, value, cls) {
  return h('div', { class: `stat ${cls ?? ''}` }, h('div', { class: 'stat-v' }, value), h('div', { class: 'stat-l' }, label));
}

export function button(label, onClick, opts = {}) {
  return h('button', { type: 'button', class: opts.class ?? 'btn', disabled: opts.disabled, title: opts.title, on: { click: onClick } }, label);
}
