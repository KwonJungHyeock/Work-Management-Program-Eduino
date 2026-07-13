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

■ 문의유형별
{분류별}

■ 상담사별
{상담사별}

후속조치(콜백) 필요: {콜백건수}건`;

  /* ---- 목적지(destination) 추상화 ----
     새 대상(예: 노션)은 여기 객체만 추가하면 됩니다. */
  const DESTINATIONS = {
    sheet: {
      id:'sheet', name:'구글 시트',
      configured: cfg => !!(cfg && cfg.sheetUrl),
      /* records 를 Apps Script 웹앱(doPost)으로 전송. id 기준 upsert 이므로 재시도해도 중복 없음 */
      async send(records, cfg){
        const payload = records.map(toSheetRecord);
        const opts={ method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify({ sheet:'CS상담메모', records: payload }) };
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
  };
  const ACTIVE_DEST = 'sheet';

  /* ---- 처리대기 공용 큐 (/api/store 컬렉션 'callbacks') · 팀 공유 ---- */
  const Q = {
    async list(){ try{ const r=await fetch('/api/store?type=coll&coll=callbacks'); if(!r.ok) throw 0; const d=await r.json(); return (d&&d.items)||[]; }catch{ return null; } },
    push(item){ try{ return fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collPush',coll:'callbacks',item})}); }catch{} },
    del(id){ try{ return fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collDel',coll:'callbacks',id})}); }catch{} },
  };
  async function fetchRoster(){ try{ const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'roster'})}); const d=await r.json(); return (d&&d.roster)||[]; }catch{ return []; } }

  /* 한국 전화번호 서식 — 서울(02, 9~10자리) / 그 외 지역·휴대폰(10~11자리) 모두 대응 */
  function fmtPhone(v){
    let d=String(v||'').replace(/\D/g,'');
    if(!d) return '';
    if(d.startsWith('02')){ d=d.slice(0,10); const r=d.slice(2);
      if(d.length<=2) return '02';
      if(d.length<=8) return '02-'+r;                                   // 입력 중
      return '02-'+r.slice(0,r.length-4)+'-'+r.slice(-4);               // 02-XXX-XXXX / 02-XXXX-XXXX
    }
    d=d.slice(0,11);
    if(d.length<=3) return d;
    if(d.length<=7) return d.slice(0,3)+'-'+d.slice(3);                 // 0XX-XXXX (입력 중)
    return d.slice(0,3)+'-'+d.slice(3,d.length-4)+'-'+d.slice(-4);      // 0XX-XXX-XXXX / 0XX-XXXX-XXXX
  }

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
  // 상담 기록(누적 시트) 화면에서 편집 후 구글시트에 재전송할 수 있도록 노출
  window.CSSheet = { configured:()=>DESTINATIONS[ACTIVE_DEST].configured(getCfg()), send:syncRecords };

  // 저장 실패로 미전송된 상담 자동 재시도 (주기적 + 재접속 시) — 내부는 멱등 재반영, 외부는 구글시트
  async function retrySync(){
    try{ const u=unsynced(); if(!u.length) return; const cfg=getCfg();
      if(window.Records) u.forEach(r=>Records.pushCS(r));                        // 내부 상담 기록 재반영(중복 없음)
      if(cfg.backup!==false && DESTINATIONS[ACTIVE_DEST].configured(cfg)) await syncRecords(u);
    }catch(e){}
  }
  setInterval(retrySync, 90000);
  window.addEventListener('online', retrySync);

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
      // 팀원은 실무만: 설정(연동·상담사/분류 편집)은 관리자만 · 상담사는 본인 고정 · 이력은 본인 것만
      const isAdmin=!!(Auth.isAdmin&&Auth.isAdmin());
      const meName=((Auth.user&&Auth.user())||{}).name||'';
      if(!isAdmin && meName) lastAgent=meName;
      let typeEdit=false, agentEdit=false;
      // 폼 상태 (분류·상담사·날짜는 저장 후에도 유지되는 컨텍스트)
      let form={ category:getTypes()[0], customerType:'', prodCategory:'', route:'', date:todayStr(), agent:lastAgent };

      root.innerHTML=`
      <style>
        /* 빠른 입력 (메모 중심) */
        .q-card{border:1px solid var(--line);border-radius:14px;background:var(--panel);overflow:hidden;margin-bottom:20px;box-shadow:var(--sh)}
        .q-hd{display:flex;align-items:center;gap:10px;padding:14px 20px;background:linear-gradient(180deg,var(--panel-2),var(--panel));border-bottom:1px solid var(--line);font-weight:800;font-size:15.5px}
        .q-hd .q-ic{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;
          background:var(--red-soft);color:var(--red);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--red) 22%,transparent)}
        .q-hd .q-ic svg{width:15px;height:15px}
        /* 오늘 처리량 위젯 */
        .today-stat{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}
        .ts{display:flex;align-items:center;gap:11px;padding:11px 16px;border:1px solid var(--line);border-radius:11px;background:var(--panel);box-shadow:var(--sh-sm);min-width:150px;flex:1 1 0}
        .ts .ts-ic{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex:none;font-size:17px}
        .ts.me .ts-ic{background:var(--red-soft);color:var(--red)} .ts.day .ts-ic{background:var(--info-bg);color:var(--info)} .ts.week .ts-ic{background:var(--ok-bg);color:var(--ok)}
        .ts .ts-l{font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.03em;text-transform:uppercase}
        .ts .ts-v{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--ink);line-height:1.15}
        .ts .ts-v small{font-size:12.5px;font-weight:600;color:var(--muted);margin-left:2px}
        .today-stat.skel-load .ts{opacity:.5}
        /* 고객 이력 (연락처 기준) */
        .cust-hist{margin-top:8px;display:none}
        .cust-hist.on{display:block}
        .ch-hd{font-size:12px;font-weight:800;color:var(--info);display:flex;align-items:center;gap:5px;margin-bottom:6px}
        .ch-hd svg{width:13px;height:13px}
        .ch-item{font-size:12px;line-height:1.45;padding:7px 9px;border:1px solid var(--line);border-left:2px solid var(--info);border-radius:7px;background:var(--panel-2);margin-bottom:5px}
        .ch-item .ch-m{color:var(--muted);font-weight:700;margin-bottom:2px}
        .ch-item .ch-c{color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .ch-none{font-size:12px;color:var(--faint);padding:2px 0}
        .q-hd .kbd{margin-left:auto;font-size:12.5px;font-weight:600;color:var(--muted)}
        .q-hd .kbd b{background:var(--panel);border:1px solid var(--line-strong);border-radius:5px;padding:1px 7px;color:var(--ink-2)}
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
        .chip{display:inline-flex;align-items:center;gap:6px;padding:8px 15px;border:1px solid var(--line-strong);border-radius:8px;background:var(--panel);
          font-size:13.5px;font-weight:600;color:var(--ink-2);cursor:pointer;transition:border-color .12s,background .12s,box-shadow .12s,transform .12s;user-select:none;line-height:1.2}
        .chip:hover{border-color:var(--faint);background:var(--panel-2);transform:translateY(-1px)}
        .chip.on{border-color:var(--red);background:var(--red-soft);color:var(--red);font-weight:700;box-shadow:inset 0 0 0 1px var(--red),0 1px 3px color-mix(in srgb,var(--red) 20%,transparent)}
        .chip.on:hover{transform:translateY(-1px)}
        .chip .q-del{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;
          background:var(--line-strong);color:#fff;font-size:10px;font-weight:800}
        .chip.on .q-del{background:var(--red);color:#fff}
        .sec-edit{margin-left:auto;background:none;border:0;color:var(--muted);font-size:12px;font-weight:700;cursor:pointer;padding:3px 8px;border-radius:6px;text-transform:none;letter-spacing:0}
        .sec-edit:hover{background:var(--hover);color:var(--red)} .sec-edit.on{color:var(--red)}
        .chip-add{display:flex;gap:6px;align-items:center}
        .chip-add input{height:auto;padding:8px 10px;font-size:13.5px;width:118px}
        /* 내용/답변 */
        .q-memo{width:100%;min-height:150px;font-size:15px;line-height:1.6;padding:14px;border:1.5px solid var(--line-strong);border-radius:10px;background:var(--panel);resize:vertical}
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
        .pend-card{display:grid;grid-template-columns:1fr 210px;gap:14px;align-items:start;padding:13px 15px;border:1px solid var(--line);border-radius:10px;background:var(--panel);margin-bottom:9px}
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
        .note-card{display:grid;grid-template-columns:58px 96px 1fr auto;gap:12px;align-items:start;padding:12px 14px;border:1px solid var(--line);border-radius:9px;background:var(--panel);margin-bottom:8px}
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
        .badge.cb{background:#eae4ff;color:#5b3fc4}
      </style>
      <div class="mhead">
        <div class="tt">상담 메모</div>
        <div class="ds">통화 중 분류·고객유형·상품분류를 바로 누르고 내용을 적으면(Ctrl+Enter 저장) <b>내부 상담 기록과 구글시트에 동시에 저장</b>됩니다.</div>
        <div class="mtabs">
          <div class="t" data-t="memo">상담 메모</div>
          <div class="t" data-t="pending">처리 대기 <span class="tab-cnt" id="pendCnt" style="display:none"></span></div>
          <div class="t" data-t="summary">일일 결산</div>
          ${isAdmin?'<div class="t" data-t="settings">연동 설정</div>':''}
        </div>
      </div>
      <div class="mbody" id="csBody"></div>`;
      const body=root.querySelector('#csBody');
      root.querySelectorAll('.mtabs .t').forEach(t=>{ t.classList.toggle('on',t.dataset.t===tab);
        t.onclick=()=>{ tab=t.dataset.t; root.querySelectorAll('.mtabs .t').forEach(x=>x.classList.toggle('on',x.dataset.t===tab)); draw(); }; });
      const draw=()=>{ updatePendCnt();
        if(tab==='settings' && !isAdmin) tab='memo';
        return tab==='memo'?drawMemo(): tab==='pending'?drawPending(): tab==='summary'?drawSummary(): drawSettings(); };
      async function updatePendCnt(){ const c=root.querySelector('#pendCnt'); if(!c) return;
        const list=await Q.list(); if(!list){ c.style.display='none'; return; }
        const n=list.filter(r=>!r.done).length;
        c.textContent=n||''; c.style.display=n?'':'none'; }

      /* ---------------- 상담 메모 탭 ---------------- */
      let histCache=null;
      function showCustHist(phone){
        const el2=body.querySelector('#custHist'); if(!el2) return;
        const key=String(phone||'').replace(/\D/g,'');
        if(!histCache || key.length<9){ el2.className='cust-hist'; el2.innerHTML=''; return; }
        const dayOf=r=>String(r.date||r.day||'').slice(0,10);
        const matches=histCache.filter(r=>String(r.contact||'').replace(/\D/g,'')===key)
          .sort((a,b)=>String(b.date||b.day||'').localeCompare(String(a.date||a.day||'')));
        if(!matches.length){ el2.className='cust-hist on'; el2.innerHTML=`<div class="ch-none">이 번호의 이전 상담 기록이 없습니다.</div>`; return; }
        el2.className='cust-hist on';
        el2.innerHTML=`<div class="ch-hd">${icon('history')}이 고객 이전 문의 ${matches.length}건</div>`+
          matches.slice(0,3).map(r=>`<div class="ch-item"><div class="ch-m">${esc(dayOf(r))} · ${esc(r.category||'-')}${r.name?' · '+esc(r.name):''}</div><div class="ch-c">${esc((r.content||'').slice(0,50)||'(내용 없음)')}</div></div>`).join('');
      }
      function drawMemo(){
        body.innerHTML=`
          <div class="today-stat" id="todayStat" style="display:none"></div>
          <div class="q-card">
            <div class="q-hd"><span class="q-ic">${icon('phone')}</span>빠른 입력
              <span class="kbd">저장 후 자동 초기화 · <b>Ctrl</b>+<b>Enter</b> 저장</span></div>
            <div class="q-bd">
              <form id="qform">
                <div class="q-grid">
                  <div class="q-main">
                    <div>
                      <div class="q-sec-cap">분류 <span class="req">필수</span>
                        ${isAdmin?'<button type="button" class="sec-edit" id="typeEdit">편집</button>':''}</div>
                      <div class="chips" id="catGroup"></div>
                    </div>
                    <div>
                      <div class="q-sec-cap">고객유형 <span class="opt">선택 · 다시 누르면 해제</span>
                        ${isAdmin?'<button type="button" class="sec-edit" data-oe="cust">편집</button>':''}</div>
                      <div class="chips" id="custGroup"></div>
                    </div>
                    <div>
                      <div class="q-sec-cap">상품분류 <span class="opt">선택 · 다시 누르면 해제</span>
                        ${isAdmin?'<button type="button" class="sec-edit" data-oe="prod">편집</button>':''}</div>
                      <div class="chips" id="prodGroup"></div>
                    </div>
                    <div>
                      <div class="q-sec-cap">주문경로 <span class="opt">선택 · 다시 누르면 해제</span>
                        ${isAdmin?'<button type="button" class="sec-edit" data-oe="route">편집</button>':''}</div>
                      <div class="chips" id="routeGroup"></div>
                    </div>
                    <div>
                      <div class="q-sec-cap">내용 <span class="req">필수</span></div>
                      <textarea id="fContent" class="q-memo" placeholder="문의 내용을 입력하세요 —  통화하면서 자유롭게 기록" required></textarea>
                    </div>
                    <div>
                      <div class="q-sec-cap" style="display:flex;align-items:center;gap:6px;white-space:nowrap">답변 <span class="opt">선택</span>
                        <select id="tplSel" class="sec-edit" style="margin-left:auto;max-width:170px;padding:2px 6px;font-weight:700;cursor:pointer"></select></div>
                      <textarea id="fAnswer" class="q-ans" placeholder="응대/답변 내용 (나중에 채워도 됩니다)"></textarea>
                    </div>
                  </div>

                  <aside class="q-side">
                    <div>
                      <div class="side-cap-row"><span class="cap" style="margin:0">상담사</span></div>
                      <div class="q-agents" id="agentGroup"></div>
                    </div>
                    <div><span class="cap">날짜</span><input type="date" id="fDate" value="${esc(form.date)}"></div>
                    <div><span class="cap">연락처 <em>선택</em></span><input type="tel" inputmode="numeric" id="fContact" placeholder="010-0000-0000" maxlength="13">
                      <div class="cust-hist" id="custHist"></div></div>
                    <div><span class="cap">이름/학교명/업체명 <em>선택</em></span><input type="text" id="fName" list="dlName" autocomplete="off" placeholder="예: 홍길동 / 에듀이노초"><datalist id="dlName"></datalist></div>
                    <div><span class="cap">상품코드 <em>선택</em></span><input type="text" id="fProdCode" list="dlCode" autocomplete="off" placeholder="예: A-100"><datalist id="dlCode"></datalist></div>
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
        { const te=body.querySelector('#typeEdit'); if(te) te.onclick=(e)=>{ typeEdit=!typeEdit;
          e.currentTarget.classList.toggle('on',typeEdit); e.currentTarget.textContent=typeEdit?'완료':'편집';
          renderCat(); }; }
        renderCat();

        /* --- 고객유형 / 상품분류 / 주문경로 칩 (단일선택 · 관리자는 ＋추가/×삭제 → 팀 자동 공유) --- */
        const OPT_GROUPS = {
          cust:  { sel:'#custGroup', setKey:'cs.notes.customerType', defaults:CS_CUSTOMER_TYPES,     key:'customerType', ph:'새 고객유형' },
          prod:  { sel:'#prodGroup', setKey:'cs.notes.prodCategory', defaults:CS_PRODUCT_CATEGORIES,  key:'prodCategory', ph:'새 상품분류' },
          route: { sel:'#routeGroup',setKey:'cs.notes.route',        defaults:CS_ORDER_ROUTES,        key:'route',        ph:'새 주문경로' },
        };
        const optEdit={ cust:false, prod:false, route:false };
        function renderChoice(name){
          const cfg=OPT_GROUPS[name]; const g=body.querySelector(cfg.sel); if(!g) return;
          const options=OptionSets.get(cfg.setKey, cfg.defaults); const edit=isAdmin && optEdit[name];
          if(form[cfg.key] && !options.includes(form[cfg.key])) form[cfg.key]='';
          g.innerHTML='';
          options.forEach(o=>{ const b=el('button','chip'+(form[cfg.key]===o?' on':'')); b.type='button';
            b.innerHTML=`<span>${esc(o)}</span>${edit&&options.length>1?'<span class="q-del" title="삭제">✕</span>':''}`;
            b.onclick=(e)=>{ if(e.target.classList.contains('q-del')){ OptionSets.remove(cfg.setKey,cfg.defaults,o); if(form[cfg.key]===o)form[cfg.key]=''; renderChoice(name); return; }
              if(edit) return; form[cfg.key]=(form[cfg.key]===o?'':o); renderChoice(name); };
            g.appendChild(b); });
          if(edit){ const add=el('div','chip-add');
            add.innerHTML=`<input type="text" class="optNew" placeholder="${cfg.ph}" maxlength="14">
              <button type="button" class="btn pri sm optAdd">${icon('plus')}추가</button>`;
            const doAdd=()=>{ const inp=add.querySelector('.optNew'); const r=OptionSets.add(cfg.setKey,cfg.defaults,inp.value);
              if(!r.ok){ if(inp.value.trim()) toast('이미 있는 항목입니다'); return; } renderChoice(name);
              const ni=g.querySelector('.optNew'); if(ni) ni.focus(); };
            add.querySelector('.optAdd').onclick=doAdd;
            add.querySelector('.optNew').onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); doAdd(); } };
            g.appendChild(add);
          }
        }
        Object.keys(OPT_GROUPS).forEach(renderChoice);
        body.querySelectorAll('[data-oe]').forEach(btn=>btn.onclick=(e)=>{ const n=btn.dataset.oe; optEdit[n]=!optEdit[n];
          e.currentTarget.classList.toggle('on',optEdit[n]); e.currentTarget.textContent=optEdit[n]?'완료':'편집'; renderChoice(n); });

        /* --- 입력 편의: 연락처 한국 전화 서식(서울 02 포함) + 최근값 자동완성 --- */
        (function(){
          const ct=body.querySelector('#fContact');
          const notes=getNotes(); const recent=(k)=>[...new Set(notes.map(r=>r[k]).filter(Boolean))].slice(-40).reverse();
          const nl=body.querySelector('#dlName'), cl=body.querySelector('#dlCode');
          if(nl) nl.innerHTML=recent('name').map(v=>`<option value="${esc(v)}">`).join('');
          if(cl) cl.innerHTML=recent('prodCode').map(v=>`<option value="${esc(v)}">`).join('');
          if(ct) ct.addEventListener('input',()=>{ ct.value=fmtPhone(ct.value); showCustHist(ct.value); });
        })();

        /* --- 오늘 처리량 위젯 + 고객 이력(연락처) : 최근 기록 1회 프리페치 --- */
        (function(){
          const ymd=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
          const digits=s=>String(s||'').replace(/\D/g,'');
          const dayOf=r=>String(r.date||r.day||'').slice(0,10);
          const today=todayStr(); const ws=new Date(); ws.setDate(ws.getDate()-((ws.getDay()+6)%7)); const wkStart=ymd(ws);
          const months=[...new Set([today.slice(0,7), wkStart.slice(0,7), ymd(new Date(new Date().setMonth(new Date().getMonth()-1))).slice(0,7)])];
          histCache=null;
          if(!window.Records) return;
          Promise.all(months.map(m=>Records.month('cs','notes',m))).then(packs=>{
            if(!body.isConnected) return;
            histCache=packs.filter(Boolean).flat();
            // 오늘 처리량 위젯
            const box=body.querySelector('#todayStat'); if(box){
              const myName=meName||((Auth.user&&Auth.user()||{}).name)||'';
              const todayN=histCache.filter(r=>dayOf(r)===today).length;
              const weekN=histCache.filter(r=>{ const d=dayOf(r); return d>=wkStart&&d<=today; }).length;
              const mineN=histCache.filter(r=>dayOf(r)===today && (r.agent||r.whoName||'')===myName).length;
              box.innerHTML=`
                <div class="ts me"><span class="ts-ic">🙋</span><div><div class="ts-l">오늘 나</div><div class="ts-v">${mineN}<small>건</small></div></div></div>
                <div class="ts day"><span class="ts-ic">📋</span><div><div class="ts-l">오늘 상담(팀)</div><div class="ts-v">${todayN}<small>건</small></div></div></div>
                <div class="ts week"><span class="ts-ic">🗓️</span><div><div class="ts-l">이번 주(팀)</div><div class="ts-v">${weekN}<small>건</small></div></div></div>`;
              box.style.display='flex';
            }
            const ct=body.querySelector('#fContact'); if(ct&&ct.value) showCustHist(ct.value);
          }).catch(()=>{});
        })();

        /* --- 답변 템플릿 원클릭 삽입 (답변 템플릿 라이브러리와 연동) --- */
        (function(){ const sel=body.querySelector('#tplSel'); if(!sel) return;
          const tpls=store(STORE.csTpl).get([]);
          sel.innerHTML=`<option value="">＋ 템플릿 삽입</option>`+
            tpls.map((t,i)=>`<option value="${i}">[${esc(t.cat||'기타')}] ${esc(t.title||'')}</option>`).join('');
          sel.onchange=()=>{ if(sel.value==='') return; const t=tpls[Number(sel.value)];
            if(t){ const ta=body.querySelector('#fAnswer');
              ta.value = ta.value.trim() ? (ta.value.replace(/\s+$/,'')+'\n\n'+t.body) : t.body; ta.focus(); }
            sel.value=''; };
        })();

        /* --- 상담사 드롭다운 (공간 효율 · 관리자는 목록에서 직접 추가) --- */
        function renderAgents(){
          const g=body.querySelector('#agentGroup'); g.innerHTML='';
          if(!isAdmin){   // 팀원: 본인이 상담사 (선택·편집 불가)
            form.agent = meName || form.agent;
            g.innerHTML=`<select disabled style="width:100%;height:40px"><option>${esc(form.agent||'-')}</option></select>
              <div class="muted" style="font-size:11.5px;margin-top:4px">본인 계정으로 자동 기록됩니다</div>`;
            return;
          }
          const agents=getAgents();
          if(!agents.includes(form.agent)) form.agent = agents.includes(lastAgent)?lastAgent:(agents[0]||'');
          const buildOpts=cur=>`<option value="">(상담사 선택)</option>${getAgents().map(o=>`<option ${o===cur?'selected':''}>${esc(o)}</option>`).join('')}<option value="__add">＋ 상담사 추가…</option>`;
          g.innerHTML=`<select id="agentSel" style="width:100%;height:40px;font-size:14.5px">${buildOpts(form.agent)}</select>`;
          const sel=g.querySelector('#agentSel');
          sel.onchange=()=>{ if(sel.value==='__add'){ const v=(prompt('추가할 상담사 이름','')||'').trim();
              if(v){ const cur=getAgents(); if(!cur.includes(v)){ cur.push(v); setAgents(cur); } form.agent=v; store(STORE.csAgent).set(v); lastAgent=v; sel.innerHTML=buildOpts(v); }
              else { sel.value=form.agent||''; } return; }
            form.agent=sel.value; if(sel.value){ store(STORE.csAgent).set(sel.value); lastAgent=sel.value; } };
        }
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
            date:form.date, category:form.category, route:form.route,
            contact:body.querySelector('#fContact').value.trim(),
            customerType:form.customerType,
            name:body.querySelector('#fName').value.trim(),
            prodCategory:form.prodCategory,
            prodCode:body.querySelector('#fProdCode').value.trim(),
            content, answer:body.querySelector('#fAnswer').value.trim(),
            agent, callback:body.querySelector('#fCallback').checked, syncedAt:null };
          const all=getNotes(); all.push(rec); setNotes(all);
          // 서버 시트 누적 — 전 직원 공유 기록 + 인사이트(선택 상담사 기준) · 실패해도 저장 무영향
          if(window.Records) Records.pushCS(rec);
          // 콜백(후속조치) 체크 시 → 팀 공용 처리대기 큐에 등록
          if(rec.callback){ Q.push({ id:rec.id, category:rec.category, name:rec.name, contact:rec.contact,
            content:rec.content, agent:rec.agent, createdAt:rec.createdAt, done:false, assignee:'', assigneeName:'', note:'' }); }
          // 폼 초기화 (분류·상담사·날짜 유지 · 고객유형/상품분류/주문경로/텍스트는 비움)
          form.customerType=''; form.prodCategory=''; form.route='';
          renderChoice('#custGroup', CS_CUSTOMER_TYPES, 'customerType');
          renderChoice('#prodGroup', CS_PRODUCT_CATEGORIES, 'prodCategory');
          renderChoice('#routeGroup', CS_ORDER_ROUTES, 'route');
          ['fContent','fAnswer','fContact','fName','fProdCode'].forEach(id=>body.querySelector('#'+id).value='');
          body.querySelector('#fCallback').checked=false;
          body.querySelector('#fContent').focus();
          renderList(); renderSyncBar(); toast('저장되었습니다');
          // 저장과 동시에 구글시트 전송 (내부 상담 기록은 위 Records.pushCS 로 이미 반영)
          const cfg=getCfg();
          if(cfg.backup!==false && DESTINATIONS[ACTIVE_DEST].configured(cfg)){
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

      function todayNotes(){ const t=todayStr();
        return getNotes().filter(r=>todayStr(r.createdAt)===t && (isAdmin || !meName || r.agent===meName)); }
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
            <label class="fld">이름/학교명/업체명<input type="text" id="eName" value="${esc(r.name||'')}"></label>
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
            const wasCb=r.callback; t.callback=box.querySelector('#eCb').checked;
            t.syncedAt=null; // 수정되었으므로 재동기화 필요
            setNotes(all);
            if(window.Records) Records.pushCS(t);   // 서버 시트 반영(편집이면 카운터 중복 없이 덮어씀)
            // 편집으로 콜백을 새로 켜면 처리대기 큐에 등록, 끄면 제거
            if(t.callback && !wasCb){ Q.push({ id:t.id, category:t.category, name:t.name, contact:t.contact,
              content:t.content, agent:t.agent, createdAt:t.createdAt, done:false, assignee:'', assigneeName:'', note:'' }); updatePendCnt(); }
            else if(!t.callback && wasCb){ Q.del(t.id); updatePendCnt(); }
          }
          renderList(); renderSyncBar(); toast('수정되었습니다');
        };
      }
      function renderSyncBar(){
        const slot=body.querySelector('#syncSlot'); if(!slot) return;
        const cfg=getCfg(), n=unsynced().length;
        if(!DESTINATIONS[ACTIVE_DEST].configured(cfg)){
          slot.innerHTML=`<div class="syncbar">${icon('alert')}구글 시트가 아직 연결되지 않았습니다. ${isAdmin?'<b>연동 설정</b> 탭에서 시트 URL을 등록하세요.':'관리자가 시트를 연결하면 자동으로 함께 전송됩니다. (내부 상담 기록에는 저장됩니다)'}</div>`; return;
        }
        if(n===0){ slot.innerHTML=`<div class="syncbar ok">${icon('checkCircle')}${SHEET_MSG.allSent}.</div>`; return; }
        slot.innerHTML=`<div class="syncbar">${icon('cloudUp')}구글시트 전송 실패분 <b>${n}건</b> — 내부 기록에는 저장되어 있습니다
          <button class="btn sm" id="syncNow" style="margin-left:auto">${icon('cloudUp')}다시 전송</button></div>`;
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

      /* ---------------- 일일 결산 탭 (기간 조회 지원) ---------------- */
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
        { const st=body.querySelector('#saveTxt'); if(st) st.onclick=()=>{ downloadBlob(new Blob([buildSummary(from,to)],{type:'text/plain;charset=utf-8'}),`CS결산_${from===to?from:from+'_'+to}.txt`); toast('메모장(.txt)으로 저장했습니다'); }; }
        { const et=body.querySelector('#editTpl'); if(et) et.onclick=openTpl; }
        body.querySelector('#pushSum').onclick=async(e)=>{ const b=e.currentTarget; b.disabled=true;
          const r=await syncRecords(unsynced()); b.disabled=false; renderSum();
          toast(r.ok?(r.unconfirmed?SHEET_MSG.unconf(r.synced):SHEET_MSG.ok(r.synced)):SHEET_MSG.fail(r.error)); };
        renderSum();
        function rangeNotes(){ return getNotes().filter(r=>{ const d=todayStr(r.createdAt); return d>=from&&d<=to; }); }
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
          const list=rangeNotes(), a=agg(list); const wrap=body.querySelector('#sumWrap'); if(!wrap) return;
          const cbCount=list.filter(r=>r.callback).length;
          wrap.innerHTML=`
            <div class="sum-grid" style="margin-bottom:16px">
              <div class="sum-card"><div class="lb">총 상담 건수</div><div class="vl">${a.total}</div></div>
              <div class="sum-card" style="border-color:#ead9b0;background:var(--warn-bg)"><div class="lb">콜백 필요</div><div class="vl" style="color:var(--warn)">${cbCount}</div></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">
              <div class="card"><div class="card-hd"><b>상담사별 처리 건수</b></div><div class="card-bd" style="padding:0">
                <table class="tbl"><thead><tr><th>상담사</th><th class="num">건수</th></tr></thead><tbody>
                  ${Object.keys(a.byAgent).length?Object.entries(a.byAgent).sort((x,y)=>y[1]-x[1]).map(([k,v])=>`<tr><td>${esc(k)}</td><td class="num">${v}</td></tr>`).join(''):'<tr><td colspan="2" class="muted" style="text-align:center;padding:16px">기록 없음</td></tr>'}
                </tbody></table></div></div>
              <div class="card"><div class="card-hd"><b>문의유형별 건수</b></div><div class="card-bd" style="padding:0">
                <table class="tbl"><thead><tr><th>문의유형</th><th class="num">건수</th></tr></thead><tbody>
                  ${getTypes().some(t=>a.byCat[t])?getTypes().filter(t=>a.byCat[t]).map(t=>`<tr><td>${esc(t)}</td><td class="num">${a.byCat[t]}</td></tr>`).join(''):'<tr><td colspan="2" class="muted" style="text-align:center;padding:16px">기록 없음</td></tr>'}
                </tbody></table></div></div>
            </div>
            <div class="card" style="margin-top:16px"><div class="card-hd">${icon('clipboard')}<b>저장 텍스트 미리보기</b>
              <span class="muted" style="margin-left:auto;font-size:12px">[양식 편집]에서 형식을 바꿀 수 있습니다</span></div>
              <div class="card-bd"><pre id="sumPre" style="white-space:pre-wrap;font-family:var(--mono);font-size:12.5px;line-height:1.55;margin:0;color:var(--ink-2)"></pre></div></div>`;
          const pre=body.querySelector('#sumPre'); if(pre) pre.textContent=buildSummary(from,to);
        }
        // 토큰 치환으로 결산 텍스트 생성 (기간·커스텀 양식 반영)
        function buildSummary(f,t){
          const list=getNotes().filter(r=>{ const d=todayStr(r.createdAt); return d>=f&&d<=t; }), a=agg(list);
          const catLines=getTypes().map(t2=>`- ${t2}: ${a.byCat[t2]||0}건`).join('\n');
          const custLines=CS_CUSTOMER_TYPES.filter(t2=>a.byCust[t2]).map(t2=>`- ${t2}: ${a.byCust[t2]}건`).join('\n') || '- (없음)';
          const agentLines=Object.entries(a.byAgent).sort((x,y)=>y[1]-x[1]).map(([k,v])=>`- ${k}: ${v}건`).join('\n') || '- (없음)';
          const cbList=list.filter(r=>r.callback);
          const cbLines=cbList.length? cbList.sort((x,y)=>x.createdAt.localeCompare(y.createdAt))
            .map(r=>`- ${timeHM(r.createdAt)} ${r.name||'-'}${r.contact?`(${r.contact})`:''}: ${(r.content||'').slice(0,40)}${r.callbackDone?' [완료]':''}`).join('\n') : '- (없음)';
          const label = f===t? f : `${f} ~ ${t}`;
          const map={ '{날짜}':label, '{총건수}':a.total, '{분류별}':catLines, '{고객유형별}':custLines,
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
          const tokens=[['{날짜}','기간'],['{총건수}','총 건수'],['{분류별}','문의유형별 목록'],['{상담사별}','상담사별 목록'],['{콜백건수}','콜백 건수']];
          const tt=box.querySelector('#tplTokens');
          tokens.forEach(([k,d2])=>{ const b=el('button','chip sm'); b.type='button'; b.textContent=k; b.title=d2;
            b.onclick=()=>{ const ta=box.querySelector('#tplArea'); const s=ta.selectionStart??ta.value.length, e2=ta.selectionEnd??s;
              ta.value=ta.value.slice(0,s)+k+ta.value.slice(e2); ta.focus(); ta.selectionStart=ta.selectionEnd=s+k.length; };
            tt.appendChild(b); });
          box.querySelector('#tplClose').onclick=()=>{ box.classList.add('hidden'); box.innerHTML=''; };
          box.querySelector('#tplReset').onclick=()=>{ box.querySelector('#tplArea').value=DEFAULT_SUM_TPL; };
          box.querySelector('#tplSave').onclick=()=>{ setSumTpl(box.querySelector('#tplArea').value); toast('양식을 저장했습니다'); renderSum(); };
        }
        window.__csBuildSummary=(d)=>buildSummary(d,d); // (테스트 편의)
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
                <li>백업용 <b>구글 스프레드시트</b>를 준비합니다. <span class="muted" style="font-size:12.5px">(탭·헤더 자동 생성 · 이 모듈 탭: <b>CS상담메모</b>)</span></li>
                <li><span class="k">확장 프로그램</span> → <span class="k">Apps Script</span> → 편집기 내용을 지우고 위 <b>[Apps Script 코드 복사]</b> 붙여넣기 후 저장. <span class="muted" style="font-size:12.5px">(<span class="mono">SHEET_NAME</span>은 <b>비워둠</b> → 모듈별 탭에 기록)</span></li>
                <li><span class="k">배포</span> → <span class="k">새 배포</span> → <span class="k">웹 앱</span> (실행: 나 / 액세스: <span class="k">모든 사용자</span>)로 배포. <span class="muted" style="font-size:12.5px">(권한 승인 창이 뜨면 허용)</span></li>
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
              <div class="note" style="margin-bottom:14px">${icon('check')} 상담 메모를 <b>저장</b>하면 내부 상담 기록과 구글시트에 <b>동시에</b> 전송됩니다. 전송 실패분은 <b>자동 재시도</b>되며 상단 바에서 수동 전송도 가능합니다.</div>
              <label class="chk" style="margin-bottom:16px"><input type="checkbox" id="cfgBackup" ${cfg.backup!==false?'checked':''}> 구글시트 <b>백업 사용</b> <span class="muted" style="font-weight:500">· 끄면 내부 상담 기록에만 저장(내부 시트가 안정화되면 꺼도 됩니다)</span></label>
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
          try{ const res=await fetch(url+(url.includes('?')?'&':'?')+'sheet='+encodeURIComponent('CS상담메모'),{method:'GET'}); let d=null; try{d=await res.json();}catch{}
            stat.innerHTML = res.ok ? `<span style="color:var(--ok)">연결 성공 · 이 모듈 저장 탭 <b>"CS상담메모"</b>${d&&typeof d.rows==='number'?` (${d.rows}행)`:''}</span>` : `<span style="color:var(--danger)">응답 오류 HTTP ${res.status}</span>`;
          }catch(err){ stat.innerHTML=`<span style="color:var(--danger)">연결 실패: ${esc(err.message)}</span>`; }
        };
        body.querySelector('#cfgPush').onclick=async(e)=>{ const b=e.currentTarget; b.disabled=true;
          const r=await syncRecords(unsynced()); b.disabled=false;
          body.querySelector('#cfgStat').textContent = r.ok?(r.unconfirmed?SHEET_MSG.unconf(r.synced):SHEET_MSG.ok(r.synced)):SHEET_MSG.fail(r.error); };
      }

      draw();

      // 자정이 지나면 '오늘 기록'이 자동으로 새 날짜(빈 목록)로 리셋 — 누적 기록은 상담 기록 시트에 보존
      let curDay=todayStr();
      const rollTimer=setInterval(()=>{
        if(!root.isConnected){ clearInterval(rollTimer); return; }
        if(todayStr()!==curDay){ curDay=todayStr(); if(tab==='memo') draw(); }
      }, 60000);
    }
  };
})();
