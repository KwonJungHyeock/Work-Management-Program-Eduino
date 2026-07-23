/**
 * 에듀이노 통합 업무관리 · 공용 저장소 (팀 설정 공유 + 접속자 현황)
 * ---------------------------------------------------------------------------
 * 목적
 *  - 백엔드 없이 4명(CS2/MD2)이 같은 설정을 공유하고, 브라우저 캐시를 지워도
 *    "공용 설정 받기"로 복원. + 지금 누가 접속해 있는지(접속자 현황) 표시.
 *  - 무거운 데이터(상담 이력·발주)는 각자의 시트에 그대로 쌓이고, 여기에는
 *    작은 "팀 공통 설정"과 "접속 하트비트"만 저장하므로 무료 한도로 충분합니다.
 *
 * 설치
 *  1) 전용 구글시트를 하나 새로 만든다. (예: "에듀이노_공용저장소")
 *  2) 확장 프로그램 → Apps Script 에 이 코드를 붙여넣고 저장.
 *  3) 배포 → 새 배포 → 웹 앱(실행: 나 / 액세스: 모든 사용자)로 배포.
 *  4) /exec URL 을 프로그램 상단 [설정 백업] → "공용(구글) 동기화" 에 입력.
 *  ※ 코드 수정 후에는 반드시 [배포 관리 → 새 버전 → 배포]로 재배포.
 *
 * API
 *  - GET  ?type=settings  → { ok, settings:{key:value,...} }
 *  - GET  ?type=presence  → { ok, presence:[{device,dept}] }   (최근 접속자만)
 *  - GET                  → 위 둘 다 + 헬스체크
 *  - POST { op:'setSettings', entries:{key:value,...}, device }
 *  - POST { op:'presence', device, dept }
 */

var SETTINGS_SHEET = 'settings';
var PRESENCE_SHEET = 'presence';
var PRESENCE_TTL_MIN = 3;   // 이 시간(분) 안에 하트비트가 있으면 "접속 중"

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function sheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(headers); sh.setFrozenRows(1); }
  return sh;
}

function readSettings_() {
  var sh = sheet_(SETTINGS_SHEET, ['key', 'value', 'updatedAt', 'updatedBy']);
  var last = sh.getLastRow(), map = {};
  if (last > 1) {
    var vals = sh.getRange(2, 1, last - 1, 2).getValues();
    vals.forEach(function (r) { if (r[0] !== '') map[String(r[0])] = String(r[1]); });
  }
  return map;
}
function readPresence_() {
  var sh = sheet_(PRESENCE_SHEET, ['device', 'dept', 'lastSeen']);
  var last = sh.getLastRow(), now = new Date().getTime(), list = [];
  if (last > 1) {
    var vals = sh.getRange(2, 1, last - 1, 3).getValues();
    vals.forEach(function (r) {
      var t = new Date(r[2]).getTime();
      if (r[0] !== '' && (now - t) < PRESENCE_TTL_MIN * 60000) list.push({ device: String(r[0]), dept: String(r[1]) });
    });
  }
  return list;
}

function doGet(e) {
  try {
    var type = (e && e.parameter && e.parameter.type) || 'all';
    var out = { ok: true };
    if (type === 'settings' || type === 'all') out.settings = readSettings_();
    if (type === 'presence' || type === 'all') out.presence = readPresence_();
    return json_(out);
  } catch (err) { return json_({ ok: false, error: String(err) }); }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var b = JSON.parse(e.postData.contents || '{}');

    if (b.op === 'setSettings') {
      var sh = sheet_(SETTINGS_SHEET, ['key', 'value', 'updatedAt', 'updatedBy']);
      var last = sh.getLastRow(), idx = {};
      if (last > 1) {
        var keys = sh.getRange(2, 1, last - 1, 1).getValues();
        for (var i = 0; i < keys.length; i++) idx[String(keys[i][0])] = i + 2;
      }
      var now = new Date().toISOString(), entries = b.entries || {}, n = 0;
      Object.keys(entries).forEach(function (k) {
        var row = [k, entries[k], now, b.device || ''];
        if (idx[k]) sh.getRange(idx[k], 1, 1, 4).setValues([row]);
        else { sh.appendRow(row); idx[k] = sh.getLastRow(); }
        n++;
      });
      return json_({ ok: true, saved: n });
    }

    if (b.op === 'presence') {
      var sh2 = sheet_(PRESENCE_SHEET, ['device', 'dept', 'lastSeen']);
      var last2 = sh2.getLastRow(), idx2 = {};
      if (last2 > 1) {
        var ds = sh2.getRange(2, 1, last2 - 1, 1).getValues();
        for (var j = 0; j < ds.length; j++) idx2[String(ds[j][0])] = j + 2;
      }
      var row2 = [b.device || '', b.dept || '', new Date().toISOString()];
      if (idx2[b.device]) sh2.getRange(idx2[b.device], 1, 1, 3).setValues([row2]);
      else sh2.appendRow(row2);
      return json_({ ok: true });
    }

    return json_({ ok: false, error: 'unknown op' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
