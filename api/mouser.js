/* 마우저 실시간 재고·가격 프록시 (서버가 API 키를 보관 · 클라이언트에 키 비노출)
   - 환경변수 MOUSER_API_KEY 필요. 미설정이면 { configured:false } 반환 → 화면은 기준가만 표시.
   - 요청:  POST /api/mouser  { mouserNos: ["713-102010027", ...] }  (요청당 최대 25개)
   - 응답:  { configured:true, at, data: { <mouserNo>: {found,inStock,lead,availability,priceKRW,url,...} } }
   - Mouser Search API v1 (search/partnumber) 사용. 무료 키, 부품번호 1건/호출. */
const MOUSER_ENDPOINT = 'https://api.mouser.com/api/v1/search/partnumber';

function digits(s){ const m = String(s == null ? '' : s).replace(/[^\d]/g, ''); return m ? Number(m) : 0; }

async function lookupOne(key, no) {
  const r = await fetch(MOUSER_ENDPOINT + '?apiKey=' + encodeURIComponent(key), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ SearchByPartRequest: { mouserPartNumber: no, partSearchOptions: '' } }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  const parts = (d && d.SearchResults && d.SearchResults.Parts) || [];
  if (!parts.length) return { found: false };
  const p = parts.find(x => String(x.MouserPartNumber || '').trim() === String(no).trim()) || parts[0];
  const inStock = digits(p.AvailabilityInStock != null ? p.AvailabilityInStock : p.Availability);
  const price = (p.PriceBreaks && p.PriceBreaks[0] && digits(p.PriceBreaks[0].Price)) || 0;
  return {
    found: true,
    inStock,
    availability: p.Availability || '',
    lead: p.LeadTime || '',
    factoryStock: digits(p.FactoryStock),
    priceKRW: price,
    mfr: p.Manufacturer || '',
    mfrNo: p.ManufacturerPartNumber || '',
    desc: p.Description || '',
    url: p.ProductDetailUrl || '',
  };
}

module.exports = async function handler(req, res) {
  const key = process.env.MOUSER_API_KEY || process.env.EDUINO_MOUSER_API_KEY;
  if (!key) return res.status(200).json({ configured: false });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch (e) {}
  const nos = Array.isArray(body.mouserNos) ? body.mouserNos.map(String).filter(Boolean).slice(0, 25) : [];
  if (!nos.length) return res.status(200).json({ configured: true, at: new Date().toISOString(), data: {} });

  const data = {};
  // 순차 호출(레이트리밋 보호) — 보이는 품목(≤25)만 조회하므로 부담 적음
  for (const no of nos) {
    try { data[no] = await lookupOne(key, no); }
    catch (e) { data[no] = { found: false, error: String((e && e.message) || e) }; }
  }
  return res.status(200).json({ configured: true, at: new Date().toISOString(), data });
};
