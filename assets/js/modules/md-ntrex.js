/* ===========================================================================
   MD · 엔티렉스 가격비교 자동 알림
   - VPS 크롤러가 매일 1회 엔티렉스 홈페이지의 '현재 판매가'를 조회 → 공급가표의
     기준 판매가와 다르면 diff 로 KV(coll 'ntrex')에 올림
   - 이 화면은 그 변동분을 알림으로 보여주고, [공급가 요청] 버튼으로 엔티렉스
     담당자에게 공급가 요청 메일을 보냄(메일 앱 자동 작성 · 메일플러그 연동 시 자동전송)
   - 취급 상품(공급가표)·메일 양식(관리자)도 함께 관리
   ========================================================================= */
(function(){
  const FIELDS = window.NTREX_FIELDS || ['ed','ntx','name','price','supply','retail','note'];
  const toObj = a => { const o={}; FIELDS.forEach((k,i)=>o[k]=a[i]); return o; };
  const PRODUCTS = (window.NTREX_PRODUCTS||[]).map(toObj);
  const byNtx = {}; PRODUCTS.forEach(p=>{ if(p.ntx) byNtx[String(p.ntx)]=p; });
  const won = n => Number(n||0).toLocaleString();
  const isAdmin = ()=>!!(Auth.isAdmin&&Auth.isAdmin());
  const COLL='ntrex';
  const mailCfg = ()=> Object.assign({}, NTREX_MAIL_DEFAULT, store(STORE.ntrexMailCfg).get({})||{});

  async function collGet(){ try{ const r=await fetch('/api/store?type=coll&coll='+COLL); if(!r.ok) throw 0; const d=await r.json(); return (d&&d.items)||[]; }catch(e){ return null; } }

  // 메일 본문 토큰 치환
  function fillMail(cfg, p, link){
    const rep = s => String(s||'').replace(/\{ntx\}/g,p.ntx||'').replace(/\{name\}/g,p.name||'').replace(/\{ed\}/g,p.ed||'').replace(/\{link\}/g,link||'');
    return { to:cfg.to, subject:rep(cfg.subject), body:rep(cfg.body) };
  }
  function sendMail(p, link){
    const m=fillMail(mailCfg(), p, link);
    const url=`mailto:${encodeURIComponent(m.to)}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
    // 메일 앱으로 작성(자동 채움) — 팝업 차단 대비 location fallback
    try{ const a=document.createElement('a'); a.href=url; a.click(); }catch(e){ location.href=url; }
    return m;
  }

  MODULES['md.ntrex'] = {
    title:'엔티렉스 가격비교', icon:'chart',
    render(root){
      let tab='alerts', diffs=[], apDay='', q='';
      const admin=isAdmin();
      root.innerHTML=`
      <style>
        .nx-kpi{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}
        .nx-k{flex:1 1 0;min-width:150px;border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--sh-sm);padding:13px 16px}
        .nx-k .l{font-size:11.5px;font-weight:700;color:var(--muted)}
        .nx-k .v{font-size:23px;font-weight:800;margin-top:3px}
        .nx-k.warn .v{color:var(--warn)} .nx-k.red .v{color:var(--red)}
        .nx-card{border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--sh-sm);padding:14px 16px;margin-bottom:12px;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center}
        .nx-card.demo{border-style:dashed;opacity:.92}
        .nx-code{font-family:var(--mono);font-weight:800;font-size:13px}
        .nx-nm{font-size:14px;font-weight:600;color:var(--ink);margin:3px 0;line-height:1.4}
        .nx-price{display:flex;gap:14px;flex-wrap:wrap;align-items:baseline;font-size:13px;color:var(--ink-2)}
        .nx-price .old{color:var(--muted);text-decoration:line-through}
        .nx-price .new{font-weight:800;color:var(--ink)}
        .nx-price .diff{font-weight:800}
        .nx-price .up{color:var(--red)} .nx-price .down{color:var(--ok)}
        .nx-badge{font-size:11px;font-weight:800;padding:2px 8px;border-radius:6px;background:var(--warn-bg);color:var(--warn)}
        .nx-empty{padding:40px;text-align:center;color:var(--muted)}
        table.nx-t{border-collapse:collapse;width:100%;font-size:12.5px}
        table.nx-t th{position:sticky;top:0;background:var(--panel-2);color:var(--ink-2);font-size:11px;font-weight:800;text-align:left;padding:8px 10px;border-bottom:1px solid var(--line-2);white-space:nowrap}
        table.nx-t td{padding:7px 10px;border-bottom:1px solid var(--line);color:var(--ink-2)}
        table.nx-t td.num{text-align:right;font-variant-numeric:tabular-nums}
        .nx-wrap{border:1px solid var(--line);border-radius:12px;overflow:auto;max-height:calc(100vh - 340px);background:var(--panel)}
        .nx-note{border-left:4px solid var(--info);background:var(--info-bg);border-radius:0 10px 10px 0;padding:12px 16px;margin-bottom:14px;font-size:13px;color:var(--ink-2)}
        .nx-ta{width:100%;min-height:150px;font:inherit;border:1px solid var(--line-2);border-radius:8px;padding:10px;line-height:1.6}
      </style>
      <div class="mhead">
        <div class="tt">엔티렉스 가격비교</div>
        <div class="ds">매일 엔티렉스 판매가를 확인해 <b>변동된 상품</b>을 알려드립니다. 확인 후 <b>[공급가 요청]</b>으로 담당자에게 메일을 보내세요.</div>
        <div class="mtabs">
          <div class="t" data-t="alerts">가격 변동 알림</div>
          <div class="t" data-t="list">취급 상품 <span class="muted">(${PRODUCTS.length})</span></div>
          ${admin?'<div class="t" data-t="mail">메일 양식</div>':''}
        </div>
      </div>
      <div class="mbody wide" id="nxBody"><div class="muted" style="padding:18px">불러오는 중…</div></div>`;
      const body=root.querySelector('#nxBody');
      root.querySelectorAll('.mtabs .t').forEach(t=>{ t.classList.toggle('on',t.dataset.t===tab);
        t.onclick=()=>{ tab=t.dataset.t; root.querySelectorAll('.mtabs .t').forEach(x=>x.classList.toggle('on',x.dataset.t===tab)); draw(); }; });

      function draw(){ return tab==='alerts'?drawAlerts(): tab==='list'?drawList(): drawMail(); }

      /* ---------------- 가격 변동 알림 ---------------- */
      function diffRow(d, demo){
        const p=byNtx[String(d.ntx)]||d; const up=(d.newPrice||0)>=(d.oldPrice||0);
        const link=d.link||'';
        return `<div class="nx-card${demo?' demo':''}">
          <div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span class="nx-code">${esc(p.ed||'-')}</span>
              <span class="muted" style="font-size:12px">엔티렉스 ${esc(d.ntx||'')}</span>
              ${demo?'<span class="nx-badge">예시(크롤러 연동 전 미리보기)</span>':'<span class="nx-badge">판매가 변동</span>'}
            </div>
            <div class="nx-nm">${esc(p.name||d.name||'')}</div>
            <div class="nx-price">
              <span>엔티렉스 판매가 <span class="old">${won(d.oldPrice)}원</span> → <span class="new">${won(d.newPrice)}원</span></span>
              <span class="diff ${up?'up':'down'}">${up?'▲':'▼'} ${won(Math.abs((d.newPrice||0)-(d.oldPrice||0)))}원</span>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
            <button class="btn pri sm" data-a="mail" data-ntx="${esc(d.ntx||'')}" data-link="${esc(link)}">${icon('mail')}공급가 요청</button>
            <button class="btn ghost sm" data-a="copy" data-ntx="${esc(d.ntx||'')}" data-link="${esc(link)}">${icon('copy')}메일 내용 복사</button>
          </div>
        </div>`;
      }
      function drawAlerts(){
        const real=diffs&&diffs.length;
        // 크롤러 연동 전: 실제 데이터가 없으면 미리보기 예시 1건(판매가 있는 상품 기준)
        let demo=false, rows=diffs;
        if(!real){ const s=PRODUCTS.find(p=>p.price>0); demo=!!s;
          rows = s?[{ntx:s.ntx,name:s.name,oldPrice:s.price,newPrice:Math.round(s.price*1.05),link:''}]:[]; }
        body.innerHTML=`
          ${apDay?`<div class="nx-note">최근 확인: <b>${esc(apDay)}</b> · 변동 <b>${diffs.length}</b>건</div>`:
            `<div class="nx-note">${icon('alert')} 아직 크롤러가 연동되지 않아 <b>예시 미리보기</b>를 보여드립니다. VPS 크롤러가 매일 판매가를 확인하면 실제 변동분이 여기에 자동으로 표시됩니다.</div>`}
          <div class="nx-kpi">
            <div class="nx-k red"><div class="l">가격 변동</div><div class="v">${real?diffs.length:0}<span style="font-size:14px">건</span></div></div>
            <div class="nx-k"><div class="l">취급 상품</div><div class="v">${PRODUCTS.length}</div></div>
            <div class="nx-k warn"><div class="l">기준가 없음(비교대기)</div><div class="v">${PRODUCTS.filter(p=>!p.price).length}</div></div>
          </div>
          <div id="nxAlertList">${rows.length?rows.map(d=>diffRow(d,demo)).join(''):`<div class="nx-empty">${icon('check2')}<div>오늘 가격 변동이 없습니다.</div></div>`}</div>`;
        body.querySelectorAll('[data-a=mail]').forEach(b=>b.onclick=()=>{ const p=byNtx[b.dataset.ntx]||{ntx:b.dataset.ntx}; sendMail(p,b.dataset.link); toast('메일 작성 화면을 열었습니다'); });
        body.querySelectorAll('[data-a=copy]').forEach(b=>b.onclick=()=>{ const p=byNtx[b.dataset.ntx]||{ntx:b.dataset.ntx}; const m=fillMail(mailCfg(),p,b.dataset.link); copyText(`받는사람: ${m.to}\n제목: ${m.subject}\n\n${m.body}`); });
      }

      /* ---------------- 취급 상품(공급가표) ---------------- */
      function drawList(){
        body.innerHTML=`
          <div style="margin-bottom:12px"><input type="search" id="nxQ" placeholder="에듀이노코드·엔티렉스코드·상품명 검색" style="height:40px;width:100%;max-width:460px;border:1px solid var(--line-2);border-radius:8px;padding:0 12px" value="${esc(q)}"></div>
          <div class="nx-wrap"><table class="nx-t">
            <thead><tr><th>에듀이노코드</th><th>엔티렉스코드</th><th>상품명</th><th style="text-align:right">판매가(기준)</th><th style="text-align:right">공급가</th><th style="text-align:right">소비자가</th><th>비고</th></tr></thead>
            <tbody id="nxTb"></tbody></table></div>`;
        const tb=body.querySelector('#nxTb');
        function paint(){ const s=q.trim().toLowerCase();
          const list=PRODUCTS.filter(p=>!s||[p.ed,p.ntx,p.name].some(v=>String(v).toLowerCase().includes(s))).slice(0,1500);
          tb.innerHTML=list.map(p=>`<tr><td class="nx-code">${esc(p.ed)}</td><td>${esc(p.ntx)}</td><td>${esc(p.name)}</td>
            <td class="num">${p.price?won(p.price)+'원':'<span class="muted">-</span>'}</td><td class="num">${won(p.supply)}원</td><td class="num">${won(p.retail)}원</td><td class="muted">${esc(p.note||'')}</td></tr>`).join('')
            || `<tr><td colspan="7" class="nx-empty">검색 결과가 없습니다.</td></tr>`; }
        body.querySelector('#nxQ').oninput=e=>{ q=e.target.value; paint(); };
        paint();
      }

      /* ---------------- 메일 양식(관리자) ---------------- */
      function drawMail(){
        const c=mailCfg();
        body.innerHTML=`
          <div class="nx-note">공급가 요청 메일 양식입니다. 토큰 <b>{ntx}</b>(엔티렉스코드) · <b>{name}</b>(상품명) · <b>{ed}</b>(에듀이노코드) · <b>{link}</b>(상품링크)는 전송 시 실제 값으로 치환됩니다.</div>
          <div style="max-width:720px;display:flex;flex-direction:column;gap:12px">
            <label class="fld">받는사람(엔티렉스 담당자)<input type="text" id="mTo" value="${esc(c.to)}"></label>
            <label class="fld">제목<input type="text" id="mSub" value="${esc(c.subject)}"></label>
            <label class="fld">내용<textarea id="mBody" class="nx-ta">${esc(c.body)}</textarea></label>
            <div style="display:flex;gap:8px;align-items:center">
              <button class="btn pri" id="mSave">${icon('save')}저장(MD 공유)</button>
              <button class="btn" id="mPrev">미리보기</button>
              <span class="muted" id="mStat" style="font-size:12.5px"></span>
            </div>
            <div id="mPrevBox"></div>
          </div>`;
        body.querySelector('#mSave').onclick=()=>{ store(STORE.ntrexMailCfg).set({ to:body.querySelector('#mTo').value.trim(), toName:c.toName, subject:body.querySelector('#mSub').value, body:body.querySelector('#mBody').value });
          body.querySelector('#mStat').innerHTML='<span style="color:var(--ok)">저장됨(MD 공유)</span>'; toast('메일 양식 저장'); };
        body.querySelector('#mPrev').onclick=()=>{ const s=PRODUCTS.find(p=>p.price>0)||PRODUCTS[0]||{ntx:'0000',name:'샘플상품',ed:'P-T000'};
          const cfg={to:body.querySelector('#mTo').value.trim(),subject:body.querySelector('#mSub').value,body:body.querySelector('#mBody').value};
          const m=fillMail(cfg,s,'https://...'); body.querySelector('#mPrevBox').innerHTML=`<div class="nx-card" style="display:block"><div class="muted" style="font-size:12px">받는사람: ${esc(m.to)} · 제목: ${esc(m.subject)}</div><pre style="white-space:pre-wrap;font:inherit;margin:8px 0 0">${esc(m.body)}</pre></div>`; };
      }

      async function load(){
        const items=await collGet();
        if(!root.isConnected) return;
        const list=(items||[]).filter(d=>d&&d.type!=='mailcfg');
        list.sort((a,b)=>String(b.day||'').localeCompare(String(a.day||'')));
        const latest=list[0];
        diffs=(latest&&latest.items)||[]; apDay=(latest&&latest.day)||'';
        draw();
      }
      load();
    }
  };
})();
