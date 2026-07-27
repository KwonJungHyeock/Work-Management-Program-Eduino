/* 마우저 실시간 재고·가격 프록시 (서버가 키 보관 · 클라이언트에 키 비노출)
   - 환경변수 MOUSER_API_KEY 필요. 미설정이면 { configured:false }.
   - POST /api/mouser  { mouserNos:[...] }  → { configured, data:{ <no>:{found,inStock,nextDate,priceKRW,...} } }
   - 진단 GET /api/mouser            → 키 감지 여부
     진단 GET /api/mouser?test=713-… → 실제 1건 조회 결과(에러·재고·입고예정) 확인 */
const { lookupOne } = require('../lib/mouser.js');

module.exports = async function handler(req, res) {
  const key = process.env.MOUSER_API_KEY || process.env.MOUSER_CART_API_KEY || process.env.EDUINO_MOUSER_API_KEY;

  if (req.method === 'GET') {
    if (!key) return res.status(200).json({ configured: false, note: 'MOUSER_API_KEY 미감지(이 배포 환경) — 환경변수 스코프/재배포 확인' });
    const test = req.query && (req.query.test || req.query.q);
    if (test) {
      const result = await lookupOne(key, String(test));
      return res.status(200).json({ configured: true, test: String(test), result });
    }
    return res.status(200).json({ configured: true, note: 'MOUSER_API_KEY 감지됨 · ?test=<부품번호> 로 실조회 확인' });
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
