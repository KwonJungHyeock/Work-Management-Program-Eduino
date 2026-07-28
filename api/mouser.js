/* 마우저 실시간 재고·가격 프록시 (서버가 키 보관 · 클라이언트에 키 비노출)
   - 환경변수 MOUSER_API_KEY 필요. 미설정이면 { configured:false }.
   - POST /api/mouser  { mouserNos:[...] }  → { configured, data:{ <no>:{found,inStock,nextDate,priceKRW,...} } }
   - 진단 GET /api/mouser            → 키 감지 여부
     진단 GET /api/mouser?test=713-… → 실제 1건 조회 결과(에러·재고·입고예정) 확인 */
const { lookupOne, SEARCH_ENDPOINT } = require('../lib/mouser.js');

module.exports = async function handler(req, res) {
  // 검색(재고·가격)은 Search API 키 — 주문/카트 키와 다름
  const key = process.env.MOUSER_API_KEY || process.env.MOUSER_SEARCH_API_KEY || process.env.EDUINO_MOUSER_API_KEY;

  if (req.method === 'GET') {
    // ?keys=1 — 어떤 마우저 환경변수가 설정돼 있는지 확인(값은 노출 안 함, 존재여부만)
    if (req.query && req.query.keys) {
      return res.status(200).json({
        present: {
          MOUSER_API_KEY: !!process.env.MOUSER_API_KEY,
          MOUSER_SEARCH_API_KEY: !!process.env.MOUSER_SEARCH_API_KEY,
          MOUSER_CART_API_KEY: !!process.env.MOUSER_CART_API_KEY,
          MOUSER_ORDER_API_KEY: !!process.env.MOUSER_ORDER_API_KEY,
        },
        note: '검색(재고·가격)=MOUSER_API_KEY(=Search키) · 장바구니=MOUSER_CART_API_KEY(=Cart/Order키)',
      });
    }
    if (!key) return res.status(200).json({ configured: false, note: 'MOUSER_API_KEY(=Search키) 미감지 — 재고·가격은 Search API 키가 필요' });
    const test = req.query && (req.query.test || req.query.q);
    if (test) {
      // ?test=<no>&raw=1 — 마우저 원본 Part 객체 그대로(실제 필드명 확인 → 매핑 확정용)
      if (req.query.raw) {
        let http = 0, j = {};
        try {
          const r = await fetch(SEARCH_ENDPOINT + '?apiKey=' + encodeURIComponent(key), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ SearchByPartRequest: { mouserPartNumber: String(test), partSearchOptions: '' } }) });
          http = r.status; j = await r.json();
        } catch (e) {}
        const part = (j && j.SearchResults && j.SearchResults.Parts && j.SearchResults.Parts[0]) || null;
        return res.status(200).json({ test: String(test), http, errors: (j && (j.Errors || j.errors)) || [], part });
      }
      const result = await lookupOne(key, String(test));
      return res.status(200).json({ configured: true, test: String(test), result });
    }
    // ?probe=1 — 이 키가 4개 API 중 어느 것에서 통과되는지 확인(읽기 전용)
    if (req.query && req.query.probe) {
      const K = encodeURIComponent(key);
      const isKeyErr = j => ((j && (j.Errors || j.errors)) || []).some(e => /api key|unique identifier/i.test((e.Message || '') + '|' + (e.PropertyName || '')));
      const probes = [
        { api: 'Search', run: () => fetch('https://api.mouser.com/api/v1/search/partnumber?apiKey=' + K, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ SearchByPartRequest: { mouserPartNumber: '358-SC1112', partSearchOptions: '' } }) }) },
        { api: 'Cart', run: () => fetch('https://api.mouser.com/api/v1/cart?apiKey=' + K + '&countryCode=KR&currencyCode=KRW&cartKey=00000000-0000-0000-0000-000000000000', { method: 'GET' }) },
        { api: 'OrderHistory', run: () => fetch('https://api.mouser.com/api/v1/orderhistory/byDateRange?apiKey=' + K + '&startDate=2026-07-01&endDate=2026-07-27', { method: 'GET' }) },
        { api: 'Order', run: () => fetch('https://api.mouser.com/api/v1/order/history?apiKey=' + K, { method: 'GET' }) },
      ];
      const out = [];
      for (const pr of probes) {
        try { const r = await pr.run(); let j = {}; try { j = await r.json(); } catch (e) {}
          const keyRejected = isKeyErr(j);
          out.push({ api: pr.api, http: r.status, keyRejected, verdict: (r.status === 404) ? '경로불명(판정보류)' : keyRejected ? '이 키 아님' : '이 키일 가능성', firstError: (((j && (j.Errors || j.errors)) || [])[0] || {}).Message || '' });
        } catch (e) { out.push({ api: pr.api, error: String((e && e.message) || e) }); }
      }
      return res.status(200).json({ configured: true, probe: out, hint: "verdict '이 키일 가능성' 인 API 가 등록된 키의 소속. 정확한 것은 마우저 API 허브에서 키별 라벨 확인." });
    }
    return res.status(200).json({ configured: true, note: 'MOUSER_API_KEY 감지됨 · ?test=<부품번호> 실조회 · ?probe=1 어느 API 키인지' });
  }

  if (!key) return res.status(200).json({ configured: false });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch (e) {}
  const nos = Array.isArray(body.mouserNos) ? body.mouserNos.map(String).filter(Boolean).slice(0, 25) : [];
  if (!nos.length) return res.status(200).json({ configured: true, at: new Date().toISOString(), data: {} });

  const data = {};
  for (const no of nos) { data[no] = await lookupOne(key, no); }
  return res.status(200).json({ configured: true, at: new Date().toISOString(), data });
};
