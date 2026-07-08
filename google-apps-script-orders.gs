/**
 * 에듀이노 통합 업무관리 · 입점사 발주 → 구글시트(발주표) 연동
 * ---------------------------------------------------------------------------
 * 설치
 *  1) 발주표 구글시트를 연다.
 *  2) 확장 프로그램 → Apps Script → 이 코드를 전부 붙여넣고 저장.
 *  3) 배포 → 새 배포 → 웹 앱(액세스: 모든 사용자)로 배포.
 *  4) 나온 /exec URL을 프로그램 → MD → 입점사 발주 → 연동 설정 에 입력.
 *
 * 동작
 *  - doPost: { cols:[헤더...], rows:[[...],[...]] } 를 받아 SHEET_NAME 시트에
 *            헤더가 없으면 먼저 넣고, 전달된 행들을 순서대로 append 한다.
 *  - doGet : 헬스체크.
 */

var SHEET_NAME = '발주';   // 실제 탭 이름에 맞게 수정

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  try {
    var sh = getSheet_();
    return json_({ ok: true, sheet: SHEET_NAME, rows: Math.max(0, sh.getLastRow()) });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
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
    // 시트가 비어있고 헤더가 넘어왔으면 헤더부터
    if (sh.getLastRow() === 0 && cols.length) {
      sh.appendRow(cols);
      sh.setFrozenRows(1);
    }
    var width = cols.length || rows[0].length;
    var values = rows.map(function (r) {
      var row = r.slice(0, width);
      while (row.length < width) row.push('');
      return row;
    });
    sh.getRange(sh.getLastRow() + 1, 1, values.length, width).setValues(values);

    return json_({ ok: true, added: values.length });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
