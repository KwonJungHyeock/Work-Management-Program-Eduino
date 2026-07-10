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
        sampleRaw: r.sampleRaw, sampleMapped: r.products.slice(0, 3) });
    }
    const n = await catalog.bulkUpsert(r.products);
    return res.status(200).json({ ok: true, synced: n, zone: r.zone, at: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err && err.message || err) });
  }
};

async function postJson(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 300));
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
  const pre = sbo ? 'sbo' : '';
  const zoneHost = `https://${pre}oapi.ecount.com`;
  const host = z => `https://${pre}oapi${String(z || '').toUpperCase()}.ecount.com`;

  // 1) ZONE
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
  const M = (k, d) => process.env['ECOUNT_MAP_' + k] || d;
  const products = arr.map(x => ({
    selfCode: x[M('CODE', 'PROD_CD')],
    code: '',
    name: x[M('NAME', 'PROD_DES')],
    vendor: M('VENDOR', '') ? x[M('VENDOR', '')] : '',
    settle: M('SETTLE', '') ? x[M('SETTLE', '')] : '',
    ship: M('SHIP', '') ? (Number(x[M('SHIP', '')]) || 0) : 0,
  })).filter(p => p.selfCode);
  return { zone, products, sampleRaw: arr.slice(0, 2) };
}
module.exports.fetchEcount = fetchEcount;
