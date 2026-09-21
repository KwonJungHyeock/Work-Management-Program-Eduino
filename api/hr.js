/* ===========================================================================
   HR 전용 API (인사·교육·총무)
   - 일반 업무 데이터(api/store.js)와 달리 **호출자 신원을 서버에서 확인**한다.
     화면에서 메뉴를 감추는 것만으로는 "열람 불가"가 되지 않기 때문.
   - 흐름: ① unlock(아이디+접속코드) → 권한 확인 → 서명 토큰 발급(만료 있음)
           ② 이후 모든 읽기/쓰기는 토큰 제시 필수 · 토큰에 담긴 범위 밖이면 거부
   - 저장 위치도 분리: eduino:hr:<이름>  (공개 GET /api/store 로는 접근 불가)
   - 열람/수정 이력은 감사 로그(eduino:audit)에 남는다.

   API (POST JSON)
     { op:'unlock', loginId, code }                  → { ok, token, exp, me, scope }
     { op:'list',   token, name }                    → { ok, items:[...] }
     { op:'get',    token, name, id }                → { ok, item }
     { op:'put',    token, name, item }              → { ok }        (수정 권한 필요)
     { op:'del',    token, name, id }                → { ok }        (수정 권한 필요)
   =========================================================================== */

const crypto = require('crypto');

const ACCOUNTS_KEY = 'eduino:accounts';
const ADMIN_ID = process.env.ADMIN_ID || process.env.EDUINO_ADMIN_ID || 'admin';
const ADMIN_CODE = process.env.ADMIN_CODE || process.env.EDUINO_ADMIN_CODE || 'robodyne12';
const HR_PREFIX = 'eduino:hr:';
const SESSION_MIN = Math.min(Math.max(Number(process.env.HR_SESSION_MIN) || 480, 10), 1440);   // 기본 8시간

/* 데이터 묶음 → 필요한 화면 권한 키.
   화면을 새로 붙일 때 여기만 늘리면 되고, 권한 판정 로직은 그대로 둔다. */
const DATA = {
  staff:    { need: 'hr.home',     label: '직원 마스터' },
  share:    { need: 'hr.share',    label: '추천도서·강의' },
  catalog:  { need: 'hr.catalog',  label: '강의 카탈로그' },
  // selfNeed = 전체 열람 권한은 없지만 '본인 행만' 볼 수 있는 권한(명세서: 일반 직원 = 본인 관련 항목만)
  apply:    { need: 'hr.apply',    label: '교육 신청·예산', selfNeed: 'hr.mypage' },
  review:   { need: 'hr.review',   label: '교육 후기' },
  match:    { need: 'hr.match',    label: '맞춤 추천' },
  // 팀장 피드백: 전체 열람은 인사담당자·대표(hr.feedback)만.
  // 팀장은 등록 권한(hr.fbwrite)만 받아 '자기가 쓴 것'만 보고 고칠 수 있다.
  feedback: { need: 'hr.feedback', label: '팀장 피드백', selfNeed: 'hr.fbwrite' },
  legal:    { need: 'hr.legal',    label: '법정의무교육', selfNeed: 'hr.legalme' },
  docreq:   { need: 'hr.docreq',   label: '서류 발급 신청', selfNeed: 'hr.docme' },
  welfare:  { need: 'hr.welfare',  label: '팀 복리비' },
  supply:   { need: 'hr.supply',   label: '소모품 관리', selfNeed: 'hr.supplyme' },
};
const HR_KEYS = [...new Set(Object.keys(DATA).reduce((a, k) => a.concat([DATA[k].need, DATA[k].selfNeed]), []).filter(Boolean))];
/* 이 행이 '본인 것'인가 — 본인 행만 열람할 때 쓰는 판정(계정 아이디 기준) */
function ownedBy(item, loginId) {
  if (!item || !loginId) return false;
  return item.staffLogin === loginId || item.byId === loginId || item.loginId === loginId;
}
/* 개인 소유가 아닌 '공용 정의' 행(법정의무교육 과정, 자주 쓰는 소모품 등).
   본인 행만 보는 사람도 이건 봐야 화면이 성립한다. 쓰기는 여전히 전체 권한자만 가능. */
function isShared(item) { return !!(item && item.shared === true); }

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
async function logAudit(entry) {
  try {
    await redis(['LPUSH', 'eduino:audit', JSON.stringify({ at: new Date().toISOString(), ...entry })]);
    await redis(['LTRIM', 'eduino:audit', 0, 499]);
  } catch (e) {}
}

/* 토큰 서명 키 — 전용 값(HR_SECRET)이 있으면 그것, 없으면 서버에만 있는 KV 토큰에서 파생.
   어느 경우든 코드/저장소에 비밀값이 남지 않는다. */
function secret() {
  const s = process.env.HR_SECRET || kvCreds().token || '';
  return crypto.createHash('sha256').update('eduino-hr|' + s).digest();
}
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function signToken(payload) {
  const body = b64u(JSON.stringify(payload));
  const mac = b64u(crypto.createHmac('sha256', secret()).update(body).digest());
  return body + '.' + mac;
}
function readToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const expect = crypto.createHmac('sha256', secret()).update(parts[0]).digest();
  let got; try { got = unb64u(parts[1]); } catch (e) { return null; }
  if (got.length !== expect.length || !crypto.timingSafeEqual(got, expect)) return null;   // 위조 토큰
  let p; try { p = JSON.parse(unb64u(parts[0]).toString('utf8')); } catch (e) { return null; }
  if (!p || !p.exp || Date.now() > p.exp) return null;                                     // 만료
  return p;
}

async function getAccount(loginId) {
  const v = await redis(['HGET', ACCOUNTS_KEY, loginId]);
  if (!v) return null; try { return JSON.parse(v); } catch (e) { return null; }
}
async function getAdminProfile() { try { const v = await redis(['GET', 'eduino:admin:profile']); return v ? JSON.parse(v) : {}; } catch (e) { return {}; } }

/* 계정 → 이 사람이 볼 수 있는/고칠 수 있는 HR 화면 키 목록 */
function scopeOf(acc) {
  if (acc.role === 'admin') return { r: HR_KEYS.slice(), w: HR_KEYS.slice() };             // 대표·관리자 = 전체
  const perms = Array.isArray(acc.perms) ? acc.perms : [];
  const edit = Array.isArray(acc.editPerms) ? acc.editPerms : [];
  const r = HR_KEYS.filter(k => perms.indexOf(k) >= 0);
  const w = HR_KEYS.filter(k => edit.indexOf(k) >= 0 && r.indexOf(k) >= 0);               // 수정은 열람을 전제
  return { r, w };
}

function dataKey(name) {
  const d = DATA[name];
  if (!d) throw new Error('bad data name');
  return HR_PREFIX + name;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const op = body.op;

    /* ── ① 잠금 해제 — 아이디·접속코드 재확인 후 토큰 발급 ── */
    if (op === 'unlock') {
      const loginId = String(body.loginId || '').trim();
      const code = String(body.code || '');
      if (!loginId || !code) return res.status(200).json({ ok: false, error: '아이디와 접속코드를 입력하세요' });

      let acc = null;
      if (loginId === ADMIN_ID) {
        const prof = await getAdminProfile();
        if (code === ADMIN_CODE || (prof.code && code === String(prof.code))) {
          acc = { loginId: ADMIN_ID, name: prof.name || '관리자', role: 'admin', dept: prof.dept || '' };
        }
      } else {
        const a = await getAccount(loginId);
        if (a && a.active !== false && String(a.code) === code) acc = a;
      }
      if (!acc) {
        await logAudit({ area: 'HR', act: 'unlock-fail', who: loginId });
        return res.status(200).json({ ok: false, error: '아이디 또는 접속코드가 올바르지 않습니다' });
      }

      const scope = scopeOf(acc);
      if (!scope.r.length) {
        await logAudit({ area: 'HR', act: 'unlock-deny', who: loginId, name: acc.name || '' });
        return res.status(200).json({ ok: false, error: 'HR 열람 권한이 없는 계정입니다. 관리자에게 권한을 요청하세요.' });
      }
      const exp = Date.now() + SESSION_MIN * 60000;
      const token = signToken({ u: acc.loginId, n: acc.name || acc.loginId, ro: acc.role || 'member', r: scope.r, w: scope.w, exp });
      await logAudit({ area: 'HR', act: 'unlock', who: acc.loginId, name: acc.name || '' });
      return res.status(200).json({
        ok: true, token, exp,
        me: { loginId: acc.loginId, name: acc.name || acc.loginId, role: acc.role || 'member' },
        scope,
      });
    }

    /* ── ② 데이터 접근 — 토큰 필수 ── */
    const t = readToken(body.token);
    if (!t) return res.status(401).json({ ok: false, error: 'HR 세션이 만료되었습니다. 다시 잠금을 해제하세요.', relock: true });

    const name = String(body.name || '');
    const meta = DATA[name];
    if (!meta) return res.status(400).json({ ok: false, error: 'bad data name' });

    const canRead = (t.r || []).indexOf(meta.need) >= 0;
    const canWrite = (t.w || []).indexOf(meta.need) >= 0;
    // 전체 권한이 없어도 '본인 행만' 권한이 있으면 자기 것은 보고 쓸 수 있다
    const selfRead = !canRead && !!meta.selfNeed && (t.r || []).indexOf(meta.selfNeed) >= 0;
    const selfWrite = !canWrite && !!meta.selfNeed && (t.w || []).indexOf(meta.selfNeed) >= 0;
    if (!canRead && !selfRead) {
      await logAudit({ area: 'HR', act: 'deny', who: t.u, detail: name });
      return res.status(403).json({ ok: false, error: `'${meta.label}' 열람 권한이 없습니다.` });
    }

    if (op === 'list') {
      const map = arrToObj(await redis(['HGETALL', dataKey(name)]));
      let items = Object.keys(map).map(k => { try { const o = JSON.parse(map[k]); o.id = k; return o; } catch (e) { return null; } }).filter(Boolean);
      if (selfRead) items = items.filter(x => isShared(x) || ownedBy(x, t.u));   // 본인 것 + 공용 정의
      return res.status(200).json({ ok: true, items, canWrite: canWrite || selfWrite, self: selfRead });
    }
    if (op === 'get') {
      const v = await redis(['HGET', dataKey(name), String(body.id || '')]);
      let item = null; if (v) { try { item = JSON.parse(v); } catch (e) {} }
      if (item && selfRead && !isShared(item) && !ownedBy(item, t.u)) item = null;   // 남의 행은 없는 것으로
      return res.status(200).json({ ok: true, item, canWrite: canWrite || selfWrite });
    }
    if (op === 'put') {
      if (!canWrite && !selfWrite) return res.status(403).json({ ok: false, error: `'${meta.label}' 수정 권한이 없습니다.` });
      const item = body.item || {};
      if (!canWrite && selfWrite && !ownedBy(item, t.u)) {                // 본인 행만 쓰기
        await logAudit({ area: 'HR', act: 'deny-write', who: t.u, detail: name });
        return res.status(403).json({ ok: false, error: '본인 항목만 저장할 수 있습니다.' });
      }
      const id = String(item.id || '').trim();
      if (!id) return res.status(400).json({ ok: false, error: 'item.id required' });
      item.updatedAt = new Date().toISOString();
      item.updatedBy = t.n || t.u;
      await redis(['HSET', dataKey(name), id, JSON.stringify(item)]);
      await logAudit({ area: 'HR', act: 'put', who: t.u, name: t.n, detail: name + '/' + id });
      return res.status(200).json({ ok: true, item });
    }
    if (op === 'del') {
      if (!canWrite && !selfWrite) return res.status(403).json({ ok: false, error: `'${meta.label}' 수정 권한이 없습니다.` });
      const id = String(body.id || '').trim();
      if (!id) return res.status(400).json({ ok: false, error: 'id required' });
      if (!canWrite && selfWrite) {                                       // 본인 행만 삭제
        const v = await redis(['HGET', dataKey(name), id]);
        let cur = null; if (v) { try { cur = JSON.parse(v); } catch (e) {} }
        if (!cur || !ownedBy(cur, t.u)) return res.status(403).json({ ok: false, error: '본인 항목만 삭제할 수 있습니다.' });
      }
      const n = await redis(['HDEL', dataKey(name), id]);
      await logAudit({ area: 'HR', act: 'del', who: t.u, name: t.n, detail: name + '/' + id });
      return res.status(200).json({ ok: true, removed: Number(n) || 0 });
    }
    return res.status(400).json({ ok: false, error: 'unknown op' });
  } catch (e) {
    if (e && e.kv) return res.status(503).json({ ok: false, error: 'KV_NOT_CONNECTED' });
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};
