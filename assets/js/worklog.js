/* ===========================================================================
   업무 로그 — CS/MD가 처리한 건을 서버(KV)에 누적 (관리자 인사이트용)
   - 저장(시트 전송=백업)과 함께 압축 이벤트 1건을 fire-and-forget 로 올림
   - CS는 '선택된 상담사' 기준, MD는 로그인 계정 기준으로 귀속
   - 이름 → 계정 loginId 는 로스터(/api/auth op:roster)로 자동 매칭
   ========================================================================= */
window.WorkLog = (function(){
  let rosterCache=null, rosterAt=0;
  async function roster(){
    if(rosterCache && Date.now()-rosterAt < 300000) return rosterCache;   // 5분 캐시
    try{
      const r=await fetch('/api/auth',{ method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ op:'roster' }) });
      const d=await r.json(); rosterCache=(d&&d.roster)||[]; rosterAt=Date.now();
    }catch(e){ rosterCache=rosterCache||[]; }
    return rosterCache;
  }
  const today=()=>{ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const rid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);

  function post(event){
    try{ return fetch('/api/store',{ method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ op:'workLog', dept:event.dept, event }) }).catch(()=>{}); }catch(e){}
  }
  /* who = 계정 loginId(매칭 시) 또는 '@이름'(미매칭) */
  async function log({ dept, who, whoName, type, day }){
    const d=(/^\d{4}-\d{2}-\d{2}$/.test(day||'')?day:today());
    const ev={ dept, id:rid(), day:d, ts:Date.now(),
      who:who||('@'+(whoName||'?')), whoName:whoName||who||'?', type:type||'' };
    return post(ev);
  }
  async function logCS(agentName, day, type){
    const R=await roster();
    const m=R.find(p=>p.dept==='cs' && p.name===agentName) || R.find(p=>p.name===agentName);
    return log({ dept:'cs', who: m?m.loginId:('@'+agentName), whoName: agentName, type:type||'상담', day });
  }
  function logMD(day, type){
    const u=(window.Auth&&Auth.user&&Auth.user())||{};
    return log({ dept:'md', who: u.loginId||('@'+(u.name||'MD')), whoName: u.name||u.loginId||'MD', type:type||'발주', day });
  }
  return { log, logCS, logMD, roster };
})();
