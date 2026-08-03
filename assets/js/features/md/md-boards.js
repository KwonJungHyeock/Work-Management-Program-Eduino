/* ===========================================================================
   MD · 현황판 공용 엔진 (buildBoard) — 노션 시트 구조 그대로 프로그램 내 이관
   - 입점사 신규/변동사항 · 품절관리 현황 · 제품검수 현황 · 상품관리 현황
   - 입력 폼 + 팀 공유 표(서버 시트 누적) + 기간/담당자 필터 + CSV + 행 수정/삭제
   - 저장: Records.pushRaw(dept, sheet, rec) (담당자=처리자 필드 귀속) · 조회: Records.month
   - 상품코드(자체코드) 입력 시 제품명 자동연동(카탈로그 API)
   =========================================================================== */
(function(){
  // 필드 서식(입력 편의): phone=한국 전화 하이픈(CS 상담메모와 동일) · amount=천단위 콤마
  const fmtField=(fmt,v)=> fmt==='phone' ? (typeof fmtPhone==='function'?fmtPhone(v):v)
    : fmt==='amount' ? (typeof fmtAmountInput==='function'?fmtAmountInput(v):v) : v;
  const ymd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const addDays=(s,n)=>{ const d=new Date(s+'T00:00:00'); d.setDate(d.getDate()+n); return ymd(d); };
  const monthsBetween=(from,to)=>{ const out=[]; let y=+from.slice(0,4), m=+from.slice(5,7);
    const ey=+to.slice(0,4), em=+to.slice(5,7); let g=0;
    while((y<ey||(y===ey&&m<=em))&&g++<60){ out.push(`${y}-${String(m).padStart(2,'0')}`); m++; if(m>12){m=1;y++;} } return out; };
  const NAME_PALETTE=['#2f6fed','#0f9d8e','#e0743a','#7a5af0','#1a8f4a','#e0518f','#0d8bd9','#b26a00','#8e44ad','#d4327a'];
  function colorForName(n){ const s=String(n||''); let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return NAME_PALETTE[h%NAME_PALETTE.length]; }

  /* 상품코드 → 제품명 조회 (카탈로그, 캐시) */
  const codeCache={};
  async function lookupProduct(code){
    const c=String(code||'').trim().toUpperCase(); if(!c) return {product:null,options:[]};
    if(Object.prototype.hasOwnProperty.call(codeCache,c)) return codeCache[c];
    try{ const r=await fetch('/api/catalog?code='+encodeURIComponent(c)); const d=await r.json();
      const res={ product:(d&&d.product)||null, options:(d&&d.options)||[] }; codeCache[c]=res; return res; }catch(e){ return {product:null,options:[]}; }
  }

  function buildBoard(cfg){
    // cfg: { key, dept?, title, icon, sheet, desc, fields:[{k,label,type,options?,w?,req?}], whoField, codeField, nameField }
    // dept 기본 'md' — CS 등 다른 부서 시트도 이 엔진으로 생성(window.buildBoard 로 공유)
    MODULES[cfg.key]={
      title:cfg.title, icon:cfg.icon||'clipboard',
      render(root){
        const isAdmin=!!(Auth.isAdmin&&Auth.isAdmin());
        const me=(Auth.user&&Auth.user())||{};
        const canDel=isAdmin || me.role==='lead' || (cfg.memberDelete && me.dept===cfg.dept);   // 파트장급 · (보드가 허용 시)해당 부서원
        const canOpt=isAdmin || (me.role==='lead' && me.dept===cfg.dept);   // 선택 항목(속성값) 추가·삭제 = 관리자 또는 해당 부서 파트장
        // 팀원(비처리자)은 특정 기록의 수정을 부서장/관리자에게 '요청'할 수 있음(문맥 요청)
        const canReq = typeof window.openReqComposer==='function' && !!(window.Req && typeof window.Req.isHandler==='function' && !window.Req.isHandler(me));
        function refLabelOf(r){ const vals=[]; const d=r[cfg.dateField]||r.date||r.day||''; if(d) vals.push(String(d));
          const dateLike=s=>/^\d{1,4}[-/.]\d{1,2}([-/.]\d{1,2})?$/.test(s);
          for(const f of (cfg.fields||[])){ if(vals.length>=3) break; if(f.k===cfg.dateField||f.type==='textarea') continue; const v=r[f.k];
            if(v!=null && String(v).trim()){ const s=String(v).trim(); if(s.length<=24 && !dateLike(s) && !vals.includes(s)) vals.push(s); } }
          return vals.join(' · ')||('기록 '+(r.id||'')); }
        // 담당자 목록 (사용자 편집 · 로컬 저장) — whoField 가 select/agent 인 경우
        const whoCfg = cfg.fields.find(f=>f.k===cfg.whoField);
        const agentsKey = 'eduino.md.board.'+cfg.sheet+'.agents';
        const getAgents=()=> store(agentsKey).get((whoCfg&&whoCfg.options)?whoCfg.options.slice():[]);
        const setAgents=(v)=> store(agentsKey).set(v);

        // ── 구글 시트 2차 백업 연동 (모듈별 탭) ──
        const syncCfgKey='eduino.board.'+cfg.sheet+'.cfg';
        const getSyncCfg=()=> store(syncCfgKey).get({sheetUrl:'',backup:true});
        const setSyncCfg=(v)=> store(syncCfgKey).set(v);
        const tabName=(cfg.sheetTab||cfg.title).replace(/[\/\\:?*\[\]]/g,'·');   // 시트 탭 이름(금지문자 치환)
        function toSheetRow(rec){ const o={ id:rec.id }; cfg.fields.forEach(f=>{ o[f.label]= rec[f.k]!=null?rec[f.k]:''; }); o['등록자']=rec.whoName||''; return o; }
        async function sendSheet(records){ const c=getSyncCfg(); if(!c.sheetUrl||!records.length) return {ok:false,error:'URL 미설정'};
          const opts={ method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify({ sheet:tabName, records:records.map(toSheetRow) }) };
          try{ const res=await fetch(c.sheetUrl,opts); if(!res.ok) throw new Error('HTTP '+res.status); let d=null; try{d=await res.json();}catch(e){} if(d&&d.ok===false) throw new Error(d.error||'시트 처리 실패'); return {ok:true}; }
          catch(err){ if(/failed to fetch|networkerror|load failed|cors/i.test(err.message||'')){ try{ await fetch(c.sheetUrl,{...opts,mode:'no-cors'}); return {ok:true,unconfirmed:true}; }catch(e){} } return {ok:false,error:err.message||'전송 실패'}; } }
        function backupOne(rec){ const c=getSyncCfg(); if(c.backup!==false && c.sheetUrl) sendSheet([rec]); }

        // ── 고객 데이터베이스 원장(21_거래내역) 연동 — cfg.ledger 있는 보드만(후불/발주/견적) ──
        const custDbUrl=()=> (store(STORE.custDbCfg).get({sheetUrl:''})||{}).sheetUrl||'';
        async function ledgerPost(body){ const url=custDbUrl(); if(!url) return {ok:false,skip:true};
          const opts={ method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify(body) };
          try{ const res=await fetch(url,opts); if(!res.ok) throw new Error('HTTP '+res.status); let d=null; try{d=await res.json();}catch(e){} if(d&&d.ok===false) throw new Error(d.error||'원장 처리 실패'); return {ok:true}; }
          catch(err){ if(/failed to fetch|networkerror|load failed|cors/i.test(err.message||'')){ try{ await fetch(url,{...opts,mode:'no-cors'}); return {ok:true,unconfirmed:true}; }catch(e){} } return {ok:false,error:err.message||'전송 실패'}; } }
        function ledgerUpsert(rec){ if(!cfg.ledger || !custDbUrl()) return; ledgerPost({ sheet:cfg.ledger.tab, records:[cfg.ledger.map(rec)] }); }
        function ledgerDelete(id){ if(!cfg.ledger || !custDbUrl()) return; ledgerPost({ sheet:cfg.ledger.tab, delIds:[id] }); }

        root.innerHTML=`
        <style>
          .bd-card{border:1px solid var(--line);border-radius:14px;background:var(--panel);overflow:hidden;margin-bottom:20px;box-shadow:var(--sh)}
          .bd-hd{display:flex;align-items:center;gap:10px;padding:14px 20px;background:linear-gradient(180deg,var(--panel-2),var(--panel));border-bottom:1px solid var(--line);font-weight:800;font-size:15.5px}
          .bd-hd .bd-ic{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:var(--red-soft);color:var(--red)}
          .bd-hd .bd-ic svg{width:15px;height:15px}
          .bd-bd{padding:18px 20px}
          .bd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px 16px;align-items:start}
          .bd-f{display:flex;flex-direction:column;gap:6px}
          .bd-f.wide{grid-column:1 / -1}
          .bd-f label{font-size:11.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
          .bd-f label .req{color:var(--red);margin-left:3px}
          .bd-f input,.bd-f select,.bd-f textarea{height:40px;font-size:14px;border:1px solid var(--line-strong);border-radius:9px;padding:0 11px;background:var(--panel);width:100%}
          .bd-f textarea{height:auto;min-height:64px;padding:9px 11px;resize:vertical;line-height:1.5}
          .bd-f input:focus,.bd-f select:focus,.bd-f textarea:focus{border-color:var(--red);box-shadow:0 0 0 3px var(--red-soft);outline:none}
          .bd-chips{display:flex;gap:7px;flex-wrap:wrap}
          .bd-chip{display:inline-flex;align-items:center;padding:8px 14px;border:1px solid var(--line-strong);border-radius:8px;background:var(--panel);font-size:13.5px;font-weight:600;color:var(--ink-2);cursor:pointer;transition:.12s;user-select:none}
          .bd-chip:hover{border-color:var(--faint);background:var(--panel-2)}
          .bd-chip.on{border-color:var(--red);background:var(--red-soft);color:var(--red);font-weight:700;box-shadow:inset 0 0 0 1px var(--red)}
          .bd-code-hint{font-size:12px;color:var(--info);min-height:15px}
          .bd-code-hint.warn{color:var(--warn)}
          .bd-actions{display:flex;align-items:center;gap:10px;margin-top:16px;flex-wrap:wrap}
          .bd-ctrl{display:flex;flex-wrap:wrap;gap:10px 12px;align-items:center;margin-bottom:12px}
          .seg{display:inline-flex;border:1px solid var(--line-2);border-radius:9px;overflow:hidden}
          .seg button{border:0;background:var(--panel);padding:7px 13px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer;border-left:1px solid var(--line-2)}
          .seg button:first-child{border-left:0}
          .seg button.on{background:var(--active-bg);color:var(--red)}
          .bd-dates{display:none;align-items:center;gap:6px;font-size:13px;color:var(--muted)}
          .bd-dates.on{display:inline-flex}
          .bd-in{height:34px;border:1px solid var(--line-2);border-radius:8px;padding:0 10px;font-size:13px;min-width:120px}
          .bd-sp{flex:1}
          .bd-meta{font-size:12.5px;color:var(--muted);margin:0 0 8px;font-weight:600}
          .bd-wrap{border:1px solid var(--line);border-radius:12px;overflow:auto;max-height:calc(100vh - 430px);min-height:160px;background:var(--panel);box-shadow:var(--sh-sm)}
          table.bd{border-collapse:separate;border-spacing:0;width:100%;font-size:13px}
          table.bd th{position:sticky;top:0;z-index:2;background:var(--panel-2);color:var(--ink-2);font-size:11.5px;font-weight:800;letter-spacing:.02em;text-align:left;padding:9px 10px;border-bottom:1px solid var(--line-2);white-space:nowrap}
          table.bd td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top;color:var(--ink-2)}
          table.bd tr:nth-child(even) td{background:var(--zebra)}
          table.bd tbody tr:hover td{background:var(--hover)}
          table.bd td.wrap{white-space:pre-wrap;word-break:break-word;line-height:1.45;min-width:180px}
          table.bd td.who{font-weight:700}
          .bd-badge{display:inline-block;font-weight:700;border-radius:6px;padding:2px 9px;font-size:12px;background:var(--line-2);color:var(--muted)}
          .bd-del{border:0;background:none;color:var(--faint);cursor:pointer;padding:2px 5px;border-radius:5px}
          .bd-del:hover{background:var(--danger-soft);color:var(--danger)}
          .bd-empty{padding:40px;text-align:center;color:var(--muted);font-size:14px}
        </style>
        <div class="mhead pad"><div class="tt">${esc(cfg.title)}</div><div class="ds">${esc(cfg.desc)}</div></div>
        <div class="mbody wide">
          <div id="syncPanel" class="hidden" style="margin-bottom:20px"></div>
          <div class="bd-card">
            <div class="bd-hd">새 기록 입력
              ${canOpt && (cfg.fields||[]).some(f=>f.type==='select')?`<button type="button" class="btn ghost sm" id="bOptEdit" style="margin-left:auto">${icon('settings')}선택 항목 편집</button>`:''}</div>
            <div class="bd-bd"><form id="bForm"><div class="bd-grid" id="fGrid"></div>
              <div class="bd-actions">
                <button type="submit" class="btn pri lg">${icon('save')}저장</button>
                <span class="muted" id="fMsg" style="font-size:13px"></span></div>
            </form></div>
          </div>

          <div class="bd-ctrl">
            <span class="seg" id="segR">
              <button data-r="today">오늘</button><button data-r="7">7일</button>
              <button data-r="30">30일</button><button data-r="month" class="on">이번달</button>
              <button data-r="custom">지정</button></span>
            <span class="bd-dates" id="dates"><input type="date" id="dFrom"> ~ <input type="date" id="dTo"></span>
            ${cfg.whoField?`<select class="bd-in" id="fWho"><option value="">${esc((whoCfg&&whoCfg.label)||'담당자')} 전체</option></select>`:''}
            ${(cfg.filterFields||[]).map(f=>`<select class="bd-in" data-ff="${esc(f.k)}"><option value="">${esc(f.label)} 전체</option>${((cfg.fields.find(x=>x.k===f.k)||{}).options||[]).map(o=>`<option>${esc(o)}</option>`).join('')}</select>`).join('')}
            <input class="bd-in" id="fQ" type="text" placeholder="검색어…">
            <span class="bd-sp"></span>
            ${isAdmin?`<button class="btn ghost sm" id="btnSync">${icon('cloud')}시트 연동</button>`:''}
            ${isAdmin?`<button class="btn ghost sm" id="btnCsv">${icon('download')}CSV</button>`:''}
          </div>
          <p class="bd-meta" id="meta"></p>
          <div class="bd-wrap"><table class="bd" id="tbl"></table></div>
          <p class="bd-meta" style="margin-top:10px;color:var(--faint)">팀 공유 기록입니다 · 저장 시 서버에 누적되어 모든 담당자에게 보입니다.${canDel?' 파트장·관리자는 기록을 삭제할 수 있습니다.':''}</p>
        </div>`;

        const $=s=>root.querySelector(s);
        const form={};  // 폼 상태 (칩 선택값 등)
        cfg.fields.forEach(f=>{ form[f.k] = f.type==='date' ? todayStr() : (f.def||''); });

        /* ---- 입력 폼 렌더 (짧은 필드 먼저 촘촘히 → 넓은 textarea는 맨 아래 전폭) ---- */
        const grid=$('#fGrid');
        const formOrder=[...cfg.fields].sort((a,b)=>(a.type==='textarea'?1:0)-(b.type==='textarea'?1:0));
        formOrder.forEach(f=>{
          const wrap=el('div','bd-f'+((f.type==='textarea')?' wide':''));
          if(f.newRow) wrap.style.gridColumnStart='1';   // 이 필드부터 새 줄에서 시작
          const lab=`<label>${esc(f.label)}${f.req?'<span class="req">*</span>':''}</label>`;
          if(f.type==='agent' || (f.type==='select' && f.k===cfg.whoField)){
            // 담당자/처리자 — 드롭다운(공간 효율) · 관리자는 목록에서 직접 추가 가능
            const buildOpts=(cur)=>`<option value="">(담당자 선택)</option>${getAgents().map(o=>`<option ${o===cur?'selected':''}>${esc(o)}</option>`).join('')}${isAdmin?'<option value="__add">＋ 담당자 추가…</option>':''}`;
            wrap.innerHTML=lab+`<select data-k="${esc(f.k)}" data-agent="1">${buildOpts(form[f.k])}</select>`;
            grid.appendChild(wrap);
            const sel=wrap.querySelector('select');
            sel.onchange=()=>{ if(sel.value==='__add'){ const v=(prompt('추가할 담당자 이름','')||'').trim();
                if(v){ const cur=getAgents(); if(!cur.includes(v)){ cur.push(v); setAgents(cur); } form[f.k]=v; sel.innerHTML=buildOpts(v); }
                else { sel.value=form[f.k]||''; } return; }
              form[f.k]=sel.value; };
          } else if(f.type==='select'){
            // 선택 항목 = 공용 옵션 레지스트리(OptionSets) · 관리자는 드롭다운에서 ＋추가, 삭제는 [선택 항목 편집]에서
            const setKey=cfg.key+'.'+f.k;
            const buildSel=(cur)=>{ const opts=OptionSets.get(setKey, f.options||[]);
              return `<option value="">(선택)</option>${opts.map(o=>`<option ${o===cur?'selected':''}>${esc(o)}</option>`).join('')}${canOpt?'<option value="__add">＋ 항목 추가…</option>':''}`; };
            wrap.innerHTML=lab+`<select data-k="${esc(f.k)}">${buildSel(form[f.k])}</select>`;
            grid.appendChild(wrap);
            const sel=wrap.querySelector('select');
            sel.onchange=()=>{ if(sel.value==='__add'){ const v=(prompt('추가할 “'+f.label+'” 항목','')||'').trim();
                if(v){ const r=OptionSets.add(setKey, f.options||[], v); if(r.ok){ form[f.k]=v; toast('추가됨 · 팀 공유'); } else { toast('이미 있는 항목입니다'); form[f.k]=v; } }
                sel.innerHTML=buildSel(form[f.k]); return; }
              form[f.k]=sel.value; };
          } else if(f.type==='toggle'){
            wrap.innerHTML=lab+`<label style="display:flex;align-items:center;gap:8px;height:40px;font-size:14px;font-weight:600;cursor:pointer"><input type="checkbox" data-k="${esc(f.k)}" style="width:18px;height:18px"> ${esc(f.onLabel||'완료')}</label>`;
            grid.appendChild(wrap);
            wrap.querySelector('input').onchange=e=>form[f.k]=e.target.checked?(f.onLabel||'완료'):'';
          } else if(f.type==='textarea'){
            wrap.innerHTML=lab+`<textarea data-k="${esc(f.k)}" placeholder="${esc(f.ph||'')}"></textarea>`;
            grid.appendChild(wrap);
            wrap.querySelector('textarea').oninput=e=>form[f.k]=e.target.value;
          } else if(f.type==='number'){
            wrap.innerHTML=lab+`<input type="number" data-k="${esc(f.k)}" placeholder="${esc(f.ph||'')}" min="0" ${f.max?`max="${f.max}"`:''}>`;
            grid.appendChild(wrap);
            wrap.querySelector('input').oninput=e=>form[f.k]=e.target.value;
          } else { // text / date / code
            const t = f.type==='date'?'date':'text';
            // 연락처(phone)·금액(amount)은 입력 즉시 서식 적용
            const fmtAttr = f.format==='phone' ? ' inputmode="numeric" maxlength="13"' : f.format==='amount' ? ' inputmode="numeric" style="text-align:right"' : '';
            wrap.innerHTML=lab+`<input type="${t}" data-k="${esc(f.k)}"${fmtAttr} ${f.type==='date'?`value="${esc(form[f.k])}"`:''} placeholder="${esc(f.ph||'')}" ${f.k===cfg.codeField?'autocomplete="off"':''}>`+
              (f.k===cfg.codeField?`<div class="bd-code-hint" data-codehint></div>`:'');
            grid.appendChild(wrap);
            const inp=wrap.querySelector('input');
            inp.oninput=e=>{ if(f.format){ e.target.value=fmtField(f.format,e.target.value); } form[f.k]=e.target.value; };
            if(f.k===cfg.codeField) wireCodeLookup(inp, wrap.querySelector('[data-codehint]'));
          }
        });

        function wireCodeLookup(inp, hint){
          const nameField = cfg.nameField;
          let seq=0, tmr=null;
          const run=()=>{ const code=inp.value.trim(); const my=++seq;
            if(!code){ hint.textContent=''; hint.className='bd-code-hint'; return; }
            hint.textContent='조회 중…'; hint.className='bd-code-hint';
            lookupProduct(code).then(res=>{ if(my!==seq||!root.isConnected) return; const p=res.product;
              if(p){ hint.textContent='✓ '+(p.name||'(이름 없음)'); hint.className='bd-code-hint';
                if(nameField){ const nEl=grid.querySelector(`[data-k="${nameField}"]`);
                  if(nEl && (!nEl.value.trim() || nEl.dataset.auto==='1')){ nEl.value=p.name||''; nEl.dataset.auto='1'; form[nameField]=p.name||''; } }
                // 자체코드 → 입점사명 자동 채움(구매처명 이름표 우선) · 사용자가 직접 입력했으면 보존
                if(cfg.vendorField){ const vName=(typeof catVendorName==='function'?catVendorName(p):(p.vendor||''))||'';
                  const vEl=grid.querySelector(`[data-k="${cfg.vendorField}"]`);
                  if(vEl && vName && (!vEl.value.trim() || vEl.dataset.auto==='1')){ vEl.value=vName; vEl.dataset.auto='1'; form[cfg.vendorField]=vName; } } }
              else if(res.options && res.options.length){ hint.innerHTML=`옵션 상품 ${res.options.length}개 — `+res.options.slice(0,6).map(o=>`<a href="#" data-c="${esc(o.selfCode)}" style="color:var(--info);text-decoration:underline">${esc(o.selfCode)}</a>`).join(', ')+(res.options.length>6?' …':''); hint.className='bd-code-hint';
                hint.querySelectorAll('a[data-c]').forEach(a=>a.onclick=(e)=>{ e.preventDefault(); inp.value=a.dataset.c; form[cfg.codeField]=a.dataset.c; if(cfg.nameField){ const nEl=grid.querySelector(`[data-k="${cfg.nameField}"]`); if(nEl) nEl.dataset.auto=''; } run(); }); }
              else { hint.textContent='미등록 코드 — 제품명을 직접 입력'; hint.className='bd-code-hint warn'; }
            }); };
          inp.addEventListener('input',()=>{ clearTimeout(tmr); tmr=setTimeout(run,300); });
          if(cfg.nameField){ const nEl=grid.querySelector(`[data-k="${cfg.nameField}"]`); if(nEl) nEl.addEventListener('input',()=>{ nEl.dataset.auto=''; }); }
          if(cfg.vendorField){ const vEl=grid.querySelector(`[data-k="${cfg.vendorField}"]`); if(vEl) vEl.addEventListener('input',()=>{ vEl.dataset.auto=''; }); }
        }

        /* ---- 저장 ---- */
        let all=[];
        $('#bForm').addEventListener('submit',e=>{ e.preventDefault();
          const reqMiss=cfg.fields.find(f=>f.req && !String(form[f.k]||'').trim());
          if(reqMiss){ $('#fMsg').textContent='필수 항목: '+reqMiss.label; return; }
          if(cfg.titleField && !String(form[cfg.titleField]||'').trim()){ $('#fMsg').textContent='필수 항목: '+(cfg.fields.find(f=>f.k===cfg.titleField)||{}).label; return; }
          const who = cfg.whoField ? (form[cfg.whoField]||'') : (me.name||'');
          const dateVal = cfg.dateField ? (form[cfg.dateField]||todayStr()) : todayStr();
          const rec={ id:uuid(), createdAt:nowISO(), day: (/^\d{4}-\d{2}-\d{2}$/.test(dateVal)?dateVal:todayStr()),
            who: me.loginId||('@'+(who||'?')), whoName: who };
          cfg.fields.forEach(f=>{ rec[f.k]= form[f.k]!=null?form[f.k]:''; });
          all.unshift(rec); paint();
          if(window.Records) Records.pushRaw(cfg.dept||'md', cfg.sheet, rec);
          backupOne(rec);   // 구글 시트 2차 백업(설정 시)
          ledgerUpsert(rec);   // 고객DB 원장(21_거래내역)에 append/upsert(설정 시)
          // 폼 리셋(담당자/날짜는 유지 · 기본값 있는 필드는 기본값으로)
          cfg.fields.forEach(f=>{ if(f.k===cfg.whoField) return; if(f.type==='date'){ form[f.k]=todayStr(); return; } form[f.k]=f.def||''; });
          resetInputs();
          $('#fMsg').textContent='저장되었습니다'; setTimeout(()=>{ if($('#fMsg')) $('#fMsg').textContent=''; }, 2500);
        });
        function resetInputs(){
          grid.querySelectorAll('[data-k]').forEach(inp=>{ const k=inp.dataset.k; const f=cfg.fields.find(x=>x.k===k);
            if(!f) return;
            if(k===cfg.whoField){ inp.value=form[k]||''; return; }   // 담당자는 다음 입력에도 유지
            if(f.type==='toggle'){ inp.checked=false; }
            else if(f.type==='date'){ inp.value=form[k]; }
            else { inp.value=form[k]||''; inp.dataset.auto=''; }   // select 는 기본값 복원, text 는 비움
          });
          grid.querySelectorAll('[data-codehint]').forEach(h=>h.textContent='');
        }

        /* ---- 표(조회) ---- */
        let preset='month', custom={from:todayStr(),to:todayStr()}, who='', q='', editId=null;
        const ffVals={};   // 필드값 필터(예: 처리상태)
        function range(){ const to=todayStr();
          if(preset==='today') return {from:to,to};
          if(preset==='7') return {from:addDays(to,-6),to};
          if(preset==='30') return {from:addDays(to,-29),to};
          if(preset==='month') return {from:to.slice(0,8)+'01',to};
          return {from:custom.from<=custom.to?custom.from:custom.to, to:custom.from<=custom.to?custom.to:custom.from};
        }
        const showCols = cfg.fields.filter(f=>!f.hideInTable);
        function filtered(){ const {from,to}=range();
          let rows=all.filter(r=>{ const d=r.day||r[cfg.dateField]||''; return d>=from&&d<=to; });
          if(cfg.whoField && who) rows=rows.filter(r=>(r.whoName||r[cfg.whoField]||'')===who);
          (cfg.filterFields||[]).forEach(f=>{ const v=ffVals[f.k]; if(v) rows=rows.filter(r=>String(r[f.k]??'').trim()===v); });
          if(q){ const s=q.toLowerCase(); rows=rows.filter(r=>showCols.some(c=>String(r[c.k]??'').toLowerCase().includes(s))); }
          rows.sort((a,b)=>String(b.day||'').localeCompare(String(a.day||'')) || String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
          return {rows,from,to};
        }
        function fmtCell(r,c){
          let v=r[c.k]; v = v==null?'':String(v);
          if(c.k===cfg.whoField && v){ const col=colorForName(v); return `<td style="white-space:nowrap"><span class="bd-badge" style="color:${col};background:${col}1a">${esc(v)}</span></td>`; }
          if(c.type==='select' && v){ return `<td style="white-space:nowrap">${(typeof tagBadge==='function')?tagBadge(v,'bd-badge'):`<span class="bd-badge">${esc(v)}</span>`}</td>`; }
          if(c.type==='toggle'){ return `<td style="white-space:nowrap">${v?`<span class="bd-badge" style="color:var(--ok);background:var(--ok-bg)">${esc(v)}</span>`:'<span class="muted">-</span>'}</td>`; }
          const cls=(c.type==='textarea'?'wrap ':'');
          return `<td class="${cls.trim()}" ${c.type==='textarea'?'':'style="white-space:nowrap"'}>${esc(v)}</td>`;
        }
        function paint(){
          if(!root.isConnected || !$('#tbl')) return;
          const {rows,from,to}=filtered();
          $('#meta').textContent=`${from} ~ ${to} · 총 ${rows.length.toLocaleString()}건`;
          const hasAct=true;   // 수정은 전 담당자 가능(삭제는 관리자만)
          const head=`<thead><tr>${showCols.map(c=>`<th>${esc(c.label)}</th>`).join('')}${hasAct?'<th></th>':''}</tr></thead>`;
          if(!rows.length){ $('#tbl').innerHTML=head+`<tbody><tr><td class="bd-empty" colspan="${showCols.length+1}">해당 기간의 기록이 없습니다.</td></tr></tbody>`; return; }
          const CAP=1500; const show=rows.slice(0,CAP);
          $('#tbl').innerHTML=head+`<tbody>${show.map(r=> editId===r.id ? editRow(r,hasAct) : `<tr>${showCols.map(c=>fmtCell(r,c)).join('')}${hasAct?actionCell(r):''}</tr>`).join('')}</tbody>`;
          if(rows.length>CAP) $('#meta').textContent+=` (앞 ${CAP}건 표시)`;
          wire();
        }
        function actionCell(r){ return `<td style="white-space:nowrap"><span style="display:flex;gap:4px;justify-content:flex-end">
          <button class="btn ghost sm" data-a="edit" data-id="${esc(r.id)}">수정</button>
          ${cfg.rowCopy?`<button class="btn ghost sm" data-a="copy" data-id="${esc(r.id)}" title="이 행과 동일한 값으로 오늘 날짜 새 건 생성">${icon('copy')}복사</button>`:''}
          ${canReq?`<button class="btn ghost sm" data-a="req" data-id="${esc(r.id)}" title="이 기록의 수정을 부서장/관리자에게 요청">${icon('stamp')||''}수정요청</button>`:''}
          ${canDel?`<button class="bd-del" data-a="del" data-id="${esc(r.id)}" title="삭제">${icon('trash')}</button>`:''}</span></td>`; }
        function editRow(r,hasAct){
          const cells=showCols.map(c=>{
            const v=r[c.k]==null?'':String(r[c.k]);
            if(c.type==='select'||c.type==='agent'){ const opts=(c.type==='agent'?getAgents():OptionSets.get(cfg.key+'.'+c.k, c.options||[]));
              return `<td><select data-k="${esc(c.k)}"><option value="">(선택)</option>${[...new Set([...opts,v].filter(Boolean))].map(o=>`<option ${o===v?'selected':''}>${esc(o)}</option>`).join('')}</select></td>`; }
            if(c.type==='toggle'){ return `<td><input type="checkbox" data-k="${esc(c.k)}" ${v?'checked':''} data-on="${esc(c.onLabel||'완료')}"></td>`; }
            if(c.type==='textarea'){ return `<td><textarea data-k="${esc(c.k)}" rows="2" style="width:100%;min-width:160px;font:inherit;border:1px solid var(--line-2);border-radius:6px;padding:5px 7px">${esc(v)}</textarea></td>`; }
            const t=c.type==='date'?'date':(c.type==='number'?'number':'text');
            return `<td><input data-k="${esc(c.k)}" type="${t}" value="${esc(v)}" style="width:${c.type==='textarea'?'160':'110'}px;font:inherit;border:1px solid var(--line-2);border-radius:6px;padding:5px 7px"></td>`;
          }).join('');
          return `<tr>${cells}${hasAct?`<td style="white-space:nowrap"><span style="display:flex;gap:4px">
            <button class="btn pri sm" data-a="save" data-id="${esc(r.id)}">${icon('check')}</button>
            <button class="btn ghost sm" data-a="cancel">취소</button></span></td>`:''}</tr>`;
        }
        function wire(){
          // 편집 행의 연락처·금액 입력칸도 입력 즉시 서식 적용(신규 입력폼과 동일)
          $('#tbl').querySelectorAll('[data-k]').forEach(inp=>{ const f=cfg.fields.find(x=>x.k===inp.dataset.k);
            if(f&&f.format){ inp.value=fmtField(f.format,inp.value); inp.oninput=()=>{ inp.value=fmtField(f.format,inp.value); };
              if(f.format==='amount') inp.style.textAlign='right'; if(f.format==='phone') inp.maxLength=13; } });
          $('#tbl').querySelectorAll('[data-a=edit]').forEach(b=>b.onclick=()=>{ editId=b.dataset.id; paint(); });
          $('#tbl').querySelectorAll('[data-a=cancel]').forEach(b=>b.onclick=()=>{ editId=null; paint(); });
          $('#tbl').querySelectorAll('[data-a=req]').forEach(b=>b.onclick=()=>{ const r=all.find(x=>String(x.id)===b.dataset.id); if(!r||typeof window.openReqComposer!=='function') return;
            const pre={ cat:'datafix', refKey:cfg.key, refId:r.id, refLabel:refLabelOf(r) }; if((cfg.dept||'')==='cs') pre.type='cs-fix';
            window.openReqComposer(pre); });
          // 복사(opt-in) — 원본은 그대로 두고 동일 값의 새 건을 오늘 날짜로 생성(순수 추가 · 기존 데이터 불변)
          $('#tbl').querySelectorAll('[data-a=copy]').forEach(b=>b.onclick=async()=>{
            const src=all.find(x=>x.id===b.dataset.id); if(!src) return;
            const today=todayStr(); const rec={...src, id:uuid(), createdAt:nowISO(), day:today };
            if(cfg.dateField) rec[cfg.dateField]=today;                 // 접수일자 = 오늘
            rec.who=me.loginId||('@'+(rec.whoName||'?'));               // 생성자 귀속(담당자 표시값은 원본 유지)
            all.unshift(rec); editId=null; paintWho(); paint();
            if(window.Records) await Records.pushRaw(cfg.dept||'md',cfg.sheet,rec);
            backupOne(rec); ledgerUpsert(rec);                          // 백업·원장도 동일 경로로 반영
            toast('오늘 날짜로 복사했습니다');
          });
          $('#tbl').querySelectorAll('[data-a=save]').forEach(b=>b.onclick=async(e)=>{
            const tr=e.currentTarget.closest('tr'); const old=all.find(x=>x.id===editId); if(!old) return;
            const prevDay=String(old.day||old[cfg.dateField]||old.date||'');   // 삭제 대상(옛 달 버킷)
            const rec={...old};
            tr.querySelectorAll('[data-k]').forEach(inp=>{ const k=inp.dataset.k;
              rec[k]= inp.type==='checkbox' ? (inp.checked?(inp.dataset.on||'완료'):'') : inp.value; });
            if(cfg.whoField) rec.whoName=rec[cfg.whoField]||rec.whoName;
            if(cfg.dateField) rec.day = /^\d{4}-\d{2}-\d{2}$/.test(rec[cfg.dateField]||'')?rec[cfg.dateField]:rec.day;
            e.currentTarget.disabled=true;
            Object.assign(old,rec); editId=null; paintWho(); paint();
            if(window.Records){
              const oldM=prevDay.slice(0,7), newM=String(rec.day||'').slice(0,7);
              // 날짜(월)가 바뀌면 옛 달 버킷의 기록을 지워야 조회에 잔재가 안 남음
              if(oldM && newM && oldM!==newM) await Records.del(cfg.dept||'md',cfg.sheet,rec.id,oldM,old.who,prevDay);
              await Records.pushRaw(cfg.dept||'md',cfg.sheet,rec);
            }
            backupOne(rec);   // 시트 백업도 갱신(id upsert)
            ledgerUpsert(rec);   // 고객DB 원장도 갱신(id upsert)
            toast('수정했습니다');
          });
          if(canDel) $('#tbl').querySelectorAll('[data-a=del]').forEach(b=>b.onclick=async()=>{
            if(!confirm('이 기록을 서버에서 삭제할까요? (되돌릴 수 없음)')) return;
            const r=all.find(x=>x.id===b.dataset.id); if(!r) return;
            await Records.del(cfg.dept||'md',cfg.sheet,r.id,(r.day||'').slice(0,7),r.who,r.day);
            ledgerDelete(r.id);   // 고객DB 원장에서도 제거
            all=all.filter(x=>x.id!==r.id); paintWho(); paint(); toast('삭제했습니다');
          });
        }
        function paintWho(){ if(!cfg.whoField) return; const sel=$('#fWho'); if(!sel) return;
          const names=[...new Set(all.map(r=>r.whoName||r[cfg.whoField]).filter(Boolean))].sort();
          sel.innerHTML=`<option value="">${esc((whoCfg&&whoCfg.label)||'담당자')} 전체</option>`+names.map(n=>`<option ${n===who?'selected':''}>${esc(n)}</option>`).join('');
        }
        // 필드값 필터 드롭다운을 실제 데이터의 고유값으로 채움(입점사명·상태 등 select가 아닌 필드도 필터 가능)
        function paintFilterOptions(){
          (cfg.filterFields||[]).forEach(f=>{ const sel=root.querySelector(`[data-ff="${f.k}"]`); if(!sel) return;
            const def=cfg.fields.find(x=>x.k===f.k)||{}; const cur=ffVals[f.k]||'';
            let vals=[...new Set(all.map(r=>String(r[f.k]==null?'':r[f.k]).trim()).filter(Boolean))];
            if(def.options&&def.options.length) vals=[...new Set([...def.options, ...vals])]; else vals.sort();
            if(cur && vals.indexOf(cur)<0){ ffVals[f.k]=''; }
            sel.innerHTML=`<option value="">${esc(f.label)} 전체</option>`+vals.map(v=>`<option ${v===(ffVals[f.k]||'')?'selected':''}>${esc(v)}</option>`).join('');
          });
        }

        $('#segR').querySelectorAll('button').forEach(b=>b.onclick=()=>{ preset=b.dataset.r;
          $('#segR').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));
          $('#dates').classList.toggle('on',preset==='custom');
          if(preset==='custom'){ $('#dFrom').value=custom.from; $('#dTo').value=custom.to; }
          load(); });
        $('#dFrom').onchange=()=>{ custom.from=$('#dFrom').value||custom.from; load(); };
        $('#dTo').onchange=()=>{ custom.to=$('#dTo').value||custom.to; load(); };
        if($('#fWho')) $('#fWho').onchange=()=>{ who=$('#fWho').value; paint(); };
        root.querySelectorAll('[data-ff]').forEach(sel=>sel.onchange=()=>{ ffVals[sel.dataset.ff]=sel.value; paint(); });
        $('#fQ').oninput=()=>{ q=$('#fQ').value.trim(); paint(); };
        // 선택 항목 편집(관리자) — 드롭다운 옵션 추가/삭제를 한곳에서 · 팀 자동 공유
        function refreshSelect(fk){ const sel=grid.querySelector(`select[data-k="${fk}"]`); if(!sel) return;
          const f=cfg.fields.find(x=>x.k===fk); const opts=OptionSets.get(cfg.key+'.'+fk, f.options||[]); const cur=form[fk];
          sel.innerHTML=`<option value="">(선택)</option>${opts.map(o=>`<option ${o===cur?'selected':''}>${esc(o)}</option>`).join('')}${canOpt?'<option value="__add">＋ 항목 추가…</option>':''}`;
          if(cur && !opts.includes(cur)) form[fk]=''; }
        if($('#bOptEdit')) $('#bOptEdit').onclick=()=>{
          const selects=cfg.fields.filter(f=>f.type==='select');
          const ov=el('div','modal-ov'); ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px';
          const inner=el('div',''); inner.style.cssText='background:var(--panel);border:1px solid var(--line);border-radius:16px;max-width:600px;width:100%;max-height:86vh;overflow:auto;padding:22px 24px;box-shadow:var(--sh-lg)';
          function draw(){ inner.innerHTML=`<div style="font-size:16px;font-weight:800;margin-bottom:4px">${icon('settings')} 선택 항목 편집</div>
            <div class="muted" style="font-size:12.5px;margin-bottom:16px">관리자·해당 부서 파트장 · 저장 즉시 <b>팀 전체에 반영</b>됩니다. 항목의 <b>✕</b>로 삭제, 아래 칸으로 추가하세요.</div>
            ${selects.map(f=>{ const opts=OptionSets.get(cfg.key+'.'+f.k, f.options||[]);
              return `<div style="margin-bottom:16px"><div style="font-weight:700;font-size:13px;margin-bottom:7px">${esc(f.label)}</div>
                <div style="display:flex;gap:7px;flex-wrap:wrap;align-items:center">
                  ${opts.map(o=>`<span style="display:inline-flex;align-items:center;gap:7px;padding:6px 8px 6px 12px;border:1px solid var(--line-strong);border-radius:8px;font-size:13px;font-weight:600">${esc(o)}<button type="button" class="oe-del" data-fk="${esc(f.k)}" data-v="${esc(o)}" title="삭제" style="border:0;background:none;color:var(--faint);cursor:pointer;font-size:13px;padding:0 2px">✕</button></span>`).join('')}
                  <span style="display:inline-flex;gap:5px;align-items:center"><input type="text" class="oe-new" data-fk="${esc(f.k)}" placeholder="추가할 항목" maxlength="18" style="width:130px;height:34px;font-size:13px;border:1px solid var(--line-strong);border-radius:8px;padding:0 10px"><button type="button" class="btn pri sm oe-add" data-fk="${esc(f.k)}">${icon('plus')}추가</button></span>
                </div></div>`; }).join('')}
            <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="btn pri" id="oeClose">${icon('check')}완료</button></div>`;
            inner.querySelectorAll('.oe-del').forEach(b=>b.onclick=()=>{ const fk=b.dataset.fk;
              if(!confirm(`“${b.dataset.v}” 항목을 삭제할까요? (팀 전체 반영)`)) return;
              OptionSets.remove(cfg.key+'.'+fk, (cfg.fields.find(x=>x.k===fk)||{}).options||[], b.dataset.v); refreshSelect(fk); draw(); toast('삭제됨 · 팀 공유'); });
            inner.querySelectorAll('.oe-add').forEach(b=>b.onclick=()=>{ const fk=b.dataset.fk; const inp=inner.querySelector(`.oe-new[data-fk="${fk}"]`);
              const r=OptionSets.add(cfg.key+'.'+fk, (cfg.fields.find(x=>x.k===fk)||{}).options||[], inp.value);
              if(!r.ok){ if(inp.value.trim()) toast('이미 있는 항목입니다'); return; } refreshSelect(fk); draw(); toast('추가됨 · 팀 공유'); });
            inner.querySelectorAll('.oe-new').forEach(inp=>inp.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); inner.querySelector(`.oe-add[data-fk="${inp.dataset.fk}"]`).click(); } });
            inner.querySelector('#oeClose').onclick=()=>ov.remove();
          }
          draw(); ov.appendChild(inner); ov.onclick=e=>{ if(e.target===ov) ov.remove(); }; document.body.appendChild(ov);
        };
        if($('#btnSync')) $('#btnSync').onclick=renderSyncPanel;
        function renderSyncPanel(){
          const panel=$('#syncPanel'); if(!panel) return;
          if(!panel.classList.contains('hidden')){ panel.classList.add('hidden'); panel.innerHTML=''; return; }
          panel.classList.remove('hidden');
          const c=getSyncCfg(); const headers=cfg.fields.map(f=>f.label).concat(['등록자']);
          panel.innerHTML=`<div class="bd-card">
            <div class="bd-hd"><span class="bd-ic">${icon('cloud')}</span>구글 시트 2차 백업 연동
              <span class="muted" style="font-weight:600;font-size:12.5px;margin-left:6px">· 탭 이름: <b>${esc(tabName)}</b> · 관리자 전용</span></div>
            <div class="bd-bd">
              <ol class="setup-guide" style="margin:0 0 12px">
                <li>백업용 <b>구글 스프레드시트</b>를 하나 준비합니다. <span class="muted" style="font-size:12.5px">(탭은 자동 생성 · 1행 헤더 자동: ${esc(headers.join(' · '))})</span></li>
                <li><b>확장 프로그램 → Apps Script</b>에 <b>[코드 복사]</b>를 붙여넣고 저장. (<span class="mono">SHEET_NAME</span>은 비워두면 이 탭에 기록)</li>
                <li><b>배포 → 새 배포 → 웹 앱</b>(실행: 나 / 액세스: 모든 사용자) → 표시된 <span class="mono">…/exec</span> URL 복사.</li>
                <li>아래에 URL 붙여넣고 <b>저장 → 연결 테스트</b>. <span class="muted" style="font-size:12.5px">같은 스프레드시트를 쓰면 모든 모듈에 같은 URL을 넣어도 됩니다(탭만 달라짐).</span></li>
              </ol>
              <div style="margin-bottom:10px"><button class="btn sm" id="syncCopyCode">${icon('copy')}Apps Script 코드 복사</button></div>
              <label class="fld" style="margin-bottom:12px">웹 앱 URL<input type="text" id="syncUrl" value="${esc(c.sheetUrl||'')}" placeholder="https://script.google.com/macros/s/……/exec"></label>
              <label class="chk" style="margin-bottom:14px"><input type="checkbox" id="syncBackup" ${c.backup!==false?'checked':''}> 저장 시 시트로 <b>자동 백업</b> <span class="muted" style="font-weight:500">· 끄면 내부 서버 기록에만 저장</span></label>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                <button class="btn pri" id="syncSave">${icon('check')}저장</button>
                <button class="btn" id="syncTest">${icon('cloud')}연결 테스트</button>
                <button class="btn" id="syncAll">${icon('cloudUp')}이번 목록 전체 전송</button>
                <button class="btn ghost" id="syncClose">닫기</button>
                <span class="muted" id="syncStat" style="font-size:13px"></span></div>
            </div></div>
          ${cfg.ledger?`<div class="bd-card" style="margin-top:16px">
            <div class="bd-hd"><span class="bd-ic">${icon('grid')}</span>고객 데이터베이스(원장) 연동
              <span class="muted" style="font-weight:600;font-size:12.5px;margin-left:6px">· 저장 시 <b>${esc(cfg.ledger.tab)}</b> 시트에 자동 누적 · 관리자 전용</span></div>
            <div class="bd-bd">
              <div class="note" style="margin-bottom:12px">후불·발주·견적 저장 건이 <b>고객 데이터베이스</b> 원장(<b>${esc(cfg.ledger.tab)}</b>)에 자동으로 쌓여 타겟별·구분별 집계가 최신화됩니다. 아래에 <b>고객DB 스프레드시트</b>에 배포한 Apps Script 웹앱 URL을 넣으세요. (백업 시트와 <b>다른</b> 스프레드시트입니다)</div>
              <div style="margin-bottom:10px"><button class="btn sm" id="cdbCopyCode">${icon('copy')}고객DB Apps Script 코드 복사</button> <span class="muted" style="font-size:12px">· 고객DB 스프레드시트의 Apps Script에 붙여넣고 배포</span></div>
              <label class="fld" style="margin-bottom:12px">고객DB 웹 앱 URL<input type="text" id="cdbUrl" value="${esc(custDbUrl())}" placeholder="https://script.google.com/macros/s/……/exec"></label>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                <button class="btn pri" id="cdbSave">${icon('check')}저장</button>
                <button class="btn" id="cdbTest">${icon('cloud')}연결 테스트</button>
                <button class="btn" id="cdbBackfill">${icon('cloudUp')}조회분 원장 백필</button>
                <span class="muted" id="cdbStat" style="font-size:13px"></span></div>
              <div class="note" style="margin-top:10px;font-size:12px"><b>백필</b>: 지금 <b>조회된 기간</b>의 기록을 원장으로 한 번에 전송합니다(과거 입력분 이관용). 기간을 넓게(예: 30일) 잡고 누르세요. id 기준이라 <b>중복 없음</b> · 전송 후 고객DB에서 <b>[재집계]</b> 실행.</div>
            </div></div>`:''}`;
          if(cfg.ledger){
            panel.querySelector('#cdbCopyCode').onclick=async()=>{ try{ const r=await fetch('integrations/google-apps-script/customerdb.gs'); if(!r.ok) throw 0; copyText(await r.text()); toast('고객DB Apps Script 코드 복사됨'); }catch(e){ toast('코드 파일을 불러오지 못했습니다 — 저장소의 integrations/google-apps-script/customerdb.gs 사용'); } };
            panel.querySelector('#cdbSave').onclick=()=>{ store(STORE.custDbCfg).set({ sheetUrl:panel.querySelector('#cdbUrl').value.trim() }); panel.querySelector('#cdbStat').innerHTML='<span style="color:var(--ok)">✓ 저장됨(팀 공유)</span>'; toast('고객DB 연동 저장'); };
            panel.querySelector('#cdbTest').onclick=async()=>{ const url=panel.querySelector('#cdbUrl').value.trim(), st=panel.querySelector('#cdbStat'); if(!url){ st.textContent='URL을 입력하세요'; return; } st.textContent='테스트 중…';
              try{ const res=await fetch(url+(url.includes('?')?'&':'?')+'sheet='+encodeURIComponent(cfg.ledger.tab)); let d=null; try{d=await res.json();}catch(e){}
                st.innerHTML=res.ok?`<span style="color:var(--ok)">연결 성공 · 원장 <b>"${esc(cfg.ledger.tab)}"</b>${d&&typeof d.rows==='number'?` (${d.rows}행)`:''}</span>`:`<span style="color:var(--danger)">응답 오류 HTTP ${res.status}</span>`; }catch(e){ st.innerHTML=`<span style="color:var(--danger)">연결 실패: ${esc(e.message)}</span>`; } };
            // 백필: 현재 조회된(기간 필터된) 기록을 원장으로 일괄 전송(id upsert · 배치)
            panel.querySelector('#cdbBackfill').onclick=async()=>{
              const st=panel.querySelector('#cdbStat'); if(!custDbUrl()){ st.textContent='먼저 URL을 저장하세요'; return; }
              if(!all.length){ st.textContent='조회된 기록이 없습니다 — 기간을 넓혀보세요'; return; }
              if(!confirm(`현재 조회된 ${all.length}건을 고객DB 원장(${cfg.ledger.tab})으로 전송할까요?\nid 기준이라 여러 번 눌러도 중복되지 않습니다.\n전송 후 고객DB에서 [재집계]를 실행하세요.`)) return;
              const recs=all.map(cfg.ledger.map); const B=150; let sent=0, fail=0;
              const btn=panel.querySelector('#cdbBackfill'); btn.disabled=true;
              for(let i=0;i<recs.length;i+=B){ st.textContent=`전송 중… (${Math.min(i+B,recs.length)}/${recs.length})`;
                const r=await ledgerPost({ sheet:cfg.ledger.tab, records:recs.slice(i,i+B) });
                if(r.ok) sent+=Math.min(B,recs.length-i); else fail+=Math.min(B,recs.length-i); }
              btn.disabled=false;
              st.innerHTML= fail? `<span style="color:var(--danger)">전송 ${sent}건 · 실패 ${fail}건 (다시 시도 안전)</span>` : `<span style="color:var(--ok)">✓ ${sent}건 원장 전송 완료 · 이제 고객DB [재집계] 실행</span>`;
              toast(fail?`백필 ${sent}건 · 실패 ${fail}건`:`원장 백필 ${sent}건 완료`);
            };
          }
          panel.querySelector('#syncClose').onclick=()=>{ panel.classList.add('hidden'); panel.innerHTML=''; };
          panel.querySelector('#syncCopyCode').onclick=async()=>{ try{ const r=await fetch('integrations/google-apps-script/main.gs'); if(!r.ok) throw 0; copyText(await r.text()); toast('Apps Script 코드 복사됨'); }catch(e){ toast('코드 파일을 불러오지 못했습니다 — 저장소의 integrations/google-apps-script/main.gs 사용'); } };
          panel.querySelector('#syncSave').onclick=()=>{ setSyncCfg({ sheetUrl:panel.querySelector('#syncUrl').value.trim(), backup:panel.querySelector('#syncBackup').checked }); panel.querySelector('#syncStat').innerHTML='<span style="color:var(--ok)">✓ 저장됨(팀 공유)</span>'; toast('연동 설정 저장'); };
          panel.querySelector('#syncTest').onclick=async()=>{ const url=panel.querySelector('#syncUrl').value.trim(), st=panel.querySelector('#syncStat'); if(!url){ st.textContent='URL을 입력하세요'; return; } st.textContent='테스트 중…';
            // 이 모듈이 실제로 기록하는 탭(tabName)을 함께 조회 — 표시도 그 탭으로
            try{ const res=await fetch(url+(url.includes('?')?'&':'?')+'sheet='+encodeURIComponent(tabName)); let d=null; try{d=await res.json();}catch(e){}
              st.innerHTML=res.ok?`<span style="color:var(--ok)">연결 성공 · 이 모듈 저장 탭 <b>"${esc(tabName)}"</b>${d&&typeof d.rows==='number'?` (${d.rows}행)`:''}</span>`:`<span style="color:var(--danger)">응답 오류 HTTP ${res.status}</span>`; }catch(e){ st.innerHTML=`<span style="color:var(--danger)">연결 실패: ${esc(e.message)}</span>`; } };
          panel.querySelector('#syncAll').onclick=async()=>{ const st=panel.querySelector('#syncStat'); if(!getSyncCfg().sheetUrl){ st.textContent='먼저 URL을 저장하세요'; return; } st.textContent=`전송 중… (${all.length}건)`;
            const r=await sendSheet(all); st.innerHTML=r.ok?`<span style="color:var(--ok)">${all.length}건 전송${r.unconfirmed?' (응답 확인 불가 · 재전송 안전)':''}</span>`:`<span style="color:var(--danger)">전송 실패: ${esc(r.error||'')}</span>`; };
        }
        if($('#btnCsv')) $('#btnCsv').onclick=()=>{ if(!isAdmin){ toast('시트 다운로드는 관리자만 가능합니다'); return; } const {rows,from,to}=filtered();
          const header=showCols.map(c=>c.label);
          const lines=[header,...rows.map(r=>showCols.map(c=>r[c.k]==null?'':String(r[c.k])))];
          const csv='﻿'+lines.map(r=>r.map(c=>/[",\n]/.test(String(c))?'"'+String(c).replace(/"/g,'""')+'"':c).join(',')).join('\r\n');
          downloadBlob(new Blob([csv],{type:'text/csv'}),`${cfg.title}_${from}_${to}.csv`); toast('CSV로 저장했습니다'); };

        async function load(){
          if(!$('#meta')) return; $('#meta').textContent='불러오는 중…';
          const {from,to}=range(); const ms=monthsBetween(from,to);
          const packs=await Promise.all(ms.map(m=>Records.month(cfg.dept||'md',cfg.sheet,m)));
          if(!root.isConnected||!$('#meta')) return;
          if(packs.some(p=>p===null)){ $('#meta').textContent='서버에서 기록을 불러오지 못했습니다.'; return; }
          const map={}; packs.forEach(p=>(p||[]).forEach(r=>{ if(r&&r.id) map[r.id]=r; }));
          all=Object.values(map); paintWho(); paintFilterOptions(); paint();
        }
        load();
      }
    };
  }

  /* ── 1) 입점사 신규/변동사항 ── */
  buildBoard({ key:'md.vendorchg', title:'입점사 신규/변동사항', icon:'truck', sheet:'vendorchg',
    desc:'신규 제품·입점사 / 공급가 변동·이슈 등 입점사 관련 과업을 팀 공유로 기록·관리합니다.',
    titleField:'title', whoField:'assignee', dateField:'sdate',
    fields:[
      { k:'title', label:'타이틀(업무 내용)', type:'text', req:true, ph:'예: OO사 신규 입점 / △△ 공급가 인상' },
      { k:'status', label:'진행상태', type:'select', options:['대기','[신규] 제품/입점','[기존] 단가/이슈','보류'] },
      { k:'assignee', label:'담당자', type:'agent', options:['여미림','이진환'] },
      { k:'sdate', label:'시작일', type:'date' },
      { k:'edate', label:'종료(예정)일', type:'date' },
      { k:'progress', label:'진행율(%)', type:'number', max:100, ph:'0~100' },
      { k:'note', label:'결정사항', type:'textarea', ph:'무엇을 어떻게 하기로 했는지(결정 내용)' },
      { k:'reason', label:'사유', type:'textarea', ph:'왜 그렇게 결정했는지(판단 근거)' },
      { k:'memo', label:'메모', type:'textarea', ph:'참고·특이사항·후속 메모' },
    ] });

  /* ── 2) 품절관리 현황 ── */
  buildBoard({ key:'md.stock', title:'품절관리 현황', icon:'box', sheet:'stockmgmt',
    desc:'제품별 판매·품절·단종 상태와 처리 내역을 팀 공유로 기록합니다. 자체코드 입력 시 제품명·입점사명이 자동 연동됩니다.',
    titleField:'name', whoField:'handler', dateField:'date', codeField:'code', nameField:'name', vendorField:'vendor',
    filterFields:[{k:'gubun',label:'분류'},{k:'own',label:'자사/입점사'},{k:'vendor',label:'입점사명'},{k:'status',label:'상태'}],
    fields:[
      { k:'date', label:'날짜', type:'date' },
      { k:'gubun', label:'분류', type:'select', options:['판매','품절','단종'] },
      { k:'own', label:'자사/입점사', type:'select', options:['자사 키트','자사 부품','입점사 키트','입점사 부품'] },
      { k:'vendor', label:'입점사명', type:'text', ph:'자체코드 입력 시 자동' },
      { k:'code', label:'자체코드', type:'code', ph:'예: P-AP3' },
      { k:'name', label:'상품관리(제품명)', type:'text', req:true, ph:'자체코드 입력 시 자동' },
      { k:'handler', label:'처리자', type:'agent', options:['여미림','이진환','신아름'] },
      { k:'content', label:'처리내용', type:'textarea', ph:'처리 내용' },
      { k:'status', label:'상태', type:'toggle', onLabel:'완료' },
      { k:'remark', label:'특이사항', type:'textarea', ph:'특이사항' },
    ] });

  /* ── 3) 제품검수 현황 (검수 내역) ── */
  buildBoard({ key:'md.inspect', title:'제품검수 현황', icon:'check', sheet:'inspect',
    desc:'입고 제품의 동작·외관·상세페이지 검수 내역을 기록합니다. 상품코드 입력 시 제품명이 자동 연동됩니다.',
    titleField:'title', whoField:'assignee', dateField:'idate', codeField:'code', nameField:'name',
    fields:[
      { k:'title', label:'검수(제목)', type:'text', req:true, ph:'예: OO 입고 검수' },
      { k:'idate', label:'입고일자', type:'date' },
      { k:'cdate', label:'검수일자', type:'date' },
      { k:'assignee', label:'담당자', type:'agent', options:['여미림','이진환'] },
      { k:'code', label:'상품코드', type:'code', ph:'예: C-19' },
      { k:'name', label:'제품명', type:'text', ph:'상품코드 입력 시 자동' },
      { k:'func', label:'동작 기능', type:'select', options:['O','X'] },
      { k:'appear', label:'외관 및 구성품', type:'select', options:['O','X'] },
      { k:'detail', label:'상세페이지 수정', type:'select', options:['O','X'] },
      { k:'remark', label:'특이사항', type:'textarea', ph:'특이사항' },
    ] });

  /* ── 4) 상품관리 현황 ── */
  buildBoard({ key:'md.prodmgmt', title:'상품관리 현황', icon:'grid', sheet:'prodmgmt',
    desc:'판매·가격·썸네일·상세페이지 등 상품 관리 작업 처리 내역을 팀 공유로 기록합니다. 자체코드 입력 시 제품명이 자동 연동됩니다.',
    titleField:'name', whoField:'handler', dateField:'date', codeField:'code', nameField:'name',
    fields:[
      { k:'name', label:'상품관리(제품명)', type:'text', req:true, ph:'자체코드 입력 시 자동' },
      { k:'date', label:'날짜', type:'date' },
      { k:'handler', label:'처리자', type:'agent', options:['여미림','신아름','이진환'] },
      { k:'gubun', label:'분류', type:'select', options:['판매','품절','가격','신규상품','단종','썸네일','상세페이지'] },
      { k:'code', label:'자체코드', type:'code', ph:'예: P-AJ26' },
      { k:'content', label:'처리내용', type:'textarea', ph:'처리 내용' },
      { k:'status', label:'상태', type:'toggle', onLabel:'완료' },
      { k:'datetext', label:'날짜(기록용)', type:'text', ph:'예: 3/14, 3월 중' },
      { k:'remark', label:'특이사항', type:'textarea', ph:'특이사항' },
    ] });

  // 상품관리·품절관리·제품검수를 한 메뉴에서 서브탭으로 (개별 보드는 그대로 유지 · 임베드)
  MODULES['md.prodhub']={
    title:'상품·품절 관리', icon:'grid',
    render(root){
      const SUBS=[
        { t:'prodmgmt', key:'md.prodmgmt', label:'상품관리' },
        { t:'stock',    key:'md.stock',    label:'품절관리' },
        { t:'inspect',  key:'md.inspect',  label:'제품검수' },
      ];
      let tab='prodmgmt';
      root.innerHTML=`
        <div class="mhead">
          <div class="tt">상품·품절 관리</div>
          <div class="ds">상품관리 · 품절관리 · 제품검수 현황을 한 곳에서 관리합니다.</div>
          <div class="mtabs">${SUBS.map(s=>`<div class="t" data-t="${s.t}">${esc(s.label)}</div>`).join('')}</div>
        </div>
        <div class="mbody wide" id="phBody"></div>`;
      const body=root.querySelector('#phBody');
      root.querySelectorAll('.mtabs .t').forEach(t=>{ t.classList.toggle('on',t.dataset.t===tab);
        t.onclick=()=>{ tab=t.dataset.t; root.querySelectorAll('.mtabs .t').forEach(x=>x.classList.toggle('on',x.dataset.t===tab)); draw(); }; });
      function draw(){ const s=SUBS.find(x=>x.t===tab)||SUBS[0]; embedModule(body, s.key); }
      draw();
    }
  };

  // 다른 모듈(CS 등)에서 같은 엔진으로 현황판을 만들 수 있도록 공개
  window.buildBoard = buildBoard;
})();
