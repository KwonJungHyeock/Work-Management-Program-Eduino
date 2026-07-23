# 아키텍처 · 유지보수 인계 가이드

에듀이노 통합 업무관리 프로그램의 구조·데이터 흐름·유지보수 방법을 정리한 문서입니다.
**처음 인계받는 사람은 이 문서부터 읽으세요.**

---

## 1. 한눈에 보기

- **빌드 도구 없음.** `npm run build` 같은 과정이 없습니다. `.html`/`.js`/`.css` 를 그대로 브라우저가 읽어 실행합니다. → 파일을 고치면 바로 반영됩니다(배포는 git push 만 하면 Vercel 이 정적 서빙).
- **단일 페이지 앱(SPA).** `app.html` 하나가 셸이고, 왼쪽 메뉴를 누르면 해시(`#cs.notes`)만 바뀌며 해당 **기능 모듈**이 콘텐츠 영역에 그려집니다.
- **모듈 = 화면 1개.** 각 기능은 `window.MODULES['<부서>.<기능>'] = { title, icon, render(el) }` 로 자기 자신을 등록합니다. 셸이 해시를 보고 맞는 모듈의 `render()` 를 호출합니다.
- **저장.** 개인 설정은 브라우저 `localStorage`(`store()`), 팀 공용 데이터·기록은 백엔드(`/api/store`, Vercel KV)에 저장합니다. 구글시트는 백업으로 병행합니다.

---

## 2. 폴더 구조

```
index.html            로그인(접속코드) — core/config.js + core/app.js 만 로드
app.html              앱 셸 — 전 스크립트 로드. ⚠️ 로드 순서 = 실행 순서
vercel.json           정적 캐시 헤더 + 크론(구글시트 동기화·월 백업)

assets/
  css/                theme.css(디자인 시스템) · shell.css(레이아웃) · login.css
  brand/, platform-logos/, favicon.svg
  embeds/             product-tool.html — MD 상품 데이터시트 도구(md.js 가 iframe 로 로드)
  js/
    core/             런타임 척추 — 이 순서로 로드됨
      config.js         NAV(메뉴)·플랫폼 프리셋·STORE 키·태그 색상  ← 설정 교체 지점
      app.js            store()·Auth·icon()·el()·MODULES 레지스트리·embedModule()
      worklog.js        Records API — 서버 기록 읽기/쓰기(월 단위 버킷)
      sync.js           공용 저장소 클라이언트(팀 설정 공유·접속자 현황)
      shell.js          사이드바/상단바/상태바 렌더 + 해시 라우팅(맨 마지막 로드)
    lib/              범용 유틸(외부 의존성 0)
      xlsxlite.js       XLSX/CSV 파서(parseFile·parseSheets·parseCsv)
      zip.js            ZIP 생성기
    data/             시드 데이터(자동생성 · 전 직원 기본 탑재값)
      ntrex-data.js       엔티렉스 공급가표(가격비교 기준)
      vendors-data.js     입점사 마스터 · vendors-ship-data.js 배송 정책
      duties-data.js      직무/업무 범위(업무지시 추천용)
    features/         기능 모듈 — window.MODULES 에 화면 등록
      home/   home·calendar·tasks.js
      cs/     cs·cs-notes·cs-lookup·cs-custdb·cs-china·cs-exchange·cs-postpay.js
      md/     md·md-order·md-payreq·md-boards·md-pricewatch.js
      ts/     ts-notes·ts-templates.js        (메뉴상 MD 섹션 · 모듈키 md.*)
      admin/  admin·settle·insights·duties·admin-sales.js
      shared/ sheets·handover·manual.js       (여러 부서가 쓰는 공용 빌더)

api/                  Vercel 서버리스 함수(각 파일 = 1 엔드포인트)
  store.js            공용 설정·기록(KV coll/recPush) · getSheet
  auth.js             로그인 검증 · 계정·권한 · 관리자 프로필
  catalog.js          상품코드 → 제품명 조회
  sendmail.js         공급가 요청 등 메일 발송(SMTP)
  cron-sync.js        구글시트 정기 동기화(vercel.json 크론)
  backup-snapshot.js  월간 데이터 스냅샷

integrations/         앱이 배포/연동에 쓰는 아티팩트
  google-apps-script/ 구글시트 Apps Script — 앱이 fetch 로 코드를 사용자에게 제공
    main.gs  sync.gs  orders.gs  customerdb.gs
  source-data/입점사_배송정보.csv   vendors-ship-data.js 자동생성 원본

docs/                 기능목록·구글시트 연동 가이드·본 문서
scripts/              개발용 스크립트(엔티렉스 수집·이카운트 동기화 · 런타임 아님)
```

---

## 3. 로드/실행 순서 (중요)

`app.html` 의 `<script defer>` 는 **문서에 적힌 순서대로 실행**됩니다. 반드시 지켜야 하는 순서:

```
data(시드)  →  core/config → core/app → core/worklog  →  lib  →  features(순서무관)  →  core/sync → core/shell
```

- `core/app.js` 가 `store()`·`Auth`·`icon()`·`MODULES` 등 **전역**을 정의하므로 그 뒤에 오는 모든 것이 이를 씁니다.
- `features/*` 는 서로 순서 무관(각자 `MODULES` 에 등록만 함). 단 **core 이후**여야 합니다.
- `core/shell.js` 가 **맨 마지막**입니다 — body 를 렌더하고 라우팅을 시작합니다.

> 새 기능 파일을 추가하면 `app.html` 의 `features 구역`에 `<script>` 한 줄만 넣으면 됩니다.

---

## 4. 기능 모듈 작성 규약

```js
MODULES['md.example'] = {
  title: '예시 화면',
  icon: 'chart',                 // app.js ICONS 에 있는 이름
  render(root){                  // root = 콘텐츠 컨테이너(div)
    root.innerHTML = `<div class="mhead">…</div><div class="mbody">…</div>`;
    // 이벤트 바인딩, 데이터 로드 등
  }
};
```

- **라우팅**: 셸이 `location.hash`(`#md.example`)를 읽어 해당 모듈 `render()` 호출.
- **메뉴 노출**: `core/config.js` 의 `NAV` 에 `{ key:'md.example', name:'예시' }` 추가.
- **탭 안에 다른 모듈 임베드**: `embedModule(container, 'md.tsrecords')` (app.js) — 헤더 중복 제거하고 삽입.
- **공용 빌더 재사용**(직접 render 를 짜지 않아도 되는 경우):
  - `sheets.js` `build(cfg)` — 서버 누적 기록 표 뷰(발주기록·상담기록 등).
  - `handover.js` `buildHandover(cfg)` — 입점사(MD)·파트너사(CS) 관리 UI.
  - `md-boards.js` `buildBoard(cfg)` · `manual.js` `buildManual(cfg)`.

---

## 5. 데이터 흐름

| 저장 위치 | 무엇 | 접근 방법 |
|---|---|---|
| 브라우저 `localStorage` | 개인 설정·기기별 상태·취급상품 오버라이드 등 | `store('키').get(기본)/set(값)` (app.js) |
| Vercel KV (백엔드) | 팀 공용 설정, 접속자 현황, 상담/발주 **기록** | `/api/store` (`collPush`·`recPush`·`getSheet`) |
| 서버 기록 조회 | 월 단위로 쌓인 전 직원 기록 | `Records.month(dept,sheet,'YYYY-MM')` (worklog.js) |
| 구글시트 | 위 기록의 **백업**(병행 전송) | 각 모듈 → `/exec` URL 또는 `no-cors` |

- `store()` 는 **localStorage 전용**입니다(서버 동기화 아님). 팀 공유가 필요한 값은 `/api/store` 의 coll 로 저장하세요.
- 서버 기록 쓰기(`recPush`)는 `record.day`(`YYYY-MM-DD`)가 필수 — 이 값으로 월 버킷을 나눕니다.

---

## 6. 인증 · 권한

- 로그인: `index.html` → `Auth.login(id, code)` → `api/auth.js` 가 접속코드 검증(접속코드는 클라이언트에 노출 안 됨).
- 관리자: 환경변수 `ADMIN_ID`/`ADMIN_CODE`(기본 `admin`/`robodyne12`) 또는 `eduino:admin:profile`.
- 역할(role): `admin`(대표) · `manager`(팀장) · `lead`(파트장) · `member`(팀원). 권한 없는 메뉴는 사이드바에 잠금 표시.
- 화면 안에서 `Auth.user()` / `Auth.isAdmin()` 으로 분기.

---

## 7. 외부 연동

- **구글시트 Apps Script** (`integrations/google-apps-script/*.gs`): 상담/발주 기록을 시트로 백업. 앱이 `fetch()` 로 이 `.gs` 코드를 읽어 "코드 복사" 버튼으로 제공하므로 **경로를 바꾸면 해당 fetch 도 함께 고쳐야** 합니다.
- **시드 데이터 자동생성**: `data/*-data.js` 는 원본(예: `integrations/source-data/입점사_배송정보.csv`, `scripts/` 수집 결과)에서 생성된 파일입니다. 원본이 바뀌면 재생성해 교체하세요.

---

## 8. 배포

- git push → Vercel 이 정적 파일 서빙 + `api/*` 를 서버리스로 실행.
- `vercel.json`: `/assets` 와 `.html` 은 `no-cache`(항상 최신), 크론 2개(매일 구글시트 동기화·매월 백업).
- `api/` 만 서버 함수이고 나머지(assets·integrations·docs)는 정적 서빙됩니다.

---

## 9. 유지보수 체크리스트

**새 기능 추가**
1. `core/config.js` `NAV` 에 메뉴 추가.
2. `features/<부서>/<기능>.js` 에 `MODULES['<key>'] = {…}` 등록.
3. `app.html` features 구역에 `<script>` 한 줄 추가.

**자주 손대는 지점**
- 메뉴·바로가기·플랫폼 프리셋 → `core/config.js`
- 색상/디자인 토큰 → `assets/css/theme.css`
- 누적 기록 표(열·필터·색상) → `features/shared/sheets.js` 의 각 `build({...})`
- 가격비교(엔티렉스) 기준 데이터 → `data/ntrex-data.js` (또는 앱 내 **엑셀 일괄 업데이트**)

**파일을 옮길 때 반드시 같이 고칠 곳**
- `app.html`(스크립트 경로) · `index.html`(core 2개) · `md.js`(iframe embeds 경로)
- 런타임 `fetch()` 하는 `.gs` 경로(cs-notes·md-boards·md-order·ts-notes·shell)

**깨지지 않았는지 확인(부팅 스모크)**
- 로그인 → 각 부서 메뉴 클릭해 화면이 뜨는지, 브라우저 콘솔에 에러가 없는지.
- 개발 시엔 로컬 정적 서버로 `app.html` 을 띄우고 전 라우트를 돌며 `window.MODULES` 등록 여부·콘솔 에러 0 을 확인(기존 Playwright 스모크 테스트 방식과 동일).

---

## 10. 설계 원칙(왜 이렇게 했나)

- **무빌드**: 사내 소수 인원이 인계·수정하기 쉽도록 툴체인 의존성을 없앴습니다. 파일 = 기능.
- **전역 등록 방식**: 모듈 간 import 그래프가 없어, 파일 하나만 열면 그 기능 전체를 볼 수 있습니다.
- **부서별 폴더**: 팀이 부르는 업무 영역(홈/CS/MD/TS/관리자)과 폴더를 일치시켜, "그 기능 어디 있지?" 를 폴더만 보고 찾게 했습니다.
