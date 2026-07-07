/**
 * Eduino Works · CS 상담 메모 → 구글 시트 연동 (Apps Script 웹앱)
 * ---------------------------------------------------------------------------
 * 설치 방법
 *  1) 연동할 구글 시트를 연다.
 *  2) 확장 프로그램 → Apps Script 를 열고, 이 파일 내용을 전부 붙여넣는다.
 *  3) 저장 후 [배포] → [새 배포] → 유형 "웹 앱" 선택.
 *       - 실행 계정: 나
 *       - 액세스 권한: "모든 사용자"
 *  4) 배포 후 나오는 웹 앱 URL(.../exec)을 복사해
 *     Eduino Works → CS → 상담 메모 → 연동 설정 에 붙여넣는다.
 *
 * 동작
 *  - doPost: { records:[ {id, createdAt, type, agent, contact, product, memo, callback, syncedAt} ] }
 *            를 받아 SHEET_NAME 시트에 id 기준으로 upsert(있으면 갱신, 없으면 추가)한다.
 *            → 같은 레코드를 재전송해도 중복 행이 생기지 않는다(네트워크 재시도 안전).
 *  - doGet : 헬스체크. { ok:true, sheet:"상담메모", rows:N } 반환.
 */

var SHEET_NAME = '상담메모';
var HEADERS = ['id','createdAt','type','agent','contact','product','memo','callback','syncedAt','receivedAt'];

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
  }
  // 헤더가 없으면 생성
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  try {
    var sh = getSheet_();
    return json_({ ok: true, sheet: SHEET_NAME, rows: Math.max(0, sh.getLastRow() - 1) });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // 동시 요청 직렬화 → 행 꼬임 방지
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    var records = body.records || (body.id ? [body] : []);
    if (!records.length) return json_({ ok: true, synced: [] });

    var sh = getSheet_();
    var lastRow = sh.getLastRow();

    // 기존 id → 행번호 인덱스
    var idToRow = {};
    if (lastRow > 1) {
      var ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) idToRow[String(ids[i][0])] = i + 2;
    }

    var now = new Date().toISOString();
    var synced = [];

    records.forEach(function (r) {
      var row = HEADERS.map(function (h) {
        if (h === 'receivedAt') return now;
        if (h === 'callback') return r.callback ? 'Y' : 'N';
        return r[h] != null ? r[h] : '';
      });
      var existing = idToRow[String(r.id)];
      if (existing) {
        sh.getRange(existing, 1, 1, HEADERS.length).setValues([row]); // upsert: 갱신
      } else {
        sh.appendRow(row);                                            // 신규 추가
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
