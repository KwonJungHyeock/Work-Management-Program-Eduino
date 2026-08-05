# CLAUDE.md — 작업 규칙 및 프로젝트 요약

에듀이노 통합 업무관리 프로그램. 이 문서는 Claude Code가 이 저장소에서 작업할 때 따르는 규칙과,
불필요한 코드 탐색을 줄이기 위한 최소 지도(map)입니다.

---

## 1. 코드 탐색 규칙 — 토큰 절약 (최우선)

- 지시서에 **명시된 파일·모듈만** 읽는다. 코드베이스 전체 훑기 금지.
- 파일은 전체 Read 대신 **Grep으로 해당 함수·심볼 위치를 찾아 필요한 부분만** 읽는다.
- 지시서에 **없는 파일 수정이 필요해 보이면 수정하지 말고 먼저 질문**한다.
- **리팩토링·코드 정리·개선 작업은 지시서에 명시된 경우에만** 수행한다.
- 작업 완료 보고는 **변경 요약만**. 코드 전문 재출력 금지.

---

## 2. 아키텍처 (빌드 없음)

브라우저에서 바로 도는 **no-build SPA**. 번들러·npm 런타임 의존성 없음.

- `app.html` 이 모든 JS를 `<script defer>` 로 **고정 순서** 로드 → **파일을 새로 만들면 반드시 `app.html` 에 등록**.
- 화면 1개 = `MODULES['<dept>.<feature>'] = { title, icon, render(root) }`
- 라우팅 = 해시 `#dept.feature` · 좌측 메뉴 = `assets/js/core/config.js` 의 `NAV`
  → **새 화면 추가 = ① 기능 파일 ② `app.html` script 태그 ③ `NAV` 항목**, 세 곳 모두 필요.

### 폴더
| 경로 | 내용 |
|---|---|
| `assets/js/core/` | `app.js`(전역 헬퍼·`store`·`actLog`) · `config.js`(NAV·STORE·공유설정) · `shell.js`(레이아웃·권한·배지) · `sync.js`(설정 동기화) |
| `assets/js/features/<dept>/` | 화면 모듈 (cs · md · ts · logi · admin · home · shared) |
| `assets/js/data/` | 번들 기본 데이터(입점사·엔티렉스·마우저 시드 등) |
| `assets/js/lib/` | `xlsxlite`(xlsx 읽기) · `xlslite`(레거시 .xls 읽기) · `zip`(zip + `XlsxOut` xlsx 쓰기) |
| `api/` | Vercel 서버리스 (`store` · `auth` · `catalog` · `backup-snapshot` · 크론) |

---

## 3. 데이터 저장 (Upstash Redis = Vercel KV)

`api/store.js` 가 단일 관문. 저장 형태는 **두 가지뿐**:

1. **월 버킷** `eduino:sheet:<dept>:<sheet>:<YYYY-MM>` — 상담·발주 등 실무 기록.
   조회 시 **해당 월만** 읽음(확장에 강함). 쓰기는 `Records.pushRaw`, 허용 시트는 `store.js` 의 `SHEET_ALLOW`.
2. **공용 컬렉션** `eduino:coll:<name>` — 공지·요청·활동로그·마우저 품목 등.
   `collPush`/`collDel`, 조회는 **해시 전체 HGETALL** → 커지면 부담. 새 컬렉션은 append-only가 되지 않게 주의.

그 외: 팀 공용 설정은 `eduino:settings[:cs|:md]` (localStorage ↔ 자동 동기화).
**공유돼야 하는 설정 키는 `config.js` 의 `STORE` + `SHARED_SETTING_KEYS` + `SHARE_DEFAULT` 에 모두 등록**해야 동기화됨.

### 백업 / 복구
- 매일(KST 00:20) 전체 스냅샷 → `eduino:backup:day:<YYYY-MM-DD>` (gzip·14일 자동만료)
- 매월 1일 월간 스냅샷 → `eduino:backup:<YYYY-MM>` + 컬렉션·설정
- 새 컬렉션을 만들면 `api/backup-snapshot.js` 의 `COLL_NAMES` 에 추가할 것.

---

## 4. 자주 쓰는 전역 헬퍼 (재정의 금지)

`store(key)` · `esc` · `el` · `icon(name)` · `toast` · `uuid` · `todayStr()` · `nowISO()` ·
`fmtNum` · `copyText` · `downloadBlob` · `actLog(작업, 구분, 대상)`(활동 로그) ·
`Auth.user()` / `Auth.isAdmin()` · `Records.month(dept, sheet, ym)` ·
`XlsxLite.parseSheets` (.xlsx 읽기) · `XlsLite.parseSheets` (.xls 읽기) · `XlsxOut.save(rows, 파일명, 시트명)` (.xlsx 쓰기)

> `icon()` 은 모르는 이름이면 빈 문자열을 반환(예외 아님). `won` 은 전역이 아님 — 파일마다 확인.

---

## 5. 권한

- `role`: `admin`(전체) · `lead`(파트장) · `member`
- 페이지 접근/수정은 계정별 `perms` / `editPerms` 로 부여 (관리자 → 팀 설정 › 팀원 계정)
- 부서원 기본 열람은 `config.js` 의 `DEPT_OPEN_KEYS`
- 화면 안에서 열람/수정을 나눌 땐 **열람 조건과 수정 조건을 분리**해 쓴다 (예: 파트장 열람, 수정은 권한 부여 시).

---

## 6. 검증 방법 (테스트 러너 없음)

1. 문법: `NODE_PATH=/opt/node22/lib/node_modules /opt/node22/bin/node --check <파일>`
2. 화면: Playwright로 정적 서버 띄우고 `/api/**` 를 mock 한 뒤 `#route` 진입해 확인
   - 세션 주입: `localStorage.setItem('eduino.session', JSON.stringify({user:{…}, ts:Date.now()}))`
   - 스크래치 파일은 스크래치패드 디렉터리에 둘 것(저장소에 남기지 않음)
3. 변경한 화면은 **캡처로 눈으로 확인**하고, 관련 기존 동작은 회귀 확인.

---

## 7. 커밋 · 브랜치

- 작업 브랜치: `claude/work-automation-draft-sxi5np` (다른 브랜치 푸시 금지)
- 푸시: `git push -u origin <branch>` · 네트워크 실패 시에만 2·4·8·16초 백오프 재시도
- 커밋 메시지는 **한국어**, 무엇을·왜 바꿨는지 중심. 트레일러는 기존 커밋과 동일하게 유지.
- **PR은 명시적으로 요청받았을 때만** 생성.

## 8. 보안 (예외 없음)

- API 키·토큰·접속코드를 코드/문서/커밋에 절대 쓰지 않는다. 비밀값은 **Vercel 환경변수만** 사용.
- 커밋 전 diff 에 비밀값이 없는지 확인한다.
- 사용자 데이터(매출·거래처·고객)를 외부로 내보내거나 공개 호스팅하지 않는다.
