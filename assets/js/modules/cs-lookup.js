/* ===========================================================================
   CS · 상품 조회
   - 이카운트 품목 카탈로그(/api/catalog)를 "상품코드"로 정확히 1건 조회.
   - 상품명 부분일치는 혼선을 주므로 제외 — 코드 기준 단건 조회만.
   - 조회 결과에 구매처명·상품분류·입고단가·출고단가까지 표시(이카운트 화면과 동일 항목).
   - 조회 전용(수정 없음). MD 발주와 동일 카탈로그 공유(매일 00시 최신화).
   =========================================================================== */
(function(){
  MODULES['cs.lookup'] = {
    title:'상품 조회', icon:'search',
    render(root){
      root.innerHTML=`
        <style>
          .lk-wrap{max-width:760px}
          .lk-search{position:relative}
          .lk-search .ic{position:absolute;left:15px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none;display:flex}
          .lk-search .ic svg{width:19px;height:19px}
          .lk-search input{height:56px;font-size:18px;font-family:var(--mono);letter-spacing:.02em;padding:0 16px 0 46px;border-width:1.5px}
          .lk-search input:focus{border-color:var(--brand,#1f56a3);box-shadow:0 0 0 4px rgba(31,86,163,.12)}
          .lk-meta{font-size:12.5px;color:var(--muted);margin:10px 2px 0;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
          .lk-card{margin-top:18px;border:1px solid var(--line);border-radius:13px;overflow:hidden;box-shadow:var(--sh-sm)}
          .lk-top{display:flex;align-items:center;gap:12px;padding:16px 18px;background:linear-gradient(0deg,var(--panel-2),var(--panel));border-bottom:1px solid var(--line)}
          .lk-top .code{font-family:var(--mono);font-weight:800;font-size:20px;letter-spacing:.02em}
          .lk-top .nm{font-size:14.5px;color:var(--ink-2);font-weight:600;line-height:1.4}
          .lk-grid{display:grid;grid-template-columns:repeat(4,1fr)}
          .lk-cell{padding:13px 16px;border-top:1px solid var(--line)}
          .lk-cell + .lk-cell{border-left:1px solid var(--line)}
          @media(max-width:620px){ .lk-grid{grid-template-columns:repeat(2,1fr)} .lk-cell:nth-child(odd){border-left:none} }
          .lk-cell .k{font-size:11.5px;color:var(--muted);font-weight:700;letter-spacing:.03em;margin-bottom:5px}
          .lk-cell .v{font-size:15px;font-weight:700;color:var(--ink)}
          .lk-cell .v.num{font-family:var(--mono)}
          .lk-cell .v .won{font-size:12px;color:var(--muted);font-weight:600;margin-left:2px}
          .lk-empty{padding:44px 20px;text-align:center;color:var(--muted)}
          .lk-empty svg{width:34px;height:34px;opacity:.4;margin-bottom:10px}
          .lk-empty.bad{color:var(--danger)}
          .lk-opts{margin-top:18px;border:1px solid var(--line);border-radius:13px;overflow:hidden;box-shadow:var(--sh-sm)}
          .lk-opts-hd{padding:12px 16px;background:var(--panel-2);border-bottom:1px solid var(--line);font-size:13px;font-weight:700;color:var(--ink-2)}
          .lk-opts-hd b{color:var(--red)}
          .lk-opt{display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid var(--line-2);cursor:pointer;transition:.12s}
          .lk-opt:first-child{border-top:none}
          .lk-opt:hover{background:var(--red-soft)}
          .lk-opt .oc{font-family:var(--mono);font-weight:800;font-size:15px;min-width:110px}
          .lk-opt .on{font-size:14px;color:var(--ink-2);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
          .lk-opt .go{color:var(--muted);display:flex}.lk-opt:hover .go{color:var(--red)}
        </style>
        <div class="mhead pad"><div class="mhead-row">
          <div><div class="tt">상품 조회</div>
            <div class="ds">이카운트 품목을 <b>상품코드</b>로 조회합니다. 고객 문의 응대 시 구매처·단가를 바로 확인하세요.</div></div>
        </div></div>
        <div class="mbody"><div class="lk-wrap">
          <div class="lk-search"><span class="ic">${icon('search')}</span>
            <input type="text" id="lkQ" placeholder="상품코드 입력 (예: P-DA39)" autocomplete="off" autofocus></div>
          <div class="lk-meta" id="lkMeta"></div>
          <div id="lkOut"><div class="lk-empty" id="lkHint">${icon('search')}<div>상품코드를 입력하면 상세 정보가 표시됩니다.</div></div></div>
        </div></div>`;

      const qEl=root.querySelector('#lkQ'), metaEl=root.querySelector('#lkMeta'), out=root.querySelector('#lkOut');

      fetch('/api/catalog?type=meta').then(r=>r.json()).then(d=>{ if(!root.isConnected||!d||!d.ok) return;
        const when=d.updatedAt?new Date(d.updatedAt).toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'-';
        metaEl.innerHTML=`<span>총 <b>${fmtNum(d.count||0)}</b>개 품목</span><span>·</span><span>최신화 ${esc(when)}</span><span>·</span><span>매일 00시 이카운트 자동 반영</span>`;
      }).catch(()=>{});

      const won=n=>`<span class="v num">${fmtNum(Number(n)||0)}<span class="won">원</span></span>`;
      const cell=(k,v)=>`<div class="lk-cell"><div class="k">${k}</div>${v}</div>`;
      const hint=(html,bad)=>{ out.innerHTML=`<div class="lk-empty${bad?' bad':''}">${html}</div>`; };

      let seq=0, timer=null;
      async function run(code){
        const my=++seq;
        if(!code){ hint(`${icon('search')}<div>상품코드를 입력하면 상세 정보가 표시됩니다.</div>`); return; }
        hint(`${icon('cloud')}<div>조회 중…</div>`);
        let d=null; try{ const r=await fetch('/api/catalog?code='+encodeURIComponent(code)); d=await r.json(); }catch(e){}
        if(my!==seq||!root.isConnected) return;                       // 최신 조회만 반영
        if(!d||!d.ok){ hint(`${icon('alert')}<div>조회에 실패했습니다. 잠시 후 다시 시도하세요.</div>`,true); return; }
        const p=d.product;
        if(!p){
          // 옵션 상품(예: P-D10-1~3) 후보가 있으면 선택 리스트 표시
          const opts=(d.options||[]);
          if(opts.length){
            out.innerHTML=`<div class="lk-opts">
              <div class="lk-opts-hd">"<b>${esc(code)}</b>" 옵션 상품 <b>${opts.length}</b>개 — 선택하세요</div>
              ${opts.map((o,i)=>`<div class="lk-opt" data-i="${i}">
                <span class="oc">${esc(o.selfCode)}</span>
                <span class="on">${o.name?esc(o.name):'<span class="muted">(품명 없음)</span>'}</span>
                <span class="go">${icon('chevron')}</span></div>`).join('')}</div>`;
            out.querySelectorAll('.lk-opt').forEach(row=>row.onclick=()=>{ const o=opts[+row.dataset.i]; qEl.value=o.selfCode; showProduct(o); });
            return;
          }
          hint(`${icon('alert')}<div>"${esc(code)}" — 미등록 상품코드입니다.<br><span style="font-size:12.5px">이카운트에 등록하면 매일 00시 자동 반영됩니다.</span></div>`,true); return;
        }
        showProduct(p);
      }
      function showProduct(p){
        const vendor=(typeof catVendorName==='function')?catVendorName(p):(p.vendor||'');
        const category=(typeof catCategoryName==='function')?catCategoryName(p):(p.category||'');
        out.innerHTML=`<div class="lk-card">
          <div class="lk-top">
            <div style="flex:1;min-width:0"><div class="code">${esc(p.selfCode)}</div>
              <div class="nm">${p.name?esc(p.name):'<span class="muted">(품명 없음)</span>'}</div></div>
            <button class="btn sm" id="lkCopy">${icon('copy')}제품명 복사</button></div>
          <div class="lk-grid">
            ${cell('구매처명', `<span class="v">${vendor?esc(vendor):'<span class="muted">미지정</span>'}</span>`)}
            ${cell('상품분류', `<span class="v">${category?esc(category):'<span class="muted">-</span>'}</span>`)}
            ${cell('입고단가', won(p.inPrice))}
            ${cell('출고단가', won(p.outPrice))}
          </div></div>`;
        const cp=root.querySelector('#lkCopy'); if(cp) cp.onclick=()=>{ copyText(p.name||''); toast('제품명 복사'); };
      }
      qEl.oninput=()=>{ const t=qEl.value.trim(); clearTimeout(timer); timer=setTimeout(()=>run(t), 260); };
      qEl.onkeydown=e=>{ if(e.key==='Enter'){ clearTimeout(timer); run(qEl.value.trim()); } };
      qEl.focus();
    }
  };
})();
