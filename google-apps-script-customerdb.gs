/* ===========================================================================
   에듀이노 고객 데이터베이스 — Apps Script (고객DB 스프레드시트 전용)
   -------------------------------------------------------------------------
   역할
   1) 프로그램(후불/발주/견적)이 저장한 건을 원장 [21_거래내역]에 id 기준 append/수정/삭제
   2) [재집계] 신규 거래를 기존 [01_고객마스터]·타겟별 시트에 "증분"으로 반영
      · 기존 거래처/통합은 절대 재분리하지 않음(역사 데이터는 기준선으로 고정)
      · 매칭 안 되는 신규 거래처는 [신규_확인] 탭에 모아 사람이 검토
      · [00_요약]은 이미 수식(SUMIF)이라 원장만 쌓이면 자동 최신화 → 손대지 않음

   배포
   - 이 고객DB 스프레드시트에서 확장 프로그램 → Apps Script → 이 코드 전체 붙여넣기 → 저장
   - 배포 → 새 배포 → 웹 앱 (실행: 나 / 액세스: 모든 사용자) → /exec URL 복사
   - 프로그램 [후불/발주] → 시트 연동 → "고객 데이터베이스(원장) 연동" 에 그 URL 저장
   - 시트를 새로고침하면 상단 [고객DB] 메뉴가 생깁니다. 최초 1회 [재집계 실행]으로
     기준선이 설정되고(기존 행은 이미 요약/마스터에 포함되어 있으므로 기준선 처리),
     이후부터 신규 저장분이 자동 반영됩니다. (매일 자동 실행도 설치 가능)
   =========================================================================== */

var LEDGER = '21_거래내역';
var MASTER = '01_고객마스터';
var REVIEW = '신규_확인';
var MARK   = '집계반영';                       // 원장에 추가되는 증분 처리 표시 열
var PARTNER_TARGET = '파트너·입점사';
// 타겟 → 타겟별 시트(_전체 / _구매). 파트너·입점사는 별도 구조(02)라 마스터만 갱신.
var TARGET_SHEETS = {
  '대학':      ['03_대학_전체','04_대학_구매'],
  '고등':      ['05_고등_전체','06_고등_구매'],
  '중등':      ['07_중등_전체','08_중등_구매'],
  '초등':      ['09_초등_전체','10_초등_구매'],
  '유아':      ['11_유아_전체','12_유아_구매'],
  '공공기관':  ['13_공공기관_전체','14_공공기관_구매'],
  '기업·학원': ['15_기업학원_전체','16_기업학원_구매'],
  '개인':      ['17_개인_전체','18_개인_구매'],
  '미분류':    ['19_미분류_전체','20_미분류_구매'],
};

/* ---------- 공통 유틸 ---------- */
function ss_() { return SpreadsheetApp.getActive(); }
function sheet_(name) { return ss_().getSheetByName(name); }
function normKey_(s) {
  s = String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();
  s = s.replace(/^[(（]\s*입찰\s*[)）]\s*/, '').replace(/^입찰\s+/, '');
  return s.replace(/\s+/g, '').toLowerCase();
}
function num_(x) { var n = parseFloat(String(x == null ? '' : x).replace(/[^\d.\-]/g, '')); return isNaN(n) ? 0 : n; }
function isPurchase_(gubun) { return String(gubun || '').trim() !== '견적'; }   // 견적만 문의, 나머지는 구매
function ymd_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var s = String(v || '').trim(); var m = s.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  return m ? (m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2)) : '';
}
// 헤더 행(1행)에서 이름→열번호(1-base) 맵
function headerMap_(sh) {
  var lastCol = sh.getLastColumn(); if (lastCol < 1) return { map: {}, lastCol: 0 };
  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {}; for (var i = 0; i < hdr.length; i++) { var k = String(hdr[i] || '').trim(); if (k && !(k in map)) map[k] = i + 1; }
  return { map: map, lastCol: lastCol };
}

/* ---------- 웹앱 진입점 ---------- */
function doGet(e) {
  var name = (e && e.parameter && e.parameter.sheet) || LEDGER;
  var sh = sheet_(name);
  var rows = sh ? Math.max(0, sh.getLastRow() - 1) : 0;
  return json_({ ok: true, sheet: name, rows: rows });
}
function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var name = body.sheet || LEDGER;
    var sh = sheet_(name);
    if (!sh) return json_({ ok: false, error: 'sheet not found: ' + name });
    if (body.delIds && body.delIds.length) { var d = delByIds_(sh, body.delIds); return json_({ ok: true, deleted: d }); }
    var recs = body.records || (body.record ? [body.record] : []);
    if (!recs.length) return json_({ ok: false, error: 'no records' });
    var n = upsertById_(sh, recs);
    return json_({ ok: true, upserted: n });
  } catch (err) { return json_({ ok: false, error: String(err && err.message || err) }); }
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------- 원장 append / 수정 / 삭제 (id 기준) ---------- */
function upsertById_(sh, records) {
  var hm = headerMap_(sh), map = hm.map, lastCol = hm.lastCol;
  if (!map['id']) throw new Error("원장 1행에 'id' 헤더가 없습니다");
  var idCol = map['id'];
  var lastRow = sh.getLastRow();
  var ids = lastRow > 1 ? sh.getRange(2, idCol, lastRow - 1, 1).getValues() : [];
  var pos = {}; for (var i = 0; i < ids.length; i++) { var v = String(ids[i][0] || ''); if (v) pos[v] = i + 2; }
  var appended = [];
  for (var r = 0; r < records.length; r++) {
    var rec = records[r]; var id = String(rec.id || '');
    var rowArr = new Array(lastCol).fill('');
    for (var key in rec) { if (map[key]) rowArr[map[key] - 1] = rec[key]; }
    if (id && pos[id]) {
      // 수정: 값이 온 열만 덮어씀(빈 값도 반영), 단 집계반영 열은 건드리지 않음
      var rowNum = pos[id];
      var cur = sh.getRange(rowNum, 1, 1, lastCol).getValues()[0];
      for (var key2 in rec) { if (map[key2]) cur[map[key2] - 1] = rec[key2]; }
      sh.getRange(rowNum, 1, 1, lastCol).setValues([cur]);
    } else {
      appended.push(rowArr);
    }
  }
  if (appended.length) sh.getRange(sh.getLastRow() + 1, 1, appended.length, lastCol).setValues(appended);
  return records.length;
}
function delByIds_(sh, delIds) {
  var hm = headerMap_(sh); if (!hm.map['id']) return 0;
  var idCol = hm.map['id']; var lastRow = sh.getLastRow(); if (lastRow < 2) return 0;
  var ids = sh.getRange(2, idCol, lastRow - 1, 1).getValues();
  var want = {}; delIds.forEach(function (x) { want[String(x)] = 1; });
  var del = [];
  for (var i = 0; i < ids.length; i++) { if (want[String(ids[i][0] || '')]) del.push(i + 2); }
  del.sort(function (a, b) { return b - a; }).forEach(function (rn) { sh.deleteRow(rn); });
  return del.length;
}

/* ---------- 재집계 (증분) ---------- */
function recalc() {
  var lock = LockService.getScriptLock(); if (!lock.tryLock(30000)) { toast_('다른 재집계가 실행 중입니다'); return; }
  try {
    var led = sheet_(LEDGER); if (!led) { toast_('[' + LEDGER + '] 시트가 없습니다'); return; }
    var hm = headerMap_(led), map = hm.map;
    ['id', '구분', '타겟', '거래처명', '금액', '날짜'].forEach(function (k) { if (!map[k]) throw new Error('원장에 ' + k + ' 헤더가 없습니다'); });
    var lastRow = led.getLastRow(), lastCol = led.getLastColumn();

    // 집계반영(MARK) 열 확보 — 없으면 새로 만들고 "기존 행 전체를 기준선(Y)"으로 표시하고 종료(중복집계 방지)
    var firstTime = false;
    if (!map[MARK]) {
      led.getRange(1, lastCol + 1).setValue(MARK);
      map[MARK] = lastCol + 1; lastCol += 1; firstTime = true;
      if (lastRow > 1) led.getRange(2, map[MARK], lastRow - 1, 1).setValues(rep_('Y', lastRow - 1));
      SpreadsheetApp.flush();
      toast_('기준선 설정 완료 · 기존 ' + (lastRow - 1) + '행은 이미 요약/마스터에 포함(집계반영=Y). 이후 신규 저장분부터 자동 반영됩니다.');
      return;
    }
    if (lastRow < 2) { toast_('원장에 데이터가 없습니다'); return; }

    var data = led.getRange(2, 1, lastRow - 1, lastCol).getValues();
    var markCol0 = map[MARK] - 1, gCol0 = map['구분'] - 1, tCol0 = map['타겟'] - 1,
        vCol0 = map['거래처명'] - 1, aCol0 = map['금액'] - 1, dCol0 = map['날짜'] - 1;

    // 처리 대상 = 집계반영 != 'Y' 인 신규 행
    var pending = [];
    for (var i = 0; i < data.length; i++) { if (String(data[i][markCol0] || '').toUpperCase() !== 'Y') pending.push(i); }
    if (!pending.length) { toast_('새로 반영할 신규 거래가 없습니다.'); return; }

    // 고객마스터 로드 + normKey 인덱스
    var mst = sheet_(MASTER); if (!mst) throw new Error('[' + MASTER + '] 시트가 없습니다');
    var mhm = headerMap_(mst); var mMap = mhm.map;
    var mCol = function (n) { return mMap[n] || 0; };
    var mLastRow = mst.getLastRow();
    var mVals = mLastRow > 1 ? mst.getRange(2, 1, mLastRow - 1, mhm.lastCol).getValues() : [];
    var mIndex = {}; // normKey → 0-based row in mVals
    var nameC = mCol('거래처명');
    for (var r = 0; r < mVals.length; r++) { var k = normKey_(mVals[r][nameC - 1]); if (k && !(k in mIndex)) mIndex[k] = r; }

    // 신규(미매칭) 집계 버킷
    var review = {}; // normKey → {name,target,cnt,sum,first,last,quote}
    var quoteDelta = {}; // 기존 거래처의 이번 견적 증가분(타겟별 견적문의수에 가산 · 고객마스터엔 열 없음)
    var applied = 0;

    for (var p = 0; p < pending.length; p++) {
      var row = data[pending[p]];
      var name = row[vCol0], key = normKey_(name);
      if (!key) { data[pending[p]][markCol0] = 'Y'; continue; }
      var gubun = row[gCol0], amt = num_(row[aCol0]), date = ymd_(row[dCol0]), purchase = isPurchase_(gubun);
      if (key in mIndex) {
        applyToRow_(mVals[mIndex[key]], mMap, purchase, amt, date);
        if (!purchase) quoteDelta[key] = (quoteDelta[key] || 0) + 1;
        applied++;
      } else {
        var b = review[key] || (review[key] = { name: String(name).replace(/[\r\n]+/g, ' ').trim(), target: row[tCol0], cnt: 0, sum: 0, quote: 0, first: '', last: '' });
        if (purchase) { b.cnt++; b.sum += amt; } else { b.quote++; }
        if (date) { if (!b.first || date < b.first) b.first = date; if (!b.last || date > b.last) b.last = date; }
        if (!(key in review)) newcust++;
      }
      data[pending[p]][markCol0] = 'Y';
    }

    // 고객마스터 저장(변경 행만) + 마크 저장
    if (mVals.length) mst.getRange(2, 1, mVals.length, mhm.lastCol).setValues(mVals);
    led.getRange(2, map[MARK], data.length, 1).setValues(data.map(function (x) { return [x[markCol0]]; }));

    // 타겟별 시트 숫자 동기화(기존 행만 · 큐레이션 열은 보존)
    syncTargetSheets_(mVals, mMap, quoteDelta);

    // 신규_확인 탭 갱신(누적)
    var revCount = writeReview_(review);

    SpreadsheetApp.flush();
    toast_('재집계 완료 · 기존 거래처 ' + applied + '건 반영 / 신규 후보 ' + Object.keys(review).length + '곳(신규_확인 ' + revCount + '행). ※ 신규는 검토 후 고객마스터에 추가하세요.');
  } finally { lock.releaseLock(); }
}

// 마스터/타겟 한 행에 거래 1건 반영 — 구매만 건수·금액·구매일 갱신, 견적은 견적문의수(열 있을 때)만
function applyToRow_(rowArr, map, purchase, amt, date) {
  function add(col, delta) { if (col) rowArr[col - 1] = num_(rowArr[col - 1]) + delta; }
  function setMax(col, d) { if (col && d) { var cur = ymd_(rowArr[col - 1]); if (!cur || d > cur) rowArr[col - 1] = d; } }
  function setMin(col, d) { if (col && d) { var cur = ymd_(rowArr[col - 1]); if (!cur || d < cur) rowArr[col - 1] = d; } }
  if (purchase) {
    add(map['구매건수'], 1); add(map['총구매액(원)'] || map['총구매액'], amt);
    setMin(map['최초구매일'], date); setMax(map['최근구매일'], date);
    if (map['구매여부']) rowArr[map['구매여부'] - 1] = '구매';
  } else {
    add(map['견적문의수'], 1);   // 견적문의수 열이 있는 시트(타겟별)에서만 반영
  }
}

// 타겟별 _전체/_구매의 숫자 열을, 갱신된 고객마스터 값으로 덮어씀(있는 행만) · 견적문의수는 증분 가산
function syncTargetSheets_(mVals, mMap, quoteDelta) {
  // 고객마스터 normKey → {건수,액,최초,최근,견적}
  var byKey = {};
  var nameC = mMap['거래처명'], cntC = mMap['구매건수'], amtC = mMap['총구매액(원)'] || mMap['총구매액'],
      f0 = mMap['최초구매일'], l0 = mMap['최근구매일'];
  for (var r = 0; r < mVals.length; r++) {
    var k = normKey_(mVals[r][nameC - 1]); if (!k) continue;
    byKey[k] = { cnt: cntC ? mVals[r][cntC - 1] : '', amt: amtC ? mVals[r][amtC - 1] : '', first: f0 ? mVals[r][f0 - 1] : '', last: l0 ? mVals[r][l0 - 1] : '' };
  }
  for (var t in TARGET_SHEETS) {
    TARGET_SHEETS[t].forEach(function (sn) {
      var sh = sheet_(sn); if (!sh) return; var hm = headerMap_(sh), map = hm.map;
      var lr = sh.getLastRow(); if (lr < 2) return;
      var vals = sh.getRange(2, 1, lr - 1, hm.lastCol).getValues();
      var nC = map['거래처명'], cC = map['구매건수'], aC = map['총구매액(원)'] || map['총구매액'], fC = map['최초구매일'], lC = map['최근구매일'], qC = map['견적문의수'];
      if (!nC) return;
      for (var i = 0; i < vals.length; i++) {
        var k = normKey_(vals[i][nC - 1]); var m = byKey[k];
        if (qC && quoteDelta[k]) vals[i][qC - 1] = num_(vals[i][qC - 1]) + quoteDelta[k];   // 견적 증분(매칭행)
        if (!m) continue;
        if (cC && m.cnt !== '') vals[i][cC - 1] = m.cnt;
        if (aC && m.amt !== '') vals[i][aC - 1] = m.amt;
        if (fC && m.first !== '') vals[i][fC - 1] = m.first;
        if (lC && m.last !== '') vals[i][lC - 1] = m.last;
      }
      sh.getRange(2, 1, vals.length, hm.lastCol).setValues(vals);
    });
  }
}

// 신규_확인 탭 — normKey 기준 누적(있으면 합산)
function writeReview_(review) {
  if (!Object.keys(review).length) return sheet_(REVIEW) ? Math.max(0, sheet_(REVIEW).getLastRow() - 1) : 0;
  var sh = sheet_(REVIEW);
  var HEAD = ['거래처명', '타겟(추정)', '구매건수', '총구매액', '견적문의수', '최초', '최근', '상태', 'normKey'];
  if (!sh) { sh = ss_().insertSheet(REVIEW); sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold'); }
  var hm = headerMap_(sh), keyC = hm.map['normKey'] || HEAD.length;
  var lr = sh.getLastRow();
  var exist = {}; // normKey → rowNum
  if (lr > 1) { var kv = sh.getRange(2, keyC, lr - 1, 1).getValues(); for (var i = 0; i < kv.length; i++) { var k = String(kv[i][0] || ''); if (k) exist[k] = i + 2; } }
  var appendRows = [];
  for (var key in review) {
    var b = review[key];
    if (exist[key]) {
      var rn = exist[key]; var cur = sh.getRange(rn, 1, 1, HEAD.length).getValues()[0];
      cur[2] = num_(cur[2]) + b.cnt; cur[3] = num_(cur[3]) + b.sum; cur[4] = num_(cur[4]) + b.quote;
      if (b.first && (!cur[5] || b.first < String(cur[5]))) cur[5] = b.first;
      if (b.last && (!cur[6] || b.last > String(cur[6]))) cur[6] = b.last;
      sh.getRange(rn, 1, 1, HEAD.length).setValues([cur]);
    } else {
      appendRows.push([b.name, b.target, b.cnt, b.sum, b.quote, b.first, b.last, '검토대기', key]);
    }
  }
  if (appendRows.length) sh.getRange(sh.getLastRow() + 1, 1, appendRows.length, HEAD.length).setValues(appendRows);
  return Math.max(0, sh.getLastRow() - 1);
}

/* ---------- 메뉴 / 트리거 ---------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('고객DB')
    .addItem('① 기준선 설정 (최초 1회 · 백필 전에)', 'setBaseline')
    .addItem('② 재집계 실행 (신규 반영)', 'recalc')
    .addSeparator()
    .addItem('매일 자동 재집계 설치(00:30)', 'installDailyTrigger')
    .addItem('자동 재집계 해제', 'removeDailyTrigger')
    .addToUi();
}
/* 기준선 설정 — 현재 원장의 모든 행을 '이미 요약/마스터에 반영됨(집계반영=Y)'으로 표시.
   ※ 반드시 과거 데이터만 있는 상태(백필 전)에서 1회 실행하세요. 백필 후 실행하면 백필분도 건너뜁니다. */
function setBaseline() {
  var led = sheet_(LEDGER); if (!led) { toast_('[' + LEDGER + '] 시트가 없습니다'); return; }
  var hm = headerMap_(led); var lastRow = led.getLastRow(), lastCol = led.getLastColumn();
  var mc = hm.map[MARK];
  if (!mc) { led.getRange(1, lastCol + 1).setValue(MARK); mc = lastCol + 1; }
  if (lastRow > 1) led.getRange(2, mc, lastRow - 1, 1).setValues(rep_('Y', lastRow - 1));
  SpreadsheetApp.flush();
  toast_('기준선 설정 완료 · 기존 ' + (lastRow - 1) + '행 = 집계반영(Y). 이제 백필 후 [재집계]를 실행하세요.');
}
function installDailyTrigger() {
  removeDailyTrigger();
  ScriptApp.newTrigger('recalc').timeBased().everyDays(1).atHour(0).nearMinute(30).create();
  toast_('매일 00:30 자동 재집계를 설치했습니다.');
}
function removeDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'recalc') ScriptApp.deleteTrigger(t); });
}
function rep_(v, n) { var a = []; for (var i = 0; i < n; i++) a.push([v]); return a; }
function toast_(msg) { try { ss_().toast(msg, '고객DB', 8); } catch (e) { Logger.log(msg); } }
