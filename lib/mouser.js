/* 마우저 API 공용 로직 — 검색(재고·가격·입고예정)·크론·주문이 함께 사용.
   여기 한 곳만 고치면 전 기능에 반영됨. (Vercel 서버함수에서 require) */
const SEARCH_ENDPOINT = 'https://api.mouser.com/api/v1/search/partnumber';
const CART_INSERT_ENDPOINT = 'https://api.mouser.com/api/v1/cart/items/insert';

// 숫자 추출 — 소수점 유지 후 반올림(₩516,578.4 → 516578). 예전엔 점을 지워 10배로 튀는 버그가 있었음.
function digits(s) { const m = String(s == null ? '' : s).replace(/[^\d.]/g, ''); if (!m) return 0; const n = Number(m); return isNaN(n) ? 0 : Math.round(n); }

// 마우저 부품 1건 조회 → 재고·가격·입고예정(재입고 날짜)·리드타임까지 파싱.
// 실패해도 throw 하지 않고 {found:false, http, errors} 반환 → 진단에서 원인 확인 가능.
async function lookupOne(key, no) {
  let http = 0, d = {};
  try {
    const r = await fetch(SEARCH_ENDPOINT + '?apiKey=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ SearchByPartRequest: { mouserPartNumber: String(no), partSearchOptions: '' } }),
    });
    http = r.status;
    try { d = await r.json(); } catch (e) {}
  } catch (e) { return { found: false, http, errors: [{ Message: String((e && e.message) || e) }] }; }

  const errors = (d && (d.Errors || d.errors)) || [];
  const parts = (d && d.SearchResults && d.SearchResults.Parts) || [];
  if (!parts.length) return { found: false, http, errors, partsCount: 0 };

  const p = parts.find(x => String(x.MouserPartNumber || '').trim() === String(no).trim()) || parts[0];
  // 입고예정(주문중) — 필드명이 버전마다 다를 수 있어 방어적으로 파싱(AvailabilityOnOrder[].Quantity/Date)
  const ooRaw = p.AvailabilityOnOrder || p.availabilityOnOrder || p.OnOrder || [];
  const onOrder = (Array.isArray(ooRaw) ? ooRaw : []).map(o => ({
    qty: digits(o.Quantity != null ? o.Quantity : (o.quantity != null ? o.quantity : o.Qty)),
    date: String(o.Date || o.date || o.AvailabilityDate || o.ExpectedDate || '').trim(),
  })).filter(o => o.qty || o.date);
  const nextDate = (onOrder.find(o => o.date) || {}).date || '';
  const restriction = p.RestrictionMessage || '';   // 예: "유통업체를 통해 구입할 수 없습니다." → 마우저 구매불가
  return {
    found: true, http, partsCount: parts.length,
    inStock: digits(p.AvailabilityInStock != null ? p.AvailabilityInStock : p.Availability),
    availability: p.Availability || '',
    lead: p.LeadTime || '',
    factoryStock: digits(p.FactoryStock),
    onOrder,                 // [{qty, date}] — 주문중/재입고 예정
    nextDate,                // 가장 가까운 재입고 예정일 (예: 2026-08-03)
    priceKRW: (p.PriceBreaks && p.PriceBreaks[0] && digits(p.PriceBreaks[0].Price)) || 0,
    restricted: !!restriction,
    restriction,             // 마우저 구매제한 사유(있으면 재고·가격 없음)
    mfr: p.Manufacturer || '',
    mfrNo: p.ManufacturerPartNumber || '',
    desc: p.Description || '',
    url: p.ProductDetailUrl || '',
  };
}

// 마우저 Cart API 로 부품 1건의 가격·재고를 조회(보강용).
//  Search API 가 RestrictionMessage 로 재고·가격을 0으로 막는 품목도 Cart API 는 실제값(UnitPrice·MouserATS)을 반환.
//  ※ cartKey 를 넘기면 그 '전용 조회 카트' 하나에만 담아 값을 뽑음 → 팀 주문카트/계정을 새 카트로 오염시키지 않음.
//     (빈 문자열이면 마우저가 새 카트를 만들어 반환 — 그 CartKey 를 되돌려 주므로 호출측이 재사용해야 함.)
async function cartLookupOne(key, no, cartKey = '') {
  let http = 0, d = {};
  const qs = `?apiKey=${encodeURIComponent(key)}&countryCode=KR&currencyCode=KRW`;
  try {
    const r = await fetch(CART_INSERT_ENDPOINT + qs, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ CartKey: String(cartKey || ''), CartItems: [{ MouserPartNumber: String(no), Quantity: 1 }] }),
    });
    http = r.status;
    try { d = await r.json(); } catch (e) {}
  } catch (e) { return { found: false, http, errors: [{ Message: String((e && e.message) || e) }] }; }

  const errors = (d && (d.Errors || d.errors)) || [];
  const outKey = (d && (d.CartKey || d.cartKey)) || cartKey || '';
  const items = (d && (d.CartItems || d.cartItems)) || [];
  const it = items.find(x => String(x.MouserPartNumber || x.mouserPartNumber || '').trim() === String(no).trim()) || items[0];
  if (!it) return { found: false, http, errors, via: 'cart', cartKey: outKey };
  const inStock = digits(it.MouserATS != null ? it.MouserATS : (it.AvailabilityInStock != null ? it.AvailabilityInStock : it.Availability));
  const priceKRW = digits(it.UnitPrice != null ? it.UnitPrice : it.unitPrice);
  return {
    found: !!(priceKRW || inStock), http, via: 'cart', errors, cartKey: outKey,
    inStock, priceKRW,
    availability: it.Availability || (inStock ? String(inStock) + ' In Stock' : ''),
    lead: it.LeadTime || '',
    mfrNo: it.ManufacturerPartNumber || it.MfrPartNumber || '',
    desc: it.Description || '',
  };
}

module.exports = { SEARCH_ENDPOINT, CART_INSERT_ENDPOINT, digits, lookupOne, cartLookupOne };
