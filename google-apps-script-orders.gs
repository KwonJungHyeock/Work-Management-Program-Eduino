/**
 * 에듀이노 통합 업무관리 · 입점사 발주 → 구글시트(발주표) 연동
 * ---------------------------------------------------------------------------
 * 설치
 *  1) 발주표 구글시트를 연다.
 *  2) 확장 프로그램 → Apps Script → 이 코드를 전부 붙여넣고 저장.
 *  3) 배포 → 새 배포 → 웹 앱(실행: 나 / 액세스: 모든 사용자)로 배포.
 *  4) 나온 /exec URL을 프로그램 → MD → 입점사 발주 → 연동 설정 에 입력.
 *
 * 동작
 *  - doPost: { cols:[헤더...], rows:[[...],[...]] } 를 받아 SHEET_NAME 시트에 append.
 *    ★ 시트의 1행(헤더 이름)을 읽어 "열 이름"으로 매핑하므로, 시트 열 순서가
 *      우리와 달라도 값이 올바른 칸에 들어갑니다. (자체상품코드 ↔ 상품코드 별칭 처리)
 *    ★ 헤더가 없으면 전달된 cols 를 먼저 헤더로 넣습니다.
 *  - doGet : 헬스체크.
 */

var SHEET_NAME = '발주';   // 실제 탭 이름에 맞게 수정 (예: '2026년입점사발주')

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function norm_(s) { return String(s == null ? '' : s).replace(/\s/g, '').toLowerCase(); }

function doGet() {
  try {
    var sh = getSheet_();
    return json_({ ok: true, sheet: SHEET_NAME, rows: Math.max(0, sh.getLastRow()) });
  } catch (err) { return json_({ ok: false, error: String(err) }); }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    var cols = body.cols || [];
    var rows = body.rows || [];
    if (!rows.length) return json_({ ok: true, added: 0 });

    var sh = getSheet_();

    // 1) 헤더 확보
    var lastCol = sh.getLastColumn();
    var header = (sh.getLastRow() >= 1 && lastCol > 0) ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    var hasHeader = header.some(function (h) { return String(h).trim() !== ''; });
    if (!hasHeader) {
      sh.getRange(1, 1, 1, cols.length).setValues([cols]);
      sh.setFrozenRows(1);
      header = cols.slice();
    }

    // 2) 헤더 이름 → 열 인덱스
    var idx = {};
    header.forEach(function (h, i) { var k = norm_(h); if (k && idx[k] == null) idx[k] = i; });
    // 별칭: 자체상품코드 <-> 상품코드
    var alias = function (name) {
      var k = norm_(name);
      if (idx[k] != null) return idx[k];
      if (k === norm_('자체상품코드') && idx[norm_('상품코드')] != null) return idx[norm_('상품코드')];
      if (k === norm_('상품코드') && idx[norm_('자체상품코드')] != null) return idx[norm_('자체상품코드')];
      return null;
    };

    // 3) 들어온 각 행을 시트 열 순서에 맞춰 재배치
    var width = header.length;
    var out = rows.map(function (r) {
      var line = [];
      for (var i = 0; i < width; i++) line.push('');
      cols.forEach(function (cName, ci) {
        var col = alias(cName);
        if (col != null && col < width) line[col] = (r[ci] != null ? r[ci] : '');
      });
      return line;
    });

    sh.getRange(sh.getLastRow() + 1, 1, out.length, width).setValues(out);
    return json_({ ok: true, added: out.length });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
