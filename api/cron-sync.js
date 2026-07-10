/* ===========================================================================
   Vercel 서버리스 · 이카운트(ECOUNT) → 상품 카탈로그 일일 동기화 (매일 00:00 KST)
   - vercel.json 의 crons 로 매일 15:00 UTC(=00:00 KST) 자동 호출
   - ECOUNT OAPI 흐름: Zone 조회 → 로그인(SESSION_ID) → 품목 목록 → KV 카탈로그 업서트
   ── 필요한 Vercel 환경변수 (키는 절대 코드/채팅에 넣지 말 것):
      ECOUNT_COM_CODE     회사코드              (필수)
      ECOUNT_USER_ID      API용 로그인 아이디    (필수)
      ECOUNT_API_CERT_KEY API 인증키            (필수)
      ECOUNT_ZONE         존(예: CA). 미설정 시 Zone API로 자동 조회   (선택)
      ECOUNT_TEST         'true'면 테스트(sbo) 서버 사용                (선택)
      ECOUNT_LAN          기본 'ko-KR'                                  (선택)
      ECOUNT_PRODUCT_PATH 품목 목록 API 경로(기본 InventoryBasic/GetBasicProductsList) (선택)
      ECOUNT_PRODUCT_BODY 품목 API 요청 파라미터(JSON 문자열)          (선택)
      ECOUNT_ARRAY_PATH   응답에서 배열 위치(예 'Data.Result')         (선택, 미설정 시 자동 탐색)
      ECOUNT_MAP_CODE/_NAME/_VENDOR/_SETTLE/_SHIP  품목 필드명 매핑     (선택, 기본 PROD_CD/PROD_DES)
      CRON_SECRET         (선택) 설정 시 크론/진단 호출 인증
   진단: GET /api/cron-sync?diag=1  → 존/로그인/샘플 응답을 반환(카탈로그에 쓰지 않음)
   =========================================================================== */

const catalog = require('./catalog.js');

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers['authorization'] || '';
    const key = (req.query && req.query.key) || '';
    if (auth !== `Bearer ${secret}` && key !== secret) return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  try {
    const r = await fetchEcount();
    if (req.query && (req.query.diag || req.query.test)) {
      return res.status(200).json({ ok: true, zone: r.zone, detected: r.products.length,
        custCount: r.custCount, classCount: r.classCount, custSample: r.custSample,
        sampleRaw: r.sampleRaw, sampleMapped: r.products.slice(0, 3) });
    }
    const n = await catalog.bulkUpsert(r.products);
    return res.status(200).json({ ok: true, synced: n, zone: r.zone, at: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err && err.message || err) });
  }
};

async function postJson(url, body) {
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  } catch (e) {
    throw new Error('연결 실패 [' + url + '] — ' + (e && e.message || e) + (e && e.cause && e.cause.code ? ' (' + e.cause.code + ')' : ''));
  }
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
  if (!r.ok) throw new Error('HTTP ' + r.status + ' [' + url + '] ' + t.slice(0, 300));
  return j != null ? j : t;
}
// 응답 JSON 안에서 상품 배열을 찾아냄 (경로 지정 또는 자동 탐색)
function pickArray(obj, path) {
  if (Array.isArray(obj)) return obj;
  if (path) { let cur = obj; for (const k of path.split('.')) cur = cur && cur[k]; if (Array.isArray(cur)) return cur; }
  const d = (obj && obj.Data) || obj || {};
  const cands = [d.Result, d.Datas, d.datas, d.List, d.list, obj && obj.Result, obj && obj.data];
  for (const c of cands) if (Array.isArray(c)) return c;
  if (d && typeof d === 'object') for (const k in d) if (Array.isArray(d[k])) return d[k];
  return [];
}

// 이카운트 품목 목록 조회 → 발주 스키마로 정규화
async function fetchEcount() {
  const com = process.env.ECOUNT_COM_CODE, user = process.env.ECOUNT_USER_ID, cert = process.env.ECOUNT_API_CERT_KEY;
  if (!com || !user || !cert) throw new Error('ECOUNT_COM_CODE / ECOUNT_USER_ID / ECOUNT_API_CERT_KEY 환경변수를 설정하세요');
  const sbo = /^(1|true|test|y)$/i.test(process.env.ECOUNT_TEST || '');
  // 운영: oapi{ZONE}.ecount.com / 존조회 oapi.ecount.com · 테스트: sboapi{ZONE}.ecount.com / 존조회 sboapi.ecount.com
  const base = sbo ? 'sboapi' : 'oapi';
  const zoneHost = `https://${base}.ecount.com`;
  const host = z => `https://${base}${String(z || '').toUpperCase()}.ecount.com`;

  // 1) ZONE (ECOUNT_ZONE 를 직접 넣으면 이 단계 건너뜀)
  let zone = process.env.ECOUNT_ZONE;
  if (!zone) {
    const zr = await postJson(`${zoneHost}/OAPI/V2/Zone`, { COM_CODE: com });
    zone = (zr && (zr.Data && zr.Data.ZONE)) || (zr && zr.ZONE);
    if (!zone) throw new Error('ZONE 조회 실패 · 응답: ' + JSON.stringify(zr).slice(0, 300));
  }
  // 2) LOGIN → SESSION_ID
  const lr = await postJson(`${host(zone)}/OAPI/V2/OAPILogin`, {
    COM_CODE: com, USER_ID: user, API_CERT_KEY: cert, LAN_TYPE: process.env.ECOUNT_LAN || 'ko-KR', ZONE: zone,
  });
  const sid = lr && ((lr.Data && lr.Data.Datas && lr.Data.Datas.SESSION_ID) || (lr.Data && lr.Data.SESSION_ID) || lr.SESSION_ID);
  if (!sid) throw new Error('로그인 실패(SESSION_ID 없음) · 응답: ' + JSON.stringify(lr).slice(0, 300));

  // 3) 품목 목록
  const path = process.env.ECOUNT_PRODUCT_PATH || '/OAPI/V2/InventoryBasic/GetBasicProductsList';
  let params = {}; if (process.env.ECOUNT_PRODUCT_BODY) { try { params = JSON.parse(process.env.ECOUNT_PRODUCT_BODY); } catch (e) {} }
  const pr = await postJson(`${host(zone)}${path}?SESSION_ID=${encodeURIComponent(sid)}`, params);
  const arr = pickArray(pr, process.env.ECOUNT_ARRAY_PATH);

  // 3b) 거래처(구매처) 이름 맵 — 품목의 거래처코드(CUST)를 회사명으로 치환
  const cust = await fetchCustMap(host(zone), sid);
  // 3c) 품목분류 이름 맵 — CLASS_CD 코드를 분류명으로 치환(best-effort)
  const cls = await fetchClassMap(host(zone), sid);

  const M = (k, d) => process.env['ECOUNT_MAP_' + k] || d;
  const VCODE = M('VENDORCODE', 'CUST');   // 품목 레코드에서 거래처코드가 들어있는 필드
  const products = arr.map(x => {
    const vcode = String(x[VCODE] || '').trim();
    const vname = cust.map[vcode] || (M('VENDOR', '') ? x[M('VENDOR', '')] : '');
    const ccode = String(x[M('CLASSCODE', 'CLASS_CD')] || '').trim();
    return {
      selfCode: x[M('CODE', 'PROD_CD')],
      code: '',
      name: x[M('NAME', 'PROD_DES')],
      vendor: vname,
      category: cls.map[ccode] || (M('CATEGORY', '') ? x[M('CATEGORY', '')] : ''),
      inPrice: Number(x[M('INPRICE', 'IN_PRICE')]) || 0,
      outPrice: Number(x[M('OUTPRICE', 'OUT_PRICE')]) || 0,
      settle: M('SETTLE', '') ? x[M('SETTLE', '')] : '',
      ship: M('SHIP', '') ? (Number(x[M('SHIP', '')]) || 0) : 0,
    };
  }).filter(p => p.selfCode);
  return { zone, products, sampleRaw: arr.slice(0, 2), custCount: cust.count, custSample: cust.sample, classCount: cls.count };
}

// 이카운트 거래처 목록 → { code: 회사명 } 맵. 실패 시 빈 맵(품목만 업로드).
async function fetchCustMap(hostUrl, sid) {
  try {
    const path = process.env.ECOUNT_CUST_PATH || '/OAPI/V2/AccountBasic/GetBasicCustList';
    let params = {}; if (process.env.ECOUNT_CUST_BODY) { try { params = JSON.parse(process.env.ECOUNT_CUST_BODY); } catch (e) {} }
    const cr = await postJson(`${hostUrl}${path}?SESSION_ID=${encodeURIComponent(sid)}`, params);
    const list = pickArray(cr, process.env.ECOUNT_CUST_ARRAY_PATH);
    const codeF = process.env.ECOUNT_CUST_CODE || 'CUST';
    const nameCands = [process.env.ECOUNT_CUST_NAME, 'CUST_DES', 'CUST_NAME', 'CUST_NM', 'BUSINESS_NAME'].filter(Boolean);
    const map = {};
    for (const c of list) {
      const code = String(c[codeF] || '').trim(); if (!code) continue;
      let name = ''; for (const f of nameCands) { if (c[f]) { name = String(c[f]).trim(); break; } }
      if (name) map[code] = name;
    }
    return { map, count: Object.keys(map).length, sample: list.slice(0, 2) };
  } catch (e) {
    return { map: {}, count: 0, sample: 'ERR: ' + (e && e.message || e) };
  }
}

// 이카운트 품목분류 목록 → { code: 분류명 } 맵(best-effort). 실패 시 빈 맵.
async function fetchClassMap(hostUrl, sid) {
  try {
    const path = process.env.ECOUNT_CLASS_PATH;
    if (!path) return { map: {}, count: 0 };   // 엔드포인트 미설정 시 건너뜀(원본 필드로 폴백)
    let params = {}; if (process.env.ECOUNT_CLASS_BODY) { try { params = JSON.parse(process.env.ECOUNT_CLASS_BODY); } catch (e) {} }
    const cr = await postJson(`${hostUrl}${path}?SESSION_ID=${encodeURIComponent(sid)}`, params);
    const list = pickArray(cr, process.env.ECOUNT_CLASS_ARRAY_PATH);
    const codeF = process.env.ECOUNT_CLASS_CODE || 'CLASS_CD';
    const nameCands = [process.env.ECOUNT_CLASS_NAME, 'CLASS_DES', 'CLASS_NAME', 'CLASS_NM'].filter(Boolean);
    const map = {};
    for (const c of list) {
      const code = String(c[codeF] || '').trim(); if (!code) continue;
      let name = ''; for (const f of nameCands) { if (c[f]) { name = String(c[f]).trim(); break; } }
      if (name) map[code] = name;
    }
    return { map, count: Object.keys(map).length };
  } catch (e) {
    return { map: {}, count: 0 };
  }
}
module.exports.fetchEcount = fetchEcount;
