/* ===========================================================================
   CS · 상품 조회
   - 이카운트 품목 카탈로그(/api/catalog)를 상품코드·상품명으로 빠르게 검색.
   - 고객이 "이 상품 코드가 뭐예요? / 이 상품 있어요?" 물어볼 때 CS가 즉시 확인.
   - 조회 전용(수정 없음). MD 발주와 동일한 카탈로그를 공유하므로 항상 최신.
   =========================================================================== */
(function(){
  MODULES['cs.lookup'] = {
    title:'상품 조회', icon:'search',
    render(root){
      root.innerHTML=`
        <style>
          .lk-wrap{max-width:960px}
          .lk-search{position:relative}
          .lk-search .ic{position:absolute;left:15px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none;display:flex}
          .lk-search .ic svg{width:19px;height:19px}
          .lk-search input{height:56px;font-size:17px;padding:0 16px 0 46px;border-width:1.5px}
          .lk-search input:focus{border-color:var(--brand,#1f56a3);box-shadow:0 0 0 4px rgba(31,86,163,.12)}
          .lk-meta{font-size:12.5px;color:var(--muted);margin:10px 2px 0;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
          .lk-res{margin-top:18px;border:1px solid var(--line);border-radius:11px;overflow:hidden;box-shadow:var(--sh-sm)}
          .lk-res table{width:100%;border-collapse:collapse}
          .lk-res th{background:#eef1f5;font-size:12px;color:var(--muted);text-align:left;padding:10px 14px;font-weight:700}
          .lk-res td{padding:11px 14px;border-top:1px solid var(--line);font-size:14px;vertical-align:middle}
          .lk-res tbody tr:hover{background:var(--active-bg)}
          .lk-code{font-family:var(--mono);font-weight:800;letter-spacing:.02em;white-space:nowrap}
          .lk-copy{opacity:0;transition:.12s}
          .lk-res tbody tr:hover .lk-copy{opacity:1}
          .lk-empty{padding:44px 20px;text-align:center;color:var(--muted)}
          .lk-empty svg{width:34px;height:34px;opacity:.4;margin-bottom:10px}
          mark{background:#fff2a8;color:inherit;border-radius:2px;padding:0 1px}
        </style>
        <div class="mhead pad"><div class="mhead-row">
          <div><div class="tt">상품 조회</div>
            <div class="ds">이카운트 품목을 상품코드 또는 상품명으로 검색합니다. 고객 문의 응대 시 코드·품명을 바로 확인하세요.</div></div>
        </div></div>
        <div class="mbody"><div class="lk-wrap">
          <div class="lk-search"><span class="ic">${icon('search')}</span>
            <input type="text" id="lkQ" placeholder="상품코드 또는 상품명 검색 (예: 아두이노, A-1)" autocomplete="off" autofocus></div>
          <div class="lk-meta" id="lkMeta"></div>
          <div class="lk-res" id="lkRes" style="display:none"><table><thead><tr>
            <th style="width:180px">상품코드</th><th>품명</th><th style="width:70px"></th></tr></thead>
            <tbody id="lkBody"></tbody></table></div>
          <div class="lk-empty" id="lkHint">${icon('search')}<div>검색어를 입력하면 결과가 표시됩니다.</div></div>
        </div></div>`;

      const qEl=root.querySelector('#lkQ'), metaEl=root.querySelector('#lkMeta');
      const resBox=root.querySelector('#lkRes'), tbody=root.querySelector('#lkBody'), hint=root.querySelector('#lkHint');

      // 카탈로그 규모·최신화 시각 표시
      fetch('/api/catalog?type=meta').then(r=>r.json()).then(d=>{ if(!root.isConnected||!d||!d.ok) return;
        const when=d.updatedAt?new Date(d.updatedAt).toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'-';
        metaEl.innerHTML=`<span>총 <b>${fmtNum(d.count||0)}</b>개 품목</span><span>·</span><span>최신화 ${esc(when)}</span><span>·</span><span>매일 00시 이카운트 자동 반영</span>`;
      }).catch(()=>{});

      const hl=(s,term)=>{ s=String(s||''); if(!term) return esc(s);
        const i=s.toLowerCase().indexOf(term.toLowerCase()); if(i<0) return esc(s);
        return esc(s.slice(0,i))+'<mark>'+esc(s.slice(i,i+term.length))+'</mark>'+esc(s.slice(i+term.length)); };

      let seq=0, timer=null;
      function showHint(html){ resBox.style.display='none'; hint.style.display=''; hint.innerHTML=html; }
      async function run(term){
        const my=++seq;
        if(!term){ showHint(`${icon('search')}<div>검색어를 입력하면 결과가 표시됩니다.</div>`); return; }
        showHint(`${icon('cloud')}<div>검색 중…</div>`);
        let d=null; try{ const r=await fetch('/api/catalog?limit=50&q='+encodeURIComponent(term)); d=await r.json(); }catch(e){}
        if(my!==seq||!root.isConnected) return;                       // 최신 검색만 반영
        if(!d||!d.ok){ showHint(`${icon('alert')}<div>조회에 실패했습니다. 잠시 후 다시 시도하세요.</div>`); return; }
        const items=d.items||[];
        if(!items.length){ showHint(`${icon('search')}<div>"${esc(term)}"에 해당하는 상품이 없습니다.</div>`); return; }
        hint.style.display='none'; resBox.style.display='';
        tbody.innerHTML=items.map(p=>`<tr>
          <td class="lk-code">${hl(p.selfCode,term)}</td>
          <td>${hl(p.name,term)||'<span class="muted">(품명 없음)</span>'}</td>
          <td><button class="btn ghost sm lk-copy" data-c="${esc(p.selfCode)}">${icon('copy')}</button></td></tr>`).join('');
        if(d.total>items.length) tbody.insertAdjacentHTML('beforeend',
          `<tr><td colspan="3" class="muted" style="text-align:center;font-size:12.5px">상위 ${items.length}건 표시 · 전체 ${fmtNum(d.total)}건 — 검색어를 더 구체적으로 입력하세요.</td></tr>`);
        tbody.querySelectorAll('.lk-copy').forEach(b=>b.onclick=()=>{ copyText(b.dataset.c); toast('상품코드 복사: '+b.dataset.c); });
      }
      qEl.oninput=()=>{ const t=qEl.value.trim(); clearTimeout(timer); timer=setTimeout(()=>run(t), 220); };
      qEl.onkeydown=e=>{ if(e.key==='Enter'){ clearTimeout(timer); run(qEl.value.trim()); } };
      qEl.focus();
    }
  };
})();
