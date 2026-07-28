/* 마우저 주문내역(Order History API) 프록시 — 주문·상태·송장(추적)번호를 가져와 주문내역 탭에 표시.
   - 키: Order/History 계열 우선(MOUSER_ORDER_API_KEY → MOUSER_HISTORY_API_KEY → MOUSER_CART_API_KEY → MOUSER_API_KEY)
   - GET /api/mouser-orders          → { configured, orders:[{orderNo,date,status,total,tracking,...}] }
   - 진단 GET /api/mouser-orders?raw=1 → 마우저 원응답 그대로(필드/에러 확인용 · 키 확정 후 매핑 미세조정)
   ※ Order History API 응답 필드는 배포 후 실제 키로 ?raw=1 확인해 확정 권장. 방어적으로 파싱함. */
const ORDERHISTORY_BYDATE = 'https://api.mouser.com/api/v1/orderhistory/ByDateRange';

function orderKey() {
  return process.env.MOUSER_ORDER_API_KEY || process.env.MOUSER_HISTORY_API_KEY || process.env.MOUSER_CART_API_KEY || process.env.MOUSER_API_KEY;
}
const ymd = d => d.toISOString().slice(0, 10);

async function fetchHistory(key, startDate, endDate) {
  const r = await fetch(ORDERHISTORY_BYDATE + '?apiKey=' + encodeURIComponent(key), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ DateRange: { StartDate: startDate, EndDate: endDate } }),
  });
  let body = {}; try { body = await r.json(); } catch (e) {}
  return { http: r.status, body };
}

// 응답 필드명이 문서/버전마다 다를 수 있어 후보를 넓게 커버
function normalize(d) {
  const list = (d && (d.OrderHistoryItems || d.OrderHistory || d.Orders || d.orderHistoryItems || [])) || [];
  return list.map(o => ({
    orderNo: o.WebOrderNumber || o.SalesOrderNumber || o.OrderNumber || o.PONumber || '',
    poNumber: o.PONumber || o.PoNumber || '',
    date: (o.OrderDate || o.PODate || o.DateOrdered || o.SubmittedDate || '').toString().slice(0, 10),
    status: o.OrderStatusDisplay || o.OrderStatus || o.Status || '',
    total: o.OrderTotal || o.Total || o.MerchandiseTotal || '',
    tracking: o.TrackingNumber || o.Tracking || o.CarrierTrackingNumber || '',
    carrier: o.Carrier || o.ShipVia || '',
    shipDate: (o.ShipDate || o.ShippedDate || '').toString().slice(0, 10),
  })).filter(o => o.orderNo || o.date);
}

module.exports = async function handler(req, res) {
  const key = orderKey();
  if (!key) return res.status(200).json({ configured: false });

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 12, 1);

  if (req.method === 'GET' && req.query && req.query.raw) {
    try { const r = await fetchHistory(key, ymd(start), ymd(now)); return res.status(200).json({ configured: true, http: r.http, raw: r.body }); }
    catch (e) { return res.status(200).json({ configured: true, error: String((e && e.message) || e) }); }
  }

  try {
    const r = await fetchHistory(key, ymd(start), ymd(now));
    const errors = (r.body && (r.body.Errors || r.body.errors)) || [];
    return res.status(200).json({ configured: true, http: r.http, errors, orders: normalize(r.body) });
  } catch (e) {
    return res.status(200).json({ configured: true, error: String((e && e.message) || e), orders: [] });
  }
};
