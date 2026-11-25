// 가상 동네 배치도(ADR 0004). 외부 지도를 불러오지 않는다(AC-20 · AC-48).
import { s, h } from './dom.js';

const COLOR = { safety: 'var(--alarm-safety)', fault: 'var(--alarm-fault)', estimated: 'var(--alarm-estimated)', normal: 'var(--alarm-normal)' };
const LABEL = { safety: '안전', fault: '손실 큰 고장', estimated: '손실 추정(끊김)', normal: '정상' };
const OFFICE = { x: 30, y: 300 };

export function siteMap(points, route) {
  const svg = s('svg', { viewBox: '0 0 660 340', role: 'img', 'aria-label': '가상 동네 배치도. 실제 지도 아님.', class: 'map' },
    s('title', null, '가상 동네 배치도 (실제 지도 아님)'),
    s('rect', { x: 10, y: 10, width: 640, height: 320, rx: 8, fill: 'none', stroke: 'var(--line)' }),
    s('line', { x1: 10, y1: 180, x2: 650, y2: 180, stroke: 'var(--line)', 'stroke-width': 6, opacity: 0.35 }),
    s('line', { x1: 340, y1: 10, x2: 340, y2: 330, stroke: 'var(--line)', 'stroke-width': 6, opacity: 0.35 }),
    s('text', { x: 400, y: 40, class: 'map-t' }, '아파트 단지(Z1)'),
    s('text', { x: 40, y: 30, class: 'map-t' }, '구역 Z2'),
    s('text', { x: 40, y: 205, class: 'map-t' }, '구역 Z3'),
    s('text', { x: 380, y: 195, class: 'map-t' }, '구역 Z4'),
    s('rect', { x: OFFICE.x - 10, y: OFFICE.y - 10, width: 20, height: 20, rx: 3, fill: 'var(--brand)' }),
    s('text', { x: OFFICE.x + 16, y: OFFICE.y + 4, class: 'map-t' }, '시공사 사무소'),
  );
  if (route?.length) {
    const pts = [OFFICE, ...route].map((p) => `${p.x},${p.y}`).join(' ');
    svg.append(s('polyline', { points: pts, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2, 'stroke-dasharray': '6 4' }));
  }
  for (const p of points) {
    const c = COLOR[p.status];
    const common = { fill: p.status === 'estimated' ? 'none' : c, stroke: c, 'stroke-width': p.status === 'estimated' ? 2 : 1, 'stroke-dasharray': p.status === 'estimated' ? '3 2' : null };
    const shape = p.id.startsWith('A-')
      ? s('rect', { x: p.x, y: p.y, width: 50, height: 34, rx: 4, ...common, 'fill-opacity': p.status === 'normal' ? 0.25 : 0.85 })
      : s('circle', { cx: p.x, cy: p.y, r: p.kind === 'pv' ? 7 : 9, ...common });
    shape.append(s('title', null, `${p.id} · ${LABEL[p.status]}`));
    svg.append(shape);
    if (p.id.startsWith('A-')) svg.append(s('text', { x: p.x + 25, y: p.y + 21, 'text-anchor': 'middle', class: 'map-t' }, p.id.slice(2)));
  }
  const legend = h('div', { class: 'legend' },
    Object.entries(LABEL).map(([k, v]) => h('span', { class: `lg lg-${k}` }, v)),
    h('span', { class: 'lg lg-route' }, '출동 묶음 경로'),
  );
  return h('div', null, svg, legend, h('p', { class: 'muted small' }, '가상 동네 배치도 · 실제 지도 아님 · 외부 지도를 불러오지 않습니다.'));
}
