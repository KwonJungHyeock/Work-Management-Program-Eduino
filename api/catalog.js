/* ===========================================================================
   Vercel 서버리스 · 상품 카탈로그 (셀메이트 연동용)
   - 대용량 상품 목록을 KV 해시(eduino:catalog)에 저장, 코드로 O(1) 조회
   - 브라우저마다 전체를 동기화하지 않고, 발주 입력 시 코드로 서버에서 조회
   API
     GET  /api/catalog?code=ABC   → { ok, product }        (없으면 product:null)
     GET  /api/catalog?type=meta  → { ok, count, updatedAt }
     POST /api/catalog { op:'bulkUpsert', products:[...], secret } (크론/관리자 전용)
   =========================================================================== */

const CATALOG_KEY = 'eduino:catalog';
const META_KEY = 'eduino:catalog:meta';

function kvCreds() {
  const env = process.env;
  let url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  let token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    for (const k of Object.keys(env)) {
      if (!url && /REST_API_URL$/.test(k) && /^https?:\/\//.test(env[k] || '')) url = env[k];
      if (!token && /(?:^|_)REST_API_TOKEN$/.test(k)) token = env[k];
    }
  }
  return { url, token };
}
async function redis(command) {
  const { url, token } = kvCreds();
  if (!url || !token) { const e = new Error('KV_NOT_CONNECTED'); e.kv = true; throw e; }
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
const normCode = (c) => String(c || '').trim().toUpperCase();

// 상품 레코드 정규화 — 발주 화면이 쓰는 스키마로 통일
function normalizeProduct(p) {
  if (!p) return null;
  const code = normCode(p.selfCode || p.code);
  if (!code) return null;
  return {
    selfCode: code,
    code: String(p.code || ''),
    name: String(p.name || ''),
    vendor: String(p.vendor || ''),
    settle: String(p.settle || ''),
    ship: Number(p.ship) || 0,
  };
}

async function bulkUpsert(products) {
  const list = (Array.isArray(products) ? products : []).map(normalizeProduct).filter(Boolean);
  if (!list.length) return 0;
  // KV(REST)는 한 번에 너무 큰 명령이 부담이므로 배치로 나눠 HSET
  const B = 500;
  for (let i = 0; i < list.length; i += B) {
    const cmd = ['HSET', CATALOG_KEY];
    for (const p of list.slice(i, i + B)) cmd.push(p.selfCode, JSON.stringify(p));
    await redis(cmd);
  }
  await redis(['HSET', META_KEY, 'count', String(list.length), 'updatedAt', new Date().toISOString()]);
  return list.length;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      if (q.type === 'meta') {
        const arr = await redis(['HGETALL', META_KEY]); const o = {};
        if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) o[arr[i]] = arr[i + 1];
        return res.status(200).json({ ok: true, count: Number(o.count) || 0, updatedAt: o.updatedAt || null });
      }
      const code = normCode(q.code);
      if (!code) return res.status(400).json({ ok: false, error: 'code required' });
      const v = await redis(['HGET', CATALOG_KEY, code]);
      let product = null; if (v) { try { product = JSON.parse(v); } catch (e) {} }
      return res.status(200).json({ ok: true, product });
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      // 쓰기(대량 업서트)는 크론 시크릿 또는 관리자만
      const secret = process.env.CRON_SECRET || process.env.SELLMATE_SYNC_SECRET || '';
      const ok = secret ? (body.secret === secret) : true;   // 시크릿 미설정 시 내부 신뢰(사내툴)
      if (!ok) return res.status(401).json({ ok: false, error: 'unauthorized' });
      if (body.op === 'bulkUpsert') { const n = await bulkUpsert(body.products || []); return res.status(200).json({ ok: true, upserted: n }); }
      if (body.op === 'clear') { await redis(['DEL', CATALOG_KEY]); await redis(['DEL', META_KEY]); return res.status(200).json({ ok: true }); }
      return res.status(400).json({ ok: false, error: 'unknown op' });
    }
    return res.status(405).json({ ok: false, error: 'method not allowed' });
  } catch (err) {
    if (err && err.kv) return res.status(503).json({ ok: false, error: 'KV 미연결' });
    return res.status(500).json({ ok: false, error: String(err && err.message || err) });
  }
};

module.exports.bulkUpsert = bulkUpsert;
module.exports.normalizeProduct = normalizeProduct;
