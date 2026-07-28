/* 마우저 일일 모니터링 크론 — 매일 아침 워치리스트(48품목) 재고·가격·입고예정을 최신화.
   ① coll 'mouser_stock'(item id:'latest')에 현재값 저장 → 마우저 탭이 이걸 읽어 표시(실시간 호출 대신).
   ② 전일 스냅샷과 비교 → 변동(가격↑↓·신규입고·품절)을 coll 'mouser_report'(일자별)에 저장.
   - 트리거: Vercel 크론(GET) · 브라우저로 열면 수동 1회 실행(첫 스냅샷/즉시 갱신).
   - 키: MOUSER_API_KEY. 미설정 시 {configured:false}. */
const { MOUSER_PARTS, MOUSER_FIELDS } = require('../assets/js/data/mouser-data.js');
const { lookupOne, cartLookupOne } = require('../lib/mouser.js');

const SNAP_KEY = 'eduino:mouser:snap:last';        // 직전 스냅샷(변동 비교용)
const STOCK_COLL = 'eduino:coll:mouser_stock';     // 최신 재고맵(클라이언트가 읽음)
const REPORT_COLL = 'eduino:coll:mouser_report';   // 일자별 변동 리포트
const PROBE_KEY = 'eduino:mouser:probecart';       // 가격·재고 조회 전용 카트키(재사용 → 계정 오염 방지)

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
  // 검색(재고·가격)은 Search API 키
  const key = process.env.MOUSER_API_KEY || process.env.MOUSER_SEARCH_API_KEY || process.env.EDUINO_MOUSER_API_KEY;
  // 장바구니(Cart) 키 — Search 가 구매제한/조회불가로 막은 품목의 가격·재고를 Cart API 로 보강.
  const cartKey = process.env.MOUSER_CART_API_KEY || process.env.MOUSER_ORDER_API_KEY || process.env.MOUSER_API_KEY;
  if (!key) return res.status(200).json({ configured: false });

  const parts = MOUSER_PARTS.map(toObj);
  const nos = parts.map(p => p.mouserNo);
  const today = new Date().toISOString().slice(0, 10);
  const at = new Date().toISOString();

  const results = await pool(nos, 5, no => lookupOne(key, no));

  // Search 가 막은 품목(구매제한·조회불가)은 Cart API 로 가격·재고 보강 시도.
  //  ※ 계정 카트 오염 방지: 전용 '조회 카트' 하나(PROBE_KEY)만 재사용 — 매 조회마다 새 카트를 만들지 않음.
  let cartFilled = 0;
  if (cartKey) {
    const needCart = nos.filter(no => { const d = results[no] || {}; return !d.found || d.restricted || (!d.inStock && !d.priceKRW); });
    if (needCart.length) {
      // 저장된 조회 카트키 재사용 → 없으면 첫 1건을 순차 조회해 새 키를 확보하고 저장(이후 전부 이 키로).
      let probe = (await redis(['GET', PROBE_KEY])) || '';
      const merge = (no, c) => { if (c && c.found && (c.priceKRW || c.inStock)) { results[no] = { ...(results[no] || {}), ...c, found: true, restricted: false, restriction: '' }; cartFilled++; } };
      let rest = needCart;
      if (!probe) {
        const seed = await cartLookupOne(cartKey, needCart[0], '');
        probe = (seed && seed.cartKey) || '';
        if (probe) await redis(['SET', PROBE_KEY, probe]);
        merge(needCart[0], seed);
        rest = probe ? needCart.slice(1) : needCart;   // 키 확보 실패 시 폴백(전체 재시도)
      }
      const cartRes = await pool(rest, 5, no => cartLookupOne(cartKey, no, probe));
      rest.forEach(no => merge(no, cartRes[no]));
    }
  }

  // 최신 재고맵(클라이언트 표시용) + 변동비교용 스냅샷
  const stock = {}; const snap = { day: today, at, parts: {} };
  let found = 0;
  parts.forEach(p => {
    const d = results[p.mouserNo] || {};
    if (d.found) found++;
    stock[p.mouserNo] = { found: !!d.found, inStock: d.inStock || 0, priceKRW: d.priceKRW || 0, availability: d.availability || '', lead: d.lead || '', nextDate: d.nextDate || '', onOrderQty: (d.onOrder && d.onOrder[0] && d.onOrder[0].qty) || 0, onOrder: (d.onOrder || []).slice(0, 6), restricted: !!d.restricted, restriction: d.restriction || '', via: d.via || 'search' };
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

  const restrictedCnt = Object.values(stock).filter(s => s.restricted).length;
  const buyableCnt = Object.values(stock).filter(s => s.found && !s.restricted && (s.inStock > 0 || s.priceKRW > 0)).length;
  const restrictedList = parts.filter(p => (stock[p.mouserNo] || {}).restricted).map(p => p.mouserNo);
  return res.status(200).json({ ok: true, day: today, checked: nos.length, found, buyable: buyableCnt, restricted: restrictedCnt, cartFilled, restrictedList: restrictedList.slice(0, 60), changed: changes.length, firstRun: !last });
};
