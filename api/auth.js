/* ===========================================================================
   Vercel 서버리스 · 사내 로그인/계정 관리
   - 마스터 관리자(팀장)는 환경변수로 지정: ADMIN_ID(기본 'admin'), ADMIN_CODE
     · ADMIN_CODE 미설정 시 기본 'robodyne12' (Vercel 환경변수로 반드시 교체 권장)
   - 관리자가 팀원 계정(아이디·접속코드·이름·부서·메일)을 발급/수정/삭제
   - 로그인은 서버에서 접속코드를 검증 → 접속코드가 클라이언트 코드에 노출되지 않음
   - 계정은 KV 해시 eduino:accounts 에 저장 (공개 GET /api/store 로는 안 보임)
   API (POST JSON)
     { op:'login', loginId, code } → { ok, user:{loginId,name,dept,role,email} }
     { op:'listUsers', admin:{loginId,code} } → { ok, users:[...] }   (관리자)
     { op:'saveUser',  admin, user } → { ok }                          (관리자)
     { op:'deleteUser',admin, loginId } → { ok }                       (관리자)
   =========================================================================== */

const ACCOUNTS_KEY = 'eduino:accounts';
const ADMIN_ID = process.env.ADMIN_ID || process.env.EDUINO_ADMIN_ID || 'admin';
const ADMIN_CODE = process.env.ADMIN_CODE || process.env.EDUINO_ADMIN_CODE || 'robodyne12';

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
function arrToObj(arr) { const o = {}; if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) o[arr[i]] = arr[i + 1]; return o; }

async function getAccount(loginId) { const v = await redis(['HGET', ACCOUNTS_KEY, loginId]); if (!v) return null; try { return JSON.parse(v); } catch (e) { return null; } }
async function allAccounts() { const map = arrToObj(await redis(['HGETALL', ACCOUNTS_KEY])); return Object.keys(map).map(k => { try { return JSON.parse(map[k]); } catch (e) { return null; } }).filter(Boolean); }
async function putAccount(a) { await redis(['HSET', ACCOUNTS_KEY, a.loginId, JSON.stringify(a)]); }
async function delAccount(id) { await redis(['HDEL', ACCOUNTS_KEY, id]); }

function isAdmin(body) { const a = (body && body.admin) || {}; return a.loginId === ADMIN_ID && String(a.code) === String(ADMIN_CODE); }
function safeUser(acc, role) { return { loginId: acc.loginId, name: acc.name || acc.loginId, dept: acc.dept || '', role: role || acc.role || 'member', email: acc.email || '', perms: Array.isArray(acc.perms) ? acc.perms : null }; }

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const op = body.op;

    if (op === 'login') {
      const loginId = String(body.loginId || '').trim();
      const code = String(body.code || '');
      if (!loginId || !code) return res.status(200).json({ ok: false, error: '아이디와 접속코드를 입력하세요' });
      if (loginId === ADMIN_ID && code === ADMIN_CODE) {
        return res.status(200).json({ ok: true, user: { loginId: ADMIN_ID, name: '관리자', dept: 'admin', role: 'admin', email: '' } });
      }
      const acc = await getAccount(loginId);
      if (!acc || acc.active === false || String(acc.code) !== code) {
        return res.status(200).json({ ok: false, error: '아이디 또는 접속코드가 올바르지 않습니다' });
      }
      return res.status(200).json({ ok: true, user: safeUser(acc, 'member') });
    }

    if (op === 'listUsers') {
      if (!isAdmin(body)) return res.status(403).json({ ok: false, error: '관리자 권한이 필요합니다' });
      return res.status(200).json({ ok: true, users: await allAccounts(), adminId: ADMIN_ID });
    }

    if (op === 'roster') {
      // 이름/부서만 (접속코드·이메일 제외) — 공지/메모 수신자 선택용, 로그인 사용자 누구나
      const list = (await allAccounts()).map(a => ({ loginId: a.loginId, name: a.name || a.loginId, dept: a.dept || '' }));
      return res.status(200).json({ ok: true, roster: list });
    }

    if (op === 'saveUser') {
      if (!isAdmin(body)) return res.status(403).json({ ok: false, error: '관리자 권한이 필요합니다' });
      const u = body.user || {};
      const loginId = String(u.loginId || '').trim();
      if (!/^[a-zA-Z0-9._-]{2,30}$/.test(loginId)) return res.status(400).json({ ok: false, error: '아이디는 영문/숫자/._- 2~30자' });
      if (loginId === ADMIN_ID) return res.status(400).json({ ok: false, error: '예약된 아이디입니다' });
      if (!String(u.code || '').trim()) return res.status(400).json({ ok: false, error: '접속코드를 입력하세요' });
      const perms = Array.isArray(u.perms) ? u.perms.filter(k => typeof k === 'string' && /^[a-z]+\.[a-z]+$/i.test(k)).slice(0, 50) : [];
      const acc = {
        loginId, code: String(u.code), name: String(u.name || ''), dept: String(u.dept || ''),
        email: String(u.email || ''), role: 'member', active: u.active !== false, perms,
        createdAt: u.createdAt || new Date().toISOString(),
      };
      await putAccount(acc);
      return res.status(200).json({ ok: true });
    }

    if (op === 'deleteUser') {
      if (!isAdmin(body)) return res.status(403).json({ ok: false, error: '관리자 권한이 필요합니다' });
      await delAccount(String(body.loginId || '').trim());
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'unknown op' });
  } catch (err) {
    if (err && err.kv) return res.status(503).json({ ok: false, error: 'KV 미연결 — Vercel 프로젝트에 KV(Upstash) 스토어를 연결하세요.' });
    return res.status(500).json({ ok: false, error: String(err && err.message || err) });
  }
};
