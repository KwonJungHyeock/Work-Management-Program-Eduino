/* ===========================================================================
   Vercel 서버리스 · 메일 자동발송 (엔티렉스 공급가 요청 등)
   - 메일플러그 SMTP 로 발송. nodemailer 없이 Node 내장 tls 로 직접 구현(무의존성).
   - 비밀번호는 코드/클라이언트에 노출하지 않고 환경변수로만 주입합니다.
   - 오발송 방지: 수신자 화이트리스트(SENDMAIL_ALLOW) 안의 주소로만 발송.

   환경변수 (Vercel → Settings → Environment Variables)
     SMTP_HOST       기본 smtp.mailplug.co.kr
     SMTP_PORT       기본 465 (SSL) · 안 되면 587
     SMTP_USER       발송 계정 전체 이메일 (예: ljh7735@robodyne.co.kr)  ★필수
     SMTP_PASS       발송 계정 비밀번호(또는 앱 비밀번호)                 ★필수
     SMTP_FROM_NAME  보내는 사람 표시 이름 (예: 이진환)  · 기본 SMTP_USER
     SMTP_REPLY_TO   회신 받을 주소 (예: order@robodyne.co.kr)
     SENDMAIL_ALLOW  발송 허용 수신자(쉼표구분 · 이메일 또는 @도메인)
                     예: n4812@ntrex.co.kr,@ntrex.co.kr  · 미설정 시 전체 허용(권장:설정)

   API
     GET  /api/sendmail                 → { ok, configured, from, fromName, replyTo, allow }
     POST /api/sendmail { op:'send', to, toName, subject, body, actor }
   =========================================================================== */
const tls = require('node:tls');
const net = require('node:net');

const CFG = () => {
  const e = process.env;
  return {
    host: e.SMTP_HOST || 'smtp.mailplug.co.kr',
    port: Number(e.SMTP_PORT) || 465,
    user: e.SMTP_USER || '',
    pass: e.SMTP_PASS || '',
    fromName: e.SMTP_FROM_NAME || e.SMTP_USER || '',
    replyTo: e.SMTP_REPLY_TO || '',
    allow: String(e.SENDMAIL_ALLOW || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  };
};

const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
function recipientAllowed(to, allow) {
  if (!allow.length) return true;                 // 미설정 = 전체 허용(권장은 설정)
  const t = String(to || '').toLowerCase();
  return allow.some(a => a.startsWith('@') ? t.endsWith(a) : t === a);
}

// ── UTF-8 헤더/본문 인코딩 ──
const b64 = s => Buffer.from(String(s), 'utf8').toString('base64');
const encHeader = s => /^[\x20-\x7E]*$/.test(String(s || '')) ? String(s || '') : '=?UTF-8?B?' + b64(s) + '?=';
const nameAddr = (name, addr) => name ? `${encHeader(name)} <${addr}>` : addr;

function buildMessage(c, { to, toName, subject, body }) {
  const now = new Date();
  const dateHdr = now.toUTCString().replace(/GMT$/, '+0000');
  const rand = Buffer.from(String(now.getTime()) + c.user).toString('hex').slice(0, 16);
  const bodyB64 = Buffer.from(String(body || '').replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  const H = [
    `From: ${nameAddr(c.fromName, c.user)}`,
    `To: ${nameAddr(toName, to)}`,
    c.replyTo ? `Reply-To: ${c.replyTo}` : '',
    `Subject: ${encHeader(subject)}`,
    `Date: ${dateHdr}`,
    `Message-ID: <${rand}@${(c.user.split('@')[1] || 'localhost')}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);
  return H.join('\r\n') + '\r\n\r\n' + bodyB64 + '\r\n';
}

// ── 최소 SMTP 대화 (implicit TLS=465 / STARTTLS 미사용) ──
function smtpSend(c, msg, to) {
  return new Promise((resolve, reject) => {
    const useTls = c.port === 465;
    const sock = useTls
      ? tls.connect({ host: c.host, port: c.port, servername: c.host, rejectUnauthorized: false })
      : net.connect({ host: c.host, port: c.port });
    let buf = '', step = 0, done = false;
    const steps = [
      { send: null, expect: 220 },                                   // greeting
      { send: () => `EHLO ${(c.user.split('@')[1] || 'robodyne.co.kr')}`, expect: 250 },
      { send: () => 'AUTH LOGIN', expect: 334 },
      { send: () => b64(c.user), expect: 334 },
      { send: () => b64(c.pass), expect: 235 },
      { send: () => `MAIL FROM:<${c.user}>`, expect: 250 },
      { send: () => `RCPT TO:<${to}>`, expect: 250 },
      { send: () => 'DATA', expect: 354 },
      { send: () => msg.replace(/\r\n\.\r\n/g, '\r\n..\r\n').replace(/^\./gm, '..') + '\r\n.', expect: 250 },
      { send: () => 'QUIT', expect: 221 },
    ];
    const fail = (e) => { if (done) return; done = true; try { sock.destroy(); } catch (x) {} reject(e instanceof Error ? e : new Error(String(e))); };
    const finish = () => { if (done) return; done = true; try { sock.end(); } catch (x) {} resolve(true); };
    sock.setTimeout(20000, () => fail(new Error('SMTP 타임아웃')));
    sock.on('error', fail);
    function pump() {
      // 완결된 응답(마지막 줄이 "코드<공백>")이 buf 에 있으면 처리
      const lines = buf.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || '';
      const m = last.match(/^(\d{3})([ -])/);
      if (!m || m[2] === '-') return;                 // 아직 멀티라인 진행 중
      const code = Number(m[1]); buf = '';
      const st = steps[step];
      if (code !== st.expect) return fail(new Error(`SMTP ${code}: ${last} (기대 ${st.expect})`));
      step++;
      if (step >= steps.length) return finish();
      const nxt = steps[step];
      if (nxt.send) { try { sock.write(nxt.send() + '\r\n'); } catch (e) { return fail(e); } }
    }
    sock.on('data', (d) => { buf += d.toString('utf8'); pump(); });
    // greeting(step0) 은 서버가 먼저 보냄 → 첫 data 이벤트에서 pump 가 step0 처리 후 EHLO 전송
  });
}

module.exports = async function handler(req, res) {
  try {
    const c = CFG();
    if (req.method === 'GET') {
      return res.status(200).json({
        ok: true, configured: !!(c.user && c.pass),
        from: c.user, fromName: c.fromName, replyTo: c.replyTo,
        host: c.host, port: c.port, allow: c.allow,
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method not allowed' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (body.op !== 'send') return res.status(400).json({ ok: false, error: 'unknown op' });

    if (!c.user || !c.pass) return res.status(503).json({ ok: false, error: 'SMTP 미설정 — Vercel 환경변수(SMTP_USER·SMTP_PASS)를 등록하세요.' });
    const to = String(body.to || '').trim();
    if (!isEmail(to)) return res.status(400).json({ ok: false, error: '받는 사람 주소가 올바르지 않습니다.' });
    if (!recipientAllowed(to, c.allow)) return res.status(403).json({ ok: false, error: `허용되지 않은 수신자입니다 (${to}). SENDMAIL_ALLOW 확인.` });
    const subject = String(body.subject || '(제목 없음)').slice(0, 300);
    const mailBody = String(body.body || '').slice(0, 20000);

    const msg = buildMessage(c, { to, toName: String(body.toName || ''), subject, body: mailBody });
    await smtpSend(c, msg, to);

    // 감사 로그(누가·언제·누구에게) — store.js 와 동일 리스트
    try {
      const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
      const kvTok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
      if (kvUrl && kvTok) {
        const entry = JSON.stringify({ at: new Date().toISOString(), actor: String(body.actor || '?').slice(0, 40), action: 'mail.send', target: to, detail: subject.slice(0, 80) });
        await fetch(kvUrl, { method: 'POST', headers: { Authorization: `Bearer ${kvTok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(['LPUSH', 'eduino:audit', entry]) });
      }
    } catch (e) {}

    return res.status(200).json({ ok: true, to, from: c.user });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err && err.message || err) });
  }
};
