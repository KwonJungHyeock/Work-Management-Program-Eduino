/* ===========================================================================
   Vercel 서버리스 · 셀메이트 → 상품 카탈로그 일일 동기화 (매일 00:00 KST)
   - vercel.json 의 crons 로 매일 15:00 UTC(=00:00 KST) 자동 호출
   - 셀메이트 API 로 상품 목록을 받아 KV 카탈로그(eduino:catalog)에 업서트
   ── 필요한 Vercel 환경변수:
      SELLMATE_API_URL   상품 목록 조회 엔드포인트 (필수)
      SELLMATE_API_KEY   인증 키 (필수)
      SELLMATE_AUTH_HEADER  인증 헤더명 (선택, 기본 'Authorization')
      SELLMATE_AUTH_PREFIX  키 앞에 붙는 접두어 (선택, 기본 'Bearer ')
      SELLMATE_ARRAY_PATH   응답에서 상품 배열 키 (선택, 예 'data' / 'items')
      SELLMATE_MAP_CODE / _NAME / _VENDOR / _SETTLE / _SHIP  응답 필드명 매핑(선택)
      CRON_SECRET        (선택) 설정 시 크론 호출 인증에 사용
   =========================================================================== */

const catalog = require('./catalog.js');

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${secret}`) return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  try {
    const products = await fetchSellmate();
    const n = await catalog.bulkUpsert(products);
    return res.status(200).json({ ok: true, synced: n, at: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err && err.message || err) });
  }
};

// 셀메이트 상품 목록을 API 로 가져와 발주 스키마로 정규화
async function fetchSellmate() {
  const url = process.env.SELLMATE_API_URL, key = process.env.SELLMATE_API_KEY;
  if (!url || !key) throw new Error('SELLMATE_API_URL / SELLMATE_API_KEY 환경변수를 설정하세요 (셀메이트 API 스펙 필요)');
  const hName = process.env.SELLMATE_AUTH_HEADER || 'Authorization';
  const hPrefix = process.env.SELLMATE_AUTH_PREFIX != null ? process.env.SELLMATE_AUTH_PREFIX : 'Bearer ';
  const r = await fetch(url, { headers: { [hName]: hPrefix + key, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error('셀메이트 응답 오류 HTTP ' + r.status);
  const data = await r.json();
  // 응답 구조에서 상품 배열 추출 (환경변수 또는 흔한 키에서 자동 탐색)
  const path = process.env.SELLMATE_ARRAY_PATH;
  const arr = Array.isArray(data) ? data
    : (path && data[path]) || data.items || data.products || data.data || data.list || data.result || [];
  const M = (k, d) => process.env['SELLMATE_MAP_' + k] || d;
  return (Array.isArray(arr) ? arr : []).map(x => ({
    selfCode: x[M('CODE', 'code')] ?? x.goods_code ?? x.item_code ?? x.product_code,
    code:     M('CAFE24', '') ? x[M('CAFE24', '')] : '',
    name:     x[M('NAME', 'name')] ?? x.goods_name ?? x.item_name ?? x.product_name,
    vendor:   x[M('VENDOR', 'vendor')] ?? x.supplier ?? x.maker ?? '',
    settle:   x[M('SETTLE', 'settle')] ?? '',
    ship:     Number(x[M('SHIP', 'ship')] ?? 0) || 0,
  }));
}
module.exports.fetchSellmate = fetchSellmate;
