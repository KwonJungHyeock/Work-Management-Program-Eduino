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
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function norm_(s) { return String(s == null ? '' : s).replace(/\s/g, '').toLowerCase(); }

function doGet() {
  try {
    var sh = getSheet_();
    return json_({ ok: true, sheet: SHEET_NAME || sh.getName(), rows: Math.max(0, sh.getLastRow() - 1) });
  } catch (err) { return json_({ ok: false, error: String(err) }); }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // 동시 요청 직렬화 → 행 꼬임 방지
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    var records = body.records || (body.id ? [body] : []);
    if (!records.length) return json_({ ok: true, synced: [] });

    var sh = getSheet_(body.sheet);   // body.sheet = 모듈이 지정한 탭 이름(없으면 SHEET_NAME/첫 탭)

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
