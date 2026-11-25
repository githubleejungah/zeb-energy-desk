// 가상 기준 데이터. 실제 회사 · 고객 · 가격이 아니다.
// 시각은 "H" = 2026-08-01 00:00부터 센 시간 수. day = Math.floor(H / 24).
// 숫자 설정값은 config 한곳에만 둔다(ADR 0005, 가정 AS-6 · AS-7 · AS-10).

const D = (day, hour = 0) => day * 24 + hour; // day 0 = 2026-08-01

export const config = {
  startH: D(31, 9), // 시연 시작: 2026-09-01 09:00
  horizonDays: 61, // 8 · 9월
  sunStartHour: 7, // 해 뜬 시간 [7, 18)
  sunEndHour: 18,
  commDataHours: 3, // AC-06
  heartbeatMissingHours: 2, // AC-07 "1시간 넘게" = 시간 단위로 2칸 연속
  lowRatio: 0.5, // AC-08
  lowHours: 2,
  recurWindowHours: 7 * 24, // AC-12
  recurCount: 3,
  workOrderDueHours: 7 * 24, // AC-13
  dispatchConfirmHours: 48, // AC-15
  lossPriceWon: 150, // 원/kWh, 가상 손실 단가(AS-3)
  dispatchMaxSites: 5, // AC-19
  reportDueSoonDays: 30, // AC-22
  warrantySoonDays: 30, // AC-31
  plans: { pro: 3000, ops: 9000 }, // 개소당 월 요금(원), 가상(AS-1)
  creditTiers: [
    { overHours: 24, rate: 0.3 },
    { overHours: 4, rate: 0.1 },
  ], // AC-27
  missionBaselineDays: 5, // AC-38: 미션이 열리지 않았던 평일 5일
  missionBaselineLookbackDays: 30, // AC-38 · AC-59: 최대 30일 전까지 찾음
  missionSuccessRatio: 1.1,
  missionPoints: 100, // 1점 = 1원
  appealHours: 7 * 24, // AC-40
  rawRetentionHours: 7 * 24, // AC-47
  memoMaxChars: 500, // SEC-04
  holdMaxHours: 14 * 24, // AC-65 보류 최대 14일(AS-11)
  holdLossLimitWon: 30000, // AC-65 보류 뒤 손실 한도(AS-11)
  hqTempMaxHours: 30 * 24, // AC-67 본사 임시 관리 30일(AS-11)
  siteCheckItems: ['인버터 표시등', '차단기', '통신 장치 전원'], // AC-60(AS-11)
};

export const complex = {
  id: 'C1',
  name: '가상 제로에너지 단지',
  households: 300,
  buildings: ['101', '102', '103', '104', '105', '106'],
  zone: 'Z1',
};

export const contractors = [
  { id: 'K1', name: '가상 시공사 1', plan: 'pro', contractStart: '2025-01-01', contractEnd: null },
  { id: 'K2', name: '가상 시공사 2', plan: 'ops', contractStart: '2025-01-01', contractEnd: null },
  { id: 'K3', name: '가상 시공사 3', plan: 'pro', contractStart: '2025-01-01', contractEnd: '2026-08-25' },
];

export const partners = [{ id: 'P1', name: '가상 충전사업자' }];

// 배치도 좌표(0~600, 0~300). 실제 지도가 아니다(ADR 0004).
const aptPos = [
  [400, 62], [462, 62], [524, 62], [400, 112], [462, 112], [524, 112],
];

function makeAssets() {
  const assets = [];
  aptPos.forEach(([x, y], i) => {
    assets.push({
      id: `A-10${i + 1}`, kind: 'pv', capacityKw: 30, x, y, zone: 'Z1', owner: 'common',
      building: `10${i + 1}`, install: '2026-03-02', warrantyYears: 3, contractorId: 'K1',
    });
  });
  assets.push({ id: 'GEO-1', kind: 'geo', capacityKw: 50, x: 590, y: 80, zone: 'Z1', owner: 'common', install: '2026-03-02', warrantyYears: 5, contractorId: 'K1' });
  assets.push({ id: 'EV-1', kind: 'ev', capacityKw: 7, x: 590, y: 120, zone: 'Z1', owner: 'common', install: '2026-03-02', warrantyYears: 3, contractorId: 'K1' });

  // 단독주택 태양광 32곳: 구역 Z2(1~12) · Z3(13~22) · Z4(23~32)
  for (let n = 1; n <= 32; n++) {
    const id = `PV-${String(n).padStart(2, '0')}`;
    const zone = n <= 12 ? 'Z2' : n <= 22 ? 'Z3' : 'Z4';
    const k = n - 1;
    let x, y;
    if (zone === 'Z2') { x = 60 + (k % 4) * 60; y = 40 + Math.floor(k / 4) * 45; }
    else if (zone === 'Z3') { x = 60 + ((k - 12) % 5) * 55; y = 215 + Math.floor((k - 12) / 5) * 45; }
    else { x = 380 + ((k - 22) % 5) * 50; y = 205 + Math.floor((k - 22) / 5) * 45; }
    assets.push({
      id, kind: 'pv', capacityKw: n % 7 === 0 ? 8 : n % 3 === 0 ? 5 : 3, x, y, zone, owner: 'house',
      install: '2025-05-20', warrantyYears: 3, contractorId: zone === 'Z4' ? 'K2' : 'K1',
    });
  }
  const set = (id, patch) => Object.assign(assets.find((a) => a.id === id), patch);
  set('PV-02', { install: '2024-09-15' }); // 사후관리 보고 기한 임박(AC-22)
  set('PV-21', { install: '2023-09-20' }); // 하자보증 만료 30일 이내(AC-24 · AC-31)
  set('PV-29', { install: '2026-08-12' }); // 달 중간 설치(일할, AC-26)
  set('PV-30', { contractorId: 'K3' }); // 계약 종료 시공사(AC-16 · AC-31)
  set('PV-32', { contractorId: null }); // 담당 등록 누락(AC-16)
  return assets;
}

export const assets = makeAssets();

// 담당 이관(일할 AC-26): PV-31이 8/16부터 K2 → K1
export const transfers = [{ assetId: 'PV-31', from: 'K2', to: 'K1', atDate: '2026-08-16' }];

// 설비 고장 시나리오(Q4 점검표 10가지 + 안전 + 대조군). 시간은 H.
export const faults = [
  { id: 'F1', assetId: 'PV-03', type: 'low', factor: 0, fromH: D(30, 10), toH: null }, // 1 데이터는 오는데 발전 0
  { id: 'F2', zone: 'Z3', type: 'cloudy', factor: 0.25, fromH: D(29, 0), toH: D(30, 0) }, // 2 흐린 날(대조군: 알람 없어야 함)
  { id: 'F3', assetId: 'PV-07', type: 'heartbeat', fromH: D(30, 22), toH: null }, // 3 밤 통신 끊김
  { id: 'F4', assetId: 'GEO-1', type: 'low', factor: 0.3, fromH: D(30, 2), toH: D(30, 8) }, // 4 해와 무관한 설비
  { id: 'F5a', assetId: 'PV-11', type: 'data', fromH: D(24, 9), toH: D(24, 14) }, // 5 같은 원인 7일 3번
  { id: 'F5b', assetId: 'PV-11', type: 'data', fromH: D(26, 10), toH: D(26, 15) },
  { id: 'F5c', assetId: 'PV-11', type: 'data', fromH: D(28, 9), toH: D(28, 14) },
  { id: 'F6', assetId: 'A-103', type: 'heartbeat', fromH: D(31, 6), toH: null }, // 6 큰 설비 통신 끊김(손실 추정)
  { id: 'F7', assetId: 'PV-15', type: 'low', factor: 0.2, fromH: D(28, 10), toH: null }, // 7 · 48시간 미확정 → 본사
  { id: 'F8', assetId: 'A-105', type: 'safety', fromH: D(31, 8), toH: D(31, 12) }, // 8 안전 신호(12시 현장 조치로 해소)
  { id: 'F10', assetId: 'PV-19', type: 'low', factor: 0.1, fromH: D(27, 10), toH: null }, // 10 조치했는데 복귀 안 됨
  { id: 'FW', assetId: 'PV-21', type: 'low', factor: 0, fromH: D(25, 10), toH: D(25, 15) }, // 보증 기간 안 고장
];

// 회사 쪽 수집 중단(감면 대상). cause: 'company' | 'field' | null(미판정 → 예외)
export const serviceOutages = [
  { id: 'SO-1', zone: 'Z2', fromH: D(14, 0), toH: D(14, 6), cause: 'company' }, // 6시간 → 10%
  { id: 'SO-2', assetIds: ['PV-25'], fromH: D(20, 0), toH: D(21, 2), cause: 'company' }, // 26시간 → 30%
  { id: 'SO-3', zone: 'Z3', fromH: D(22, 3), toH: D(22, 8), cause: null }, // 미판정 → 예외
];

export const equipmentChanges = [{ assetId: 'PV-09', atH: D(27, 12), note: '인버터 교체' }];
export const ownerChanges = [{ assetId: 'PV-14', atH: D(23, 10) }];

// 시연 시작 상태에 미리 들어 있는 사람의 행동(가상)
export const seededActions = {
  dispatches: [
    { id: 'DS-1', contractorId: 'K1', alarmKeys: ['PV-19:low'], proposedH: D(28, 8), confirmedH: D(28, 9) },
    { id: 'DS-2', contractorId: 'K1', alarmKeys: ['PV-21:low'], proposedH: D(25, 12), confirmedH: D(25, 12) },
  ],
  results: [
    { alarmKey: 'PV-19:low', atH: D(28, 15), memo: '인버터 재시작' },
    { alarmKey: 'PV-21:low', atH: D(25, 16), memo: '차단기 교체' },
  ],
  // 설치 1년 차 보고 기한이 이미 지난 설비는 제출된 것으로 둔다. PV-06만 빠뜨린 사례(기한 지남).
  reports: assets.flatMap((a, i) => {
    if (a.id === 'PV-06') return [];
    const [y, m, d] = a.install.split('-');
    return [1, 2, 3]
      .filter((k) => `${Number(y) + k}-${m}-${d}` < '2026-09-01')
      .map((k) => ({ assetId: a.id, year: k, submittedH: D(-60 + (i % 30), 10) }));
  }),
  budgets: [{ partnerId: 'P1', approvedWon: 300000, approvedH: D(0, 9) }],
};

// 의무 출처(공고문). 법률 검토가 아닌 확인 목록(AC-21).
export const obligationSources = [
  { label: '2025 주택지원사업 공고(사후관리 · 하자보증)', url: 'https://zeb.energy.or.kr/BC/down/2025년%20신재생에너지보급(주택지원)사업%20공고.pdf' },
  { label: '2025 건물지원 공고(통합모니터링 연계 유지)', url: 'https://www.pc.go.kr/egf/bp/board/article/download?fileSeq=144713' },
];
