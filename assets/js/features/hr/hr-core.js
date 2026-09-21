/* ===========================================================================
   HR 공통 — 잠금 해제(재인증) · API 래퍼 · 화면 골격
   · HR 데이터는 서버(api/hr.js)가 신원을 확인한 뒤에만 내준다.
     → 화면 진입 시 접속코드로 한 번 잠금을 풀고, 그때 받은 토큰으로만 읽고 쓴다.
   · 토큰은 sessionStorage 에만 둔다(탭을 닫으면 사라짐). 접속코드는 저장하지 않는다.
   전역: HR.session() · HR.api(op, body) · HR.guard(root, 화면키, 그리기함수)
   =========================================================================== */
(function(){
  const SKEY='eduino.hr.token';
  const meU=()=>(Auth.user&&Auth.user())||{};

  function session(){
    try{ const s=JSON.parse(sessionStorage.getItem(SKEY)||'null');
      if(s && s.token && s.exp && Date.now()<s.exp) return s;
    }catch(e){}
    return null;
  }
  function setSession(s){ try{ sessionStorage.setItem(SKEY, JSON.stringify(s)); }catch(e){} }
  function clear(){ try{ sessionStorage.removeItem(SKEY); }catch(e){} }

  async function post(payload){
    const r=await fetch('/api/hr',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    let d=null; try{ d=await r.json(); }catch(e){}
    if(!d) return { ok:false, error:'서버 응답을 읽지 못했습니다' };
    if(d.relock) clear();
    return d;
  }
  /* 데이터 호출 — 세션이 없으면 호출하지 않고 relock 을 돌려준다 */
  async function api(op, body){
    const s=session(); if(!s) return { ok:false, relock:true, error:'HR 세션이 없습니다' };
    return post({ op, token:s.token, ...(body||{}) });
  }
  const unlock=(loginId, code)=> post({ op:'unlock', loginId, code });

  /* 화면 골격 — 잠금 화면을 그렸다가, 풀리면 draw(host, session) 를 호출 */
  function guard(root, pageKey, draw){
    const u=meU();
    const host=el('div'); root.appendChild(host);
    function run(){
      const s=session();
      if(!s){ lockScreen(); return; }
      if((s.scope&&s.scope.r||[]).indexOf(pageKey)<0){ denyScreen(s); return; }
      host.innerHTML='';
      draw(host, { ...s, canWrite:(s.scope&&s.scope.w||[]).indexOf(pageKey)>=0, relock:()=>{ clear(); run(); } });
    }
    function denyScreen(s){
      host.innerHTML=`<div class="hr-lock"><div class="hr-lock-box">${icon('lock')||''}
        <div class="t">이 화면의 열람 권한이 없습니다</div>
        <div class="d"><b>${esc(s.me&&s.me.name||'')}</b> 계정에는 이 화면 권한이 부여되어 있지 않습니다.<br>필요하시면 관리자에게 요청하세요.</div>
        <div class="a"><button class="btn ghost sm" id="hrRelock">다른 계정으로 잠금 해제</button></div></div></div>`;
      host.querySelector('#hrRelock').onclick=()=>{ clear(); run(); };
    }
    function lockScreen(){
      host.innerHTML=`<div class="hr-lock"><div class="hr-lock-box">${icon('shield')||icon('lock')||''}
        <div class="t">HR 자료 잠금</div>
        <div class="d">인사·급여 관련 자료는 <b>접속코드를 한 번 더 확인</b>한 뒤 열립니다.<br>
          확인된 세션은 이 브라우저 탭에서만 유지되며, 탭을 닫으면 자동으로 잠깁니다.</div>
        <div class="hr-lock-f">
          <input id="hrId" value="${esc(u.loginId||'')}" placeholder="아이디" autocomplete="username">
          <input id="hrCode" type="password" placeholder="접속코드" autocomplete="current-password">
          <button class="btn pri" id="hrGo">${icon('lock')||''}잠금 해제</button>
        </div>
        <div class="hr-msg" id="hrMsg"></div></div></div>`;
      const $=s=>host.querySelector(s);
      const go=async()=>{
        const id=($('#hrId').value||'').trim(), code=$('#hrCode').value||'';
        if(!id||!code){ $('#hrMsg').innerHTML='<span class="bad">아이디와 접속코드를 입력하세요.</span>'; return; }
        $('#hrGo').disabled=true; $('#hrMsg').textContent='확인 중…';
        const d=await unlock(id, code);
        if(!d.ok){ $('#hrGo').disabled=false; $('#hrMsg').innerHTML=`<span class="bad">${esc(d.error||'해제 실패')}</span>`; return; }
        setSession({ token:d.token, exp:d.exp, me:d.me, scope:d.scope });
        run();
      };
      $('#hrGo').onclick=go;
      $('#hrCode').onkeydown=e=>{ if(e.key==='Enter') go(); };
      if(u.loginId) $('#hrCode').focus(); else $('#hrId').focus();
    }
    run();
  }

  /* HR 화면 공통 머리말 — 누가 열었는지·언제 잠기는지 항상 보이게 */
  function headBar(s){
    const left=Math.max(0, Math.round((s.exp-Date.now())/60000));
    return `<div class="hr-who">${icon('shield')||''}
      <b>${esc(s.me&&s.me.name||'')}</b> 님으로 열람 중
      <span class="muted">· ${left>=60?Math.floor(left/60)+'시간 '+(left%60)+'분':left+'분'} 후 자동 잠금</span>
      <button class="btn ghost sm" data-hr="lock">${icon('lock')||''}지금 잠그기</button></div>`;
  }
  function wireHead(scope, s){
    const b=scope.querySelector('[data-hr=lock]'); if(b) b.onclick=()=>{ clear(); s.relock(); };
  }

  const CSS=`
    .hr-lock{display:flex;justify-content:center;padding:40px 16px}
    .hr-lock-box{max-width:460px;width:100%;text-align:center;border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:28px 24px;box-shadow:var(--sh-sm)}
    .hr-lock-box svg{width:34px;height:34px;color:var(--muted)}
    .hr-lock-box .t{font-size:16px;font-weight:800;margin:10px 0 6px}
    .hr-lock-box .d{font-size:12.5px;color:var(--muted);line-height:1.6}
    .hr-lock-f{display:flex;gap:6px;margin-top:16px;flex-wrap:wrap}
    .hr-lock-f input{flex:1;min-width:120px;width:auto;height:38px}
    .hr-lock-f .btn{white-space:nowrap}
    .hr-msg{font-size:12.5px;color:var(--muted);margin-top:10px;min-height:18px}
    .hr-msg .bad{color:var(--danger);font-weight:700}
    .hr-who{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--ink-2);background:var(--panel-2);border:1px solid var(--line-2);border-radius:9px;padding:7px 12px;margin-bottom:14px}
    .hr-who .btn{margin-left:auto}`;

  window.HR={ session, clear, api, unlock, guard, headBar, wireHead, CSS };
})();
