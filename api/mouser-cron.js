/* 마우저 일일 모니터링 크론 — 워치리스트(48품목)의 가격·재고를 매일 조회해
   전일 스냅샷과 비교 → 변동(가격↑↓·신규입고·품절)을 일자별 리포트로 저장.
   - 트리거: Vercel 크론(GET) · 수동 확인용으로 브라우저에서 /api/mouser-cron 열어도 1회 실행됨
   - 저장: eduino:mouser:snap:last(직전 스냅샷) + coll 'mouser_report'(일자별 변동 리포트)
   - 키: MOUSER_API_KEY (Search 와 동일). 미설정 시 {configured:false}. */
const { MOUSER_PARTS, MOUSER_FIELDS } = require('../assets/js/data/mouser-data.js');
const SEARCH = 'https://api.mouser.com/api/v1/search/partnumber';
const SNAP_KEY = 'eduino:mouser:snap:last';
const REPORT_COLL = 'eduino:coll:mouser_report';

function kvCreds() {
  const env = process.env;
  let url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  let token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) for (const k of Object.keys(env)) {
    if (!url && /REST_API_URL$/.test(k) && /^https?:\/\//.test(env[k] || '')) url = env[k];
    if (!token && /(?:^|_)REST_API_TOKEN$/.test(k)) token = env[k];
  }
  return { url, token };
}
async function redis(command) {
  const { url, token } = kvCreds(); if (!url || !token) return null;
  try { const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) }); const j = await r.json(); return j && j.result; }
  catch (e) { return null; }
}
const digits = s => { const m = String(s == null ? '' : s).replace(/[^\d]/g, ''); return m ? Number(m) : 0; };
const toObj = row => MOUSER_FIELDS.reduce((o, k, i) => (o[k] = row[i], o), {});

async function lookupOne(key, no) {
  const r = await fetch(SEARCH + '?apiKey=' + encodeURIComponent(key), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ SearchByPartRequest: { mouserPartNumber: no, partSearchOptions: '' } }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  const parts = (d && d.SearchResults && d.SearchResults.Parts) || [];
  if (!parts.length) return { found: false };
  const p = parts.find(x => String(x.MouserPartNumber || '').trim() === String(no).trim()) || parts[0];
  return { found: true, inStock: digits(p.AvailabilityInStock != null ? p.AvailabilityInStock : p.Availability), priceKRW: (p.PriceBreaks && p.PriceBreaks[0] && digits(p.PriceBreaks[0].Price)) || 0 };
}
// 동시 5건씩 조회(레이트리밋·타임아웃 보호)
async function pool(items, size, fn) { const out = {}; for (let i = 0; i < items.length; i += size) { const b = items.slice(i, i + size); await Promise.all(b.map(async it => { out[it] = await fn(it).catch(() => ({ found: false })); })); } return out; }

module.exports = async function handler(req, res) {
  const key = process.env.MOUSER_API_KEY || process.env.MOUSER_CART_API_KEY || process.env.EDUINO_MOUSER_API_KEY;
  if (!key) return res.status(200).json({ configured: false });

  const parts = MOUSER_PARTS.map(toObj);
  const nos = parts.map(p => p.mouserNo);
  const today = new Date().toISOString().slice(0, 10);

  const results = await pool(nos, 5, no => lookupOne(key, no));
  const snap = { day: today, at: new Date().toISOString(), parts: {} };
  parts.forEach(p => { const d = results[p.mouserNo] || {}; snap.parts[p.mouserNo] = { price: d.found ? d.priceKRW : 0, inStock: d.found ? d.inStock : 0 }; });

  let last = null;
  try { const s = await redis(['GET', SNAP_KEY]); last = s ? JSON.parse(s) : null; } catch (e) {}
  const changes = [];
  if (last && last.parts) parts.forEach(p => {
    const o = last.parts[p.mouserNo], n = snap.parts[p.mouserNo]; if (!o || !n) return;
    if ((o.price || 0) > 0 && (n.price || 0) > 0 && o.price !== n.price)
      changes.push({ mouserNo: p.mouserNo, name: p.name, kind: n.price > o.price ? 'up' : 'down', field: 'price', old: o.price, new: n.price });
    const oIn = (o.inStock || 0) > 0, nIn = (n.inStock || 0) > 0;
    if (!oIn && nIn) changes.push({ mouserNo: p.mouserNo, name: p.name, kind: 'restock', field: 'stock', old: o.inStock || 0, new: n.inStock });
    if (oIn && !nIn) changes.push({ mouserNo: p.mouserNo, name: p.name, kind: 'oos', field: 'stock', old: o.inStock, new: 0 });
  });

  await redis(['SET', SNAP_KEY, JSON.stringify(snap)]);
  const report = { id: 'rep:' + today, type: 'report', day: today, at: snap.at, checked: nos.length, changed: changes.length, changes: changes.slice(0, 300) };
  await redis(['HSET', REPORT_COLL, report.id, JSON.stringify(report)]);

  return res.status(200).json({ ok: true, day: today, checked: nos.length, changed: changes.length, firstRun: !last });
};
