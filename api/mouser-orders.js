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

  const r = await fetchHistory(key, start, now);

  if (req.method === 'GET' && req.query && req.query.raw) {
    return res.status(200).json({ configured: true, ok: r.ok, http: r.http, endpoint: r.endpoint, tried: r.tried, raw: r.body });
  }
  const errors = (r.body && (r.body.Errors || r.body.errors)) || [];
  return res.status(200).json({ configured: true, http: r.http, endpoint: r.endpoint, tried: r.tried, errors, orders: normalize(r.body) });
};
