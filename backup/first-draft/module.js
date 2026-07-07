/* ===========================================================================
   부서 모듈 공용 렌더러
   - 각 부서 index.html 은 initModule(deptKey, tools) 만 호출하면 됩니다.
   - tools: { featureKey: { title, render(container) } }
     'live' 기능 타일을 누르면 랜딩을 숨기고 해당 툴 패널을 인라인으로 띄웁니다.
   =========================================================================== */
function initModule(deptKey, tools){
  const BASE = '../../';                 // 모듈 페이지 → 루트
  const user = requireAuth(BASE);
  if(!user) return;

  const dept = DEPT_MAP[deptKey];
  document.title = `${dept.name} · Eduino Works`;

  // 셸
  renderAppbar($('appbar'), user, BASE);

  const root = $('modRoot');

  function landing(){
    const feats = FEATURES[deptKey] || [];
    root.innerHTML = `
      <nav class="crumbs">
        <a href="${BASE}dashboard.html">홈</a><span class="sep">›</span>
        <span style="color:var(--ink);font-weight:600">${esc(dept.name)} · ${esc(dept.full)}</span>
      </nav>
      <div class="wrap">
        <div class="section-title">${dept.icon} ${esc(dept.full)} 편의기능</div>
        <div class="grid cols3" id="featGrid"></div>
      </div>`;
    const grid = $('featGrid');
    feats.forEach(f => {
      const live = f.status === 'live';
      const t = el('div', 'tile '+dept.cls+(live?'':' soon'));
      t.innerHTML = `<div class="accent"></div>
        <div style="display:flex;align-items:center;gap:.6em">
          <span class="ic">${f.icon}</span><h4>${esc(f.name)}</h4>
          <span class="badge ${live?'live':'soon'}" style="margin-left:auto">${live?'동작':'예정'}</span>
        </div>
        <div class="desc">${esc(f.desc)}</div>`;
      if(live){
        t.onclick = () => {
          if(f.href && f.href.indexOf('#') === -1){ location.href = f.href; return; } // 별도 파일(예: 상품툴)
          const key = (f.href||'').split('#')[1] || f.key;
          location.hash = key;
        };
      }
      grid.appendChild(t);
    });
  }

  function openTool(key){
    const tool = tools[key];
    if(!tool){ location.hash=''; return; }
    root.innerHTML = `
      <nav class="crumbs">
        <a href="${BASE}dashboard.html">홈</a><span class="sep">›</span>
        <a href="#" id="crumbDept">${esc(dept.name)}</a><span class="sep">›</span>
        <span style="color:var(--ink);font-weight:600">${esc(tool.title)}</span>
      </nav>
      <div class="wrap" id="toolBody"></div>`;
    $('crumbDept').onclick = (e)=>{ e.preventDefault(); location.hash=''; };
    tool.render($('toolBody'));
  }

  function route(){
    const key = location.hash.replace('#','');
    if(key && tools[key]) openTool(key);
    else landing();
  }
  window.addEventListener('hashchange', route);
  route();
}
