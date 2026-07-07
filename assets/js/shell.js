/* ===========================================================================
   앱 셸: 사이드바 · 상단바 · 상태바 렌더 + 해시 라우팅
   모듈은 window.MODULES[key] = { title, subtitle, icon, flush?, render(el) } 로 등록
   =========================================================================== */
window.MODULES = window.MODULES || {};

function bootShell(){
  const me = requireAuth('');
  if(!me) return;

  const app = el('div','app'); app.id='app';
  app.innerHTML = `
    <aside class="side">
      <button class="side-brand" id="brandBtn" title="홈으로 이동">
        <img class="brand-mark" src="assets/brand/eduino-mark.svg" alt="에듀이노">
        <span class="nm"><b>에듀이노</b><small>통합 업무관리</small></span></button>
      <nav class="side-nav sc" id="nav"></nav>
      <div class="side-foot">
        <button class="btn ghost block" id="btnLogout" style="justify-content:flex-start">${icon('logout')}<span class="txt">로그아웃</span></button>
      </div>
    </aside>
    <header class="top">
      <div class="navtoggle" id="navToggle" title="메뉴 접기/펼치기">${icon('menu')}</div>
      <div class="crumb" id="crumb"></div>
      <div class="sp"></div>
      <div class="quicklinks" id="quicklinks"></div>
      <div class="presence" id="presence" title="실시간 접속자 현황은 공용 서버 연동(예정) 후 표시됩니다">
        <span class="dot"></span><span id="presenceTxt">이 기기만 접속 중</span></div>
      <div class="device">
        <div class="av" id="devAv"></div>
        <div class="meta"><b id="devName"></b><br><small>이 PC</small></div>
      </div>
    </header>
    <main class="main sc" id="main"></main>
    <footer class="status" id="status"></footer>
    <div class="app-intro" id="appIntro">
      <div class="ai-mark"><img src="assets/brand/eduino-mark.svg" alt="에듀이노"><div class="ai-nm">${esc(APP_NAME_FULL)}</div></div>
    </div>`;
  document.body.innerHTML=''; document.body.appendChild(app);

  // 상단 사내 바로가기 링크
  const ql=$('quicklinks');
  (typeof QUICK_LINKS!=='undefined'?QUICK_LINKS:[]).forEach(l=>{
    const a=el('a','qlink'); a.href=l.url; a.target='_blank'; a.rel='noopener noreferrer'; a.title=l.name;
    a.innerHTML=`${icon('external')}<span>${esc(l.name)}</span>`; ql.appendChild(a);
  });

  // 로고 클릭 → 인트로 재생 후 홈으로
  const intro=$('appIntro');
  function playIntro(then){ intro.classList.add('show'); setTimeout(()=>{ intro.classList.remove('show'); if(then)then(); }, 1400); }
  $('brandBtn').onclick=()=>playIntro(()=>{ location.hash=''; });

  // 기기 정보
  $('devName').textContent = me.device;
  $('devAv').textContent = me.device.replace(/[^0-9A-Za-z가-힣]/g,'').slice(0,2).toUpperCase() || 'PC';

  // 내비게이션
  const DEPT_COLOR = { cs:'#4d9bff', md:'#ff5257', design:'#b07cff', acct:'#42c98a' };
  const nav = $('nav');
  NAV.forEach(g=>{
    const grp = el('div','nav-group');
    grp.style.setProperty('--dept', DEPT_COLOR[g.dept]||'#8b93a1');
    grp.innerHTML = `<div class="nav-glabel">${icon(g.icon)}<span class="txt">${esc(g.name)} · ${esc(g.full)}</span>
      ${g.soon?'<span class="badge soon cnt">예정</span>':''}</div>`;
    g.items.forEach(it=>{
      const soon = g.soon || it.soon;
      const item = el('div','nav-item'+(soon?' soon':''));
      item.dataset.key = it.key;
      item.innerHTML = `${icon(it.icon||'chevron')}<span class="txt">${esc(it.name)}</span>${soon?'<span class="badge soon">예정</span>':''}`;
      if(!soon) item.onclick = ()=>{ location.hash = it.key; };
      else item.onclick = ()=>toast('개발 예정 기능입니다');
      grp.appendChild(item);
    });
    nav.appendChild(grp);
  });

  $('btnLogout').onclick = ()=>{ Auth.logout(); location.href='index.html'; };
  $('navToggle').onclick = ()=>app.classList.toggle('nav-collapsed');
  $('presence').onclick = ()=>toast('여러 PC의 실시간 접속 현황은 서버 연동(개발 예정) 후 제공됩니다');

  function firstKey(){ for(const g of NAV) if(!g.soon) for(const it of g.items) if(!it.soon) return it.key; }

  function route(){
    const key = location.hash.replace('#','') || firstKey();
    const mod = MODULES[key];
    // 활성 표시
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('on', n.dataset.key===key));
    const main = $('main');
    if(!mod){ main.className='main sc'; main.innerHTML=`<div class="view"><div class="empty">${icon('info')}<div>준비 중인 기능입니다.</div></div></div>`; setCrumb(key); return; }
    setCrumb(key, mod);
    main.className = 'main sc'+(mod.flush?' flush':'');
    main.style.position = mod.flush?'relative':'';
    main.style.overflow = '';   // 모듈이 자체 스크롤을 쓰면 render 안에서 재설정
    main.innerHTML='';
    mod.render(main, { me });
  }
  function setCrumb(key, mod){
    const [dept] = key.split('.');
    const g = NAV.find(x=>x.dept===dept);
    $('crumb').innerHTML = `<span class="s">${esc(g?g.name:'')}</span>${icon('chevron')}
      <span class="t">${esc(mod?mod.title:'')}</span>`;
    document.title = (mod?mod.title+' · ':'')+APP_NAME;
  }
  function setStatus(){
    $('status').innerHTML =
      `<div class="seg">${icon('monitor')}<span>기기</span><b>${esc(me.device)}</b></div>
       <div class="seg ok">${icon('check')}<span>접속 코드 인증됨</span></div>
       <div class="seg">${icon('users')}<span>접속</span><b>1</b><span>(이 기기)</span></div>
       <div class="sp"></div>
       <div class="seg">${esc(APP_NAME)} · 초안(Draft)</div>`;
  }

  window.addEventListener('hashchange', route);
  setStatus(); route();
}
document.addEventListener('DOMContentLoaded', bootShell);
