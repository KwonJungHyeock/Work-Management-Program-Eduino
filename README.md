# 에듀이노 통합 업무관리 프로그램

에듀이노 사내 업무(**CS · MD · 물류 · 관리**)를 한곳에 모은 **웹 기반 통합 업무관리 프로그램**입니다.
관리자가 발급한 **아이디 · 접속코드**로 로그인하면 부서·권한에 맞는 메뉴가 열리고, 상담·발주·가격비교·입고·정산 등 실무를 브라우저에서 처리합니다.

- **빌드 도구 없는 순수 브라우저 SPA**(HTML/CSS/JS) + **Vercel 서버리스**(`/api/*`) + **KV(Upstash Redis)**
- 팀 공용 데이터는 서버에 **즉시 공유**, 개인 설정·캐시는 브라우저(`localStorage`)에 저장
- 무거운 상담·발주 기록은 **월별 시트에 누적** + **구글시트 백업** 병행
- 상단바에 사내 연동 서비스(에듀이노몰·카페24 관리자 등) 바로가기와 **실시간 접속자 수** 표시

---

## 목차
1. [아키텍처](#아키텍처)
2. [기능 범위](#기능-범위)
3. [데이터 범위 · 저장 구조](#데이터-범위--저장-구조)
4. [외부 연동](#외부-연동)
5. [폴더 구조](#폴더-구조)
6. [실행 · 배포](#실행--배포)
7. [백업 워크플로](#백업-워크플로)
8. [새 기능 추가 방법](#새-기능-추가-방법)
9. [보안 원칙](#보안-원칙)

---

## 아키텍처

| 계층 | 구성 |
|------|------|
| **프론트엔드** | 빌드 없는 SPA. `app.html`이 스크립트를 **정해진 순서로** 로드하고, 각 기능은 `window.MODULES[key] = { title, icon, render(el) }`로 등록됨. **해시 라우팅**(`#dept.feature`)으로 콘텐츠 영역만 교체 |
| **백엔드** | Vercel 서버리스 함수(`/api/*`). 인증·공용저장소·상품카탈로그·마우저 프록시·메일·백업. 상태는 **Vercel KV(Upstash Redis)**에 보관 |
| **인증·권한** | 서버(`api/auth.js`)가 접속코드 검증(코드는 클라이언트에 노출 안 됨). 관리자가 계정·**기능별 열람 권한** 발급. 권한 없는 메뉴는 사이드바에 잠금 표시 |
| **화면 흐름** | `index.html`(로그인) → `app.html`(셸: 사이드바 + 상단바 + 콘텐츠 + 상태바) |

> 마스터 관리자는 Vercel 환경변수 `ADMIN_CODE`(또는 `EDUINO_ADMIN_CODE`)로 지정. 구조·데이터 흐름 상세는 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 참조.

---

## 기능 범위

### 🏠 홈 (공통)
홈 대시보드 · 내 업무 · 알림 · **공지사항**(읽음 확인 + 직원 댓글) · 일정·달력

### 🎧 CS · 고객 상담
- **CS상담 메모** — 통화 중 빠른 기록(Ctrl+Enter), 분류·고객유형·상품분류 토글, 콜백 큐, **일일결산**, 구글시트 자동 동기화(헤더 기준 upsert)
- **견적/발주/후불** · **교환/반품/환불** · **중국 발주요청**(재고 대기·입고 요청 공용 리스트)
- **답변·메일 템플릿**(`{변수}` 치환 복사) · **상품 조회**(이카운트: 공급업체명·공급가·판매가·마진율) · **고객 정보 검색**
- **파트너사 관리**(등급·공급율·결제조건 인수인계 카드) · **일일결산** · **업무 매뉴얼**

### 📦 MD · 상품 기획
- **입점사 발주** — 상품코드만 입력하면 입점사·**정산구분**·품명·배송비·무료배송조건 자동채움. 같은 입점사·주문자·일자는 하나의 주문서로 묶어 관리, 구글시트/이카운트용 출력
- **결제요청**(선결제 자동 집계) · **입점사 관리**(신규/변동사항 + 인수인계 카드) · **상품·품절 관리**
- **가격비교** — 아래 [엔티렉스·마우저](#-가격비교-엔티렉스--마우저) 참조
- **TS상담 메모** · **기술상담 템플릿** · **일일결산**
- **부가기능** — 상품 데이터시트 관리 도구(엑셀/CSV 일괄편집) · 상세이미지 변환기(플랫폼별 규격·ZIP)
- **업무 매뉴얼**

### 🚚 물류
- **자사제품 입고** — 중국·마우저 입고 내역 시트(구분·상품코드·제품명·수량·파일위치·**입고여부**), **월별 입고 일정 달력**, 인라인 편집, 팀 공용
- **업무 매뉴얼**

### 🛡️ 관리자
결재함 · **업무 현황**(직원별 처리량 인사이트) · **매출 데이터** · 팀 설정(계정·권한) · 공유 범위 · 감사 로그

### 💹 가격비교 (엔티렉스 · 마우저)
- **엔티렉스(디바이스마트)** — 담당자 PC(국내 IP)에서 판매가를 **매일 자동 수집**(전체를 3일 주기로 순환), **가격 변동 알림** + 일일 리포트 + **[공급가 요청] 메일**
- **마우저 직소싱 대시보드** — 재고·**원가**·**매입가(관·부가세 18% 포함)**·자사 판매가(이카운트)·**마진율**을 좌우 비교, 재고 0 품목은 입고예정(배치별), **장바구니 담기**(Cart API), **주문내역**(Order History API). 재고·가격은 매일 아침 자동 조사

---

## 데이터 범위 · 저장 구조

### 저장소별 역할

| 저장소 | 용도 | 예시 |
|--------|------|------|
| **localStorage** (`store()`) | 개인 설정·캐시(브라우저별) | 로그인 세션, 자사코드 매핑 캐시, UI 상태 |
| **Vercel KV** (`/api/store`) | 팀 공용(즉시 공유) | `coll:*` 공용 컬렉션, `records`(월별 업무 기록), 접속자 하트비트, 공용 설정 |
| **구글시트**(Apps Script) | 백업·외부 공유 | CS 상담이력, 입점사 발주 |
| **이카운트 카탈로그** (`/api/catalog`) | 상품 마스터 | 상품코드 → 상품명·공급가·판매가 (KV 해시, 일 1회 동기화) |
| **마우저 API** (`/api/mouser*`) | 부품 소싱 | 재고·가격·입고예정·장바구니·주문 |
| **엔티렉스 크롤러** (`scripts/ntrex-price.mjs`) | 공급가 감시 | 디바이스마트 판매가 → `coll:ntrex` |

### 업무 도메인(데이터 범위)

- **고객·상담** — CS 상담메모, 콜백 큐, 고객 DB, 교환/반품, TS 상담메모
- **발주·결제** — 입점사 발주, 결제요청, 중국 발주요청
- **상품·가격** — 이카운트 상품 카탈로그, 엔티렉스 공급가표, 마우저 워치리스트
- **물류** — 자사제품 입고(입고여부·일정)
- **정산·인사** — 일일결산(CS/MD), 매출 데이터, 업무 현황(처리량), 직무
- **거래처** — 입점사 관리 카드, 파트너사 관리 카드

> **공용 컬렉션(`coll:*`)** 예: `mouser_inbound`(자사제품 입고), `mouser_stock`·`mouser_report`(마우저 재고·변동), `mouser_edmap`(마우저↔자사코드), `chinaorders`, `callbacks`, `handover_md`·`handover_cs`(입점사·파트너사 카드), `ntrex`(엔티렉스 수집), 공지 등.

### 설정 백업/복원
백엔드가 없어도, 상단바 **[설정 백업]** 으로 모든 설정·데이터를 `.json`으로 내보내고 불러올 수 있습니다(PC·직원 간 세팅 공유 겸용). 팀 공용 저장소를 쓰면 캐시가 지워져도 **[공용 설정 받기]** 로 복원됩니다.

---

## 외부 연동

| 연동 | 방식 | 코드 |
|------|------|------|
| **구글시트** | Apps Script 웹앱(`doPost`) — 헤더 이름 기준 upsert(중복 없음) | [`integrations/google-apps-script/`](integrations/google-apps-script/) (main·sync·orders·customerdb.gs) |
| **마우저** | Search / Cart / Order History API 프록시(서버가 키 보관) | [`api/mouser*.js`](api/), [`lib/mouser.js`](lib/mouser.js) |
| **이카운트** | 상품 카탈로그를 KV로 동기화(일 1회) | [`scripts/sync-ecount.mjs`](scripts/sync-ecount.mjs), [`api/catalog.js`](api/catalog.js) |
| **디바이스마트(엔티렉스)** | 담당자 PC(국내 IP)에서 크롤러 실행 → 서버 업로드(3일 주기 순환·안전 랜덤화) | [`scripts/ntrex-price.mjs`](scripts/ntrex-price.mjs) |
| **메일(SMTP)** | 결제요청·공급가 요청 메일 발송 | [`api/sendmail.js`](api/sendmail.js) |
| **크론** | 마우저 일일 모니터링·이카운트 동기화 | [`api/mouser-cron.js`](api/mouser-cron.js), [`api/cron-sync.js`](api/cron-sync.js) |

---

## 폴더 구조

```
index.html                     접속코드 로그인 (core/config.js + app.js 로드)
app.html                       앱 셸 (전 스크립트 로드=실행 순서 · 주석 참조)
vercel.json                    라우팅·크론 설정

api/                           Vercel 서버리스
  auth.js                      로그인·접속코드 검증
  store.js                     공용 저장소(KV) — coll / records / 하트비트
  catalog.js                   이카운트 상품 카탈로그 조회(KV 해시)
  mouser.js·mouser-cart.js·mouser-orders.js·mouser-cron.js   마우저 API 프록시·크론
  cron-sync.js                 이카운트 등 정기 동기화
  sendmail.js                  SMTP 메일 발송
  backup-snapshot.js           설정·데이터 스냅샷 백업

assets/
  brand/ · platform-logos/     로고·플랫폼 아이콘
  css/    theme.css · shell.css · login.css · base.css
  embeds/ product-tool.html    MD 상품 데이터시트 관리 도구(iframe)
  js/
    core/   config.js          접속코드·NAV·STORE 키·플랫폼 프리셋(실서비스 전환 지점)
            app.js             아이콘·인증·store()·MODULES 레지스트리
            shell.js           사이드바/상단바/상태바 + 해시 라우팅
            worklog.js         Records API(월버킷 기록 읽기/쓰기)
            sync.js            공용 저장소 클라이언트(설정 공유·접속자 현황)
    lib/    xlsxlite.js · zip.js   의존성 없는 XLSX/CSV 파서 · ZIP 생성기
    data/   catalog·vendors·ntrex·mouser·duties 시드(자동생성)
    features/                  기능 모듈(window.MODULES 등록)
      home/ · cs/ · md/ · ts/ · logi/ · admin/ · shared/

integrations/
  google-apps-script/          구글시트 연동(앱이 fetch 로 코드 제공)
  source-data/                 입점사 배송정보 등 원본

scripts/                       개발용(엔티렉스 수집 ntrex-price.mjs · 이카운트 동기화 sync-ecount.mjs)
docs/                          ARCHITECTURE · 기능목록 · 시스템 개요·데이터흐름 · 구글시트 연동 가이드
```

---

## 실행 · 배포

**로컬(화면 확인용)** — 빌드 불필요:
```bash
python3 -m http.server 8080
# http://localhost:8080
```
로컬에선 화면만 뜨고, 로그인·공용저장소·API는 서버리스(`/api/*`)가 필요하므로 **Vercel 배포 환경**에서 동작합니다.

**배포** — Vercel + KV:
1. Vercel에 저장소 연결 → 배포
2. **Vercel KV(Upstash) 스토어를 프로젝트에 연결**(환경변수 `KV_REST_API_URL`·`KV_REST_API_TOKEN` 자동 주입)
3. 환경변수 설정(값은 **환경변수에만**, 코드/문서 금지):
   - `ADMIN_CODE` / `EDUINO_ADMIN_CODE` — 마스터 관리자 접속코드
   - `KV_REST_API_URL` · `KV_REST_API_TOKEN` — KV(Upstash)
   - `MOUSER_API_KEY`(+ Cart·Order 키) — 마우저 API
   - `CRON_SECRET` — 크론·대량 업서트 보호
   - SMTP 계정(호스트·사용자·비밀번호) — 메일 발송

---

## 백업 워크플로

- **개발**은 개인 저장소(`origin`)에서 진행
- **정기 백업**은 회사 저장소로 push:
  ```bash
  git remote add company <회사 저장소 URL>   # 최초 1회
  git push company <브랜치>:main
  ```
- git 없이 보관할 땐 스냅샷/번들:
  ```bash
  git bundle create eduino-backup.bundle --all   # 히스토리 포함
  git archive --format=zip -o eduino-source.zip HEAD   # 소스만
  ```

---

## 새 기능 추가 방법

1. `assets/js/core/config.js` 의 `NAV` 에 메뉴 항목 추가(`key`, `name`, `icon`)
2. `assets/js/features/<부서>/<기능>.js` 에서 `MODULES['<key>'] = { title, icon, render(el){...} }` 등록
3. `app.html` 의 features 구역에 모듈 `<script>` 한 줄 추가(core 이후면 순서 무관)
4. 부서 기본 열람이면 `DEPT_OPEN_KEYS` 에 key 추가

---

## 보안 원칙

- **API 키·접속코드·시크릿은 Vercel 환경변수에만** 둡니다. 코드·문서·커밋에 값을 넣지 않습니다.
- 접속코드는 서버에서만 검증되고 클라이언트 코드에 노출되지 않습니다.
- 커밋 전 민감정보(키·토큰) 유출 여부를 점검합니다.
