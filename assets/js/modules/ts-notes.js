/* ===========================================================================
   MD · TS 상담 메모 (기술상담) — 노션 시트 구조 그대로
   - 기록 항목: 날짜·문의플랫폼·담당자·상품코드·상품구분·제품명·고객정보·문의사항·답변요약·답변원본·비고
   - CS 상담 메모와 동일한 UX: 통화/문의 중 빠른 입력(Ctrl+Enter 저장) → 내부 TS 상담 기록 + 구글시트 동시 저장
   - 문의플랫폼·상품구분은 칩 토글(편집 가능) · 담당자 지정 · 상품코드 입력 시 제품명 자동연동
   =========================================================================== */
(function(){

  /* 내부 레코드 → 구글시트 헤더 이름으로 매핑 (Apps Script가 헤더 이름으로 칸을 맞춤) */
  function toSheetRecord(r){
    const o={ id:r.id };
    for(const k in TS_SHEET_MAP){ o[TS_SHEET_MAP[k]] = r[k]!=null ? r[k] : ''; }
    return o;
  }

  /* 일일 결산 저장 기본 양식 (사용자 커스텀 가능 · 토큰 치환) */
  const DEFAULT_SUM_TPL =
`[{날짜} TS 상담 결산]
총 {총건수}건

■ 문의플랫폼별
{플랫폼별}

■ 담당자별
{담당자별}`;

  /* ---- 목적지(destination) 추상화 — CS와 동일 패턴 ---- */
  const DESTINATIONS = {
    sheet: {
      id:'sheet', name:'구글 시트',
      configured: cfg => !!(cfg && cfg.sheetUrl),
      async send(records, cfg){
        const payload = records.map(toSheetRecord);
        const opts={ method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify({ sheet:'TS상담메모', records: payload }) };
        try{
          const res = await fetch(cfg.sheetUrl, opts);
          if(!res.ok) throw new Error('HTTP '+res.status);
          let data=null; try{ data = await res.json(); }catch{}
          if(data && data.ok===false) throw new Error(data.error||'시트 처리 실패(보호된 시트 등)');
          return { syncedIds: (data && data.synced) ? data.synced : records.map(r=>r.id) };
        }catch(err){
          if(/failed to fetch|networkerror|load failed|cors/i.test(err.message||'')){
            await fetch(cfg.sheetUrl, {...opts, mode:'no-cors'});
            return { syncedIds: records.map(r=>r.id), unconfirmed:true };
          }
          throw err;
        }
      },
    },
  };
  const ACTIVE_DEST = 'sheet';

  /* ---- 데이터/동기화 ---- */
  const notesDB = ()=>store(STORE.tsNotes);
  const cfgDB   = ()=>store(STORE.tsNoteCfg);
  const getNotes = ()=>notesDB().get([]);
  const setNotes = (v)=>notesDB().set(v);
  const getCfg = ()=>cfgDB().get({ sheetUrl:'', backup:true });
  const setCfg = (v)=>cfgDB().set(v);
  const unsynced = (list)=> (list||getNotes()).filter(r=>!r.syncedAt);

  async function syncRecords(records){
    const cfg=getCfg(), dest=DESTINATIONS[ACTIVE_DEST];
    if(!dest.configured(cfg)) return { ok:false, error:'시트 URL이 설정되지 않았습니다', synced:0 };
    if(!records.length) return { ok:true, synced:0 };
    try{
      const { syncedIds, unconfirmed } = await dest.send(records, cfg);
      const set=new Set(syncedIds), stamp=nowISO(); const all=getNotes();
      all.forEach(r=>{ if(set.has(r.id)) r.syncedAt=stamp; });
      setNotes(all);
      return { ok:true, synced:syncedIds.length, unconfirmed };
    }catch(err){
      return { ok:false, error: err.message||'전송 실패', synced:0 };
    }
  }
  // 상담 기록(누적 시트) 화면에서 편집 후 구글시트에 재전송할 수 있도록 노출
  window.TSSheet = { configured:()=>DESTINATIONS[ACTIVE_DEST].configured(getCfg()), send:syncRecords };

  // 미전송분 자동 재시도 (주기 + 재접속 시)
  async function retrySync(){
    try{ const u=unsynced(); if(!u.length) return; const cfg=getCfg();
      if(window.Records) u.forEach(r=>Records.pushTS(r));
      if(cfg.backup!==false && DESTINATIONS[ACTIVE_DEST].configured(cfg)) await syncRecords(u);
    }catch(e){}
  }
  setInterval(retrySync, 90000);
  window.addEventListener('online', retrySync);

  /* ---- 상품코드 → 제품명 조회 (카탈로그 API, 결과 캐시) ---- */
  const codeCache = {};
  async function lookupProduct(code){
    const c=String(code||'').trim().toUpperCase(); if(!c) return {product:null,options:[]};
    if(Object.prototype.hasOwnProperty.call(codeCache, c)) return codeCache[c];
    try{ const r=await fetch('/api/catalog?code='+encodeURIComponent(c)); const d=await r.json();
      const res={ product:(d&&d.product)||null, options:(d&&d.options)||[] }; codeCache[c]=res; return res; }catch(e){ return {product:null,options:[]}; }
  }

  /* ============================================================ */
  MODULES['md.tsnotes'] = {
    title:'TS상담 메모', icon:'clipboard',
    render(root){
      // 문의플랫폼(분류) — 사용자 편집 가능
      const typesDB=store(STORE.tsTypes);
      const getTypes=()=> typesDB.get(TS_PLATFORMS.slice());
      const setTypes=(v)=> typesDB.set(v);
      // 담당자 목록 (사용자 편집)
      const agentsDB=store(STORE.tsAgents);
      const getAgents=()=> agentsDB.get(TS_AGENTS.slice());
      const setAgents=(v)=> agentsDB.set(v);
      // 결산 양식
      const sumTplDB=store(STORE.tsSumTpl);
      const getSumTpl=()=> sumTplDB.get(DEFAULT_SUM_TPL);
      const setSumTpl=(v)=> sumTplDB.set(v);

      // 옛 레코드 보정
      (function migrate(){ const all=getNotes(); let ch=false;
        all.forEach(r=>{ if(r.date==null){ r.date=todayStr(r.createdAt); ch=true; }
          ['platform','prodType','prodCode','prodName','customer','content','answerSummary','answer','remark'].forEach(k=>{ if(r[k]==null){ r[k]=''; ch=true; } }); });
        if(ch) setNotes(all); })();

      let tab='memo', filter='전체', lastAgent=store(STORE.tsAgent).get(getAgents()[0]);
      const isAdmin=!!(Auth.isAdmin&&Auth.isAdmin());
      const meName=((Auth.user&&Auth.user())||{}).name||'';
      // 담당자가 TS 담당자 목록에 있으면 본인으로 기본선택
      if(!isAdmin && meName && getAgents().includes(meName)) lastAgent=meName;
      let typeEdit=false, agentEdit=false;
      let form={ platform:getTypes()[0], prodType:'', date:todayStr(), agent:lastAgent };

      root.innerHTML=`
      <style>
        .q-card{border:1px solid var(--line);border-radius:14px;background:var(--panel);overflow:hidden;margin-bottom:20px;box-shadow:var(--sh)}
        .q-hd{display:flex;align-items:center;gap:10px;padding:14px 20px;background:linear-gradient(180deg,var(--panel-2),var(--panel));border-bottom:1px solid var(--line);font-weight:800;font-size:15.5px}
        .q-hd .q-ic{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;
          background:var(--red-soft);color:var(--red);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--red) 22%,transparent)}
        .q-hd .q-ic svg{width:15px;height:15px}
        .today-stat{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}
        .ts{display:flex;align-items:center;gap:11px;padding:11px 16px;border:1px solid var(--line);border-radius:11px;background:var(--panel);box-shadow:var(--sh-sm);min-width:150px;flex:1 1 0}
        .ts .ts-ic{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex:none;font-size:17px}
        .ts.me .ts-ic{background:var(--red-soft);color:var(--red)} .ts.day .ts-ic{background:var(--info-bg);color:var(--info)} .ts.week .ts-ic{background:var(--ok-bg);color:var(--ok)}
        .ts .ts-l{font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.03em;text-transform:uppercase}
        .ts .ts-v{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--ink);line-height:1.15}
        .ts .ts-v small{font-size:12.5px;font-weight:600;color:var(--muted);margin-left:2px}
        .q-hd .kbd{margin-left:auto;font-size:12.5px;font-weight:600;color:var(--muted)}
        .q-hd .kbd b{background:var(--panel);border:1px solid var(--line-strong);border-radius:5px;padding:1px 7px;color:var(--ink-2)}
        .q-bd{padding:20px}
        .q-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:22px;align-items:start}
        @media(max-width:920px){.q-grid{grid-template-columns:1fr}}
        .q-main{display:flex;flex-direction:column;gap:17px}
        .q-sec-cap{font-size:11.5px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.06em;margin-bottom:9px;display:flex;align-items:center;gap:8px}
        .q-sec-cap .req{font-size:10px;font-weight:800;color:var(--red);background:var(--red-soft);border-radius:4px;padding:2px 6px;letter-spacing:.02em}
        .q-sec-cap .opt{font-size:11px;font-weight:500;color:var(--faint);text-transform:none;letter-spacing:0}
        .chips{display:flex;gap:7px;flex-wrap:wrap}
        .chip{display:inline-flex;align-items:center;gap:6px;padding:8px 15px;border:1px solid var(--line-strong);border-radius:8px;background:var(--panel);
          font-size:13.5px;font-weight:600;color:var(--ink-2);cursor:pointer;transition:border-color .12s,background .12s,box-shadow .12s,transform .12s;user-select:none;line-height:1.2}
        .chip:hover{border-color:var(--faint);background:var(--panel-2);transform:translateY(-1px)}
        .chip.on{border-color:var(--red);background:var(--red-soft);color:var(--red);font-weight:700;box-shadow:inset 0 0 0 1px var(--red),0 1px 3px color-mix(in srgb,var(--red) 20%,transparent)}
        .chip .q-del{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;
          background:var(--line-strong);color:#fff;font-size:10px;font-weight:800}
        .chip.on .q-del{background:var(--red);color:#fff}
        .sec-edit{margin-left:auto;background:none;border:0;color:var(--muted);font-size:12px;font-weight:700;cursor:pointer;padding:3px 8px;border-radius:6px;text-transform:none;letter-spacing:0}
        .sec-edit:hover{background:var(--hover);color:var(--red)} .sec-edit.on{color:var(--red)}
        .chip-add{display:flex;gap:6px;align-items:center}
        .chip-add input{height:auto;padding:8px 10px;font-size:13.5px;width:118px}
        .q-memo{width:100%;min-height:130px;font-size:15px;line-height:1.6;padding:14px;border:1.5px solid var(--line-strong);border-radius:10px;background:var(--panel);resize:vertical}
        .q-memo:focus{border-color:var(--red);box-shadow:0 0 0 3px var(--red-soft)}
        .q-ans{width:100%;min-height:72px;font-size:14px;line-height:1.55;padding:12px;border:1.5px solid var(--line-strong);border-radius:10px;resize:vertical}
        .q-ans:focus{border-color:var(--red);box-shadow:0 0 0 3px var(--red-soft)}
        .q-side{background:var(--panel-2);border:1px solid var(--line);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:14px}
        .q-side .cap{display:block;font-size:11.5px;font-weight:700;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em}
        .q-side .cap em{font-style:normal;font-weight:500;color:var(--faint);margin-left:4px;text-transform:none;letter-spacing:0}
        .q-side input[type=text],.q-side input[type=date]{height:42px;font-size:14.5px;width:100%}
        .q-agents{display:flex;flex-wrap:wrap;gap:7px}
        .q-save{width:100%;justify-content:center;margin-top:2px}
        .side-cap-row{display:flex;align-items:center;margin-bottom:6px}
        .pname-hint{font-size:12px;color:var(--info);margin-top:5px;min-height:16px}
        .pname-hint.warn{color:var(--warn)}
        .note-card{display:grid;grid-template-columns:58px 92px 1fr auto;gap:12px;align-items:start;padding:12px 14px;border:1px solid var(--line);border-radius:9px;background:var(--panel);margin-bottom:8px}
        .note-card .tm{font-variant-numeric:tabular-nums;color:var(--muted);font-size:13.5px;font-weight:600}
        .note-card .memo{font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
        .note-card .ans{font-size:13px;line-height:1.5;color:var(--ink-2);margin-top:3px;white-space:pre-wrap;word-break:break-word}
        .note-card .ans::before{content:"↳ 답변  ";color:var(--faint);font-weight:700}
        .note-card .sub{font-size:12.5px;color:var(--muted);margin-top:4px}
        .note-card .sub2{font-size:11.5px;color:var(--faint);margin-top:3px}
        .sum-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
        .sum-card{border:1px solid var(--line);border-radius:10px;padding:14px 16px;background:var(--panel)}
        .sum-card .lb{font-size:13px;color:var(--muted)}
        .sum-card .vl{font-size:26px;font-weight:800;font-variant-numeric:tabular-nums;margin-top:4px}
        .syncbar{display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #ead9b0;background:var(--warn-bg);border-radius:8px;margin-bottom:14px;font-size:13.5px;color:#7a4d06}
        .syncbar.ok{border-color:#bfe6cf;background:var(--ok-bg);color:#0b6b41}
        .badge.synced{background:var(--ok-bg);color:var(--ok)}
        .badge.pending{background:var(--warn-bg);color:var(--warn)}
        .tpl-tokens{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
        .chip.sm{padding:5px 10px;font-size:12px;font-family:var(--mono)}
      </style>
      <div class="mhead">
        <div class="tt">TS상담 메모</div>
        <div class="ds">기술상담(TS) 문의를 문의플랫폼·상품구분을 누르고 내용을 적으면(Ctrl+Enter 저장) <b>내부 TS 상담 기록과 구글시트에 동시에 저장</b>됩니다. 상품코드를 넣으면 제품명이 자동으로 채워집니다.</div>
        <div class="mtabs">
          <div class="t" data-t="memo">TS 상담 메모</div>
          <div class="t" data-t="records">TS 상담 기록</div>
          <div class="t" data-t="summary">일일 결산</div>
          ${isAdmin?'<div class="t" data-t="settings">연동 설정</div>':''}
        </div>
      </div>
      <div class="mbody" id="tsBody"></div>`;
      const body=root.querySelector('#tsBody');
      root.querySelectorAll('.mtabs .t').forEach(t=>{ t.classList.toggle('on',t.dataset.t===tab);
        t.onclick=()=>{ tab=t.dataset.t; root.querySelectorAll('.mtabs .t').forEach(x=>x.classList.toggle('on',x.dataset.t===tab)); draw(); }; });
      const draw=()=>{ if(tab==='settings' && !isAdmin) tab='memo';
        return tab==='memo'?drawMemo(): tab==='records'?embedModule(body,'md.tsrecords'): tab==='summary'?drawSummary(): drawSettings(); };

      /* ---------------- TS 상담 메모 탭 ---------------- */
      function drawMemo(){
        body.innerHTML=`
          <div class="today-stat" id="todayStat" style="display:none"></div>
          <div class="q-card">
            <div class="q-hd"><span class="q-ic">${icon('clipboard')}</span>빠른 입력
              <span class="kbd">저장 후 자동 초기화 · <b>Ctrl</b>+<b>Enter</b> 저장</span></div>
            <div class="q-bd">
              <form id="qform">
                <div class="q-grid">
                  <div class="q-main">
                    <div>
                      <div class="q-sec-cap">문의플랫폼 <span class="req">필수</span>
                        ${isAdmin?'<button type="button" class="sec-edit" id="typeEdit">편집</button>':''}</div>
                      <div class="chips" id="platGroup"></div>
                    </div>
                    <div>
                      <div class="q-sec-cap">상품구분 <span class="opt">선택 · 다시 누르면 해제</span>
                        ${isAdmin?'<button type="button" class="sec-edit" id="ptypeEdit">편집</button>':''}</div>
                      <div class="chips" id="ptypeGroup"></div>
                    </div>
                    <div>
                      <div class="q-sec-cap">문의사항 <span class="req">필수</span></div>
                      <textarea id="fContent" class="q-memo" placeholder="문의 내용을 입력하세요 — 자유롭게 기록" required></textarea>
                    </div>
                    <div>
                      <div class="q-sec-cap">답변요약 <span class="opt">선택</span></div>
                      <textarea id="fAnsSum" class="q-ans" placeholder="답변 핵심 요약 (한두 줄)"></textarea>
                    </div>
                    <div>
                      <div class="q-sec-cap">답변원본 <span class="opt">선택</span></div>
                      <textarea id="fAnswer" class="q-ans" placeholder="고객에게 보낸 답변 전문 (복사·붙여넣기)"></textarea>
                    </div>
                  </div>

                  <aside class="q-side">
                    <div>
                      <div class="side-cap-row"><span class="cap" style="margin:0">담당자</span></div>
                      <div class="q-agents" id="agentGroup"></div>
                    </div>
                    <div><span class="cap">날짜</span><input type="date" id="fDate" value="${esc(form.date)}"></div>
                    <div><span class="cap">상품코드 <em>선택 · 제품명 자동연동</em></span>
                      <input type="text" id="fProdCode" list="dlCode" autocomplete="off" placeholder="예: P-AA1"><datalist id="dlCode"></datalist>
                      <div class="pname-hint" id="pnameHint"></div></div>
                    <div><span class="cap">제품명 <em>자동/수정 가능</em></span><input type="text" id="fProdName" placeholder="상품코드 입력 시 자동"></div>
                    <div><span class="cap">고객정보 <em>선택</em></span><input type="text" id="fCustomer" placeholder="이름·연락처·업체 등"></div>
                    <div><span class="cap">비고 <em>선택</em></span><input type="text" id="fRemark" placeholder="특이사항"></div>
                    <button type="submit" class="btn pri lg q-save">${icon('save')}저장 <span style="opacity:.7;font-weight:500;font-size:12px">Ctrl+Enter</span></button>
                  </aside>
                </div>
              </form>
            </div>
          </div>

          <div id="syncSlot"></div>

          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
            <h3 style="font-size:16px">오늘 기록 <span class="muted" style="font-weight:500;font-size:13.5px" id="todayCnt"></span></h3>
            <div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap" id="filters"></div>
          </div>
          <div id="noteList"></div>`;

        /* --- 문의플랫폼 칩 (편집 가능) --- */
        const platGroup=body.querySelector('#platGroup');
        function renderPlat(){
          const types=getTypes();
          if(!types.includes(form.platform)) form.platform=types[0];
          platGroup.innerHTML='';
          types.forEach(t=>{ const b=el('button','chip'+(t===form.platform?' on':'')); b.type='button';
            b.innerHTML=`<span>${esc(t)}</span>${typeEdit&&types.length>1?`<span class="q-del" title="삭제">✕</span>`:''}`;
            b.onclick=(e)=>{
              if(e.target.classList.contains('q-del')){ const nt=types.filter(x=>x!==t); setTypes(nt); if(form.platform===t)form.platform=nt[0]; renderPlat(); renderFilters(); return; }
              if(typeEdit) return;
              form.platform=t; renderPlat();
            };
            platGroup.appendChild(b);
          });
          if(typeEdit){ const add=el('div','chip-add');
            add.innerHTML=`<input type="text" id="newType" placeholder="새 플랫폼" maxlength="12">
              <button type="button" class="btn pri sm" id="addTypeBtn">${icon('plus')}추가</button>`;
            const doAdd=()=>{ const v=add.querySelector('#newType').value.trim();
              if(!v) return; const cur=getTypes(); if(cur.includes(v)){ toast('이미 있는 플랫폼입니다'); return; }
              cur.push(v); setTypes(cur); renderPlat(); renderFilters();
              const ni=platGroup.querySelector('#newType'); if(ni) ni.focus(); };
            add.querySelector('#addTypeBtn').onclick=doAdd;
            add.querySelector('#newType').onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); doAdd(); } };
            platGroup.appendChild(add);
          }
        }
        { const te=body.querySelector('#typeEdit'); if(te) te.onclick=(e)=>{ typeEdit=!typeEdit;
          e.currentTarget.classList.toggle('on',typeEdit); e.currentTarget.textContent=typeEdit?'완료':'편집'; renderPlat(); }; }
        renderPlat();

        /* --- 상품구분 칩 (단일선택 · 관리자는 ＋추가/×삭제 → 팀 자동 공유) --- */
        const PTYPE_SET='md.tsnotes.prodType';
        let ptypeEdit=false;
        function renderChoice(sel, _o, key){
          const g=body.querySelector(sel); if(!g) return;
          const options=OptionSets.get(PTYPE_SET, TS_PRODUCT_TYPES); const edit=isAdmin && ptypeEdit;
          if(form[key] && !options.includes(form[key])) form[key]='';
          g.innerHTML='';
          options.forEach(o=>{ const b=el('button','chip'+(form[key]===o?' on':'')); b.type='button';
            b.innerHTML=`<span>${esc(o)}</span>${edit&&options.length>1?'<span class="q-del" title="삭제">✕</span>':''}`;
            b.onclick=(e)=>{ if(e.target.classList.contains('q-del')){ OptionSets.remove(PTYPE_SET,TS_PRODUCT_TYPES,o); if(form[key]===o)form[key]=''; renderChoice(sel,_o,key); return; }
              if(edit) return; form[key]=(form[key]===o?'':o); renderChoice(sel,_o,key); };
            g.appendChild(b); });
          if(edit){ const add=el('div','chip-add');
            add.innerHTML=`<input type="text" class="optNew" placeholder="새 상품구분" maxlength="14"><button type="button" class="btn pri sm optAdd">${icon('plus')}추가</button>`;
            const doAdd=()=>{ const inp=add.querySelector('.optNew'); const r=OptionSets.add(PTYPE_SET,TS_PRODUCT_TYPES,inp.value);
              if(!r.ok){ if(inp.value.trim()) toast('이미 있는 항목입니다'); return; } renderChoice(sel,_o,key);
              const ni=g.querySelector('.optNew'); if(ni) ni.focus(); };
            add.querySelector('.optAdd').onclick=doAdd;
            add.querySelector('.optNew').onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); doAdd(); } };
            g.appendChild(add);
          }
        }
        renderChoice('#ptypeGroup', null, 'prodType');
        { const pe=body.querySelector('#ptypeEdit'); if(pe) pe.onclick=(e)=>{ ptypeEdit=!ptypeEdit;
          e.currentTarget.classList.toggle('on',ptypeEdit); e.currentTarget.textContent=ptypeEdit?'완료':'편집'; renderChoice('#ptypeGroup',null,'prodType'); }; }

        /* --- 상품코드 → 제품명 자동연동 --- */
        (function(){
          const codeEl=body.querySelector('#fProdCode'), nameEl=body.querySelector('#fProdName'), hint=body.querySelector('#pnameHint');
          const notes=getNotes(); const recentCodes=[...new Set(notes.map(r=>r.prodCode).filter(Boolean))].slice(-40).reverse();
          const cl=body.querySelector('#dlCode'); if(cl) cl.innerHTML=recentCodes.map(v=>`<option value="${esc(v)}">`).join('');
          // 수기로 제품명을 고치면 자동덮어쓰기 중단
          nameEl.addEventListener('input',()=>{ nameEl.dataset.auto=''; });
          let seq=0;
          const run=()=>{ const code=codeEl.value.trim(); const my=++seq;
            if(!code){ hint.textContent=''; hint.className='pname-hint'; if(nameEl.dataset.auto==='1'){ nameEl.value=''; nameEl.dataset.auto=''; } return; }
            hint.textContent='조회 중…'; hint.className='pname-hint';
            lookupProduct(code).then(res=>{ if(my!==seq || !body.isConnected) return; const p=res.product;
              if(p){ hint.textContent='✓ '+(p.name||'(이름 없음)'); hint.className='pname-hint';
                if(!nameEl.value.trim() || nameEl.dataset.auto==='1'){ nameEl.value=p.name||''; nameEl.dataset.auto='1'; } }
              else if(res.options && res.options.length){ hint.innerHTML=`옵션 상품 ${res.options.length}개 — `+res.options.slice(0,6).map(o=>`<a href="#" data-c="${esc(o.selfCode)}" style="color:var(--info);text-decoration:underline">${esc(o.selfCode)}</a>`).join(', ')+(res.options.length>6?' …':''); hint.className='pname-hint';
                hint.querySelectorAll('a[data-c]').forEach(a=>a.onclick=(e)=>{ e.preventDefault(); codeEl.value=a.dataset.c; nameEl.dataset.auto=''; run(); }); }
              else { hint.textContent='미등록 상품코드 — 제품명을 직접 입력하세요'; hint.className='pname-hint warn'; }
            });
          };
          let tmr=null; codeEl.addEventListener('input',()=>{ clearTimeout(tmr); tmr=setTimeout(run, 300); });
        })();

        /* --- 오늘 처리량 위젯 : 최근 기록 프리페치 --- */
        (function(){
          const ymd=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
          const dayOf=r=>String(r.date||r.day||'').slice(0,10);
          const today=todayStr(); const ws=new Date(); ws.setDate(ws.getDate()-((ws.getDay()+6)%7)); const wkStart=ymd(ws);
          const months=[...new Set([today.slice(0,7), wkStart.slice(0,7)])];
          if(!window.Records) return;
          Promise.all(months.map(m=>Records.month('md','tsnotes',m))).then(packs=>{
            if(!body.isConnected) return;
            const hist=packs.filter(Boolean).flat();
            const box=body.querySelector('#todayStat'); if(!box) return;
            const myName=meName||((Auth.user&&Auth.user()||{}).name)||'';
            const todayN=hist.filter(r=>dayOf(r)===today).length;
            const weekN=hist.filter(r=>{ const d=dayOf(r); return d>=wkStart&&d<=today; }).length;
            const mineN=hist.filter(r=>dayOf(r)===today && (r.agent||r.whoName||'')===myName).length;
            box.innerHTML=`
              <div class="ts me"><span class="ts-ic">🙋</span><div><div class="ts-l">오늘 나</div><div class="ts-v">${mineN}<small>건</small></div></div></div>
              <div class="ts day"><span class="ts-ic">📋</span><div><div class="ts-l">오늘 TS(팀)</div><div class="ts-v">${todayN}<small>건</small></div></div></div>
              <div class="ts week"><span class="ts-ic">🗓️</span><div><div class="ts-l">이번 주(팀)</div><div class="ts-v">${weekN}<small>건</small></div></div></div>`;
            box.style.display='flex';
          }).catch(()=>{});
        })();

        /* --- 담당자 드롭다운 (공간 효율 · 관리자는 목록에서 직접 추가) --- */
        function renderAgents(){
          const g=body.querySelector('#agentGroup'); g.innerHTML='';
          const agents=getAgents();
          if(!isAdmin && meName && agents.includes(meName)){   // 담당자 본인이면 고정
            form.agent=meName;
            g.innerHTML=`<select disabled style="width:100%;height:40px"><option>${esc(form.agent)}</option></select>
              <div class="muted" style="font-size:11.5px;margin-top:4px">본인 계정으로 자동 기록됩니다</div>`;
            return;
          }
          if(!agents.includes(form.agent)) form.agent = agents.includes(lastAgent)?lastAgent:(agents[0]||'');
          const buildOpts=cur=>`<option value="">(담당자 선택)</option>${getAgents().map(o=>`<option ${o===cur?'selected':''}>${esc(o)}</option>`).join('')}${isAdmin?'<option value="__add">＋ 담당자 추가…</option>':''}`;
          g.innerHTML=`<select id="agentSel" style="width:100%;height:40px;font-size:14.5px">${buildOpts(form.agent)}</select>`;
          const sel=g.querySelector('#agentSel');
          sel.onchange=()=>{ if(sel.value==='__add'){ const v=(prompt('추가할 담당자 이름','')||'').trim();
              if(v){ const cur=getAgents(); if(!cur.includes(v)){ cur.push(v); setAgents(cur); } form.agent=v; store(STORE.tsAgent).set(v); lastAgent=v; sel.innerHTML=buildOpts(v); }
              else { sel.value=form.agent||''; } return; }
            form.agent=sel.value; if(sel.value){ store(STORE.tsAgent).set(sel.value); lastAgent=sel.value; } };
        }
        renderAgents();

        // 저장
        const form_el=body.querySelector('#qform');
        const submit=()=>{
          const content=body.querySelector('#fContent').value.trim();
          if(!content){ body.querySelector('#fContent').focus(); toast('문의사항을 입력하세요'); return; }
          const agent=form.agent||lastAgent||'-';
          store(STORE.tsAgent).set(agent); lastAgent=agent;
          form.date=body.querySelector('#fDate').value||todayStr();
          const rec={ id:uuid(), createdAt:nowISO(),
            date:form.date, platform:form.platform, agent,
            prodCode:body.querySelector('#fProdCode').value.trim(),
            prodType:form.prodType,
            prodName:body.querySelector('#fProdName').value.trim(),
            customer:body.querySelector('#fCustomer').value.trim(),
            content, answerSummary:body.querySelector('#fAnsSum').value.trim(),
            answer:body.querySelector('#fAnswer').value.trim(),
            remark:body.querySelector('#fRemark').value.trim(), syncedAt:null };
          const all=getNotes(); all.push(rec); setNotes(all);
          if(window.Records) Records.pushTS(rec);
          // 폼 초기화 (플랫폼·담당자·날짜 유지)
          form.prodType='';
          renderChoice('#ptypeGroup', TS_PRODUCT_TYPES, 'prodType');
          ['fContent','fAnsSum','fAnswer','fProdCode','fProdName','fCustomer','fRemark'].forEach(id=>{ const e2=body.querySelector('#'+id); if(e2){ e2.value=''; e2.dataset.auto=''; } });
          body.querySelector('#pnameHint').textContent='';
          body.querySelector('#fContent').focus();
          renderList(); renderSyncBar(); toast('저장되었습니다');
          const cfg=getCfg();
          if(cfg.backup!==false && DESTINATIONS[ACTIVE_DEST].configured(cfg)){
            syncRecords([rec]).then(r=>{ renderList(); renderSyncBar(); if(!r.ok) toast('구글시트 전송 실패 — 내부 기록에는 저장됨'); });
          }
        };
        form_el.addEventListener('submit',e=>{ e.preventDefault(); submit(); });
        form_el.addEventListener('keydown',e=>{ if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){ e.preventDefault(); submit(); } });

        // 필터
        function renderFilters(){ const fbar=body.querySelector('#filters'); if(!fbar) return; fbar.innerHTML='';
          if(!['전체',...getTypes()].includes(filter)) filter='전체';
          ['전체',...getTypes()].forEach(f=>{ const b=el('button','btn sm'+(f===filter?' pri':''),esc(f));
            b.onclick=()=>{ filter=f; renderFilters(); renderList(); }; fbar.appendChild(b); }); }
        renderFilters();

        renderList(); renderSyncBar();
        body.querySelector('#fContent')?.focus();
      }

      function todayNotes(){ const t=todayStr();
        return getNotes().filter(r=>todayStr(r.createdAt)===t && (isAdmin || !meName || r.agent===meName)); }
      function renderList(){
        const box=body.querySelector('#noteList'), cnt=body.querySelector('#todayCnt'); if(!box) return;
        let list=todayNotes().sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
        if(cnt) cnt.textContent=`· 총 ${list.length}건`;
        if(filter!=='전체') list=list.filter(r=>r.platform===filter);
        if(!list.length){ box.innerHTML=`<div class="empty">${icon('clipboard')}<div style="font-size:13.5px">${filter==='전체'?'오늘 기록이 아직 없습니다.':'해당 플랫폼 기록이 없습니다.'}</div></div>`; return; }
        box.innerHTML=''; list.forEach(r=>box.appendChild(noteCard(r)));
      }
      function noteCard(r){
        const c=el('div','note-card');
        const sync = r.syncedAt?`<span class="badge synced">시트 완료</span>`:`<span class="badge pending">시트 대기</span>`;
        const meta=[r.agent, r.prodType, r.prodCode, r.prodName, r.customer, r.remark].filter(Boolean).map(esc).join(' · ');
        const ans=r.answerSummary||r.answer||'';
        c.innerHTML=`
          <div class="tm">${timeHM(r.createdAt)}</div>
          <div><span class="badge info">${esc(r.platform||'-')}</span></div>
          <div>
            <div class="memo">${esc(r.content||'')}</div>
            ${ans?`<div class="ans">${esc(ans)}</div>`:''}
            <div class="sub">${meta} ${sync}</div>
          </div>
          <div style="display:flex;gap:4px">
            <button class="btn ghost sm" data-a="edit">수정</button>
            <button class="btn ghost sm" data-a="del">${icon('trash')}</button>
          </div>`;
        c.querySelector('[data-a=del]').onclick=()=>{ if(confirm('이 기록을 삭제할까요?')){ setNotes(getNotes().filter(x=>x.id!==r.id)); renderList(); renderSyncBar(); } };
        c.querySelector('[data-a=edit]').onclick=()=>editCard(c,r);
        return c;
      }
      function selOpts(opts, val, blank){ return (blank?`<option value="">${blank}</option>`:'')+
        [...new Set([...opts, val].filter(Boolean))].map(o=>`<option ${o===val?'selected':''}>${esc(o)}</option>`).join(''); }
      function editCard(card,r){
        const box=el('div','note-card'); box.style.gridTemplateColumns='1fr';
        box.innerHTML=`
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:10px">
            <label class="fld">문의플랫폼<select id="ePlat">${selOpts(getTypes(), r.platform)}</select></label>
            <label class="fld">담당자<input type="text" id="eAgent" value="${esc(r.agent||'')}"></label>
            <label class="fld">상품구분<select id="ePtype">${selOpts(OptionSets.get('md.tsnotes.prodType',TS_PRODUCT_TYPES), r.prodType, '(없음)')}</select></label>
            <label class="fld">상품코드<input type="text" id="eProdCode" value="${esc(r.prodCode||'')}"></label>
            <label class="fld">제품명<input type="text" id="eProdName" value="${esc(r.prodName||'')}"></label>
            <label class="fld">고객정보<input type="text" id="eCustomer" value="${esc(r.customer||'')}"></label>
            <label class="fld">날짜<input type="date" id="eDate" value="${esc(r.date||todayStr(r.createdAt))}"></label>
            <label class="fld">비고<input type="text" id="eRemark" value="${esc(r.remark||'')}"></label>
          </div>
          <label class="fld" style="margin-bottom:10px">문의사항<textarea id="eContent" rows="3">${esc(r.content||'')}</textarea></label>
          <label class="fld" style="margin-bottom:10px">답변요약<textarea id="eAnsSum" rows="2">${esc(r.answerSummary||'')}</textarea></label>
          <label class="fld" style="margin-bottom:10px">답변원본<textarea id="eAnswer" rows="3">${esc(r.answer||'')}</textarea></label>
          <div style="display:flex;align-items:center;gap:14px">
            <span style="margin-left:auto;display:flex;gap:6px">
              <button class="btn sm" id="eCancel">취소</button><button class="btn pri sm" id="eSave">저장</button></span>
          </div>`;
        card.replaceWith(box);
        box.querySelector('#eCancel').onclick=()=>renderList();
        box.querySelector('#eSave').onclick=()=>{
          const all=getNotes(); const t=all.find(x=>x.id===r.id); if(t){
            t.platform=box.querySelector('#ePlat').value; t.agent=box.querySelector('#eAgent').value.trim()||'-';
            t.prodType=box.querySelector('#ePtype').value; t.prodCode=box.querySelector('#eProdCode').value.trim();
            t.prodName=box.querySelector('#eProdName').value.trim(); t.customer=box.querySelector('#eCustomer').value.trim();
            t.date=box.querySelector('#eDate').value||t.date; t.remark=box.querySelector('#eRemark').value.trim();
            t.content=box.querySelector('#eContent').value.trim(); t.answerSummary=box.querySelector('#eAnsSum').value.trim();
            t.answer=box.querySelector('#eAnswer').value.trim();
            t.syncedAt=null;
            setNotes(all);
            if(window.Records) Records.pushTS(t);
          }
          renderList(); renderSyncBar(); toast('수정되었습니다');
        };
      }
      function renderSyncBar(){
        const slot=body.querySelector('#syncSlot'); if(!slot) return;
        const cfg=getCfg(), n=unsynced().length;
        if(!DESTINATIONS[ACTIVE_DEST].configured(cfg)){
          slot.innerHTML=`<div class="syncbar">${icon('alert')}구글 시트가 아직 연결되지 않았습니다. ${isAdmin?'<b>연동 설정</b> 탭에서 시트 URL을 등록하세요.':'관리자가 시트를 연결하면 자동으로 함께 전송됩니다. (내부 TS 상담 기록에는 저장됩니다)'}</div>`; return;
        }
        if(n===0){ slot.innerHTML=`<div class="syncbar ok">${icon('checkCircle')}모든 기록이 구글시트에 전송되었습니다.</div>`; return; }
        slot.innerHTML=`<div class="syncbar">${icon('cloudUp')}구글시트 전송 실패분 <b>${n}건</b> — 내부 기록에는 저장되어 있습니다
          <button class="btn sm" id="syncNow" style="margin-left:auto">${icon('cloudUp')}다시 전송</button></div>`;
        slot.querySelector('#syncNow').onclick=async(e)=>{ const btn=e.currentTarget; btn.disabled=true; btn.textContent='전송 중…';
          const r=await syncRecords(unsynced()); renderList(); renderSyncBar();
          toast(r.ok?`구글시트에 ${r.synced}건 전송`:'전송 실패: '+(r.error||'')); };
      }

      /* ---------------- 일일 결산 탭 ---------------- */
      function drawSummary(){
        const isoOf=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        let from=todayStr(), to=todayStr();
        body.innerHTML=`
          <div style="display:flex;align-items:flex-end;gap:10px;margin-bottom:16px;flex-wrap:wrap">
            <label class="fld" style="width:168px">${icon('calendar')} 시작일<input type="date" id="sumFrom" value="${from}"></label>
            <label class="fld" style="width:168px">종료일<input type="date" id="sumTo" value="${to}"></label>
            <span style="display:flex;gap:6px;padding-bottom:2px">
              <button class="btn sm" data-range="today">오늘</button>
              <button class="btn sm" data-range="7">최근 7일</button>
              <button class="btn sm" data-range="month">이번 달</button></span>
            <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;padding-bottom:2px">
              ${isAdmin?`<button class="btn" id="editTpl">${icon('settings')}양식 편집</button>`:''}
              <button class="btn" id="copySum">${icon('copy')}텍스트 복사</button>
              ${isAdmin?`<button class="btn pri" id="saveTxt">${icon('download')}메모장 저장(.txt)</button>`:''}
              <button class="btn" id="pushSum">${icon('cloudUp')}미전송분 시트 전송</button></div>
          </div>
          <div id="tplBox" class="hidden"></div>
          <div id="sumWrap"></div>`;
        const fEl=body.querySelector('#sumFrom'), tEl=body.querySelector('#sumTo');
        fEl.onchange=e=>{ from=e.target.value||from; if(from>to){ to=from; tEl.value=to; } renderSum(); };
        tEl.onchange=e=>{ to=e.target.value||to; if(to<from){ from=to; fEl.value=from; } renderSum(); };
        body.querySelectorAll('[data-range]').forEach(b=>b.onclick=()=>{ const r=b.dataset.range, t=todayStr();
          if(r==='today'){ from=t; to=t; } else if(r==='month'){ from=t.slice(0,8)+'01'; to=t; }
          else if(r==='7'){ const d=new Date(); d.setDate(d.getDate()-6); from=isoOf(d); to=t; }
          fEl.value=from; tEl.value=to; renderSum(); });
        body.querySelector('#copySum').onclick=()=>copyText(buildSummary(from,to));
        { const st=body.querySelector('#saveTxt'); if(st) st.onclick=()=>{ downloadBlob(new Blob([buildSummary(from,to)],{type:'text/plain;charset=utf-8'}),`TS결산_${from===to?from:from+'_'+to}.txt`); toast('메모장(.txt)으로 저장했습니다'); }; }
        { const et=body.querySelector('#editTpl'); if(et) et.onclick=openTpl; }
        body.querySelector('#pushSum').onclick=async(e)=>{ const b=e.currentTarget; b.disabled=true;
          const r=await syncRecords(unsynced()); b.disabled=false; renderSum();
          toast(r.ok?`구글시트에 ${r.synced}건 전송`:'전송 실패: '+(r.error||'')); };
        renderSum();
        function rangeNotes(){ return getNotes().filter(r=>{ const d=todayStr(r.createdAt); return d>=from&&d<=to; }); }
        function agg(list){
          const byPlat={}; getTypes().forEach(t=>byPlat[t]=0);
          const byAgent={}, byPtype={};
          list.forEach(r=>{ byPlat[r.platform]=(byPlat[r.platform]||0)+1;
            byAgent[r.agent]=(byAgent[r.agent]||0)+1;
            if(r.prodType) byPtype[r.prodType]=(byPtype[r.prodType]||0)+1; });
          return { total:list.length, byPlat, byAgent, byPtype };
        }
        function renderSum(){
          const list=rangeNotes(), a=agg(list); const wrap=body.querySelector('#sumWrap'); if(!wrap) return;
          wrap.innerHTML=`
            <div class="sum-grid" style="margin-bottom:16px">
              <div class="sum-card"><div class="lb">총 TS 상담 건수</div><div class="vl">${a.total}</div></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">
              <div class="card"><div class="card-hd"><b>담당자별 처리 건수</b></div><div class="card-bd" style="padding:0">
                <table class="tbl"><thead><tr><th>담당자</th><th class="num">건수</th></tr></thead><tbody>
                  ${Object.keys(a.byAgent).length?Object.entries(a.byAgent).sort((x,y)=>y[1]-x[1]).map(([k,v])=>`<tr><td>${esc(k)}</td><td class="num">${v}</td></tr>`).join(''):'<tr><td colspan="2" class="muted" style="text-align:center;padding:16px">기록 없음</td></tr>'}
                </tbody></table></div></div>
              <div class="card"><div class="card-hd"><b>문의플랫폼별 건수</b></div><div class="card-bd" style="padding:0">
                <table class="tbl"><thead><tr><th>문의플랫폼</th><th class="num">건수</th></tr></thead><tbody>
                  ${getTypes().some(t=>a.byPlat[t])?getTypes().filter(t=>a.byPlat[t]).map(t=>`<tr><td>${esc(t)}</td><td class="num">${a.byPlat[t]}</td></tr>`).join(''):'<tr><td colspan="2" class="muted" style="text-align:center;padding:16px">기록 없음</td></tr>'}
                </tbody></table></div></div>
            </div>
            <div class="card" style="margin-top:16px"><div class="card-hd">${icon('clipboard')}<b>저장 텍스트 미리보기</b>
              <span class="muted" style="margin-left:auto;font-size:12px">[양식 편집]에서 형식을 바꿀 수 있습니다</span></div>
              <div class="card-bd"><pre id="sumPre" style="white-space:pre-wrap;font-family:var(--mono);font-size:12.5px;line-height:1.55;margin:0;color:var(--ink-2)"></pre></div></div>`;
          const pre=body.querySelector('#sumPre'); if(pre) pre.textContent=buildSummary(from,to);
        }
        function buildSummary(f,t){
          const list=getNotes().filter(r=>{ const d=todayStr(r.createdAt); return d>=f&&d<=t; }), a=agg(list);
          const platLines=getTypes().map(t2=>`- ${t2}: ${a.byPlat[t2]||0}건`).join('\n');
          const agentLines=Object.entries(a.byAgent).sort((x,y)=>y[1]-x[1]).map(([k,v])=>`- ${k}: ${v}건`).join('\n') || '- (없음)';
          const ptypeLines=Object.entries(a.byPtype).sort((x,y)=>y[1]-x[1]).map(([k,v])=>`- ${k}: ${v}건`).join('\n') || '- (없음)';
          const label = f===t? f : `${f} ~ ${t}`;
          const map={ '{날짜}':label, '{총건수}':a.total, '{플랫폼별}':platLines, '{담당자별}':agentLines, '{상품구분별}':ptypeLines };
          let out=getSumTpl(); Object.keys(map).forEach(k=>{ out=out.split(k).join(map[k]); }); return out;
        }
        function openTpl(){
          const box=body.querySelector('#tplBox'); box.classList.remove('hidden');
          box.innerHTML=`<div class="card" style="margin-bottom:16px"><div class="card-hd">${icon('settings')}<b>결산 저장 양식 편집</b>
            <span style="margin-left:auto;display:flex;gap:6px">
              <button class="btn sm" id="tplReset">${icon('refresh')}기본값</button>
              <button class="btn pri sm" id="tplSave">${icon('save')}저장</button>
              <button class="btn sm" id="tplClose">닫기</button></span></div>
            <div class="card-bd">
              <div class="muted" style="font-size:12.5px;margin-bottom:8px">아래 <b>토큰</b>을 클릭해 넣거나 자유롭게 배치하세요.</div>
              <div class="tpl-tokens" id="tplTokens"></div>
              <textarea id="tplArea" rows="12" style="width:100%;font-family:var(--mono);font-size:13px;line-height:1.5">${esc(getSumTpl())}</textarea>
            </div></div>`;
          const tokens=[['{날짜}','기간'],['{총건수}','총 건수'],['{플랫폼별}','문의플랫폼별 목록'],['{담당자별}','담당자별 목록'],['{상품구분별}','상품구분별 목록']];
          const tt=box.querySelector('#tplTokens');
          tokens.forEach(([k,d2])=>{ const b=el('button','chip sm'); b.type='button'; b.textContent=k; b.title=d2;
            b.onclick=()=>{ const ta=box.querySelector('#tplArea'); const s=ta.selectionStart??ta.value.length, e2=ta.selectionEnd??s;
              ta.value=ta.value.slice(0,s)+k+ta.value.slice(e2); ta.focus(); ta.selectionStart=ta.selectionEnd=s+k.length; };
            tt.appendChild(b); });
          box.querySelector('#tplClose').onclick=()=>{ box.classList.add('hidden'); box.innerHTML=''; };
          box.querySelector('#tplReset').onclick=()=>{ box.querySelector('#tplArea').value=DEFAULT_SUM_TPL; };
          box.querySelector('#tplSave').onclick=()=>{ setSumTpl(box.querySelector('#tplArea').value); toast('양식을 저장했습니다'); renderSum(); };
        }
      }

      /* ---------------- 연동 설정 탭 ---------------- */
      function drawSettings(){
        const cfg=getCfg();
        body.innerHTML=`
          <div class="card" style="margin-bottom:16px;max-width:820px">
            <div class="card-hd">${icon('link')}<b>연동 방법 — 처음 한 번만 (약 3분)</b>
              <button class="btn pri sm" id="copyCode" style="margin-left:auto">${icon('copy')}Apps Script 코드 복사</button></div>
            <div class="card-bd">
              <ol class="setup-guide">
                <li>백업용 <b>구글 스프레드시트</b>를 준비합니다. <span class="muted" style="font-size:12.5px">(탭·헤더 자동 생성 · 이 모듈 탭: <b>TS상담메모</b>)</span></li>
                <li><span class="k">확장 프로그램</span> → <span class="k">Apps Script</span> → 편집기 내용을 지우고 위 <b>[Apps Script 코드 복사]</b> 붙여넣기 후 저장. <span class="muted" style="font-size:12.5px">(<span class="mono">SHEET_NAME</span>은 <b>비워둠</b> → 모듈별 탭에 기록)</span></li>
                <li><span class="k">배포</span> → <span class="k">새 배포</span> → <span class="k">웹 앱</span> (실행: 나 / 액세스: <span class="k">모든 사용자</span>)로 배포.</li>
                <li>표시된 <b>웹 앱 URL</b>(<span class="mono" style="font-size:12.5px">…/exec</span>)을 아래에 붙여넣고 <b>[저장] → [연결 테스트]</b>.</li>
              </ol>
              <div class="note" style="margin-top:6px"><b>같은 스프레드시트</b>를 쓰면 모든 모듈에 <b>같은 URL</b>을 넣어도 됩니다(탭만 달라짐). 시트 <b>1행 헤더</b>는 자동 생성되고, 각 기록은 숨은 <b>id</b> 열로 <b>중복 없이</b> 갱신됩니다.</div>
            </div>
          </div>

          <div class="card" style="margin-bottom:16px;max-width:820px">
            <div class="card-hd">${icon('link')}<b>구글 시트 연결</b></div>
            <div class="card-bd">
              <label class="fld" style="margin-bottom:14px">웹 앱 URL <span class="muted" style="font-weight:500">· 위 5번에서 복사한 주소</span>
                <input type="text" id="cfgUrl" value="${esc(cfg.sheetUrl)}" placeholder="https://script.google.com/macros/s/……/exec"></label>
              <label class="chk" style="margin-bottom:16px"><input type="checkbox" id="cfgBackup" ${cfg.backup!==false?'checked':''}> 구글시트 <b>백업 사용</b> <span class="muted" style="font-weight:500">· 끄면 내부 TS 상담 기록에만 저장</span></label>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                <button class="btn pri" id="cfgSave">${icon('check')}저장</button>
                <button class="btn" id="cfgTest">${icon('cloud')}연결 테스트</button>
                <button class="btn" id="cfgPush">${icon('cloudUp')}미전송분 전체 전송</button>
                <span class="muted" id="cfgStat" style="font-size:13px"></span>
              </div>
            </div>
          </div>`;
        body.querySelector('#copyCode').onclick=async(e)=>{
          try{ const r=await fetch('google-apps-script.gs'); if(!r.ok) throw 0; const t=await r.text(); copyText(t); }
          catch{ toast('코드 파일을 불러오지 못했습니다 — 저장소의 google-apps-script.gs 를 사용하세요'); } };
        body.querySelector('#cfgSave').onclick=()=>{
          const url=body.querySelector('#cfgUrl').value.trim();
          const backup=body.querySelector('#cfgBackup').checked;
          setCfg({ ...getCfg(), sheetUrl:url, backup }); toast('설정을 저장했습니다');
        };
        body.querySelector('#cfgTest').onclick=async()=>{
          const url=body.querySelector('#cfgUrl').value.trim(), stat=body.querySelector('#cfgStat');
          if(!url){ stat.textContent='URL을 입력하세요'; return; }
          stat.textContent='테스트 중…';
          try{ const res=await fetch(url+(url.includes('?')?'&':'?')+'sheet='+encodeURIComponent('TS상담메모'),{method:'GET'}); let d=null; try{d=await res.json();}catch{}
            stat.innerHTML = res.ok ? `<span style="color:var(--ok)">연결 성공 · 이 모듈 저장 탭 <b>"TS상담메모"</b>${d&&typeof d.rows==='number'?` (${d.rows}행)`:''}</span>` : `<span style="color:var(--danger)">응답 오류 HTTP ${res.status}</span>`;
          }catch(err){ stat.innerHTML=`<span style="color:var(--danger)">연결 실패: ${esc(err.message)}</span>`; }
        };
        body.querySelector('#cfgPush').onclick=async(e)=>{ const b=e.currentTarget; b.disabled=true;
          const r=await syncRecords(unsynced()); b.disabled=false;
          body.querySelector('#cfgStat').textContent = r.ok?`${r.synced}건 전송`:('전송 실패: '+(r.error||'')); };
      }

      draw();

      let curDay=todayStr();
      const rollTimer=setInterval(()=>{
        if(!root.isConnected){ clearInterval(rollTimer); return; }
        if(todayStr()!==curDay){ curDay=todayStr(); if(tab==='memo') draw(); }
      }, 60000);
    }
  };
})();
