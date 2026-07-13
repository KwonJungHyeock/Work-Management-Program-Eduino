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

const SETTINGS_KEY = 'eduino:settings';   // 전사(all) 버킷 = 레거시 키
const SETTINGS_SCOPES = ['all', 'cs', 'md'];
const settingsKey = (scope) => {
  scope = String(scope || 'all');
  if (SETTINGS_SCOPES.indexOf(scope) < 0) scope = 'all';
  return scope === 'all' ? SETTINGS_KEY : SETTINGS_KEY + ':' + scope;
};
const PRESENCE_KEY = 'eduino:presence';
const PRESENCE_TTL_MS = 3 * 60 * 1000; // 최근 3분 이내 하트비트 = 접속 중

function kvCreds() {
  const env = process.env;
  let url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  let token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  // 커스텀 프리픽스(STORAGE_ 등)가 붙어도 자동 탐지: *_REST_API_URL / *_REST_API_TOKEN
  if (!url || !token) {
    for (const k of Object.keys(env)) {
      if (!url && /REST_API_URL$/.test(k) && /^https?:\/\//.test(env[k] || '')) url = env[k];
      if (!token && /(?:^|_)REST_API_TOKEN$/.test(k)) token = env[k];
    }
  }
  return { url, token };
}

async function redis(command) {
  // Vercel KV 또는 Upstash 통합 — 어느 프리픽스로 연결해도 자동 인식
  const { url, token } = kvCreds();
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

// 요청한 범위들(쉼표구분)을 병합해서 반환 — 예: scope='all,cs'
async function getSettings(scopeStr) {
  let scopes = String(scopeStr || 'all').split(',').map(s => s.trim()).filter(s => SETTINGS_SCOPES.indexOf(s) >= 0);
  if (!scopes.length) scopes = ['all'];
  const out = {};
  for (const sc of scopes) Object.assign(out, arrToObj(await redis(['HGETALL', settingsKey(sc)])));
  return out;
}
async function setSettings(scope, entries) {
  const keys = Object.keys(entries || {}); if (!keys.length) return 0;
  const target = settingsKey(scope);
  const cmd = ['HSET', target]; keys.forEach(k => cmd.push(k, String(entries[k])));
  await redis(cmd);
  // 다른 범위 버킷에 남아있는 동일 키 제거 → 키는 항상 한 버킷에만 존재(범위 변경/마이그레이션 정리)
  for (const sc of SETTINGS_SCOPES) {
    const kk = settingsKey(sc); if (kk === target) continue;
    try { await redis(['HDEL', kk, ...keys]); } catch (e) {}
  }
  return keys.length;
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

// 범용 공용 컬렉션 (처리대기 큐·상담이력 공유 등) — coll 이름은 영숫자/_ 만
function collKey(c) { if (!/^[a-z0-9_]{1,40}$/i.test(c || '')) throw new Error('bad collection name'); return 'eduino:coll:' + c; }
async function collGet(c) {
  const map = arrToObj(await redis(['HGETALL', collKey(c)]));
  return Object.keys(map).map(k => { try { return JSON.parse(map[k]); } catch (e) { return null; } }).filter(Boolean);
}
async function collPush(c, item) { if (!item || item.id == null) throw new Error('item.id required'); await redis(['HSET', collKey(c), String(item.id), JSON.stringify(item)]); }
async function collDel(c, id) { await redis(['HDEL', collKey(c), String(id)]); }

// 업무 로그 — 직원별 일일 업무량 누적 (관리자 인사이트)
const WORK_DEPTS = ['cs', 'md'];
const okDept = (d) => WORK_DEPTS.indexOf(d) >= 0;
async function workLog(dept, event) {
  if (!okDept(dept)) throw new Error('bad dept');
  const day = String((event && event.day) || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('bad day');
  const ym = day.slice(0, 7);
  const who = String((event && event.who) || '?').slice(0, 60);
  const id = String((event && event.id) || Date.now());
  // 원본은 월 단위 버킷(조회 시 통째로 안 읽음) · 대시보드용 카운터는 별도 유지
  await redis(['HSET', 'eduino:worklog:' + dept + ':' + ym, id,
    JSON.stringify({ day, ts: event.ts || Date.now(), who, whoName: event.whoName || who, type: event.type || '' })]);
  await redis(['HINCRBY', 'eduino:workstat:' + dept, who + '|' + day, 1]);
  if (event && event.whoName) await redis(['HSET', 'eduino:workwho:' + dept, who, String(event.whoName).slice(0, 40)]);
  return true;
}
async function getWorkStat(deptStr) {
  let depts = String(deptStr || 'cs,md').split(',').map(s => s.trim()).filter(okDept);
  if (!depts.length) depts = WORK_DEPTS.slice();
  const stats = {}, who = {};
  for (const d of depts) {
    stats[d] = arrToObj(await redis(['HGETALL', 'eduino:workstat:' + d]));
    who[d] = arrToObj(await redis(['HGETALL', 'eduino:workwho:' + d]));
  }
  return { stats, who };
}
async function getWorkRaw(dept, month) {
  if (!okDept(dept)) throw new Error('bad dept');
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw new Error('bad month');
  const map = arrToObj(await redis(['HGETALL', 'eduino:worklog:' + dept + ':' + month]));
  return Object.keys(map).map(k => { try { const o = JSON.parse(map[k]); o.id = k; return o; } catch (e) { return null; } }).filter(Boolean);
}

// 프로그램 내 "시트" — 전 직원 업무 기록을 서버에 누적 (구글시트는 백업)
// 부서별 허용 시트(레코드 버킷) — 현황판/신설 페이지가 추가될 때마다 등록해야 서버에 저장됨
const SHEET_ALLOW = {
  cs: ['notes', 'postpay', 'exchange'],
  md: ['orders', 'tsnotes', 'vendorchg', 'stockmgmt', 'inspect', 'prodmgmt'],
};
function sheetOk(dept, sheet) { return SHEET_ALLOW[dept] && SHEET_ALLOW[dept].indexOf(sheet) >= 0; }
function sheetBucket(dept, sheet, ym) { return 'eduino:sheet:' + dept + ':' + sheet + ':' + ym; }
async function recPush(dept, sheet, record) {
  if (!sheetOk(dept, sheet)) throw new Error('bad sheet');
  const day = String((record && record.day) || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('bad day');
  const id = String((record && record.id) || '');
  if (!id) throw new Error('record.id required');
  const ym = day.slice(0, 7), bucket = sheetBucket(dept, sheet, ym);
  const who = String((record && record.who) || '?').slice(0, 60);
  const existed = await redis(['HEXISTS', bucket, id]);           // 편집이면 카운터 중복 증가 방지
  await redis(['HSET', bucket, id, JSON.stringify(record)]);
  if (!Number(existed)) {
    await redis(['HINCRBY', 'eduino:workstat:' + dept, who + '|' + day, 1]);
    if (record && record.whoName) await redis(['HSET', 'eduino:workwho:' + dept, who, String(record.whoName).slice(0, 40)]);
  }
  return true;
}
async function recDel(dept, sheet, id, month, who, day) {
  if (!sheetOk(dept, sheet)) throw new Error('bad sheet');
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw new Error('bad month');
  const removed = await redis(['HDEL', sheetBucket(dept, sheet, month), String(id)]);
  if (Number(removed) && who && /^\d{4}-\d{2}-\d{2}$/.test(day || '')) {
    try { await redis(['HINCRBY', 'eduino:workstat:' + dept, who + '|' + day, -1]); } catch (e) {}
  }
  return Number(removed) || 0;
}
// 감사 로그 (기록 삭제 등) — auth.js 와 동일 리스트 'eduino:audit'
async function logAudit(entry) {
  try { await redis(['LPUSH', 'eduino:audit', JSON.stringify({ at: new Date().toISOString(), ...entry })]); await redis(['LTRIM', 'eduino:audit', 0, 499]); } catch (e) {}
}
async function getSheet(dept, sheet, month) {
  if (!sheetOk(dept, sheet)) throw new Error('bad sheet');
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw new Error('bad month');
  const map = arrToObj(await redis(['HGETALL', sheetBucket(dept, sheet, month)]));
  return Object.keys(map).map(k => { try { const o = JSON.parse(map[k]); o.id = k; return o; } catch (e) { return null; } }).filter(Boolean);
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const type = (req.query && req.query.type) || 'all';
      const out = { ok: true };
      if (type === 'coll') { out.items = await collGet(req.query.coll); return res.status(200).json(out); }
      if (type === 'workstat') { const w = await getWorkStat(req.query && req.query.dept); out.stats = w.stats; out.who = w.who; return res.status(200).json(out); }
      if (type === 'worklog') { out.events = await getWorkRaw(req.query && req.query.dept, req.query && req.query.month); return res.status(200).json(out); }
      if (type === 'sheet') { out.records = await getSheet(req.query && req.query.dept, req.query && req.query.sheet, req.query && req.query.month); return res.status(200).json(out); }
      if (type === 'settings' || type === 'all') out.settings = await getSettings((req.query && req.query.scope) || 'all');
      if (type === 'presence' || type === 'all') out.presence = await getPresence();
      return res.status(200).json(out);
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      if (body.op === 'setSettings') {
        const n = await setSettings(body.scope || 'all', body.entries || {});
        return res.status(200).json({ ok: true, saved: n });
      }
      if (body.op === 'presence') {
        await beat(body.device || '');
        return res.status(200).json({ ok: true });
      }
      if (body.op === 'collPush') { await collPush(body.coll, body.item); return res.status(200).json({ ok: true }); }
      if (body.op === 'collDel') { await collDel(body.coll, body.id); return res.status(200).json({ ok: true }); }
      if (body.op === 'workLog') { await workLog(body.dept, body.event || {}); return res.status(200).json({ ok: true }); }
      if (body.op === 'recPush') { await recPush(body.dept, body.sheet, body.record || {}); return res.status(200).json({ ok: true }); }
      if (body.op === 'recDel') { const n = await recDel(body.dept, body.sheet, body.id, body.month, body.who, body.day);
        if (n) await logAudit({ actor: String(body.actor || '?').slice(0, 40), action: 'record.delete', target: `${body.dept}/${body.sheet}/${body.id}`, detail: `${body.dept === 'cs' ? '상담' : '발주'} 기록 · ${body.day || body.month || ''}${body.who ? ' · ' + body.who : ''}` });
        return res.status(200).json({ ok: true }); }
      return res.status(400).json({ ok: false, error: 'unknown op' });
    }
    return res.status(405).json({ ok: false, error: 'method not allowed' });
  } catch (err) {
    if (err && err.kv) return res.status(503).json({ ok: false, error: 'KV 미연결 — Vercel 프로젝트에 KV(Upstash) 스토어를 연결하세요.' });
    return res.status(500).json({ ok: false, error: String(err && err.message || err) });
  }
};
