/* ===========================================================================
   Vercel 서버리스 · 월간 자동 백업 스냅샷
   - 매월 1일(KST) vercel.json 크론이 호출 → 지난달·이번달 상담/발주 시트를
     KV 백업 키(eduino:backup:<YYYY-MM>)에 통째로 복사(편집·삭제로부터 보호)
   - 인증: CRON_SECRET (Vercel 크론이 Authorization: Bearer 로 자동 전송)
   - GET ?type=meta → 최근 백업 시각·월 목록(민감정보 없음, 관리자 화면 상태표시용)
   =========================================================================== */
function kvCreds() {
  const env = process.env;
  let url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  let token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    for (const k of Object.keys(env)) {
      if (!url && /REST_API_URL$/.test(k) && /^https?:\/\//.test(env[k] || '')) url = env[k];
      if (!token && /(?:^|_)REST_API_TOKEN$/.test(k)) token = env[k];
    }
  }
  return { url, token };
}
async function redis(command) {
  const { url, token } = kvCreds();
  if (!url || !token) { const e = new Error('KV_NOT_CONNECTED'); e.kv = true; throw e; }
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
function monthStr(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
async function getSheet(dept, sheet, ym) {
  const bucket = 'eduino:sheet:' + dept + ':' + sheet + ':' + ym;
  const arr = await redis(['HGETALL', bucket]); const out = [];
  if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) { try { const rec = JSON.parse(arr[i + 1]); rec.id = arr[i]; out.push(rec); } catch (e) {} }
  return out;
}
// 월 단위 시트 백업 대상 — CS 상담/MD 발주 + TS 상담 + MD 현황판(입점사변동·품절·검수·상품관리)
const MONTH_SHEETS = [
  ['cs', 'notes'], ['cs', 'exchange'], ['cs', 'postpay'], ['md', 'orders'], ['md', 'tsnotes'],
  ['md', 'vendorchg'], ['md', 'stockmgmt'], ['md', 'inspect'], ['md', 'prodmgmt'],
];
async function snapshotMonth(m) {
  const sheets = {}, counts = {};
  for (const [dept, sheet] of MONTH_SHEETS) {
    const rows = await getSheet(dept, sheet, m);
    sheets[dept + '/' + sheet] = rows; counts[dept + '/' + sheet] = rows.length;
  }
  const at = new Date().toISOString();
  // 하위호환: 기존 cs/md 키 유지 + 전체 시트는 sheets 에 보관
  const cs = sheets['cs/notes'] || [], md = sheets['md/orders'] || [];
  await redis(['SET', 'eduino:backup:' + m, JSON.stringify({ month: m, at, cs, md, sheets, counts })]);
  await redis(['SADD', 'eduino:backup:index', m]);
  await redis(['HSET', 'eduino:backup:meta', 'lastAt', at, 'lastMonth', m]);
  return { month: m, counts };
}
// 월 단위가 아닌 공용 컬렉션(중국발주요청·공지·메모·콜백)의 현재 상태를 통째로 백업
async function collAll(name) {
  const arr = await redis(['HGETALL', 'eduino:coll:' + name]); const out = [];
  if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) { try { out.push(JSON.parse(arr[i + 1])); } catch (e) {} }
  return out;
}
async function snapshotCollections() {
  const names = ['chinaorders', 'notice', 'memo', 'callbacks', 'calendar', 'ntrex', 'duties', 'handover_md', 'handover_cs', 'assignments', 'requests', 'cafe24_sales', 'ts_history'];
  const data = {}, counts = {};
  for (const n of names) { const items = await collAll(n); data[n] = items; counts[n] = items.length; }
  const at = new Date().toISOString();
  await redis(['SET', 'eduino:backup:coll', JSON.stringify({ at, data, counts })]);
  return counts;
}
// 팀 공용 설정(답변·메일·문자 템플릿, 상담사 목록, 시트 URL, 옵션칩 등) 백업 —
//  설정은 버전이 없어(HSET 덮어쓰기) 사고 시 복구 지점이 없었으므로 월간 스냅샷에 포함
async function snapshotSettings() {
  const scopes = ['all', 'cs', 'md'];
  const data = {}, counts = {};
  for (const sc of scopes) {
    const key = sc === 'all' ? 'eduino:settings' : 'eduino:settings:' + sc;
    const arr = await redis(['HGETALL', key]); const o = {};
    if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) o[arr[i]] = arr[i + 1];
    data[sc] = o; counts[sc] = Object.keys(o).length;
  }
  await redis(['SET', 'eduino:backup:settings', JSON.stringify({ at: new Date().toISOString(), data })]);
  return counts;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET' && req.query && req.query.type === 'meta') {
      let meta = {}; try { const a = await redis(['HGETALL', 'eduino:backup:meta']); if (Array.isArray(a)) for (let i = 0; i < a.length; i += 2) meta[a[i]] = a[i + 1]; } catch (e) {}
      let months = []; try { months = (await redis(['SMEMBERS', 'eduino:backup:index'])) || []; } catch (e) {}
      months.sort().reverse();
      return res.status(200).json({ ok: true, lastAt: meta.lastAt || null, lastMonth: meta.lastMonth || null, months });
    }
    // 쓰기(스냅샷)는 CRON_SECRET 인증
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const auth = req.headers['authorization'] || '';
      const key = (req.query && req.query.key) || '';
      if (auth !== `Bearer ${secret}` && key !== secret) return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    const now = new Date();
    const cur = monthStr(now);
    const prev = monthStr(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const done = [];
    for (const m of [prev, cur]) { try { done.push(await snapshotMonth(m)); } catch (e) { done.push({ month: m, error: String(e && e.message || e) }); } }
    let coll = null; try { coll = await snapshotCollections(); } catch (e) { coll = { error: String(e && e.message || e) }; }
    let settings = null; try { settings = await snapshotSettings(); } catch (e) { settings = { error: String(e && e.message || e) }; }
    return res.status(200).json({ ok: true, at: new Date().toISOString(), done, coll, settings });
  } catch (err) {
    if (err && err.kv) return res.status(503).json({ ok: false, error: 'KV 미연결' });
    return res.status(500).json({ ok: false, error: String(err && err.message || err) });
  }
};
