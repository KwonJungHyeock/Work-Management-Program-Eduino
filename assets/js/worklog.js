/* ===========================================================================
   업무 기록(Records) — 프로그램 내 "시트" 클라이언트
   - 상담/발주 저장 시 전체 레코드를 서버(KV)에 누적 → 전 직원 공유 시트 + 인사이트
   - 구글시트는 백업으로 병행. CS=선택 상담사 기준, MD=로그인 계정 기준으로 귀속
   - 이름 → 계정 loginId 는 로스터(/api/auth op:roster)로 자동 매칭
   - fire-and-forget: 실패해도 로컬 저장/시트 전송에는 영향 없음
   ========================================================================= */
window.Records = (function(){
  let rosterCache=null, rosterAt=0;
  async function roster(){
    if(rosterCache && Date.now()-rosterAt < 300000) return rosterCache;
    try{
      const r=await fetch('/api/auth',{ method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ op:'roster' }) });
      const d=await r.json(); rosterCache=(d&&d.roster)||[]; rosterAt=Date.now();
    }catch(e){ rosterCache=rosterCache||[]; }
    return rosterCache;
  }
  const today=()=>{ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

  function post(body){
    try{ return fetch('/api/store',{ method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body) }).then(r=>r.json()).catch(()=>null); }catch(e){ return Promise.resolve(null); }
  }
  function pushRaw(dept, sheet, record){ return post({ op:'recPush', dept, sheet, record }); }

  /* CS 상담 레코드 → 서버 시트 'notes' (담당=선택된 상담사) */
  async function pushCS(rec){
    const R=await roster();
    const m=R.find(p=>p.dept==='cs' && p.name===rec.agent) || R.find(p=>p.name===rec.agent);
    const record={ ...rec, who: m?m.loginId:('@'+(rec.agent||'?')), whoName: rec.agent||'?', day: (/^\d{4}-\d{2}-\d{2}$/.test(rec.date||'')?rec.date:today()) };
    return pushRaw('cs','notes',record);
  }
  /* MD 발주 레코드 → 서버 시트 'orders' (담당=로그인 계정) */
  function pushMD(rec){
    const u=(window.Auth&&Auth.user&&Auth.user())||{};
    const dev=(window.Auth&&Auth.device&&Auth.device())||'';   // 로그인 시 저장된 표시 이름(폴백)
    if(!u.loginId && !dev) return;                              // 로그인 안 된 상태면 서버 귀속 생략(유령 'MD' 방지)
    const name = u.name || dev || u.loginId;
    const record={ ...rec, who: u.loginId||('@'+name), whoName: name, day: (/^\d{4}-\d{2}-\d{2}$/.test(rec.date||'')?rec.date:today()) };
    return pushRaw('md','orders',record);
  }
  function del(dept, sheet, id, month, who, day){ return post({ op:'recDel', dept, sheet, id, month, who, day }); }

  /* 한 달치 시트 레코드 조회 */
  async function month(dept, sheet, ym){
    try{ const r=await fetch(`/api/store?type=sheet&dept=${encodeURIComponent(dept)}&sheet=${encodeURIComponent(sheet)}&month=${encodeURIComponent(ym)}`);
      if(!r.ok) throw 0; const d=await r.json(); return (d&&d.records)||[]; }catch(e){ return null; }
  }
  return { roster, pushCS, pushMD, pushRaw, del, month };
})();
