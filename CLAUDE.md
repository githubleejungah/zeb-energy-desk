# 작업 규칙 — zeb-energy-desk

## 스택 (ADR 0001)
- 정적 HTML · CSS · JavaScript(ES 모듈), 빌드 없음. GitHub Pages.
- 시험: Node 기본 시험 도구(`node --test`).

## 규칙
- 데이터는 모두 가상. 실제 회사 이름 · 고객 · 가격 금지. 공개본에 지원 회사 이름 · 제품 이름을 쓰지 않는다('에너지 ICT 회사', '홈 에너지 앱', '신재생 모니터링 서비스').
- 순서: 요구(docs/requirements.md) 확인 → 아키텍처 · 데이터 · 흐름 설계 승인 → 코드.
- 숫자는 근거(인터뷰 답 · 문서 · 관찰 · 추론)를 단다. 근거 없는 숫자는 가정 표에 질문으로 올린다.
- 구조 · 데이터 · 흐름이 바뀌면 같은 커밋에서 docs/도 고친다.
- 재시도 · 재발 알람 · 이의 제기처럼 되풀이되는 곳은 끝나는 조건을 둔다.
- push · 배포는 사용자 승인 뒤. Pages 배포는 올리기와 배포를 다른 작업으로 나눈다.

## 자주 쓰는 명령
- 요구 문서 검사: `python doc_lint.py ears docs/requirements.md --strict` (EARS 문장 검사 도구, 저장소 밖 강의 작업 공간에 있음)
- 시험: `node tools/run-tests.mjs` (결과 `tmp/test-results.json`, 건너뜀은 실패로 셈)
- 비밀값 검사: `node tools/secret_scan.mjs .`
- 로컬 보기: `python -m http.server 8794 -d site`

## 구조 규칙
- 세대 15분 원본(`core/raw.js`)은 `core/settlement.js`만 불러 쓴다(시험으로 검사).
- 화면은 `views.js` 역할 필터를 거친 데이터만 받는다. 글자는 textContent로만(innerHTML 금지, 시험으로 검사).
- 숫자 기준값은 `data/seed.js`의 `config` 한곳에만.
