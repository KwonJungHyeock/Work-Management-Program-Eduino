/**
 * 에듀이노 통합 업무관리 · 구글 시트 2차 백업 연동 (Apps Script 웹앱) · 범용/통합본
 * ---------------------------------------------------------------------------
 * ★ 한 번만 배포하면 모든 모듈(상담 메모/발주/후불·발주/교환·반품/현황판/TS 등)이
 *   각자 "탭(sheet)"에 자동으로 쌓입니다. 모듈이 보낼 탭 이름을 요청에 담아 보냅니다.
 *
 * 설치 (한 번)
 *  1) 백업용 구글 스프레드시트를 하나 만든다. (탭은 자동 생성되므로 비어 있어도 됨)
 *  2) 확장 프로그램 → Apps Script 에 이 코드를 전부 붙여넣고 저장.
 *  3) SHEET_NAME 은 비워둔다('') → 각 모듈이 자기 탭에 기록. (특정 탭에 고정하려면 탭 이름 입력)
 *  4) 배포 → 새 배포 → 웹 앱(실행: 나 / 액세스: 모든 사용자)로 배포.
 *  5) 표시된 /exec URL 을 프로그램의 각 모듈 [시트 연동]에 붙여넣는다.
 *     (같은 스프레드시트를 쓰면 모든 모듈에 같은 URL 을 붙여넣으면 됨 — 탭만 달라짐)
 *  ※ 코드 수정 후에는 반드시 [배포 관리 → 새 버전 → 배포]로 재배포.
 *
 * 동작
 *  - doPost: { sheet:'탭이름', records:[{ id, 헤더1:값, 헤더2:값, … }] }
 *    ★ body.sheet 로 기록할 탭 지정(없으면 SHEET_NAME/첫 탭). 없는 탭은 자동 생성.
 *    ★ 시트 1행(헤더 이름)을 읽어 "열 이름"으로 매핑 → 열 순서가 달라도 올바른 칸에 들어감.
 *      (헤더가 비어 있으면 첫 레코드의 키로 헤더를 자동 생성)
 *    ★ 숨은 'id' 열로 upsert(있으면 갱신, 없으면 추가) → 재전송/수정해도 중복 행 없음.
 *  - doGet : 헬스체크.
 */

var SHEET_NAME = '';   // 비워두면 요청이 지정한 탭(모듈명)에 자동 기록 · 특정 탭 고정 시 탭 이름 입력
                       // ※ 한 번만 배포하면 모든 모듈(상담/발주/현황판 등)이 각자 탭에 쌓입니다.

function getSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var target = SHEET_NAME || name;   // 고정 탭(SHEET_NAME) 우선, 없으면 요청이 준 탭 이름
  if (target) return ss.getSheetByName(target) || ss.insertSheet(target);
  return ss.getSheets()[0];
}

/**
 * ★ 한 번 실행하면(편집기에서 함수 선택 → 실행) 이 스프레드시트에 CS·MD 전체 탭을
 *   헤더까지 자동 생성합니다. (프로그램 모듈이 보내는 탭 이름·헤더와 동일)
 *   이미 있는 탭은 헤더만 채우고 데이터는 건드리지 않습니다.
 */
var TABS_ = {
  'CS상담메모': ['날짜','분류','주문경로','연락처','고객유형','주문자/학교/업체명','상품분류','상품코드','내용','답변','상담사','id'],
  '후불·발주': ['접수일자','구분','거래처명','이름','연락처','이메일','금액','출고일','할인율','내용','배송주소','메모','등록자','id'],
  '교환·반품': ['접수일자','구분','거래처명','이름','연락처','이메일','주문경로','금액','출고일','처리상태','내용','메모','등록자','id'],
  '입점사 신규·변동사항': ['타이틀(업무 내용)','진행상태','프로젝트 구분','담당자','시작일','종료(예정)일','진행율(%)','설명/비고','등록자','id'],
  '품절관리 현황': ['날짜','분류','자사/입점사','입점사명','자체코드','상품관리(제품명)','처리자','처리내용','상태','날짜(기록용)','특이사항','등록자','id'],
  '제품검수 현황': ['검수(제목)','입고일자','검수일자','담당자','상품코드','제품명','동작 기능','외관 및 구성품','상세페이지 수정','특이사항','등록자','id'],
  '상품관리 현황': ['상품관리(제품명)','날짜','처리자','분류','자체코드','처리내용','상태','날짜(기록용)','특이사항','등록자','id'],
  'TS상담메모': ['날짜','문의플랫폼','담당자','상품코드','상품구분','제품명','고객정보','문의사항','답변요약','답변원본','비고','id'],
  '입점사발주': ['일자','구분','주문경로','주문자명','입점사명','정산구분','자체상품코드','품명','수량','출고송장/입고','발주','배송정보/비고'],
  '일일결산': ['날짜','부서','총건수','항목별 집계','담당자별 집계','담당자 특이사항','파트 종합','상신자','결재자','결재일시','id']
};
function setupTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS_).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var header = TABS_[name];
    var cur = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
    var hasHeader = cur.some(function (h) { return String(h).trim() !== ''; });
    if (!hasHeader) { sh.getRange(1, 1, 1, header.length).setValues([header]); sh.setFrozenRows(1); sh.getRange(1, 1, 1, header.length).setFontWeight('bold'); }
  });
  // 기본 '시트1'(빈 탭)이 있으면 정리(내용 없을 때만)
  var s1 = ss.getSheetByName('시트1') || ss.getSheetByName('Sheet1');
  if (s1 && ss.getSheets().length > 1 && s1.getLastRow() === 0) ss.deleteSheet(s1);
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function norm_(s) { return String(s == null ? '' : s).replace(/\s/g, '').toLowerCase(); }

// 발주표 형식(cols/rows) → 시트 열 이름에 맞춰 append (헤더 없으면 cols로 생성)
function appendRows_(sh, cols, rows) {
  if (!rows.length) return json_({ ok: true, added: 0 });
  var lastCol = sh.getLastColumn();
  var header = (sh.getLastRow() >= 1 && lastCol > 0) ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var hasHeader = header.some(function (h) { return String(h).trim() !== ''; });
  if (!hasHeader) { sh.getRange(1, 1, 1, cols.length).setValues([cols]); sh.setFrozenRows(1); header = cols.slice(); }
  var idx = {};
  header.forEach(function (h, i) { var k = norm_(h); if (k && idx[k] == null) idx[k] = i; });
  function alias(name) { var k = norm_(name);
    if (idx[k] != null) return idx[k];
    if (k === norm_('자체상품코드') && idx[norm_('상품코드')] != null) return idx[norm_('상품코드')];
    if (k === norm_('상품코드') && idx[norm_('자체상품코드')] != null) return idx[norm_('자체상품코드')];
    return null; }
  var width = Math.max(header.length, cols.length);
  var out = rows.map(function (r) { var line = []; for (var i = 0; i < width; i++) line.push('');
    cols.forEach(function (cName, ci) { var col = alias(cName); if (col == null) col = ci; if (col != null && col < width) line[col] = (r[ci] != null ? r[ci] : ''); });
    return line; });
  sh.getRange(sh.getLastRow() + 1, 1, out.length, width).setValues(out);
  return json_({ ok: true, added: out.length });
}

function doGet(e) {
  try {
    var name = (e && e.parameter && e.parameter.sheet) || '';   // ?sheet=탭이름 이면 그 탭의 상태를 반환
    var sh = getSheet_(name);
    return json_({ ok: true, sheet: sh.getName(), rows: Math.max(0, sh.getLastRow() - 1) });
  } catch (err) { return json_({ ok: false, error: String(err) }); }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // 동시 요청 직렬화 → 행 꼬임 방지
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    var sh = getSheet_(body.sheet);   // body.sheet = 모듈이 지정한 탭 이름(없으면 SHEET_NAME/첫 탭)

    // (A) 발주표 형식 { cols:[헤더…], rows:[[…]] } → 포지셔널 append (입점사 발주)
    if (body.cols && body.rows) return appendRows_(sh, body.cols, body.rows);

    // (B) 일반 형식 { records:[{ id, 헤더:값 }] } → id 기준 upsert (상담/현황판 등)
    var records = body.records || (body.id ? [body] : []);
    if (!records.length) return json_({ ok: true, synced: [] });

    // 1) 헤더 확보 (없으면 첫 레코드의 키로 생성)
    var lastCol = sh.getLastColumn();
    var header = (sh.getLastRow() >= 1 && lastCol > 0) ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    var hasHeader = header.some(function (h) { return String(h).trim() !== ''; });
    if (!hasHeader) {
      header = Object.keys(records[0]);
      sh.getRange(1, 1, 1, header.length).setValues([header]);
      sh.setFrozenRows(1);
    }

    // 2) upsert용 id 열 확보 (없으면 맨 오른쪽에 자동 추가)
    var idCol = -1;
    header.forEach(function (h, i) { if (norm_(h) === 'id') idCol = i; });
    if (idCol < 0) { idCol = header.length; header.push('id'); sh.getRange(1, idCol + 1, 1, 1).setValue('id'); }
    var width = header.length;

    // 3) 헤더 이름 → 열 인덱스
    var idx = {};
    header.forEach(function (h, i) { var k = norm_(h); if (k && idx[k] == null) idx[k] = i; });
    // 별칭: 상품코드 ↔ 자체상품코드
    function colOf(key) {
      var k = norm_(key);
      if (idx[k] != null) return idx[k];
      if (k === norm_('상품코드') && idx[norm_('자체상품코드')] != null) return idx[norm_('자체상품코드')];
      return null;
    }

    // 4) 기존 id → 행번호
    var idToRow = {};
    var lastRow = sh.getLastRow();
    if (lastRow > 1) {
      var ids = sh.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) idToRow[String(ids[i][0])] = i + 2;
    }

    var synced = [];
    records.forEach(function (r) {
      var existing = idToRow[String(r.id)];
      // 기존 행이면 값 유지하며 갱신, 신규면 빈 줄
      var line = existing ? sh.getRange(existing, 1, 1, width).getValues()[0] : [];
      while (line.length < width) line.push('');
      Object.keys(r).forEach(function (key) {
        if (key === 'id') return;
        var col = colOf(key);
        if (col != null && col < width) line[col] = (r[key] != null ? r[key] : '');
      });
      line[idCol] = r.id;
      if (existing) {
        sh.getRange(existing, 1, 1, width).setValues([line]);
      } else {
        sh.getRange(sh.getLastRow() + 1, 1, 1, width).setValues([line]);
        idToRow[String(r.id)] = sh.getLastRow();
      }
      synced.push(r.id);
    });

    return json_({ ok: true, synced: synced, count: synced.length });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
