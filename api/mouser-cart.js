/* 마우저 장바구니(Cart API) 프록시 — [요청] 클릭 시 부품을 마우저 카트에 자동으로 담음.
   - 서버가 키 보관: MOUSER_CART_API_KEY (없으면 MOUSER_API_KEY 재사용) · 미설정 시 {configured:false}
   - 카트 식별자(CartKey)는 KV(eduino:mouser:cartkey)에 저장해 팀이 같은 카트를 계속 채움.
   - 요청:  POST /api/mouser-cart  { op:'add'|'get', items:[{mouserNo, qty, edCode}] }
   - 응답:  { configured, ok, cartKey, count, total, webUrl, errors }
   ※ Cart API 엔드포인트/필드는 마우저 문서 기준으로 작성. 실제 응답 필드는 방어적으로 파싱하며,
     배포(Vercel) 후 실제 키로 1회 검증 권장. */
const CART_BASE = 'https://api.mouser.com/api/v1/cart';
const CARTKEY_KV = 'eduino:mouser:cartkey';

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
  try {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
    const j = await r.json(); return j && j.result;
  } catch (e) { return null; }
}

const num = s => { const m = String(s == null ? '' : s).replace(/[^\d.]/g, ''); return m ? Number(m) : 0; };
// API 로 담은 카트를 웹에서 여는 URL — 저장된 CartKey 를 붙여 '담은 그 카트'가 열리게 함.
//  (마우저 웹의 cartKey 파라미터 지원 여부는 검증 중 · 미지원 시 일반 장바구니로 폴백)
const cartWebUrl = k => k ? `https://www.mouser.kr/Cart/?cartKey=${encodeURIComponent(k)}` : 'https://www.mouser.kr/Cart/';

function summarize(d, fallbackKey) {
  const items = d && (d.CartItems || d.cartItems || []) || [];
  const count = items.reduce((s, x) => s + (Number(x.Quantity || x.quantity || 0) || 0), 0);
  const errors = (d && (d.Errors || d.errors)) || [];
  return {
    ok: !(errors && errors.length),
    cartKey: (d && (d.CartKey || d.cartKey)) || fallbackKey || '',
    count,
    total: (d && (d.MerchandiseTotal || d.CartTotal || d.merchandiseTotal)) || '',
    errors,
  };
}

module.exports = async function handler(req, res) {
  // 장바구니는 Order/Cart API 키 — 검색(Search) 키와 다름. Cart/Order 키 우선, 없으면 MOUSER_API_KEY.
  const key = process.env.MOUSER_CART_API_KEY || process.env.MOUSER_ORDER_API_KEY || process.env.MOUSER_API_KEY;
  // 진단용 GET — 키 감지여부 + ?probe=<부품번호> 로 실제 담기 시도 원응답 확인
  if (req.method === 'GET') {
    if (!key) return res.status(200).json({ ok: true, api: 'cart', configured: false, note: 'Cart/Order 키 미감지' });
    if (req.query && req.query.probe) {
      const no = String(req.query.probe);
      const qs = `?apiKey=${encodeURIComponent(key)}&countryCode=KR&currencyCode=KRW`;
      let cartKey = (await redis(['GET', CARTKEY_KV])) || '';
      const payload = { CartKey: cartKey || '', CartItems: [{ MouserPartNumber: no, Quantity: 1 }] };
      const url = `${CART_BASE}/items/insert${qs}`;
      let http = 0, raw = {};
      try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); http = r.status; raw = await r.json().catch(() => ({})); }
      catch (e) { raw = { error: String((e && e.message) || e) }; }
      return res.status(200).json({ probe: no, endpoint: `${CART_BASE}/items/insert`, http, storedCartKey: cartKey || '(none)', raw });
    }
    return res.status(200).json({ ok: true, api: 'cart', configured: true, note: 'Cart/Order 키 감지됨 · ?probe=<부품번호> 로 담기 원응답 확인' });
  }
  if (!key) return res.status(200).json({ configured: false });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch (e) {}
  const op = body.op || 'add';
  const qs = `?apiKey=${encodeURIComponent(key)}&countryCode=KR&currencyCode=KRW`;
  let cartKey = (await redis(['GET', CARTKEY_KV])) || '';

  try {
    if (op === 'get') {
      if (!cartKey) return res.status(200).json({ configured: true, ok: true, cartKey: '', count: 0, webUrl: cartWebUrl('') });
      const r = await fetch(`${CART_BASE}${qs}&cartKey=${encodeURIComponent(cartKey)}`);
      const d = await r.json().catch(() => ({}));
      const s = summarize(d, cartKey);
      return res.status(200).json({ configured: true, webUrl: cartWebUrl(s.cartKey || cartKey), ...s });
    }

    // op === 'add'
    const items = (body.items || []).slice(0, 25).map(i => ({
      MouserPartNumber: String(i.mouserNo || '').trim(),
      Quantity: Math.max(1, Number(i.qty) || 1),
      CustomerPartNumber: String(i.edCode || '').trim(),
    })).filter(i => i.MouserPartNumber);
    if (!items.length) return res.status(200).json({ configured: true, ok: false, error: 'no items' });

    const payload = { CartKey: cartKey || '', CartItems: items };
    const r = await fetch(`${CART_BASE}/items/insert${qs}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const d = await r.json().catch(() => ({}));
    const s = summarize(d, cartKey);
    if (s.cartKey && s.cartKey !== cartKey) await redis(['SET', CARTKEY_KV, s.cartKey]);
    return res.status(200).json({ configured: true, webUrl: cartWebUrl(s.cartKey || cartKey), ...s });
  } catch (e) {
    return res.status(200).json({ configured: true, ok: false, error: String((e && e.message) || e), webUrl: cartWebUrl(cartKey) });
  }
};
