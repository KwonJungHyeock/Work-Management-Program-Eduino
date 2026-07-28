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
          .lk-card{margin-top:18px;border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:var(--sh-sm);background:var(--panel)}
          /* 상단: 상품코드/상품명 헤더 — 옅은 톤으로 구분 */
          .lk-top{display:flex;align-items:center;gap:12px;padding:16px 18px;background:var(--panel-2)}
          .lk-top .code{font-family:var(--mono);font-weight:800;font-size:20px;letter-spacing:.02em}
          .lk-top .nm{font-size:14.5px;color:var(--ink-2);font-weight:600;line-height:1.4}
          /* 구분 띠 — 상품코드와 정보 영역 사이 */
          .lk-band{display:flex;align-items:center;gap:7px;padding:7px 18px;background:#eef4fb;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:11px;font-weight:800;letter-spacing:.04em;color:#0a3d62}
          .lk-band svg{width:14px;height:14px}
          /* 정보 영역 — 흰색 시트 */
          .lk-grid{display:grid;grid-template-columns:repeat(4,1fr);background:var(--panel)}
          .lk-cell{padding:14px 16px}
          .lk-cell + .lk-cell{border-left:1px solid var(--line)}
          @media(max-width:620px){ .lk-grid{grid-template-columns:repeat(2,1fr)} .lk-cell:nth-child(odd){border-left:none} .lk-cell:nth-child(n+3){border-top:1px solid var(--line)} }
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
          .lk-opt .oopt{font-size:13px;font-weight:700;color:var(--red);background:var(--red-soft);border-radius:6px;padding:2px 10px;white-space:nowrap;flex:none}
          .lk-opt .on{font-size:14px;color:var(--ink-2);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
          .lk-opt .go{color:var(--muted);display:flex}.lk-opt:hover .go{color:var(--red)}
          .lk-top .obadge{font-size:13px;font-weight:800;color:var(--red);background:var(--red-soft);border-radius:7px;padding:3px 11px;white-space:nowrap}
          .lk-grid.g5{grid-template-columns:repeat(5,1fr)}
          @media(max-width:620px){ .lk-grid.g5{grid-template-columns:repeat(2,1fr)} }
          /* 검색 모드 토글 */
          .lk-mode{display:inline-flex;border:1px solid var(--line-2);border-radius:10px;overflow:hidden;margin-bottom:12px}
          .lk-mode button{border:0;background:var(--panel);padding:8px 16px;font-size:13px;font-weight:800;color:var(--muted);cursor:pointer;border-left:1px solid var(--line-2)}
          .lk-mode button:first-child{border-left:0} .lk-mode button.on{background:var(--brand,#1f56a3);color:#fff}
          /* 업체명 결과 목록 */
          .lk-vhead{margin:6px 2px 14px;font-size:13.5px;color:var(--ink-2)} .lk-vhead b{color:var(--ink)}
          .lk-vgroup{margin-bottom:14px;border:1px solid var(--line);border-radius:12px;overflow:hidden;box-shadow:var(--sh-sm)}
          .lk-vg-hd{padding:10px 15px;background:var(--panel-2);border-bottom:1px solid var(--line);font-size:13.5px;font-weight:800;color:var(--ink)}
          .lk-vg-hd .muted{font-weight:600;margin-left:6px}
          .lk-vtable{width:100%}
          .lk-vtr{display:grid;grid-template-columns:118px 1fr 92px 92px 82px;gap:8px;align-items:center;padding:9px 15px;border-top:1px solid var(--line-2);cursor:pointer;font-size:13px}
          .lk-vtr:hover{background:var(--panel-2)} .lk-vth{cursor:default;font-size:11px;font-weight:800;color:var(--muted);background:var(--panel);border-top:0}
          .lk-vth:hover{background:var(--panel)}
          .lk-vtr .c{font-family:var(--mono);font-weight:800;color:var(--brand,#1f56a3)}
          .lk-vtr .n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
          .lk-vtr .r{text-align:right;font-variant-numeric:tabular-nums}
          .lk-vtr .r.mg{color:#12886a;font-weight:800} .lk-vtr .r.mgb{color:#c0392b;font-weight:800}
          @media(max-width:620px){ .lk-vtr{grid-template-columns:96px 1fr 74px;gap:6px} .lk-vtr .r:nth-child(4),.lk-vtr .r:nth-child(5),.lk-vth span:nth-child(4),.lk-vth span:nth-child(5){display:none} }
        </style>
        <div class="mhead pad"><div class="mhead-row">
          <div><div class="tt">상품 조회</div>
            <div class="ds">이카운트 품목을 <b>상품코드</b> 또는 <b>공급업체명</b>으로 조회합니다. 고객 문의 응대 시 공급업체·단가·마진을 바로 확인하세요.</div></div>
        </div></div>
        <div class="mbody"><div class="lk-wrap">
          <div class="lk-mode" id="lkMode">
            <button data-m="code" class="on">상품코드</button>
            <button data-m="vendor">공급업체명</button></div>
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
      // 마진율(%) = (판매가 - 공급가) / 판매가 × 100 — 판매가 기준
      const marginPct=(inP,outP)=>{ inP=Number(inP)||0; outP=Number(outP)||0; if(outP<=0) return null; return Math.round((outP-inP)/outP*1000)/10; };
      // 공급업체명 → 이카운트 거래처코드(들) 역매핑 (이름표: 관리자 저장분 + 내장 기본값)
      function vendorCodesFor(term){ term=String(term||'').trim().toLowerCase(); if(!term) return [];
        const nameMap=(typeof catNameMap==='function'?(catNameMap().vendor||{}):{});
        const merged=Object.assign({}, (window.VENDOR_DEFAULTS||{}), nameMap);
        const codes=[]; for(const k in merged){ if(String(merged[k]||'').toLowerCase().includes(term)) codes.push(k); }
        return [...new Set(codes)];
      }

      let seq=0, timer=null, mode='code';
      function placeholderFor(){ return mode==='vendor'?'공급업체명 입력 (예: 로보로보)':'상품코드 입력 (예: P-DA39)'; }
      function baseHint(){ return mode==='vendor'?'공급업체명을 입력하면 그 업체의 상품이 모두 표시됩니다.':'상품코드를 입력하면 상세 정보가 표시됩니다.'; }
      function run(t){ if(mode==='vendor') return runVendor(t); return runCode(t); }
      async function runCode(code){
        const my=++seq;
        if(!code){ hint(`${icon('search')}<div>${baseHint()}</div>`); return; }
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
                ${o.option?`<span class="oopt">${esc(o.option)}</span>`:''}
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
            ${p.option?`<span class="obadge">옵션 ${esc(p.option)}</span>`:''}
            <button class="btn sm" id="lkCopy">${icon('copy')}제품명 복사</button></div>
          <div class="lk-band"><span style="width:6px;height:6px;border-radius:50%;background:#0a3d62;display:inline-block"></span><span>공급업체 · 단가 · 마진 정보</span></div>
          <div class="lk-grid g5">
            ${cell('공급업체명', `<span class="v">${vendor?esc(vendor):'<span class="muted">미지정</span>'}</span>`)}
            ${cell('상품분류', `<span class="v">${category?esc(category):'<span class="muted">-</span>'}</span>`)}
            ${cell('공급가', won(p.inPrice))}
            ${cell('에듀이노 판매가', won(p.outPrice))}
            ${cell('마진율', marginCellV(p))}
          </div></div>`;
        const cp=root.querySelector('#lkCopy'); if(cp) cp.onclick=()=>{ copyText(p.name||''); toast('제품명 복사'); };
      }
      // 마진율 셀 — 판매가 기준 %, 마진액 병기(양수 초록·음수 빨강)
      function marginCellV(p){ const m=marginPct(p.inPrice,p.outPrice);
        if(m==null) return `<span class="v" style="color:var(--muted)">-</span>`;
        const c=m>=0?'#12886a':'#c0392b'; const amt=(Number(p.outPrice)||0)-(Number(p.inPrice)||0);
        return `<span class="v" style="color:${c}">${m}%</span><span class="won" style="color:${c};margin-left:0;display:block;margin-top:2px">${fmtNum(amt)}원</span>`;
      }
      // 공급업체명 검색 → 그 업체의 상품 목록
      async function runVendor(term){
        const my=++seq;
        if(!term){ hint(`${icon('search')}<div>${baseHint()}</div>`); return; }
        const codes=vendorCodesFor(term);
        if(!codes.length){ hint(`${icon('alert')}<div>"${esc(term)}" — 일치하는 공급업체를 찾지 못했습니다.<br><span style="font-size:12.5px">이카운트 거래처명 일부로 검색해 보세요.</span></div>`,true); return; }
        hint(`${icon('cloud')}<div>조회 중…</div>`);
        let d=null; try{ const r=await fetch('/api/catalog?vendorCodes='+encodeURIComponent(codes.join(','))+'&limit=400'); d=await r.json(); }catch(e){}
        if(my!==seq||!root.isConnected) return;
        if(!d||!d.ok){ hint(`${icon('alert')}<div>조회에 실패했습니다. 잠시 후 다시 시도하세요.</div>`,true); return; }
        renderVendorList(d.items||[], term, d.total||0);
      }
      function renderVendorList(items, term, total){
        if(!items.length){ hint(`${icon('alert')}<div>"${esc(term)}" 업체의 상품이 카탈로그에 없습니다.</div>`,true); return; }
        const groups={}; items.forEach(p=>{ const vn=catVendorName(p)||'미지정'; (groups[vn]=groups[vn]||[]).push(p); });
        const names=Object.keys(groups).sort((a,b)=>a.localeCompare(b,'ko'));
        out.innerHTML=`<div class="lk-vhead">${icon('folder')} "<b>${esc(term)}</b>" — 공급업체 <b>${names.length}</b>곳 · 상품 <b>${items.length}</b>개${total>items.length?` <span class="muted">(상위 ${items.length} 표시)</span>`:''}</div>
          ${names.map(vn=>{ const rows=groups[vn]; return `<div class="lk-vgroup">
            <div class="lk-vg-hd">${esc(vn)}<span class="muted">${rows.length}개</span></div>
            <div class="lk-vtable">
              <div class="lk-vtr lk-vth"><span>상품코드</span><span>상품명</span><span class="r">공급가</span><span class="r">판매가</span><span class="r">마진율</span></div>
              ${rows.map((p,i)=>{ const m=marginPct(p.inPrice,p.outPrice); return `<div class="lk-vtr" data-vk="${esc(vn)}" data-i="${i}" title="상세 보기">
                <span class="c">${esc(p.selfCode)}</span>
                <span class="n">${p.name?esc(p.name):'<span class="muted">(품명 없음)</span>'}${p.option?` <span class="muted">· ${esc(p.option)}</span>`:''}</span>
                <span class="r">${fmtNum(p.inPrice||0)}</span>
                <span class="r">${fmtNum(p.outPrice||0)}</span>
                <span class="r ${m==null?'':(m>=0?'mg':'mgb')}">${m==null?'-':m+'%'}</span></div>`; }).join('')}
            </div></div>`; }).join('')}`;
        out.querySelectorAll('.lk-vtr[data-vk]').forEach(row=>row.onclick=()=>{ const p=groups[row.dataset.vk][+row.dataset.i]; if(p) showProduct(p); });
      }
      // 검색 모드 전환(상품코드 ↔ 공급업체명)
      root.querySelectorAll('#lkMode button').forEach(b=>b.onclick=()=>{ if(mode===b.dataset.m) return; mode=b.dataset.m;
        root.querySelectorAll('#lkMode button').forEach(x=>x.classList.toggle('on',x.dataset.m===mode));
        qEl.value=''; qEl.placeholder=placeholderFor(); hint(`${icon('search')}<div>${baseHint()}</div>`); qEl.focus(); });
      qEl.oninput=()=>{ const t=qEl.value.trim(); clearTimeout(timer); timer=setTimeout(()=>run(t), mode==='vendor'?200:260); };
      qEl.onkeydown=e=>{ if(e.key==='Enter'){ clearTimeout(timer); run(qEl.value.trim()); } };
      qEl.focus();
    }
  };
})();
