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
      const keys=Array.isArray(pageKey)?pageKey:[pageKey];
      const R=(s.scope&&s.scope.r)||[], W=(s.scope&&s.scope.w)||[];
      if(!keys.some(k=>R.indexOf(k)>=0)){ denyScreen(s); return; }
      host.innerHTML='';
      draw(host, { ...s, keys, has:k=>R.indexOf(k)>=0, canWrite:keys.some(k=>W.indexOf(k)>=0), relock:()=>{ clear(); run(); } });
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
    .hr-who .btn{margin-left:auto}
    .he-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}
    .he-bar select,.he-bar input{width:auto;height:34px;font:inherit;font-size:12.5px}
    .he-bar input.q{min-width:200px}
    .he-cnt{margin-left:auto;font-size:12px;font-weight:700;color:var(--muted)}
    .he-chip{font:inherit;font-size:12px;font-weight:700;border:1px solid var(--line-2);background:var(--panel);color:var(--ink-2);border-radius:16px;padding:5px 12px;cursor:pointer}
    .he-chip.on{border-color:var(--red);color:var(--red);background:var(--active-bg)}
    .he-wrap{border:1px solid var(--line);border-radius:11px;overflow:auto;background:var(--panel)}
    .he-tbl{width:100%;border-collapse:collapse;font-size:12.5px}
    .he-tbl th{text-align:left;font-size:11px;color:var(--muted);font-weight:700;padding:8px 10px;border-bottom:1px solid var(--line);background:var(--panel-2);white-space:nowrap}
    .he-tbl td{padding:8px 10px;border-bottom:1px solid var(--line-2);vertical-align:middle}
    .he-tbl td.num{text-align:right;font-variant-numeric:tabular-nums}
    .he-st{font-size:11px;font-weight:800;border-radius:6px;padding:2px 9px;white-space:nowrap}
    .he-tag{display:inline-block;font-size:11px;font-weight:700;border-radius:6px;padding:2px 8px;background:var(--panel-2);color:var(--ink-2);margin-right:4px}
    .he-f{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;align-items:end;border:1px solid var(--line);border-radius:11px;padding:12px 14px;background:var(--panel);margin-bottom:12px}
    .he-f[hidden]{display:none}
    .he-f label{display:block;font-size:11px;font-weight:800;color:var(--muted);margin-bottom:4px}
    .he-f input,.he-f select,.he-f textarea{width:100%;font:inherit;font-size:12.5px}
    .he-f input,.he-f select{height:34px} .he-f textarea{height:auto;min-height:58px;padding:7px 9px}
    .he-f .wide{grid-column:1/-1} .he-f .a{display:flex;gap:6px}
    .he-feed{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:11px}
    .he-card{border:1px solid var(--line);border-left:3px solid var(--line-2);border-radius:11px;background:var(--panel);padding:12px 14px;box-shadow:var(--sh-sm)}
    .he-card.book{border-left-color:#0a63c2} .he-card.course{border-left-color:#7c4dd6}
    .he-card .t{font-weight:800;font-size:13.5px;margin:4px 0 3px}
    .he-card .m{font-size:11.5px;color:var(--muted)}
    .he-card .c{font-size:12.5px;color:var(--ink-2);margin-top:7px;line-height:1.55;white-space:pre-wrap}
    .he-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:11px;margin-bottom:14px}
    .he-k{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:13px 15px;box-shadow:var(--sh-sm)}
    .he-k .v{font-size:22px;font-weight:800;line-height:1.1} .he-k .v small{font-size:12px;color:var(--muted);margin-left:2px}
    .he-k .l{font-size:11.5px;color:var(--muted);margin-top:5px;font-weight:600}
    .he-bw{height:8px;border-radius:5px;background:var(--line-2);overflow:hidden;margin-top:8px}
    .he-bb{height:100%;background:var(--ok)} .he-bb.warn{background:var(--warn)} .he-bb.over{background:var(--danger)}
    .he-sec{font-size:13px;font-weight:800;margin:18px 0 9px;display:flex;align-items:center;gap:8px}
    .he-sec .muted{font-weight:600;font-size:11.5px} .he-sec .btn{margin-left:auto}
    .he-empty{padding:34px;text-align:center;color:var(--muted);font-size:13px}
    .he-star{color:#e8a33d;letter-spacing:1px}
    .he-pick{border:1px solid var(--line);border-radius:11px;background:var(--panel);padding:12px 14px;margin-bottom:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
    .he-pick .n{font-weight:800;font-size:14px}
    .he-rec{border:1px solid var(--line);border-radius:11px;background:var(--panel);padding:12px 14px;margin-bottom:9px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
    .he-rec .r{font-size:11px;font-weight:800;color:#fff;background:var(--red);border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
    .he-rec .g{flex:1;min-width:180px} .he-rec .g b{font-size:13.5px} .he-rec .g div{font-size:11.5px;color:var(--muted);margin-top:2px}
    /* 공통 정렬 규칙 — 도구줄의 건수는 항상 오른쪽 끝, 표의 액션칸은 줄바꿈 없음 */
    .he-bar>.right,.he-cnt{margin-left:auto}
    .he-tbl td.act{white-space:nowrap;text-align:right}
    .he-tbl th.act{text-align:right}
    .he-tbl td.mid{text-align:center} .he-tbl th.mid{text-align:center}`;

  /* 화면 공통 골격 — 모든 HR 화면이 같은 머리말·여백·정렬을 쓰도록 한 곳에서 만든다 */
  function page(key, title, desc, draw, guardKeys){
    MODULES[key]={ title, icon:'clipboard', render(root){
      root.innerHTML=`<style>${CSS}</style>
        <div class="mhead"><div class="tt">${esc(title)}</div><div class="ds">${desc}</div></div>
        <div class="mbody wide" id="heBody"></div>`;
      guard(root.querySelector('#heBody'), guardKeys||key, draw); } };
  }
  const shell=(host,s,html)=>{ host.innerHTML=headBar(s)+html; wireHead(host,s); };
  const loading=(host,s)=>shell(host,s,`<div class="muted" style="padding:16px">불러오는 중…</div>`);
  /* 여러 데이터 묶음을 순서대로 읽는다. 권한 밖이면 빈 배열로 두고 화면은 계속 그린다. */
  async function loadMany(names, s){
    const out={};
    for(const n of names){
      const r=await api('list',{ name:n });
      if(r.relock){ s.relock(); return null; }
      out[n]=r.ok?(r.items||[]):[]; out['can_'+n]=!!(r.ok&&r.canWrite); out['self_'+n]=!!r.self; out['err_'+n]=r.ok?'':(r.error||'');
    }
    return out;
  }
  window.HR={ session, clear, api, unlock, guard, headBar, wireHead, page, shell, loading, loadMany, CSS };
})();
