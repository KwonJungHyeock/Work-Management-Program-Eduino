/* ===========================================================================
   Vercel 서버리스 · 상품 카탈로그 (이카운트 등 외부 상품 데이터 연동용)
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
    category: String(p.category || ''),
    custCode: String(p.custCode || ''),     // 이카운트 거래처코드(이름표로 구매처명 치환용)
    classCode: String(p.classCode || ''),   // 이카운트 품목분류코드(이름표로 분류명 치환용)
    inPrice: Number(p.inPrice) || 0,
    outPrice: Number(p.outPrice) || 0,
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
      // 카탈로그에 실제 쓰이는 거래처코드·분류코드 목록 (매핑 화면용) — GET /api/catalog?facet=1
      if (q.facet != null) {
        const flat = await redis(['HGETALL', CATALOG_KEY]);
        const vend = {}, cls = {};
        if (Array.isArray(flat)) {
          for (let i = 1; i < flat.length; i += 2) {
            let p = null; try { p = JSON.parse(flat[i]); } catch (e) {}
            if (!p) continue;
            const vc = String(p.custCode || '').trim();
            if (vc) { const o = (vend[vc] = vend[vc] || { code: vc, count: 0, sampleName: '', sampleCode: '', apiVendor: '' }); o.count++; if (!o.sampleName) { o.sampleName = p.name || ''; o.sampleCode = p.selfCode || ''; } if (p.vendor && !o.apiVendor) o.apiVendor = p.vendor; }
            const cc = String(p.classCode || '').trim();
            if (cc) { const o = (cls[cc] = cls[cc] || { code: cc, count: 0, sampleName: '', sampleCode: '' }); o.count++; if (!o.sampleName) { o.sampleName = p.name || ''; o.sampleCode = p.selfCode || ''; } }
          }
        }
        const byCount = (o) => Object.values(o).sort((a, b) => b.count - a.count);
        return res.status(200).json({ ok: true, vendors: byCount(vend), categories: byCount(cls), products: Array.isArray(flat) ? flat.length / 2 : 0 });
      }
      // 상품명/코드 부분 검색 (CS·MD 조회용) — GET /api/catalog?q=아두이노&limit=30
      if (q.q != null) {
        const term = String(q.q || '').trim().toLowerCase();
        const limit = Math.min(Number(q.limit) || 30, 100);
        if (!term) return res.status(200).json({ ok: true, items: [], total: 0 });
        const flat = await redis(['HGETALL', CATALOG_KEY]);
        const items = [];
        if (Array.isArray(flat)) {
          for (let i = 1; i < flat.length; i += 2) {
            let p = null; try { p = JSON.parse(flat[i]); } catch (e) {}
            if (!p) continue;
            const hay = ((p.selfCode || '') + ' ' + (p.name || '')).toLowerCase();
            if (hay.includes(term)) items.push(p);
          }
        }
        // 관련도 순 정렬: 코드/이름 완전일치 → 시작일치 → 부분일치
        const rank = (p) => { const c = String(p.selfCode || '').toLowerCase(), n = String(p.name || '').toLowerCase();
          if (c === term) return 0; if (c.startsWith(term)) return 1; if (n.startsWith(term)) return 2; return 3; };
        items.sort((a, b) => rank(a) - rank(b) || String(a.selfCode).localeCompare(String(b.selfCode)));
        return res.status(200).json({ ok: true, items: items.slice(0, limit), total: items.length });
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
      const secret = process.env.CRON_SECRET || '';
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
