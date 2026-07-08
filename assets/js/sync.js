/* ===========================================================================
   공용 저장소(구글 Apps Script) 클라이언트 — 팀 설정 공유 + 접속자 현황
   - 무거운 데이터가 아니라 "팀 공통 설정"과 "접속 하트비트"만 다룹니다.
   - POST 는 Apps Script CORS 특성상 no-cors(응답 확인 불가)로 보냅니다.
   - GET 은 JSON 을 읽을 수 있어 설정/접속자 목록을 받아옵니다.
   =========================================================================== */
window.SyncStore = (function(){
  const cfgDB = ()=>store(STORE.syncCfg);
  const getCfg = ()=>cfgDB().get({ url:'', autoPull:false, autoPush:true });
  const setCfg = (v)=>cfgDB().set(v);
  const configured = ()=>!!(getCfg().url);
  let pulling = false;   // pull 중 auto-push 억제

  async function post(body){
    const cfg=getCfg(); if(!cfg.url) throw new Error('공용 저장소 URL 미설정');
    const opts={ method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify(body) };
    try{
      const res=await fetch(cfg.url, opts);
      let data=null; try{ data=await res.json(); }catch{}
      if(data && data.ok===false) throw new Error(data.error||'처리 실패');
      return data||{ok:true, unconfirmed:true};
    }catch(err){
      if(/failed to fetch|networkerror|load failed|cors/i.test(err.message||'')){
        await fetch(cfg.url, {...opts, mode:'no-cors'}); return { ok:true, unconfirmed:true };
      }
      throw err;
    }
  }
  async function get(type){
    const cfg=getCfg(); if(!cfg.url) throw new Error('공용 저장소 URL 미설정');
    const res=await fetch(cfg.url+(cfg.url.includes('?')?'&':'?')+'type='+type, {method:'GET'});
    if(!res.ok) throw new Error('HTTP '+res.status);
    return res.json();
  }

  /* 로컬의 팀 공통 설정을 공용 저장소로 올림 */
  async function pushSettings(){
    const entries={};
    SHARED_SETTING_KEYS.forEach(k=>{ const v=localStorage.getItem(k); if(v!=null) entries[k]=v; });
    if(!Object.keys(entries).length) return { ok:true, saved:0 };
    const device=store(STORE.device).get('');
    const r=await post({ op:'setSettings', entries, device });
    return { ok:true, saved:Object.keys(entries).length, unconfirmed:r&&r.unconfirmed };
  }
  /* 공용 저장소의 설정을 로컬로 받아 적용 (팀 공통 키만) */
  async function pullSettings(){
    const d=await get('settings'); const s=(d&&d.settings)||{};
    let n=0; pulling=true;
    try{ SHARED_SETTING_KEYS.forEach(k=>{ if(s[k]!=null){ localStorage.setItem(k, s[k]); n++; } }); }
    finally{ pulling=false; }
    return { ok:true, applied:n };
  }

  /* 공용 컬렉션(처리대기 큐·상담이력 공유 등) */
  async function collGet(coll){ try{ const d=await get('coll&coll='+encodeURIComponent(coll)); return (d&&d.items)||[]; }catch{ return null; } }
  async function collPush(coll,item){ return post({ op:'collPush', coll, item }); }
  async function collDel(coll,id){ return post({ op:'collDel', coll, id }); }
  /* 접속 하트비트 (fire-and-forget) */
  async function beat(){ const device=store(STORE.device).get(''); if(!device) return;
    try{ await post({ op:'presence', device }); }catch{} }
  /* 현재 접속자 목록 */
  async function presence(){ try{ const d=await get('presence'); return (d&&d.presence)||[]; }catch{ return null; } }

  /* 설정 자동 동기화: 팀 공통 설정이 바뀌면 공용에 자동 업로드(1.5초 디바운스) */
  let pushTimer=null;
  const _origSet = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function(k, v){
    _origSet(k, v);
    if(!pulling && configured() && getCfg().autoPush!==false && SHARED_SETTING_KEYS.indexOf(k)>=0){
      clearTimeout(pushTimer); pushTimer=setTimeout(()=>{ pushSettings().catch(()=>{}); }, 1500);
    }
  };

  return { getCfg, setCfg, configured, pushSettings, pullSettings, beat, presence, collGet, collPush, collDel };
})();
