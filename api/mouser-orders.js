/* 마우저 주문내역(Order History API) 프록시 — 주문·상태·송장(추적)번호를 가져와 주문내역 탭에 표시.
   - 키: Order/History 계열 우선(MOUSER_ORDER_API_KEY → MOUSER_HISTORY_API_KEY → MOUSER_CART_API_KEY → MOUSER_API_KEY)
   - Order History ByDateRange 는 GET + 쿼리(startDate,endDate) 방식(문서/SDK 기준). 버전(v1/v2)·날짜형식이
     환경마다 달라 여러 조합을 순서대로 시도해 '404가 아닌' 첫 응답을 채택(자동 감지).
   - GET /api/mouser-orders          → { configured, http, endpoint, orders:[...] }
   - 진단 GET /api/mouser-orders?raw=1 → 시도 내역 + 채택된 원응답(필드/에러 확인용) */
const BASE = 'https://api.mouser.com/api';

function orderKey() {
  return process.env.MOUSER_ORDER_API_KEY || process.env.MOUSER_HISTORY_API_KEY || process.env.MOUSER_CART_API_KEY || process.env.MOUSER_API_KEY;
}
const iso = d => d.toISOString().slice(0, 10);                          // 2026-01-31
const us = d => (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();  // 1/31/2026

// 시도할 (버전 × 날짜형식) 조합 — 되는 첫 조합을 채택.
function variants(start, end) {
  const combos = [];
  for (const ver of ['v1', 'v2']) for (const fmt of ['us', 'iso']) {
    const s = fmt === 'us' ? us(start) : iso(start);
    const e = fmt === 'us' ? us(end) : iso(end);
    combos.push({ ver, fmt, s, e });
  }
  return combos;
}
async function tryOne(key, v) {
  const url = `${BASE}/${v.ver}/orderhistory/ByDateRange?apiKey=${encodeURIComponent(key)}`
    + `&startDate=${encodeURIComponent(v.s)}&endDate=${encodeURIComponent(v.e)}`;
  let http = 0, body = {};
  try { const r = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } }); http = r.status; try { body = await r.json(); } catch (e) {} }
  catch (e) { return { ver: v.ver, fmt: v.fmt, http: 0, error: String((e && e.message) || e) }; }
  // 라우팅 404(경로/버전 불일치) 판별
  const msg = (body && (body.Message || body.message)) || '';
  const routeMiss = http === 404 || /No HTTP resource/i.test(msg);
  return { ver: v.ver, fmt: v.fmt, http, routeMiss, body };
}

async function fetchHistory(key, start, end) {
  const tried = [];
  for (const v of variants(start, end)) {
    const r = await tryOne(key, v);
    tried.push({ ver: r.ver, fmt: r.fmt, http: r.http, routeMiss: !!r.routeMiss, msg: (r.body && (r.body.Message || r.body.message)) || r.error || '' });
    if (!r.routeMiss && r.http && r.http !== 404) {
      return { ok: true, http: r.http, body: r.body, endpoint: `${r.ver} GET (${r.fmt} date)`, tried };
    }
  }
  return { ok: false, http: 404, body: {}, endpoint: '', tried };
}

// ── 주문 상세(추적번호·송장·금액) — ByDateRange 엔 없어 주문번호로 상세 조회해 보강 ──
// 상세 엔드포인트도 버전/경로가 유동적 → 후보를 순서대로 시도해 첫 성공을 채택.
function detailCandidates(no, key) {
  const k = `apiKey=${encodeURIComponent(key)}`;
  return [
    { tag: 'v1/order', url: `${BASE}/v1/order/${encodeURIComponent(no)}?${k}` },
    { tag: 'v1/orderhistory/ByOrderNumber', url: `${BASE}/v1/orderhistory/ByOrderNumber?${k}&orderNumber=${encodeURIComponent(no)}` },
    { tag: 'v2/order', url: `${BASE}/v2/order/${encodeURIComponent(no)}?${k}` },
  ];
}
// 응답 어디에 있든 지정 키(대소문자 무시)의 첫 스칼라 값을 찾음(구조가 유동적이라 방어적으로).
function findVal(obj, keys, depth) {
  depth = depth || 0; if (obj == null || depth > 7) return '';
  if (Array.isArray(obj)) { for (const x of obj) { const r = findVal(x, keys, depth + 1); if (r !== '') return r; } return ''; }
  if (typeof obj === 'object') {
    for (const k of Object.keys(obj)) { if (keys.some(kk => kk.toLowerCase() === k.toLowerCase())) { const v = obj[k]; if (v != null && v !== '' && typeof v !== 'object') return v; } }
    for (const k of Object.keys(obj)) { const r = findVal(obj[k], keys, depth + 1); if (r !== '') return r; }
  }
  return '';
}
function parseDetail(d) {
  return {
    tracking: String(findVal(d, ['TrackingNumber', 'CarrierTrackingNumber', 'Tracking']) || ''),
    carrier: String(findVal(d, ['Carrier', 'ShipVia', 'ShipMethod', 'ShippingMethod', 'ShipCarrier']) || ''),
    shipDate: day10(findVal(d, ['ShipDate', 'ShippedDate', 'ShipmentDate', 'DateShipped'])),
    invoiceNo: String(findVal(d, ['InvoiceNumber', 'InvoiceNo']) || ''),
    invoiceUrl: String(findVal(d, ['InvoiceUrl', 'InvoicePdfUrl', 'InvoiceURL', 'InvoicePDFUrl']) || ''),
    total: String(findVal(d, ['OrderTotal', 'InvoiceTotal', 'GrandTotal', 'MerchandiseTotal']) || ''),
  };
}
async function fetchDetail(key, no, forceTag) {
  for (const c of detailCandidates(no, key)) {
    if (forceTag && c.tag !== forceTag) continue;
    let http = 0, body = {};
    try { const r = await fetch(c.url, { method: 'GET', headers: { 'Accept': 'application/json' } }); http = r.status; try { body = await r.json(); } catch (e) {} }
    catch (e) { continue; }
    const msg = (body && (body.Message || body.message)) || '';
    if (http === 404 || /No HTTP resource/i.test(msg)) continue;
    return { ok: true, tag: c.tag, http, body };
  }
  return { ok: false };
}
// 동시 5건씩 상세 조회(레이트리밋 보호) — 최대 30건
async function enrichTracking(key, orders) {
  const targets = orders.slice(0, 30);
  if (!targets.length) return orders;
  // 1) 첫 주문으로 되는 상세 엔드포인트 탐지
  const first = await fetchDetail(key, targets[0].orderNo || targets[0].webNo);
  if (!first.ok) return orders;                     // 상세 미지원/권한없음 → 요약만
  Object.assign(targets[0], parseDetail(first.body));
  const tag = first.tag;
  // 2) 나머지는 동일 엔드포인트로 병렬 조회
  const rest = targets.slice(1);
  for (let i = 0; i < rest.length; i += 5) {
    await Promise.all(rest.slice(i, i + 5).map(async o => {
      const r = await fetchDetail(key, o.orderNo || o.webNo, tag);
      if (r.ok) Object.assign(o, parseDetail(r.body));
    }));
  }
  return orders;
}

// 응답 필드명이 문서/버전마다 다를 수 있어 후보를 넓게 커버(웹 주문내역 화면의 모든 항목 대응)
const pick = (o, keys) => { for (const k of keys) { if (o[k] != null && o[k] !== '') return o[k]; } return ''; };
const day10 = v => v ? String(v).slice(0, 10) : '';
function normalize(d) {
  const list = (d && (d.OrderHistoryItems || d.OrderHistory || d.Orders || d.orderHistoryItems || [])) || [];
  return list.map(o => {
    const webNo = pick(o, ['WebOrderNumber', 'WebOrderNo', 'webOrderNumber']);
    const salesNo = pick(o, ['SalesOrderNumber', 'MouserOrderNumber', 'salesOrderNumber']);
    const trk = pick(o, ['TrackingNumber', 'CarrierTrackingNumber', 'Tracking', 'trackingNumber']);
    return {
      orderNo: webNo || salesNo || pick(o, ['OrderNumber', 'PONumber']) || '',
      salesNo,
      webNo,
      poNumber: pick(o, ['PONumber', 'PoNumber', 'poNumber']),
      date: day10(pick(o, ['OrderDate', 'DateCreated', 'PODate', 'DateOrdered', 'SubmittedDate', 'CreatedDate'])),
      buyer: pick(o, ['BuyerName', 'Buyer', 'OrderedBy', 'CustomerName', 'ContactName', 'PurchaserName']),
      status: pick(o, ['OrderStatusDisplay', 'OrderStatus', 'StatusDisplay', 'Status']),
      total: pick(o, ['InvoiceTotal', 'OrderTotal', 'Total', 'MerchandiseTotal', 'GrandTotal']),
      invoiceNo: pick(o, ['InvoiceNumber', 'InvoiceNo', 'invoiceNumber']),
      invoiceUrl: pick(o, ['InvoiceUrl', 'InvoicePdfUrl', 'InvoiceURL', 'InvoicePDFUrl']),
      tracking: trk,
      carrier: pick(o, ['Carrier', 'ShipVia', 'ShipMethod', 'ShippingMethod']),
      shipDate: day10(pick(o, ['ShipDate', 'ShippedDate', 'ShipmentDate', 'DateShipped'])),
    };
  }).filter(o => o.orderNo || o.date);
}

module.exports = async function handler(req, res) {
  const key = orderKey();
  if (!key) return res.status(200).json({ configured: false });

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 12, 1);

  // 진단: 특정 주문번호의 상세 원응답(추적번호 필드 확인용) — ?detailRaw=<주문번호>
  if (req.method === 'GET' && req.query && req.query.detailRaw) {
    const no = String(req.query.detailRaw);
    const d = await fetchDetail(key, no);
    return res.status(200).json({ configured: true, order: no, ok: d.ok, tag: d.tag || '', http: d.http || 0, parsed: d.ok ? parseDetail(d.body) : null, raw: d.body || null });
  }

  const r = await fetchHistory(key, start, now);

  if (req.method === 'GET' && req.query && req.query.raw) {
    return res.status(200).json({ configured: true, ok: r.ok, http: r.http, endpoint: r.endpoint, tried: r.tried, raw: r.body });
  }
  const errors = (r.body && (r.body.Errors || r.body.errors)) || [];
  let orders = normalize(r.body);
  // 추적번호·배송일·송장 보강(주문 상세 조회) — ?detail=0 이면 건너뜀
  if (orders.length && !(req.query && String(req.query.detail) === '0')) {
    try { orders = await enrichTracking(key, orders); } catch (e) {}
  }
  return res.status(200).json({ configured: true, http: r.http, endpoint: r.endpoint, tried: r.tried, errors, orders });
};
