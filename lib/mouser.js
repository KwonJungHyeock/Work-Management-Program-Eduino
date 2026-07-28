/* 마우저 API 공용 로직 — 검색(재고·가격·입고예정)·크론·주문이 함께 사용.
   여기 한 곳만 고치면 전 기능에 반영됨. (Vercel 서버함수에서 require) */
const SEARCH_ENDPOINT = 'https://api.mouser.com/api/v1/search/partnumber';
const CART_INSERT_ENDPOINT = 'https://api.mouser.com/api/v1/cart/items/insert';

function digits(s) { const m = String(s == null ? '' : s).replace(/[^\d]/g, ''); return m ? Number(m) : 0; }

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
  const onOrder = (p.AvailabilityOnOrder || []).map(o => ({ qty: digits(o.Quantity), date: (o.Date || '').trim() })).filter(o => o.qty || o.date);
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
//  ※ 빈 CartKey 로 매번 임시 카트를 만들어 값만 뽑고 버림 → 팀 실제 카트(eduino:mouser:cartkey)는 건드리지 않음.
async function cartLookupOne(key, no) {
  let http = 0, d = {};
  const qs = `?apiKey=${encodeURIComponent(key)}&countryCode=KR&currencyCode=KRW`;
  try {
    const r = await fetch(CART_INSERT_ENDPOINT + qs, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ CartKey: '', CartItems: [{ MouserPartNumber: String(no), Quantity: 1 }] }),
    });
    http = r.status;
    try { d = await r.json(); } catch (e) {}
  } catch (e) { return { found: false, http, errors: [{ Message: String((e && e.message) || e) }] }; }

  const errors = (d && (d.Errors || d.errors)) || [];
  const items = (d && (d.CartItems || d.cartItems)) || [];
  const it = items.find(x => String(x.MouserPartNumber || x.mouserPartNumber || '').trim() === String(no).trim()) || items[0];
  if (!it) return { found: false, http, errors, via: 'cart' };
  const inStock = digits(it.MouserATS != null ? it.MouserATS : (it.AvailabilityInStock != null ? it.AvailabilityInStock : it.Availability));
  const priceKRW = digits(it.UnitPrice != null ? it.UnitPrice : it.unitPrice);
  return {
    found: !!(priceKRW || inStock), http, via: 'cart', errors,
    inStock, priceKRW,
    availability: it.Availability || (inStock ? String(inStock) + ' In Stock' : ''),
    lead: it.LeadTime || '',
    mfrNo: it.ManufacturerPartNumber || it.MfrPartNumber || '',
    desc: it.Description || '',
  };
}

module.exports = { SEARCH_ENDPOINT, CART_INSERT_ENDPOINT, digits, lookupOne, cartLookupOne };
