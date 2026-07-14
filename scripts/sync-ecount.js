#!/usr/bin/env node
/* ===========================================================================
   이카운트 → 상품 카탈로그 동기화 (고정 IP 실행용 · 사무실 PC/서버에서 실행)

   [왜 필요한가]
   Vercel 서버리스는 나가는(egress) IP가 계속 바뀌어서 이카운트 API의
   "허용 IP 목록"에 등록할 수 없습니다. → Vercel 크론(/api/cron-sync)이
   "허용되지 않은 IP" 오류로 실패합니다. 이 스크립트를 이카운트 ERP를 평소
   사용하는 (=이미 IP 허용된) 사무실 PC/서버에서 돌리면, 그 PC가 이카운트에서
   품목을 받아와 배포된 프로그램 카탈로그로 밀어넣습니다.

   [준비물]
   - Node.js 18 이상 (전역 fetch 내장)
   - 같은 폴더의 .env.local 파일에 아래 값 입력 (이 파일은 git에 올라가지 않음):

       ECOUNT_COM_CODE=회사코드
       ECOUNT_USER_ID=API용_로그인아이디
       ECOUNT_API_CERT_KEY=API인증키
       # ECOUNT_ZONE=CA            # (선택) 미설정 시 자동조회
       # ECOUNT_TEST=false         # (선택) 테스트 서버면 true
       # ECOUNT_MAP_OPTION=SIZE_DES  # (선택) 규격 필드명을 직접 지정하고 싶을 때

       CATALOG_PUSH_URL=https://work-manager-liart.vercel.app/api/catalog
       CRON_SECRET=배포에_설정한_시크릿   # Vercel 환경변수 CRON_SECRET 과 동일 값

   [실행]
       node scripts/sync-ecount.js
   [진단만 (밀어넣지 않고 규격 확인)]
       node scripts/sync-ecount.js --diag
   [자동화]  Windows 작업 스케줄러 / 리눅스 crontab 으로 매일 1회 실행 등록
   =========================================================================== */

const fs = require('fs');
const path = require('path');

// --- .env.local 로더 (의존성 없이) ---
(function loadEnv() {
  const p = path.join(__dirname, '.env.local');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('='); if (i < 0) continue;
    const k = s.slice(0, i).trim(), v = s.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
})();

const { fetchEcount } = require('../api/cron-sync.js');

async function main() {
  const diag = process.argv.includes('--diag');
  const pushUrl = process.env.CATALOG_PUSH_URL;
  const secret = process.env.CRON_SECRET || '';

  console.log('이카운트에서 품목을 조회합니다…');
  const r = await fetchEcount();
  const products = r.products || [];
  const withOpt = products.filter(p => p.option && String(p.option).trim() !== '').length;
  console.log(`조회 완료 · 품목 ${products.length}개 · 규격(옵션) 채워진 품목 ${withOpt}개 · zone ${r.zone}`);

  if (diag) {
    const rows = r.sampleRaw || [];
    const keys = [...new Set(rows.flatMap(x => Object.keys(x || {})))].sort();
    const isOpt = k => /opt|size|spec|규격|옵션/i.test(k) && !/cd$|code|_no$|qty|price|단가|수량|번호|일자|date|flag|yn$|여부/i.test(k);
    console.log('\n[규격 후보 필드]');
    for (const k of keys.filter(isOpt)) console.log(' -', k, '=', rows.map(x => x[k]).filter(v => v != null && v !== '').slice(0, 3).join(' / ') || '(빈값)');
    console.log('\n[전체 필드명]\n', keys.join(', '));
    console.log('\n※ 위 후보 중 베이직/로열 같은 규격값이 든 필드를 .env.local 의 ECOUNT_MAP_OPTION 에 지정하면 확실히 연동됩니다.');
    return;
  }

  if (!pushUrl) { console.error('CATALOG_PUSH_URL 이 없습니다. .env.local 을 확인하세요.'); process.exit(1); }
  console.log('카탈로그로 업로드합니다…');
  const res = await fetch(pushUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'bulkUpsert', products, secret }),
  });
  const d = await res.json().catch(() => null);
  if (!res.ok || !d || d.ok === false) {
    console.error('업로드 실패:', res.status, d && d.error || '(응답 없음)');
    process.exit(1);
  }
  console.log(`✅ 완료 · ${d.upserted}개 반영됨. 프로그램 발주/조회에서 최신 품목·규격이 표시됩니다.`);
}

main().catch(e => { console.error('오류:', e && e.message || e); process.exit(1); });
