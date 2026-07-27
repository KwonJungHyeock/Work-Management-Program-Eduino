/* 마우저 일일 모니터링 크론 — 매일 아침 워치리스트(48품목) 재고·가격·입고예정을 최신화.
   ① coll 'mouser_stock'(item id:'latest')에 현재값 저장 → 마우저 탭이 이걸 읽어 표시(실시간 호출 대신).
   ② 전일 스냅샷과 비교 → 변동(가격↑↓·신규입고·품절)을 coll 'mouser_report'(일자별)에 저장.
   - 트리거: Vercel 크론(GET) · 브라우저로 열면 수동 1회 실행(첫 스냅샷/즉시 갱신).
   - 키: MOUSER_API_KEY. 미설정 시 {configured:false}. */
const { MOUSER_PARTS, MOUSER_FIELDS } = require('../assets/js/data/mouser-data.js');
const { lookupOne } = require('../lib/mouser.js');

const SNAP_KEY = 'eduino:mouser:snap:last';        // 직전 스냅샷(변동 비교용)
const STOCK_COLL = 'eduino:coll:mouser_stock';     // 최신 재고맵(클라이언트가 읽음)
const REPORT_COLL = 'eduino:coll:mouser_report';   // 일자별 변동 리포트

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
const toObj = row => MOUSER_FIELDS.reduce((o, k, i) => (o[k] = row[i], o), {});
// 동시 5건씩 조회(레이트리밋·타임아웃 보호)
async function pool(items, size, fn) { const out = {}; for (let i = 0; i < items.length; i += size) { await Promise.all(items.slice(i, i + size).map(async it => { out[it] = await fn(it); })); } return out; }

module.exports = async function handler(req, res) {
  const key = process.env.MOUSER_API_KEY || process.env.MOUSER_CART_API_KEY || process.env.EDUINO_MOUSER_API_KEY;
  if (!key) return res.status(200).json({ configured: false });

  const parts = MOUSER_PARTS.map(toObj);
  const nos = parts.map(p => p.mouserNo);
  const today = new Date().toISOString().slice(0, 10);
  const at = new Date().toISOString();

  const results = await pool(nos, 5, no => lookupOne(key, no));

  // 최신 재고맵(클라이언트 표시용) + 변동비교용 스냅샷
  const stock = {}; const snap = { day: today, at, parts: {} };
  let found = 0;
  parts.forEach(p => {
    const d = results[p.mouserNo] || {};
    if (d.found) found++;
    stock[p.mouserNo] = { found: !!d.found, inStock: d.inStock || 0, priceKRW: d.priceKRW || 0, availability: d.availability || '', lead: d.lead || '', nextDate: d.nextDate || '', onOrderQty: (d.onOrder && d.onOrder[0] && d.onOrder[0].qty) || 0 };
    snap.parts[p.mouserNo] = { price: d.found ? d.priceKRW : 0, inStock: d.found ? d.inStock : 0 };
  });
  await redis(['HSET', STOCK_COLL, 'latest', JSON.stringify({ id: 'latest', at, checked: nos.length, found, parts: stock })]);

  // 전일 대비 변동
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
  const report = { id: 'rep:' + today, type: 'report', day: today, at, checked: nos.length, changed: changes.length, changes: changes.slice(0, 300) };
  await redis(['HSET', REPORT_COLL, report.id, JSON.stringify(report)]);

  return res.status(200).json({ ok: true, day: today, checked: nos.length, found, changed: changes.length, firstRun: !last });
};
