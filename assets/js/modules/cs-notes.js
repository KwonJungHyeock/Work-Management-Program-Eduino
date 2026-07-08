/* ===========================================================================
   CS · 상담 메모 & 일일 결산
   - 연동 구글시트 컬럼에 맞춰 기록: 날짜·분류·연락처·고객유형·주문자/학교/업체명
     ·상품분류·상품코드·내용·답변·상담사
   - 통화 중 빠른 입력(Ctrl+Enter 저장) → 로컬 저장 → 구글 시트 동기화
   - 분류·고객유형·상품분류는 전화하면서 바로 누르는 토글 버튼
   - 저장/전송은 "destination" 추상화로 분리 (지금은 sheet, 이후 notion 추가)
   =========================================================================== */
(function(){

  /* 내부 레코드 → 구글시트 헤더 이름으로 매핑한 객체 (Apps Script가 헤더 이름으로 칸을 맞춤) */
  function toSheetRecord(r){
    const o={ id:r.id };
    for(const k in CS_SHEET_MAP){ o[CS_SHEET_MAP[k]] = r[k]!=null ? r[k] : ''; }
    return o;
  }

  /* 일일 결산 저장 기본 양식 (사용자가 화면에서 커스텀 가능 · 토큰 치환) */
  const DEFAULT_SUM_TPL =
`[{날짜} CS 상담 결산]
총 {총건수}건

■ 분류별
{분류별}

■ 고객유형별
{고객유형별}

■ 상담사별
{상담사별}

■ 후속조치(콜백) 필요: {콜백건수}건
{콜백목록}`;

  /* ---- 목적지(destination) 추상화 ----
     새 대상(예: 노션)은 여기 객체만 추가하면 됩니다. */
  const DESTINATIONS = {
    sheet: {
      id:'sheet', name:'구글 시트',
      configured: cfg => !!(cfg && cfg.sheetUrl),
      /* records 를 Apps Script 웹앱(doPost)으로 전송. id 기준 upsert 이므로 재시도해도 중복 없음 */
      async send(records, cfg){
        const payload = records.map(toSheetRecord);
        const opts={ method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify({ records: payload }) };
        try{
          const res = await fetch(cfg.sheetUrl, opts);
          if(!res.ok) throw new Error('HTTP '+res.status);
          let data=null; try{ data = await res.json(); }catch{}
          if(data && data.ok===false) throw new Error(data.error||'시트 처리 실패(보호된 시트 등)');
          return { syncedIds: (data && data.synced) ? data.synced : records.map(r=>r.id) };
        }catch(err){
          // Apps Script POST 는 CORS 로 응답을 못 읽는 경우가 많음 → no-cors 로 전송(id upsert 라 재전송 안전)
          if(/failed to fetch|networkerror|load failed|cors/i.test(err.message||'')){
            await fetch(cfg.sheetUrl, {...opts, mode:'no-cors'});
            return { syncedIds: records.map(r=>r.id), unconfirmed:true };
          }
          throw err;
        }
      },
    },
    notion: {  // 2단계 자리표시 (인터페이스만)
      id:'notion', name:'노션', placeholder:true,
      configured: ()=>false,
      async send(){ throw new Error('노션 연동은 준비 중입니다'); },
    },
  };
  const ACTIVE_DEST = 'sheet';

  /* ---- 처리대기 공용 큐 (/api/store 컬렉션 'callbacks') · 팀 공유 ---- */
  const Q = {
    async list(){ try{ const r=await fetch('/api/store?type=coll&coll=callbacks'); if(!r.ok) throw 0; const d=await r.json(); return (d&&d.items)||[]; }catch{ return null; } },
    push(item){ try{ return fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collPush',coll:'callbacks',item})}); }catch{} },
    del(id){ try{ return fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collDel',coll:'callbacks',id})}); }catch{} },
  };
  async function fetchRoster(){ try{ const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'roster'})}); const d=await r.json(); return (d&&d.roster)||[]; }catch{ return []; } }

  /* ---- 데이터/동기화 ---- */
  const notesDB = ()=>store(STORE.csNotes);
  const cfgDB   = ()=>store(STORE.csNoteCfg);
  const getNotes = ()=>notesDB().get([]);
  const setNotes = (v)=>notesDB().set(v);
  const getCfg = ()=>cfgDB().get({ sheetUrl:'', syncMode:'batch' });
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
      // 실패: 로컬 데이터는 그대로 보존 (재시도 가능)
      return { ok:false, error: err.message||'전송 실패', synced:0 };
    }
  }

  /* ============================================================ */
  MODULES['cs.notes'] = {
    title:'상담 메모', icon:'clipboard',
    render(root){
      // 분류(문의유형) — 사용자가 편집 가능 · 로컬 저장
      const typesDB=store(STORE.csTypes);
      // 옛 기본값(상품추천 등)이 저장돼 있으면 새 분류로 교체
      (function migrateTypes(){ const cur=typesDB.get(null);
        if(cur && (cur.includes('상품추천')||!cur.length)) typesDB.set(CS_INQUIRY_TYPES.slice()); })();
      const getTypes=()=> typesDB.get(CS_INQUIRY_TYPES.slice());
      const setTypes=(v)=> typesDB.set(v);
      // 상담사 목록 (사용자 편집 · 로컬 저장)
      const agentsDB=store(STORE.csAgents);
      const getAgents=()=> agentsDB.get(CS_AGENTS.slice());
      const setAgents=(v)=> agentsDB.set(v);
      // 일일 결산 저장 양식 (커스텀)
      const sumTplDB=store(STORE.csSumTpl);
      const getSumTpl=()=> sumTplDB.get(DEFAULT_SUM_TPL);
      const setSumTpl=(v)=> sumTplDB.set(v);

      // 옛 레코드 스키마(type/memo/product) → 신규(category/content/prodCode) 마이그레이션
      (function migrateNotes(){ const all=getNotes(); let ch=false;
        all.forEach(r=>{
          if(r.category==null && r.type!=null){ r.category=r.type; ch=true; }
          if(r.content==null && r.memo!=null){ r.content=r.memo; ch=true; }
          if(r.prodCode==null && r.product!=null){ r.prodCode=r.product; ch=true; }
          if(r.date==null){ r.date=todayStr(r.createdAt); ch=true; }
          ['customerType','prodCategory','name','answer'].forEach(k=>{ if(r[k]==null){ r[k]=''; ch=true; } });
        });
        if(ch) setNotes(all); })();

      let tab='memo', filter='전체', lastAgent=store(STORE.csAgent).get(getAgents()[0]);
      let typeEdit=false, agentEdit=false;
      // 폼 상태 (분류·상담사·날짜는 저장 후에도 유지되는 컨텍스트)
      let form={ category:getTypes()[0], customerType:'', prodCategory:'', date:todayStr(), agent:lastAgent };

      root.innerHTML=`
      <style>
        /* 빠른 입력 (메모 중심) */
        .q-card{border:1px solid var(--line);border-radius:14px;background:#fff;overflow:hidden;margin-bottom:20px;box-shadow:var(--sh)}
        .q-hd{display:flex;align-items:center;gap:9px;padding:14px 20px;background:var(--panel-2);border-bottom:1px solid var(--line);font-weight:800;font-size:15.5px}
        .q-hd .kbd{margin-left:auto;font-size:12.5px;font-weight:600;color:var(--muted)}
        .q-hd .kbd b{background:#fff;border:1px solid var(--line-strong);border-radius:5px;padding:1px 7px;color:var(--ink-2)}
        .q-bd{padding:20px}
        /* 빠른 입력 2단 레이아웃 (오른쪽 메타 패널로 공간 활용) */
        .q-grid{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:22px;align-items:start}
        @media(max-width:920px){.q-grid{grid-template-columns:1fr}}
        .q-main{display:flex;flex-direction:column;gap:17px}
        /* 섹션 라벨 (정제된 엔터프라이즈 톤) */
        .q-sec-cap{font-size:11.5px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.06em;margin-bottom:9px;display:flex;align-items:center;gap:8px}
        .q-sec-cap .req{font-size:10px;font-weight:800;color:var(--red);background:var(--red-soft);border-radius:4px;padding:2px 6px;letter-spacing:.02em}
        .q-sec-cap .opt{font-size:11px;font-weight:500;color:var(--faint);text-transform:none;letter-spacing:0}
        /* 칩(토글) — 선택 시 소프트 틴트 + 컬러 보더 */
        .chips{display:flex;gap:7px;flex-wrap:wrap}
        .chip{display:inline-flex;align-items:center;gap:6px;padding:8px 15px;border:1px solid var(--line-strong);border-radius:8px;background:#fff;
          font-size:13.5px;font-weight:600;color:var(--ink-2);cursor:pointer;transition:.1s;user-select:none;line-height:1.2}
        .chip:hover{border-color:var(--faint);background:var(--panel-2)}
        .chip.on{border-color:var(--red);background:var(--red-soft);color:var(--red);font-weight:700;box-shadow:inset 0 0 0 1px var(--red)}
        .chip .q-del{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;
          background:var(--line-strong);color:#fff;font-size:10px;font-weight:800}
        .chip.on .q-del{background:var(--red);color:#fff}
        .sec-edit{margin-left:auto;background:none;border:0;color:var(--muted);font-size:12px;font-weight:700;cursor:pointer;padding:3px 8px;border-radius:6px;text-transform:none;letter-spacing:0}
        .sec-edit:hover{background:var(--hover);color:var(--red)} .sec-edit.on{color:var(--red)}
        .chip-add{display:flex;gap:6px;align-items:center}
        .chip-add input{height:auto;padding:8px 10px;font-size:13.5px;width:118px}
        /* 내용/답변 */
        .q-memo{width:100%;min-height:150px;font-size:15px;line-height:1.6;padding:14px;border:1.5px solid var(--line-strong);border-radius:10px;background:#fff;resize:vertical}
        .q-memo:focus{border-color:var(--red);box-shadow:0 0 0 3px var(--red-soft)}
        .q-ans{width:100%;min-height:82px;font-size:14px;line-height:1.55;padding:12px;border:1.5px solid var(--line-strong);border-radius:10px;resize:vertical}
        .q-ans:focus{border-color:var(--red);box-shadow:0 0 0 3px var(--red-soft)}
        /* 우측 메타 패널 */
        .q-side{background:var(--panel-2);border:1px solid var(--line);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:14px}
        .q-side .cap{display:block;font-size:11.5px;font-weight:700;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em}
        .q-side .cap em{font-style:normal;font-weight:500;color:var(--faint);margin-left:4px;text-transform:none;letter-spacing:0}
        .q-side input[type=text],.q-side input[type=date]{height:42px;font-size:14.5px;width:100%}
        .q-agents{display:flex;flex-wrap:wrap;gap:7px}
        .q-cb{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:600;padding:2px 0;cursor:pointer}
        .q-cb input{width:18px;height:18px}
        .q-save{width:100%;justify-content:center;margin-top:2px}
        .side-cap-row{display:flex;align-items:center;margin-bottom:6px}
        /* 처리 대기 카드 */
        .pend-card{display:grid;grid-template-columns:1fr 210px;gap:14px;align-items:start;padding:13px 15px;border:1px solid var(--line);border-radius:10px;background:#fff;margin-bottom:9px}
        .pend-card.done{opacity:.62;background:var(--panel-2)}
        .pend-card .pc-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}
        .pend-card .pc-name{font-weight:700}
        .pend-card .pc-age{font-size:12px;font-weight:700;color:var(--warn);background:var(--warn-bg);border:1px solid #ead9b0;border-radius:5px;padding:1px 7px}
        .pend-card .pc-age.d0{color:var(--ok);background:var(--ok-bg);border-color:#bfe6cf}
        .pend-card .pc-content{font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
        .pend-card .pc-note input{margin-top:8px;width:100%;height:36px;font-size:13px}
        .pend-card .pc-side{display:flex;flex-direction:column;gap:7px;align-items:stretch}
        .pend-card .pc-meta{font-size:12.5px;color:var(--muted);text-align:right}
        .pend-card .pc-asg{font-size:11.5px;font-weight:700;color:var(--info);background:var(--info-bg);border-radius:5px;padding:1px 7px;display:inline-flex;align-items:center;gap:3px}
        .pend-card .pc-asg svg{width:12px;height:12px}
        .pend-card .pc-asgsel{height:32px;font-size:12.5px;width:100%}
        /* 결산 양식 토큰 */
        .tpl-tokens{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
        .chip.sm{padding:5px 10px;font-size:12px;font-family:var(--mono)}
        /* 오늘 기록 카드 */
        .note-card{display:grid;grid-template-columns:58px 96px 1fr auto;gap:12px;align-items:start;padding:12px 14px;border:1px solid var(--line);border-radius:9px;background:#fff;margin-bottom:8px}
        .note-card .tm{font-variant-numeric:tabular-nums;color:var(--muted);font-size:13.5px;font-weight:600}
        .note-card .memo{font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
        .note-card .ans{font-size:13px;line-height:1.5;color:var(--ink-2);margin-top:3px;white-space:pre-wrap;word-break:break-word}
        .note-card .ans::before{content:"↳ 답변  ";color:var(--faint);font-weight:700}
        .note-card .sub{font-size:12.5px;color:var(--muted);margin-top:4px}
        .note-card .sub2{font-size:11.5px;color:var(--faint);margin-top:3px}
        .sum-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
        .sum-card{border:1px solid var(--line);border-radius:10px;padding:14px 16px;background:#fff}
        .sum-card .lb{font-size:13px;color:var(--muted)}
        .sum-card .vl{font-size:26px;font-weight:800;font-variant-numeric:tabular-nums;margin-top:4px}
        .syncbar{display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #ead9b0;background:var(--warn-bg);border-radius:8px;margin-bottom:14px;font-size:13.5px;color:#7a4d06}
        .syncbar.ok{border-color:#bfe6cf;background:var(--ok-bg);color:#0b6b41}
        .badge.synced{background:var(--ok-bg);color:var(--ok)}
        .badge.pending{background:var(--warn-bg);color:var(--warn)}
        .badge.cb{background:#eae4ff;color:#5b3fc4}
      </style>
      <div class="mhead">
        <div class="tt">상담 메모</div>
        <div class="ds">통화 중 분류·고객유형·상품분류를 바로 누르고 내용을 적으면(Ctrl+Enter 저장) 연동 시트에 그대로 기록됩니다.</div>
        <div class="mtabs">
          <div class="t" data-t="memo">상담 메모</div>
          <div class="t" data-t="pending">처리 대기 <span class="tab-cnt" id="pendCnt" style="display:none"></span></div>
          <div class="t" data-t="summary">일일 결산</div>
          <div class="t" data-t="settings">연동 설정</div>
        </div>
      </div>
      <div class="mbody" id="csBody"></div>`;
      const body=root.querySelector('#csBody');
      root.querySelectorAll('.mtabs .t').forEach(t=>{ t.classList.toggle('on',t.dataset.t===tab);
        t.onclick=()=>{ tab=t.dataset.t; root.querySelectorAll('.mtabs .t').forEach(x=>x.classList.toggle('on',x.dataset.t===tab)); draw(); }; });
      const draw=()=>{ updatePendCnt();
        return tab==='memo'?drawMemo(): tab==='pending'?drawPending(): tab==='summary'?drawSummary(): drawSettings(); };
      async function updatePendCnt(){ const c=root.querySelector('#pendCnt'); if(!c) return;
        const list=await Q.list(); if(!list){ c.style.display='none'; return; }
        const n=list.filter(r=>!r.done).length;
        c.textContent=n||''; c.style.display=n?'':'none'; }

      /* ---------------- 상담 메모 탭 ---------------- */
      function drawMemo(){
        body.innerHTML=`
          <div class="q-card">
            <div class="q-hd">${icon('phone')}빠른 입력
              <span class="kbd">저장 후 자동 초기화 · <b>Ctrl</b>+<b>Enter</b> 저장</span></div>
            <div class="q-bd">
              <form id="qform">
                <div class="q-grid">
                  <div class="q-main">
                    <div>
                      <div class="q-sec-cap">분류 <span class="req">필수</span>
                        <button type="button" class="sec-edit" id="typeEdit">편집</button></div>
                      <div class="chips" id="catGroup"></div>
                    </div>
                    <div>
                      <div class="q-sec-cap">고객유형 <span class="opt">선택 · 다시 누르면 해제</span></div>
                      <div class="chips" id="custGroup"></div>
                    </div>
                    <div>
                      <div class="q-sec-cap">상품분류 <span class="opt">선택 · 다시 누르면 해제</span></div>
                      <div class="chips" id="prodGroup"></div>
                    </div>
                    <div>
                      <div class="q-sec-cap">내용 <span class="req">필수</span></div>
                      <textarea id="fContent" class="q-memo" placeholder="문의 내용을 입력하세요 —  통화하면서 자유롭게 기록" required></textarea>
                    </div>
                    <div>
                      <div class="q-sec-cap">답변 <span class="opt">선택</span></div>
                      <textarea id="fAnswer" class="q-ans" placeholder="응대/답변 내용 (나중에 채워도 됩니다)"></textarea>
                    </div>
                  </div>

                  <aside class="q-side">
                    <div>
                      <div class="side-cap-row"><span class="cap" style="margin:0">상담사</span>
                        <button type="button" class="sec-edit" id="agentEdit">편집</button></div>
                      <div class="q-agents" id="agentGroup"></div>
                    </div>
                    <div><span class="cap">날짜</span><input type="date" id="fDate" value="${esc(form.date)}"></div>
                    <div><span class="cap">연락처 <em>선택</em></span><input type="text" id="fContact" placeholder="010-0000-0000"></div>
                    <div><span class="cap">주문자/학교/업체명 <em>선택</em></span><input type="text" id="fName" placeholder="예: 에듀이노초 / 홍길동"></div>
                    <div><span class="cap">상품코드 <em>선택</em></span><input type="text" id="fProdCode" placeholder="예: A-100"></div>
                    <label class="q-cb"><input type="checkbox" id="fCallback"> 후속조치(콜백) 필요</label>
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

        /* --- 분류 칩 (편집 가능) --- */
        const catGroup=body.querySelector('#catGroup');
        function renderCat(){
          const types=getTypes();
          if(!types.includes(form.category)) form.category=types[0];
          catGroup.innerHTML='';
          types.forEach(t=>{ const b=el('button','chip'+(t===form.category?' on':'')); b.type='button';
            b.innerHTML=`<span>${esc(t)}</span>${typeEdit&&types.length>1?`<span class="q-del" title="삭제">✕</span>`:''}`;
            b.onclick=(e)=>{
              if(e.target.classList.contains('q-del')){ const nt=types.filter(x=>x!==t); setTypes(nt); if(form.category===t)form.category=nt[0]; renderCat(); renderFilters(); return; }
              if(typeEdit) return;
              form.category=t; renderCat();
            };
            catGroup.appendChild(b);
          });
          if(typeEdit){ const add=el('div','chip-add');
            add.innerHTML=`<input type="text" id="newType" placeholder="새 분류" maxlength="12">
              <button type="button" class="btn pri sm" id="addTypeBtn">${icon('plus')}추가</button>`;
            const doAdd=()=>{ const v=add.querySelector('#newType').value.trim();
              if(!v) return; const cur=getTypes(); if(cur.includes(v)){ toast('이미 있는 분류입니다'); return; }
              cur.push(v); setTypes(cur); renderCat(); renderFilters();
              const ni=catGroup.querySelector('#newType'); if(ni) ni.focus(); };
            add.querySelector('#addTypeBtn').onclick=doAdd;
            add.querySelector('#newType').onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); doAdd(); } };
            catGroup.appendChild(add);
          }
        }
        body.querySelector('#typeEdit').onclick=(e)=>{ typeEdit=!typeEdit;
          e.currentTarget.classList.toggle('on',typeEdit); e.currentTarget.textContent=typeEdit?'완료':'편집';
          renderCat(); };
        renderCat();

        /* --- 고객유형 / 상품분류 칩 (단일선택 · 다시 누르면 해제) --- */
        function renderChoice(sel, options, key){
          const g=body.querySelector(sel); g.innerHTML='';
          options.forEach(o=>{ const b=el('button','chip'+(form[key]===o?' on':'')); b.type='button'; b.textContent=o;
            b.onclick=()=>{ form[key] = (form[key]===o?'':o); renderChoice(sel,options,key); };
            g.appendChild(b); });
        }
        renderChoice('#custGroup', CS_CUSTOMER_TYPES, 'customerType');
        renderChoice('#prodGroup', CS_PRODUCT_CATEGORIES, 'prodCategory');

        /* --- 상담사 칩 (편집 가능 · 단일선택 · 마지막값 기억) --- */
        function renderAgents(){
          const g=body.querySelector('#agentGroup'); g.innerHTML='';
          const agents=getAgents();
          if(!agents.includes(form.agent)) form.agent = agents.includes(lastAgent)?lastAgent:agents[0];
          agents.forEach(a=>{ const b=el('button','chip'+(form.agent===a?' on':'')); b.type='button';
            b.innerHTML=`<span>${esc(a)}</span>${agentEdit&&agents.length>1?`<span class="q-del" title="삭제">✕</span>`:''}`;
            b.onclick=(e)=>{
              if(e.target.classList.contains('q-del')){ const na=agents.filter(x=>x!==a); setAgents(na); if(form.agent===a)form.agent=na[0]; renderAgents(); return; }
              if(agentEdit) return;
              form.agent=a; store(STORE.csAgent).set(a); lastAgent=a; renderAgents();
            };
            g.appendChild(b);
          });
          if(agentEdit){ const add=el('div','chip-add');
            add.innerHTML=`<input type="text" id="newAgent" placeholder="상담사 이름" maxlength="12">
              <button type="button" class="btn pri sm" id="addAgentBtn">${icon('plus')}추가</button>`;
            const doAdd=()=>{ const v=add.querySelector('#newAgent').value.trim();
              if(!v) return; const cur=getAgents(); if(cur.includes(v)){ toast('이미 있는 상담사입니다'); return; }
              cur.push(v); setAgents(cur); renderAgents();
              const ni=g.querySelector('#newAgent'); if(ni) ni.focus(); };
            add.querySelector('#addAgentBtn').onclick=doAdd;
            add.querySelector('#newAgent').onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); doAdd(); } };
            g.appendChild(add);
          }
        }
        body.querySelector('#agentEdit').onclick=(e)=>{ agentEdit=!agentEdit;
          e.currentTarget.classList.toggle('on',agentEdit); e.currentTarget.textContent=agentEdit?'완료':'편집';
          renderAgents(); };
        renderAgents();

        // 저장
        const form_el=body.querySelector('#qform');
        const submit=()=>{
          const content=body.querySelector('#fContent').value.trim();
          if(!content){ body.querySelector('#fContent').focus(); toast('내용을 입력하세요'); return; }
          const agent=form.agent||lastAgent||'-';
          store(STORE.csAgent).set(agent); lastAgent=agent;
          form.date=body.querySelector('#fDate').value||todayStr();
          const rec={ id:uuid(), createdAt:nowISO(),
            date:form.date, category:form.category,
            contact:body.querySelector('#fContact').value.trim(),
            customerType:form.customerType,
            name:body.querySelector('#fName').value.trim(),
            prodCategory:form.prodCategory,
            prodCode:body.querySelector('#fProdCode').value.trim(),
            content, answer:body.querySelector('#fAnswer').value.trim(),
            agent, callback:body.querySelector('#fCallback').checked, syncedAt:null };
          const all=getNotes(); all.push(rec); setNotes(all);
          // 콜백(후속조치) 체크 시 → 팀 공용 처리대기 큐에 등록
          if(rec.callback){ Q.push({ id:rec.id, category:rec.category, name:rec.name, contact:rec.contact,
            content:rec.content, agent:rec.agent, createdAt:rec.createdAt, done:false, assignee:'', assigneeName:'', note:'' }); }
          // 폼 초기화 (분류·상담사·날짜 유지 · 고객유형/상품분류/텍스트는 비움)
          form.customerType=''; form.prodCategory='';
          renderChoice('#custGroup', CS_CUSTOMER_TYPES, 'customerType');
          renderChoice('#prodGroup', CS_PRODUCT_CATEGORIES, 'prodCategory');
          ['fContent','fAnswer','fContact','fName','fProdCode'].forEach(id=>body.querySelector('#'+id).value='');
          body.querySelector('#fCallback').checked=false;
          body.querySelector('#fContent').focus();
          renderList(); renderSyncBar(); toast('저장되었습니다');
          // 실시간 모드면 즉시 전송
          const cfg=getCfg();
          if(cfg.syncMode==='realtime' && DESTINATIONS[ACTIVE_DEST].configured(cfg)){
            syncRecords([rec]).then(r=>{ renderList(); renderSyncBar(); if(!r.ok) toast(SHEET_MSG.fail()); });
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

      function todayNotes(){ const t=todayStr(); return getNotes().filter(r=>todayStr(r.createdAt)===t); }
      function renderList(){
        const box=body.querySelector('#noteList'), cnt=body.querySelector('#todayCnt'); if(!box) return;
        let list=todayNotes().sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
        if(cnt) cnt.textContent=`· 총 ${list.length}건`;
        if(filter!=='전체') list=list.filter(r=>r.category===filter);
        updatePendCnt();
        if(!list.length){ box.innerHTML=`<div class="empty">${icon('clipboard')}<div style="font-size:13.5px">${filter==='전체'?'오늘 기록이 아직 없습니다.':'해당 분류 기록이 없습니다.'}</div></div>`; return; }
        box.innerHTML=''; list.forEach(r=>box.appendChild(noteCard(r)));
      }
      function noteCard(r){
        const c=el('div','note-card');
        const sync = r.syncedAt?`<span class="badge synced">${SHEET_MSG.badgeDone}</span>`:`<span class="badge pending">${SHEET_MSG.badgePending}</span>`;
        const meta=[r.agent, r.name, r.contact, r.prodCategory, r.prodCode].filter(Boolean).map(esc).join(' · ');
        c.innerHTML=`
          <div class="tm">${timeHM(r.createdAt)}</div>
          <div><span class="badge info">${esc(r.category||'-')}</span>${r.customerType?`<div class="sub2">${esc(r.customerType)}</div>`:''}</div>
          <div>
            <div class="memo">${esc(r.content||'')}</div>
            ${r.answer?`<div class="ans">${esc(r.answer)}</div>`:''}
            <div class="sub">${meta}${r.callback?' · <span class="badge cb">콜백 필요</span>':''} ${sync}</div>
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
            <label class="fld">분류<select id="eCat">${selOpts(getTypes(), r.category)}</select></label>
            <label class="fld">고객유형<select id="eCust">${selOpts(CS_CUSTOMER_TYPES, r.customerType, '(없음)')}</select></label>
            <label class="fld">상품분류<select id="eProdCat">${selOpts(CS_PRODUCT_CATEGORIES, r.prodCategory, '(없음)')}</select></label>
            <label class="fld">상담사<input type="text" id="eAgent" value="${esc(r.agent||'')}"></label>
            <label class="fld">연락처<input type="text" id="eContact" value="${esc(r.contact||'')}"></label>
            <label class="fld">주문자/학교/업체명<input type="text" id="eName" value="${esc(r.name||'')}"></label>
            <label class="fld">상품코드<input type="text" id="eProdCode" value="${esc(r.prodCode||'')}"></label>
            <label class="fld">날짜<input type="date" id="eDate" value="${esc(r.date||todayStr(r.createdAt))}"></label>
          </div>
          <label class="fld" style="margin-bottom:10px">내용<textarea id="eContent" rows="3">${esc(r.content||'')}</textarea></label>
          <label class="fld" style="margin-bottom:10px">답변<textarea id="eAnswer" rows="2">${esc(r.answer||'')}</textarea></label>
          <div style="display:flex;align-items:center;gap:14px">
            <label class="chk"><input type="checkbox" id="eCb" ${r.callback?'checked':''}> 콜백 필요</label>
            <span style="margin-left:auto;display:flex;gap:6px">
              <button class="btn sm" id="eCancel">취소</button><button class="btn pri sm" id="eSave">저장</button></span>
          </div>`;
        card.replaceWith(box);
        box.querySelector('#eCancel').onclick=()=>renderList();
        box.querySelector('#eSave').onclick=()=>{
          const all=getNotes(); const t=all.find(x=>x.id===r.id); if(t){
            t.category=box.querySelector('#eCat').value; t.customerType=box.querySelector('#eCust').value;
            t.prodCategory=box.querySelector('#eProdCat').value; t.agent=box.querySelector('#eAgent').value.trim()||'-';
            t.contact=box.querySelector('#eContact').value.trim(); t.name=box.querySelector('#eName').value.trim();
            t.prodCode=box.querySelector('#eProdCode').value.trim(); t.date=box.querySelector('#eDate').value||t.date;
            t.content=box.querySelector('#eContent').value.trim(); t.answer=box.querySelector('#eAnswer').value.trim();
            t.callback=box.querySelector('#eCb').checked;
            t.syncedAt=null; // 수정되었으므로 재동기화 필요
            setNotes(all);
          }
          renderList(); renderSyncBar(); toast('수정되었습니다');
        };
      }
      function renderSyncBar(){
        const slot=body.querySelector('#syncSlot'); if(!slot) return;
        const cfg=getCfg(), n=unsynced().length;
        if(!DESTINATIONS[ACTIVE_DEST].configured(cfg)){
          slot.innerHTML=`<div class="syncbar">${icon('alert')}구글 시트가 아직 연결되지 않았습니다. <b>연동 설정</b> 탭에서 시트 URL을 등록하세요.</div>`; return;
        }
        if(n===0){ slot.innerHTML=`<div class="syncbar ok">${icon('checkCircle')}${SHEET_MSG.allSent}.</div>`; return; }
        slot.innerHTML=`<div class="syncbar">${icon('cloudUp')}미전송 <b>${n}건</b>${cfg.syncMode==='realtime'?' (실시간 전송 실패분)':''}
          <button class="btn sm" id="syncNow" style="margin-left:auto">${icon('cloudUp')}시트로 전송</button></div>`;
        slot.querySelector('#syncNow').onclick=async(e)=>{ const btn=e.currentTarget; btn.disabled=true; btn.textContent=SHEET_MSG.sending;
          const r=await syncRecords(unsynced()); renderList(); renderSyncBar();
          toast(r.ok?(r.unconfirmed?SHEET_MSG.unconf(r.synced):SHEET_MSG.ok(r.synced)):SHEET_MSG.fail(r.error)); };
      }

      /* ---------------- 처리 대기 탭 (팀 공용 콜백 큐) ---------------- */
      function drawPending(){
        let pf='wait'; // wait | mine | done | all
        let items=null, roster=[];
        const meName=(Auth.user&&Auth.user()||{}).name||'';
        body.innerHTML=`
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
            <h3 style="font-size:16px">처리 대기 <span class="muted" id="pendSummary" style="font-weight:500;font-size:13.5px"></span></h3>
            <div style="margin-left:auto;display:flex;gap:6px" id="pendFilters"></div>
          </div>
          <div class="note" style="margin-bottom:14px">상담 메모에서 <b>후속조치(콜백) 필요</b>로 체크한 건이 <b>팀 공용</b>으로 모입니다. 담당자를 지정하고, 처리하면 <b>완료</b>로 내리세요.</div>
          <div id="pendList"><div class="muted" style="padding:18px">불러오는 중…</div></div>`;
        function renderFilters(){ const f=body.querySelector('#pendFilters'); f.innerHTML='';
          [['wait','대기중'],['mine','내 담당'],['done','완료'],['all','전체']].forEach(([k,l])=>{ const b=el('button','btn sm'+(pf===k?' pri':''),l);
            b.onclick=()=>{ pf=k; renderFilters(); renderPend(); }; f.appendChild(b); }); }
        function daysWaiting(iso){ return Math.max(0, Math.floor((Date.now()-new Date(iso).getTime())/86400000)); }
        async function reload(){ items=await Q.list(); renderPend(); }
        function saveItem(it){ Q.push(it); updatePendCnt(); }
        function renderPend(){
          const box=body.querySelector('#pendList'), sm=body.querySelector('#pendSummary');
          if(items===null){ box.innerHTML=`<div class="empty">${icon('alert')}<div style="font-size:13.5px">공용 저장소에 연결되지 않았습니다. (배포 환경에서 표시됩니다)</div></div>`; if(sm)sm.textContent=''; return; }
          const waitN=items.filter(r=>!r.done).length;
          if(sm) sm.textContent=`· 대기 ${waitN}건 / 전체 ${items.length}건`;
          let list=items.filter(r=> pf==='wait'?!r.done : pf==='done'?r.done : pf==='mine'?(!r.done && r.assigneeName===meName) : true);
          list.sort((a,b)=> (a.done-b.done) || String(a.createdAt).localeCompare(String(b.createdAt)));
          if(!list.length){ box.innerHTML=`<div class="empty">${icon('checkCircle')}<div style="font-size:13.5px">${pf==='wait'?'처리할 후속조치가 없습니다.':pf==='mine'?'내 담당 건이 없습니다.':'해당 항목이 없습니다.'}</div></div>`; return; }
          box.innerHTML=''; list.forEach(r=>{
            const d=daysWaiting(r.createdAt); const card=el('div','pend-card'+(r.done?' done':''));
            const opts=['<option value="">담당 미지정</option>',...roster.map(p=>`<option ${p.name===r.assigneeName?'selected':''}>${esc(p.name)}</option>`)].join('');
            card.innerHTML=`
              <div class="pc-main">
                <div class="pc-top">
                  <span class="badge info">${esc(r.category||'-')}</span>
                  ${r.name?`<span class="pc-name">${esc(r.name)}</span>`:''}
                  ${r.contact?`<span class="muted">${esc(r.contact)}</span>`:''}
                  ${r.assigneeName?`<span class="pc-asg">${icon('users')}${esc(r.assigneeName)}</span>`:''}
                  ${r.done?'<span class="badge synced">완료</span>':`<span class="pc-age ${d===0?'d0':''}">${d===0?'오늘':'대기 '+d+'일'}</span>`}
                </div>
                <div class="pc-content">${esc(r.content||'')}</div>
                <div class="pc-note"><input type="text" placeholder="처리 메모 (예: 재통화 완료 · 견적 발송)" value="${esc(r.note||'')}"></div>
              </div>
              <div class="pc-side">
                <div class="pc-meta">접수 ${esc(todayStr(r.createdAt))} · ${esc(r.agent||'-')}${r.done&&r.doneAt?'<br>완료 '+timeHM(r.doneAt):''}</div>
                <select class="pc-asgsel" title="담당 지정">${opts}</select>
                <button class="btn ${r.done?'':'pri'} sm" data-a="toggle">${r.done?icon('refresh')+'되돌리기':icon('check')+'완료'}</button>
                <button class="btn ghost sm" data-a="del">${icon('trash')}삭제</button>
              </div>`;
            const inp=card.querySelector('.pc-note input');
            inp.onchange=()=>{ r.note=inp.value; saveItem(r); };
            card.querySelector('.pc-asgsel').onchange=e=>{ r.assigneeName=e.target.value; saveItem(r); renderPend(); };
            card.querySelector('[data-a=toggle]').onclick=()=>{ r.done=!r.done; r.doneAt=r.done?nowISO():null; r.note=inp.value; saveItem(r); renderPend(); };
            card.querySelector('[data-a=del]').onclick=()=>{ if(confirm('이 항목을 목록에서 삭제할까요?')){ Q.del(r.id); items=items.filter(x=>x.id!==r.id); updatePendCnt(); renderPend(); } };
            box.appendChild(card);
          });
        }
        renderFilters();
        fetchRoster().then(r=>{ roster=r; if(items!==null) renderPend(); });
        reload();
      }

      /* ---------------- 일일 결산 탭 ---------------- */
      function drawSummary(){
        let date=todayStr();
        body.innerHTML=`
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
            <label class="fld" style="width:190px">${icon('calendar')} 결산 날짜<input type="date" id="sumDate" value="${date}"></label>
            <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn" id="editTpl">${icon('settings')}양식 편집</button>
              <button class="btn" id="copySum">${icon('copy')}텍스트 복사</button>
              <button class="btn pri" id="saveTxt">${icon('download')}메모장 저장(.txt)</button>
              <button class="btn" id="pushSum">${icon('cloudUp')}미전송분 시트 전송</button></div>
          </div>
          <div id="tplBox" class="hidden"></div>
          <div id="sumWrap"></div>`;
        body.querySelector('#sumDate').onchange=e=>{ date=e.target.value; renderSum(); };
        body.querySelector('#copySum').onclick=()=>copyText(buildSummary(date));
        body.querySelector('#saveTxt').onclick=()=>{ downloadBlob(new Blob([buildSummary(date)],{type:'text/plain;charset=utf-8'}),`CS결산_${date}.txt`); toast('메모장(.txt)으로 저장했습니다'); };
        body.querySelector('#editTpl').onclick=openTpl;
        body.querySelector('#pushSum').onclick=async(e)=>{ const b=e.currentTarget; b.disabled=true;
          const r=await syncRecords(unsynced()); b.disabled=false; renderSum();
          toast(r.ok?(r.unconfirmed?SHEET_MSG.unconf(r.synced):SHEET_MSG.ok(r.synced)):SHEET_MSG.fail(r.error)); };
        renderSum();
        function dayNotes(){ return getNotes().filter(r=>todayStr(r.createdAt)===date); }
        function agg(list){
          const byCat={}; getTypes().forEach(t=>byCat[t]=0);
          const byCust={}; CS_CUSTOMER_TYPES.forEach(t=>byCust[t]=0);
          const byAgent={};
          list.forEach(r=>{ byCat[r.category]=(byCat[r.category]||0)+1;
            if(r.customerType) byCust[r.customerType]=(byCust[r.customerType]||0)+1;
            byAgent[r.agent]=(byAgent[r.agent]||0)+1; });
          return { total:list.length, byCat, byCust, byAgent };
        }
        function renderSum(){
          const list=dayNotes(), a=agg(list); const wrap=body.querySelector('#sumWrap');
          const cbList=list.filter(r=>r.callback);
          wrap.innerHTML=`
            <div class="sum-grid" style="margin-bottom:16px">
              <div class="sum-card"><div class="lb">총 상담 건수</div><div class="vl">${a.total}</div></div>
              ${getTypes().map(t=>`<div class="sum-card"><div class="lb">${esc(t)}</div><div class="vl">${a.byCat[t]||0}</div></div>`).join('')}
              <div class="sum-card" style="border-color:#ead9b0;background:var(--warn-bg)"><div class="lb">콜백 필요</div><div class="vl" style="color:var(--warn)">${cbList.length}</div></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">
              <div class="card"><div class="card-hd"><b>상담사별 처리 건수</b></div><div class="card-bd" style="padding:0">
                <table class="tbl"><thead><tr><th>상담사</th><th class="num">건수</th></tr></thead><tbody>
                  ${Object.keys(a.byAgent).length?Object.entries(a.byAgent).sort((x,y)=>y[1]-x[1]).map(([k,v])=>`<tr><td>${esc(k)}</td><td class="num">${v}</td></tr>`).join(''):'<tr><td colspan="2" class="muted" style="text-align:center;padding:16px">기록 없음</td></tr>'}
                </tbody></table></div></div>
              <div class="card"><div class="card-hd"><b>고객유형별 건수</b></div><div class="card-bd" style="padding:0">
                <table class="tbl"><thead><tr><th>고객유형</th><th class="num">건수</th></tr></thead><tbody>
                  ${CS_CUSTOMER_TYPES.some(t=>a.byCust[t])?CS_CUSTOMER_TYPES.filter(t=>a.byCust[t]).map(t=>`<tr><td>${esc(t)}</td><td class="num">${a.byCust[t]}</td></tr>`).join(''):'<tr><td colspan="2" class="muted" style="text-align:center;padding:16px">기록 없음</td></tr>'}
                </tbody></table></div></div>
            </div>
            <div class="card" style="margin-top:16px"><div class="card-hd"><b>콜백 필요 목록</b></div><div class="card-bd" style="padding:0">
              <table class="tbl"><thead><tr><th style="width:70px">시각</th><th style="width:90px">분류</th><th>주문자/업체</th><th>연락처</th><th>내용</th></tr></thead><tbody>
                ${cbList.length?cbList.sort((x,y)=>x.createdAt.localeCompare(y.createdAt)).map(r=>`<tr><td>${timeHM(r.createdAt)}</td><td>${esc(r.category||'-')}</td><td>${esc(r.name||'-')}</td><td>${esc(r.contact||'-')}</td><td>${esc((r.content||'').slice(0,40))}</td></tr>`).join(''):'<tr><td colspan="5" class="muted" style="text-align:center;padding:16px">콜백 필요 없음</td></tr>'}
              </tbody></table></div></div>
            <div class="card" style="margin-top:16px"><div class="card-hd">${icon('clipboard')}<b>저장 텍스트 미리보기</b>
              <span class="muted" style="margin-left:auto;font-size:12px">[양식 편집]에서 형식을 바꿀 수 있습니다</span></div>
              <div class="card-bd"><pre id="sumPre" style="white-space:pre-wrap;font-family:var(--mono);font-size:12.5px;line-height:1.55;margin:0;color:var(--ink-2)"></pre></div></div>`;
          const pre=body.querySelector('#sumPre'); if(pre) pre.textContent=buildSummary(date);
        }
        // 토큰 치환으로 결산 텍스트 생성 (커스텀 양식 반영)
        function buildSummary(d){
          const list=getNotes().filter(r=>todayStr(r.createdAt)===d), a=agg(list);
          const catLines=getTypes().map(t=>`- ${t}: ${a.byCat[t]||0}건`).join('\n');
          const custLines=CS_CUSTOMER_TYPES.filter(t=>a.byCust[t]).map(t=>`- ${t}: ${a.byCust[t]}건`).join('\n') || '- (없음)';
          const agentLines=Object.entries(a.byAgent).sort((x,y)=>y[1]-x[1]).map(([k,v])=>`- ${k}: ${v}건`).join('\n') || '- (없음)';
          const cbList=list.filter(r=>r.callback);
          const cbLines=cbList.length? cbList.sort((x,y)=>x.createdAt.localeCompare(y.createdAt))
            .map(r=>`- ${timeHM(r.createdAt)} ${r.name||'-'}${r.contact?`(${r.contact})`:''}: ${(r.content||'').slice(0,40)}${r.callbackDone?' [완료]':''}`).join('\n') : '- (없음)';
          const map={ '{날짜}':d, '{총건수}':a.total, '{분류별}':catLines, '{고객유형별}':custLines,
            '{상담사별}':agentLines, '{콜백건수}':cbList.length, '{콜백목록}':cbLines };
          let out=getSumTpl(); Object.keys(map).forEach(k=>{ out=out.split(k).join(map[k]); }); return out;
        }
        // 결산 양식 편집기
        function openTpl(){
          const box=body.querySelector('#tplBox'); box.classList.remove('hidden');
          box.innerHTML=`<div class="card" style="margin-bottom:16px"><div class="card-hd">${icon('settings')}<b>결산 저장 양식 편집</b>
            <span style="margin-left:auto;display:flex;gap:6px">
              <button class="btn sm" id="tplReset">${icon('refresh')}기본값</button>
              <button class="btn pri sm" id="tplSave">${icon('save')}저장</button>
              <button class="btn sm" id="tplClose">닫기</button></span></div>
            <div class="card-bd">
              <div class="muted" style="font-size:12.5px;margin-bottom:8px">아래 <b>토큰</b>을 클릭해 넣거나 자유롭게 배치하세요. 저장하면 [텍스트 복사]·[메모장 저장]에 반영됩니다.</div>
              <div class="tpl-tokens" id="tplTokens"></div>
              <textarea id="tplArea" rows="12" style="width:100%;font-family:var(--mono);font-size:13px;line-height:1.5">${esc(getSumTpl())}</textarea>
            </div></div>`;
          const tokens=[['{날짜}','날짜'],['{총건수}','총 건수'],['{분류별}','분류별 목록'],['{고객유형별}','고객유형별 목록'],['{상담사별}','상담사별 목록'],['{콜백건수}','콜백 건수'],['{콜백목록}','콜백 목록']];
          const tt=box.querySelector('#tplTokens');
          tokens.forEach(([k,d2])=>{ const b=el('button','chip sm'); b.type='button'; b.textContent=k; b.title=d2;
            b.onclick=()=>{ const ta=box.querySelector('#tplArea'); const s=ta.selectionStart??ta.value.length, e2=ta.selectionEnd??s;
              ta.value=ta.value.slice(0,s)+k+ta.value.slice(e2); ta.focus(); ta.selectionStart=ta.selectionEnd=s+k.length; };
            tt.appendChild(b); });
          box.querySelector('#tplClose').onclick=()=>{ box.classList.add('hidden'); box.innerHTML=''; };
          box.querySelector('#tplReset').onclick=()=>{ box.querySelector('#tplArea').value=DEFAULT_SUM_TPL; };
          box.querySelector('#tplSave').onclick=()=>{ setSumTpl(box.querySelector('#tplArea').value); toast('양식을 저장했습니다'); renderSum(); };
        }
        window.__csBuildSummary=buildSummary; // (테스트 편의)
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
                <li>기록할 <b>구글 시트</b>를 엽니다. <span class="muted" style="font-size:12.5px">(1행 헤더: 날짜·분류·연락처·고객유형·주문자/학교/업체명·상품분류·상품코드·내용·답변·상담사)</span></li>
                <li><span class="k">확장 프로그램</span> → <span class="k">Apps Script</span> → 편집기 내용을 지우고 위 <b>[Apps Script 코드 복사]</b> 붙여넣기 후 저장.</li>
                <li>코드 상단 <span class="mono" style="font-size:12px">SHEET_NAME</span> 을 기록할 <b>탭 이름</b>으로 맞춥니다. <span class="muted" style="font-size:12.5px">(예: 상담test / 2026 CS 상담이력)</span></li>
                <li><span class="k">배포</span> → <span class="k">새 배포</span> → <span class="k">웹 앱</span> (실행: 나 / 액세스: <span class="k">모든 사용자</span>)로 배포. <span class="muted" style="font-size:12.5px">(권한 승인 창이 뜨면 허용)</span></li>
                <li>표시된 <b>웹 앱 URL</b>(<span class="mono" style="font-size:12.5px">…/exec</span>)을 아래에 붙여넣고 <b>[저장] → [연결 테스트]</b>.</li>
              </ol>
              <div class="note" style="margin-top:6px">시트 <b>1행 헤더 이름</b>을 읽어 칸을 맞추므로 열 순서가 달라도 정확히 들어갑니다.
                각 기록은 숨은 <b>id</b> 열로 <b>중복 없이</b> 갱신되며, 전송이 실패해도 로컬에 안전하게 보관됩니다.</div>
            </div>
          </div>

          <div class="card" style="margin-bottom:16px;max-width:820px">
            <div class="card-hd">${icon('link')}<b>구글 시트 연결</b></div>
            <div class="card-bd">
              <label class="fld" style="margin-bottom:14px">웹 앱 URL <span class="muted" style="font-weight:500">· 위 5번에서 복사한 주소</span>
                <input type="text" id="cfgUrl" value="${esc(cfg.sheetUrl)}" placeholder="https://script.google.com/macros/s/……/exec"></label>
              <div style="margin-bottom:16px">
                <label class="fld" style="margin-bottom:8px">전송 방식</label>
                <div style="display:flex;gap:20px;flex-wrap:wrap">
                  <label class="chk"><input type="radio" name="mode" value="realtime" ${cfg.syncMode==='realtime'?'checked':''}> 실시간 (저장할 때마다 바로 시트로)</label>
                  <label class="chk"><input type="radio" name="mode" value="batch" ${cfg.syncMode!=='realtime'?'checked':''}> 일괄 (버튼 누를 때 모아서 전송)</label>
                </div>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                <button class="btn pri" id="cfgSave">${icon('check')}저장</button>
                <button class="btn" id="cfgTest">${icon('cloud')}연결 테스트</button>
                <button class="btn" id="cfgPush">${icon('cloudUp')}미전송분 전체 전송</button>
                <span class="muted" id="cfgStat" style="font-size:13px"></span>
              </div>
            </div>
          </div>

          <div class="card" style="margin-bottom:16px;max-width:820px;opacity:.7">
            <div class="card-hd">${icon('link')}<b>노션 연동</b><span class="badge soon" style="margin-left:auto">예정</span></div>
            <div class="card-bd"><div class="muted" style="font-size:13.5px">저장/전송 로직은 목적지(destination) 추상화로 설계되어, 이후 노션 대상만 추가하면 됩니다. (현재 인터페이스만 존재)</div></div>
          </div>`;
        body.querySelector('#copyCode').onclick=async(e)=>{
          try{ const r=await fetch('google-apps-script.gs'); if(!r.ok) throw 0; const t=await r.text(); copyText(t); }
          catch{ toast('코드 파일을 불러오지 못했습니다 — 저장소의 google-apps-script.gs 를 사용하세요'); } };
        body.querySelector('#cfgSave').onclick=()=>{
          const url=body.querySelector('#cfgUrl').value.trim();
          const mode=body.querySelector('input[name=mode]:checked').value;
          setCfg({ sheetUrl:url, syncMode:mode }); toast('설정을 저장했습니다');
        };
        body.querySelector('#cfgTest').onclick=async()=>{
          const url=body.querySelector('#cfgUrl').value.trim(), stat=body.querySelector('#cfgStat');
          if(!url){ stat.textContent='URL을 입력하세요'; return; }
          stat.textContent='테스트 중…';
          try{ const res=await fetch(url,{method:'GET'}); let d=null; try{d=await res.json();}catch{}
            stat.innerHTML = res.ok ? `<span style="color:var(--ok)">연결 성공${d&&d.sheet?` · 시트 "${esc(d.sheet)}"`:''}</span>` : `<span style="color:var(--danger)">응답 오류 HTTP ${res.status}</span>`;
          }catch(err){ stat.innerHTML=`<span style="color:var(--danger)">연결 실패: ${esc(err.message)}</span>`; }
        };
        body.querySelector('#cfgPush').onclick=async(e)=>{ const b=e.currentTarget; b.disabled=true;
          const r=await syncRecords(unsynced()); b.disabled=false;
          body.querySelector('#cfgStat').textContent = r.ok?(r.unconfirmed?SHEET_MSG.unconf(r.synced):SHEET_MSG.ok(r.synced)):SHEET_MSG.fail(r.error); };
      }

      draw();
    }
  };
})();
