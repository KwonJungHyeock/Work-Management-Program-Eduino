/* ===========================================================================
   Vercel 서버리스 · 공용 저장소 (팀 설정 공유 + 접속자 현황)
   - Vercel KV(Upstash Redis)를 REST API로 직접 호출 → 별도 npm 의존성 없음
   - 같은 도메인(/api/store)이라 CORS 문제 없이 응답을 읽습니다.
   - 필요한 환경변수(‑ Vercel에서 KV 스토어를 프로젝트에 연결하면 자동 주입):
       KV_REST_API_URL, KV_REST_API_TOKEN
   API
     GET  /api/store?type=settings → { ok, settings:{key:value} }
     GET  /api/store?type=presence → { ok, presence:[{device}] }
     GET  /api/store               → 둘 다
     POST /api/store { op:'setSettings', entries:{k:v}, device }
     POST /api/store { op:'presence', device }
   =========================================================================== */

const SETTINGS_KEY = 'eduino:settings';
const PRESENCE_KEY = 'eduino:presence';
const PRESENCE_TTL_MS = 3 * 60 * 1000; // 최근 3분 이내 하트비트 = 접속 중

async function redis(command) {
  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) { const e = new Error('KV_NOT_CONNECTED'); e.kv = true; throw e; }
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

function arrToObj(arr) { const o = {}; if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) o[arr[i]] = arr[i + 1]; return o; }

async function getSettings() { return arrToObj(await redis(['HGETALL', SETTINGS_KEY])); }
async function setSettings(entries) {
  const keys = Object.keys(entries || {}); if (!keys.length) return 0;
  const cmd = ['HSET', SETTINGS_KEY]; keys.forEach(k => cmd.push(k, String(entries[k])));
  await redis(cmd); return keys.length;
}
async function getPresence() {
  const map = arrToObj(await redis(['HGETALL', PRESENCE_KEY]));
  const now = Date.now(), list = [], stale = [];
  Object.keys(map).forEach(dev => {
    if (now - Number(map[dev]) < PRESENCE_TTL_MS) list.push({ device: dev });
    else stale.push(dev);
  });
  if (stale.length) { try { await redis(['HDEL', PRESENCE_KEY, ...stale]); } catch (e) {} }
  return list;
}
async function beat(device) { if (!device) return; await redis(['HSET', PRESENCE_KEY, device, String(Date.now())]); }

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const type = (req.query && req.query.type) || 'all';
      const out = { ok: true };
      if (type === 'settings' || type === 'all') out.settings = await getSettings();
      if (type === 'presence' || type === 'all') out.presence = await getPresence();
      return res.status(200).json(out);
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      if (body.op === 'setSettings') {
        const n = await setSettings(body.entries || {});
        return res.status(200).json({ ok: true, saved: n });
      }
      if (body.op === 'presence') {
        await beat(body.device || '');
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ ok: false, error: 'unknown op' });
    }
    return res.status(405).json({ ok: false, error: 'method not allowed' });
  } catch (err) {
    if (err && err.kv) return res.status(503).json({ ok: false, error: 'KV 미연결 — Vercel 프로젝트에 KV(Upstash) 스토어를 연결하세요.' });
    return res.status(500).json({ ok: false, error: String(err && err.message || err) });
  }
};
