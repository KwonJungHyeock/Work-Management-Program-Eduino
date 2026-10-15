/* ===========================================================================
   물류 · 중국 발주요청  — 고객이 발주한 중국 제품의 재고/입고 요청 리스트
   ① 주문완료 · 입고대기 : 고객 결제완료 후 자사 상품 입고를 기다리는 건
   ② 견적문의 · 입고요청 : 재고 부족으로 상담만 하고 발주로 이어지지 않은 건(Loss 방지)
   공용 컬렉션 'chinaorders'(팀 공유) — CS·물류가 기록, MD/구매가 열람·발주 후 완료 처리
   ※ 2026-10 메뉴를 CS → 물류로 이동(key: cs.china → logi.china).
     CS 부서원도 그대로 등록·열람할 수 있도록 config.js 의 DEPT_OPEN_EXTRA 로 열어 둔다.
   =========================================================================== */
(function(){
  const COLL='chinaorders';
  const api={
    list: async()=>{ try{ const r=await fetch('/api/store?type=coll&coll='+COLL); if(!r.ok) throw 0; const d=await r.json(); return (d&&d.items)||[]; }catch{ return null; } },
    push: (item)=>{ try{ return fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collPush',coll:COLL,item})}); }catch{} },
    del:  (id)=>{ try{ return fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collDel',coll:COLL,id})}); }catch{} },
  };
  const INQUIRY=['주문완료','견적문의'];   // 문의유형
  const REQ=['입고대기','입고요청'];        // 발주요청
  const REQ_OF={ '주문완료':'입고대기', '견적문의':'입고요청' };   // 시나리오 기본 매핑
  const meU=()=>(Auth.user&&Auth.user())||{};
  const fmtD=iso=>{ try{ const d=new Date(iso); return (d.getMonth()+1)+'/'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }catch{ return ''; } };

  /* ── 결제요청 연동 ───────────────────────────────────────────────────────
     중국 발주 건도 다른 결제요청(선결제 발주·마우저 직소싱)과 같은 길을 탄다.
       이 화면 [결제요청] → md/payreq 시트에 한 줄 적재
       → MD 결제요청 화면에 그날 건으로 집계 → 파트장이 [결제 상신]
       → 대표(박정길) 결재함에서 계좌·금액 확인 후 [결제완료]
     작성 권한은 결제요청 화면과 동일하게 파트장·관리자·'결제요청 수정' 권한자. */
  const won=n=>Number(n||0).toLocaleString();
  const parseAmt=v=>Number(String(v==null?'':v).replace(/[^\d.-]/g,''))||0;
  const canPay=()=>{ const u=meU(); return !!(Auth.isAdmin&&Auth.isAdmin()) || u.role==='lead'
    || (typeof canEditKey==='function' && canEditKey('md.payreq')); };
  /* 업체명 → 입점사 정보의 계좌 (결제요청 화면과 같은 DB를 본다) */
  function venAcct(name){
    const n=String(name||'').trim(); if(!n) return '';
    let L=[]; try{
      L=(typeof STORE!=='undefined'&&STORE.mdVendors&&store(STORE.mdVendors).get(null))||[];
      if(!Array.isArray(L)||!L.length) L=(typeof DEFAULT_MD_VENDORS!=='undefined'&&Array.isArray(DEFAULT_MD_VENDORS))?DEFAULT_MD_VENDORS:[];
    }catch(e){ L=[]; }
    let v=L.find(x=>x&&String(x.name||'').trim()===n);
    if(!v && typeof normCoName==='function'){ const k=normCoName(n); if(k) v=L.find(x=>x&&normCoName(x.name)===k); }
    return (v&&v.account)?String(v.account):'';
  }

  MODULES['logi.china']={
    title:'중국 발주요청', icon:'box',
    render(root){
      const u=meU(); const isAdmin=!!(Auth.isAdmin&&Auth.isAdmin());
      const form={ code:'', name:'', inquiry:'주문완료', req:'입고대기', customer:'', qty:'', content:'' };
      let items=[], filt={ inquiry:'', req:'', status:'open' };

      root.innerHTML=`
      <style>
        .q-card{border:1px solid var(--line);border-radius:14px;background:var(--panel);overflow:hidden;margin-bottom:20px;box-shadow:var(--sh)}
        .q-hd{display:flex;align-items:center;gap:10px;padding:14px 20px;background:linear-gradient(180deg,var(--panel-2),var(--panel));border-bottom:1px solid var(--line);font-weight:800;font-size:15.5px}
        .q-hd .q-ic{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:var(--red-soft);color:var(--red);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--red) 22%,transparent)}
        .q-hd .q-ic svg{width:15px;height:15px}
        .q-hd .kbd{margin-left:auto;font-size:12.5px;font-weight:600;color:var(--muted)}
        .q-hd .kbd b{background:var(--panel);border:1px solid var(--line-strong);border-radius:5px;padding:1px 7px;color:var(--ink-2)}
        .q-bd{padding:20px}
        /* 왼쪽 폼을 크게, 오른쪽은 컴팩트 용어 카드 */
        .cn-hero{display:grid;grid-template-columns:minmax(0,1.75fr) minmax(228px,.85fr);gap:20px;align-items:start}
        @media(max-width:900px){.cn-hero{grid-template-columns:1fr}}
        .cn-row2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        @media(max-width:560px){.cn-row2{grid-template-columns:1fr}}
        /* 용어 안내 카드(5줄) */
        .cn-def{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;align-self:start;box-shadow:var(--sh-sm)}
        .cn-def-hd{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:800;color:var(--ink);padding:12px 14px 10px;background:var(--panel-2);border-bottom:1px solid var(--line)}
        .cn-def-hd svg{width:15px;height:15px;color:var(--muted)}
        .cn-def-row{display:flex;gap:12px;align-items:center;padding:11px 14px;border-top:1px solid var(--line-2)}
        .cn-def-row:first-of-type{border-top:0}
        .cn-def-row p{margin:0;font-size:13px;line-height:1.5;color:var(--ink-2)}
        /* 태그 박스 영역 통일(고정 폭) — 배경 강조 없이 시트 배지와 동일 톤 */
        .cn-def-t{flex:none;width:82px;font-size:11.5px;font-weight:800;border-radius:6px;padding:5px 6px;text-align:center;line-height:1.35;word-break:keep-all}
        .cn-def-t.iq{background:var(--warn-bg);color:var(--warn)} .cn-def-t.ok{background:var(--ok-bg);color:var(--ok)}
        .cn-def-t.info{background:var(--info-bg);color:var(--info)}
        .cn-def-t.warn{background:var(--danger-soft);color:var(--danger)}
        .cn-fld{display:flex;flex-direction:column;gap:6px;margin-bottom:13px}
        .cn-fld>.cap{font-size:12px;font-weight:700;color:var(--ink-2)}
        .cn-fld .cap em{font-style:normal;font-weight:500;color:var(--faint);margin-left:5px}
        .cn-chips{display:flex;gap:7px;flex-wrap:wrap}
        .cn-chip{font-size:13px;font-weight:600;color:var(--ink-2);background:var(--panel);border:1px solid var(--line-strong);border-radius:8px;padding:8px 15px;cursor:pointer;transition:.1s;user-select:none}
        .cn-chip:hover{border-color:var(--faint)}
        .cn-chip.on{color:var(--red);background:var(--red-soft);border-color:var(--red);box-shadow:inset 0 0 0 1px var(--red)}
        .cn-code{font-family:var(--mono);font-weight:800;font-size:16px;letter-spacing:.02em}
        .cn-look{font-size:12.5px;min-height:20px;color:var(--muted)}
        .cn-look b{color:var(--ink)} .cn-look.ok{color:var(--ok)} .cn-look.bad{color:var(--danger)}
        /* 목록 */
        .cn-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:22px 0 8px}
        .cn-bar h3{font-size:16px;margin:0}
        /* 필터를 제목 옆에 가로로 나란히(세로 적층 방지) */
        .cn-fbtns{display:flex;gap:6px;margin-left:auto;flex-wrap:wrap}
        .cn-fbtns select{width:auto;min-width:116px;height:32px;font-size:12.5px;padding:0 26px 0 9px}
        .cn-item{display:grid;grid-template-columns:1fr auto;gap:10px 14px;align-items:start;border:1px solid var(--line);border-radius:11px;background:var(--panel);padding:13px 15px;margin-bottom:9px;box-shadow:var(--sh-sm)}
        .cn-item.done{opacity:.6;background:var(--panel-2)}
        .cn-tags{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px}
        .cn-b{font-size:11px;font-weight:800;border-radius:5px;padding:2px 8px;letter-spacing:.02em}
        .cn-b.iq0{background:var(--ok-bg);color:var(--ok)}        /* 주문완료 */
        .cn-b.iq1{background:var(--warn-bg);color:var(--warn)}    /* 견적문의 */
        .cn-b.rq{background:var(--info-bg);color:var(--info)}
        .cn-b.qty{background:var(--panel-2);color:var(--ink);border:1px solid var(--line-strong);font-variant-numeric:tabular-nums}
        .cn-b.code{font-family:var(--mono);background:var(--panel-2);color:var(--ink);border:1px solid var(--line)}
        .cn-b.st-open{background:var(--red-soft);color:var(--red)}
        .cn-b.st-done{background:var(--ok-bg);color:var(--ok)}
        .cn-b.pay{background:var(--info-bg);color:var(--info);border:1px solid color-mix(in srgb,var(--info) 28%,transparent)}
        .cn-pay{font-size:12px;color:var(--muted);margin-top:5px;line-height:1.5}
        .cn-pay b{color:var(--ink);font-variant-numeric:tabular-nums}
        /* 결제요청 입력 모달 */
        .cp-ov{position:fixed;inset:0;background:rgba(16,24,40,.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px}
        .cp-box{background:var(--panel);border:1px solid var(--line);border-radius:16px;max-width:560px;width:97%;max-height:calc(100vh - 40px);display:flex;flex-direction:column;box-shadow:var(--sh-lg)}
        .cp-hd{padding:18px 22px 13px;border-bottom:1px solid var(--line)}
        .cp-hd .t{font-size:16px;font-weight:800;display:flex;align-items:center;gap:7px}
        .cp-hd .d{font-size:12.5px;color:var(--muted);margin-top:5px;line-height:1.55}
        .cp-bd{padding:16px 22px;overflow-y:auto;flex:1;display:grid;grid-template-columns:1fr 1fr;gap:12px}
        .cp-bd .wide{grid-column:1/-1}
        @media(max-width:520px){.cp-bd{grid-template-columns:1fr}}
        .cp-f{display:flex;flex-direction:column;gap:5px}
        .cp-f label{font-size:11.5px;font-weight:700;color:var(--muted)}
        .cp-f label em{font-style:normal;color:var(--danger);margin-left:3px}
        .cp-f input,.cp-f textarea{width:100%;font:inherit;font-size:13.5px}
        .cp-f input.amt{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}
        .cp-ft{display:flex;align-items:center;gap:8px;padding:14px 22px;border-top:1px solid var(--line)}
        .cp-ft .sp{flex:1;font-size:12.5px;color:var(--muted)}
        .cn-nm{font-weight:700;font-size:14px;color:var(--ink)}
        .cn-ct{font-size:13.5px;line-height:1.5;color:var(--ink-2);white-space:pre-wrap;word-break:break-word;margin-top:3px}
        .cn-meta{font-size:12px;color:var(--muted);margin-top:6px}
        .cn-act{display:flex;flex-direction:column;gap:6px;align-items:flex-end}
        .cn-empty{padding:36px;text-align:center;color:var(--muted);border:1px dashed var(--line-strong);border-radius:12px}
        .cn-sum{display:flex;gap:8px}
        .cn-sum .s{font-size:12px;font-weight:700;color:var(--muted);background:var(--panel-2);border:1px solid var(--line);border-radius:6px;padding:3px 9px}
        .cn-sum .s b{color:var(--red)}
      </style>
      <div class="mhead pad"><div class="mhead-row">
        <div><div class="tt">중국 발주요청</div>
          <div class="ds">고객이 발주한 중국 제품 중 <b>재고가 없어 대기</b>(주문완료·입고대기)하거나, <b>재고 부족으로 상담만 하고 발주로 이어지지 않은</b>(견적문의·입고요청) 건을 기록해 팀과 공유합니다. MD·구매가 발주 후 <b>완료 처리</b>합니다.
            ${canPay()?'실제 송금이 필요한 건은 <b>[결제요청]</b>으로 올리면 결제요청 목록에 집계되고, 상신 후 <b>대표 결재함</b>에서 결제됩니다.':''}</div></div>
        <div class="mhead-act cn-sum" id="cnSum"></div>
      </div></div>
      <div class="mbody">
        <div class="q-card">
          <div class="q-hd"><span class="q-ic">${icon('box')}</span>발주요청 등록
            <span class="kbd">Ctrl+Enter 저장</span></div>
          <div class="q-bd">
            <div class="cn-hero">
              <form id="cnForm">
                <div class="cn-fld"><span class="cap">상품코드 <em>필수</em></span>
                  <input type="text" id="cCode" class="cn-code" placeholder="예: P-DA39" autocomplete="off">
                  <div class="cn-look" id="cLook">상품코드를 입력하면 품명이 자동 조회됩니다.</div></div>
                <div class="cn-row2">
                  <div class="cn-fld"><span class="cap">문의유형</span><div class="cn-chips" id="cInq"></div></div>
                  <div class="cn-fld"><span class="cap">발주요청</span><div class="cn-chips" id="cReq"></div></div>
                </div>
                <div class="cn-row2">
                  <div class="cn-fld"><span class="cap">고객명 <em>선택</em></span>
                    <input type="text" id="cCust" placeholder="예: 홍길동 / 에듀이노초"></div>
                  <div class="cn-fld"><span class="cap">발주 수량 <em>선택</em></span>
                    <input type="number" id="cQty" min="1" placeholder="예: 5" value="${form.qty||''}"></div>
                </div>
                <div class="cn-fld"><span class="cap">내용 <em>선택</em></span>
                  <textarea id="cContent" rows="3" placeholder="재고 상황 · 요청사항 등"></textarea></div>
                <button type="submit" class="btn pri lg" id="cSave">${icon('save')}발주요청 등록</button>
              </form>
              <aside class="cn-def">
                <div class="cn-def-hd">${icon('info')}용어 안내</div>
                <div class="cn-def-row"><span class="cn-def-t iq">견적문의</span><p>아직 고객이 재고 문의만 하고 결제는 이뤄지지 않은 경우</p></div>
                <div class="cn-def-row"><span class="cn-def-t ok">주문완료</span><p>고객이 결제까지 끝난 경우</p></div>
                <div class="cn-def-row"><span class="cn-def-t info">입고대기</span><p>다음 입고예정일이 잡혀 있는 경우</p></div>
                <div class="cn-def-row"><span class="cn-def-t info">입고요청</span><p>입고예정이 없는 경우</p></div>
                <div class="cn-def-row loss"><span class="cn-def-t warn">견적문의·입고요청</span><p>재고를 문의했으나 현 재고가 모자라 발주·결제까지 이뤄지지 않은 경우 — <b>재고확보 필요</b></p></div>
              </aside>
            </div>
          </div>
        </div>

        <div class="cn-bar"><h3>발주요청 목록 <span class="muted" style="font-weight:500;font-size:13.5px" id="cnCnt"></span></h3>
          <div class="cn-fbtns">
            <select id="fInq"><option value="">문의유형 전체</option>${INQUIRY.map(v=>`<option>${v}</option>`).join('')}</select>
            <select id="fReq"><option value="">발주요청 전체</option>${REQ.map(v=>`<option>${v}</option>`).join('')}</select>
            <select id="fStatus"><option value="open">처리 대기</option><option value="done">완료</option><option value="">전체</option></select>
          </div></div>
        <div id="cnList"><div class="muted" style="padding:16px">불러오는 중…</div></div>
      </div>`;

      const $=s=>root.querySelector(s);

      /* 칩 렌더 */
      function chips(sel, arr, key){
        const box=$(sel); box.innerHTML='';
        arr.forEach(v=>{ const b=el('button','cn-chip'+(form[key]===v?' on':'')); b.type='button'; b.textContent=v;
          b.onclick=()=>{ form[key]=v; chips(sel,arr,key); };   // 문의유형·발주요청 각각 독립 선택
          box.appendChild(b); });
      }
      chips('#cInq', INQUIRY, 'inquiry');
      chips('#cReq', REQ, 'req');

      /* 상품코드 → 품명 자동 조회 */
      let lookT=null;
      $('#cCode').addEventListener('input',e=>{ form.code=e.target.value.trim(); form.name='';
        const look=$('#cLook'); const code=form.code;
        if(!code){ look.className='cn-look'; look.textContent='상품코드를 입력하면 품명이 자동 조회됩니다.'; return; }
        look.className='cn-look'; look.textContent='조회 중…';
        clearTimeout(lookT); lookT=setTimeout(async()=>{
          try{ const r=await fetch('/api/catalog?code='+encodeURIComponent(code)); const d=await r.json();
            const p=(d&&d.product)||(d&&d.item)||(d&&d.items&&d.items[0]);   // 카탈로그 API는 { product } 반환
            if(p&&(p.name||p.selfCode)){ form.name=p.name||''; look.className='cn-look ok'; look.innerHTML=`✓ <b>${esc(p.name||'(품명 없음)')}</b>${p.vendor?' · '+esc(p.vendor):''}`; }
            else { look.className='cn-look bad'; look.textContent='이카운트에 없는 코드입니다. (그대로 등록 가능)'; }
          }catch{ look.className='cn-look'; look.textContent=''; }
        }, 350);
      });
      $('#cCust').oninput=e=>form.customer=e.target.value;
      { const q=$('#cQty'); if(q) q.oninput=e=>form.qty=e.target.value; }
      $('#cContent').oninput=e=>form.content=e.target.value;

      async function save(){
        if(!form.code.trim()){ toast('상품코드를 입력하세요'); $('#cCode').focus(); return; }
        const btn=$('#cSave'); btn.disabled=true;
        const item={ id:uuid(), code:form.code.trim(), name:form.name||'', inquiry:form.inquiry, req:form.req,
          customer:form.customer.trim(), qty:Number(form.qty)>0?Number(form.qty):null, content:form.content.trim(),
          author:u.loginId, authorName:u.name, dept:u.dept, createdAt:nowISO(), done:false };
        await api.push(item);
        toast('발주요청을 등록했습니다');
        form.code=''; form.name=''; form.customer=''; form.qty=''; form.content='';
        $('#cCode').value=''; $('#cCust').value=''; $('#cContent').value=''; { const q=$('#cQty'); if(q) q.value=''; }
        $('#cLook').className='cn-look'; $('#cLook').textContent='상품코드를 입력하면 품명이 자동 조회됩니다.';
        btn.disabled=false;
        await load(); $('#cCode').focus();
      }
      $('#cnForm').addEventListener('submit',e=>{ e.preventDefault(); save(); });
      $('#cnForm').addEventListener('keydown',e=>{ if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){ e.preventDefault(); save(); } });

      /* ── 결제요청 등록 ── 다른 결제요청과 같은 시트(md/payreq)에 한 줄 올린다 */
      function openPayModal(it){
        const today=todayStr();
        const baseContent=[`[${it.code}]`, it.name||'', it.content?('· '+it.content):''].filter(Boolean).join(' ').trim();
        const ov=el('div','cp-ov');
        ov.innerHTML=`<div class="cp-box">
          <div class="cp-hd"><div class="t">${icon('stamp')}결제요청 등록</div>
            <div class="d">이 중국 발주 건을 <b>결제요청</b>에 올립니다. 등록하면 MD 결제요청 목록에 집계되고,
              파트장이 <b>결제 상신</b>하면 <b>대표(박정길) 결재함</b>에서 계좌·금액을 확인해 결제완료 처리합니다.</div></div>
          <div class="cp-bd">
            <div class="cp-f"><label>결제일</label><input type="date" id="cpDate" value="${today}"></div>
            <div class="cp-f"><label>수량</label><input type="text" id="cpQty" value="${esc(it.qty!=null&&it.qty!==''?it.qty:'')}" inputmode="numeric" placeholder="예: 5"></div>
            <div class="cp-f"><label>업체명 (입금처)<em>*</em></label><input type="text" id="cpVendor" placeholder="예: 심천OOO무역"></div>
            <div class="cp-f"><label>금액<em>*</em></label><input type="text" id="cpAmount" class="amt" inputmode="numeric" placeholder="예: 1,250,000"></div>
            <div class="cp-f wide"><label>계좌정보 <span style="font-weight:500">· 업체명을 입력하면 입점사 정보에서 자동으로 채워집니다</span></label>
              <input type="text" id="cpAccount" placeholder="은행 / 계좌번호 / 예금주"></div>
            <div class="cp-f wide"><label>내용</label><input type="text" id="cpContent" value="${esc(baseContent)}"></div>
            <div class="cp-f wide"><label>주문자명</label><input type="text" id="cpOrderer" value="${esc(it.customer||'')}" placeholder="예: 스팜 김은정"></div>
          </div>
          <div class="cp-ft"><span class="sp" id="cpMsg"></span>
            <button class="btn ghost" id="cpCancel">취소</button>
            <button class="btn pri" id="cpSave">${icon('check')}결제요청 등록</button></div>
        </div>`;
        document.body.appendChild(ov);
        const q=s=>ov.querySelector(s);
        const close=()=>ov.remove();
        ov.onclick=e=>{ if(e.target===ov) close(); };
        q('#cpCancel').onclick=close;
        // 업체명 → 계좌 자동 연동 (사용자가 직접 고친 뒤에는 덮어쓰지 않음)
        let acctTouched=false;
        q('#cpAccount').oninput=()=>{ acctTouched=true; };
        q('#cpVendor').oninput=e=>{ if(acctTouched) return; const a=venAcct(e.target.value); if(a) q('#cpAccount').value=a; };
        q('#cpVendor').focus();
        q('#cpSave').onclick=async()=>{
          const vendor=q('#cpVendor').value.trim(), amount=parseAmt(q('#cpAmount').value);
          const msg=q('#cpMsg');
          if(!vendor){ msg.textContent='업체명(입금처)을 입력하세요'; q('#cpVendor').focus(); return; }
          if(amount<=0){ msg.textContent='금액을 입력하세요'; q('#cpAmount').focus(); return; }
          const date=q('#cpDate').value||today;
          const u2=meU();
          const rec={ id:uuid(), day:date, date, kind:'중국발주', orderer:q('#cpOrderer').value.trim(),
            vendor, content:q('#cpContent').value.trim()||baseContent, qty:String(q('#cpQty').value||'').trim(),
            amount, account:q('#cpAccount').value.trim()||venAcct(vendor),
            whoName:u2.name||'', who:u2.loginId||u2.name||'', createdAt:nowISO(),
            source:'china', chinaId:it.id };
          q('#cpSave').disabled=true; msg.textContent='등록 중…';
          if(!window.Records){ msg.textContent='서버에 연결되지 않았습니다'; q('#cpSave').disabled=false; return; }
          await Records.pushRaw('md','payreq',rec);
          it.payreq={ recId:rec.id, date, vendor, amount, account:rec.account,
            by:u2.loginId||'', byName:u2.name||'', at:nowISO() };
          await api.push(it);
          if(typeof actLog==='function') actLog('결제요청 등록','중국 발주요청',`${vendor} ${won(amount)}원 · ${it.code}`);
          close(); toast(`결제요청에 올렸습니다 — ${vendor} ${won(amount)}원`); load();
        };
      }
      async function cancelPayreq(it){
        const p=it.payreq; if(!p) return;
        if(!confirm(`이 건의 결제요청(${esc(p.vendor)} ${won(p.amount)}원)을 취소할까요?\n결제요청 목록에서도 삭제됩니다.`)) return;
        if(window.Records) await Records.del('md','payreq',p.recId,String(p.date||'').slice(0,7),meU().loginId,p.date);
        delete it.payreq; await api.push(it);
        toast('결제요청을 취소했습니다'); load();
      }

      async function toggleDone(it){ it.done=!it.done; it.doneBy=it.done?u.loginId:''; it.doneByName=it.done?u.name:''; it.doneAt=it.done?nowISO():'';
        await api.push(it); toast(it.done?'완료 처리했습니다':'대기 상태로 되돌렸습니다'); load(); }
      async function remove(it){ if(!confirm('이 발주요청을 삭제할까요?')) return; await api.del(it.id); load(); }

      /* 카드의 결제요청 버튼 — 권한 없는 사람에겐 상태만 보이고 버튼은 나오지 않는다 */
      function payActHtml(it){
        if(!canPay()) return '';
        return it.payreq
          ? `<button class="btn ghost sm" data-paycancel title="결제요청 목록에서도 삭제됩니다">결제요청 취소</button>`
          : `<button class="btn sm" data-pay title="대표 결재함으로 올라가는 결제요청에 추가합니다">${icon('stamp')}결제요청</button>`;
      }

      function draw(){
        const list=items.filter(it=>
          (!filt.inquiry||it.inquiry===filt.inquiry) &&
          (!filt.req||it.req===filt.req) &&
          (filt.status===''||(filt.status==='done'?it.done:!it.done))
        ).sort((a,b)=>(a.done?1:0)-(b.done?1:0) || String(b.createdAt).localeCompare(String(a.createdAt)));
        const openN=items.filter(it=>!it.done).length;
        const payN=items.filter(it=>it.payreq).length;
        $('#cnSum').innerHTML=`<span class="s">처리 대기 <b>${openN}</b>건</span>${payN?`<span class="s">결제요청 <b>${payN}</b>건</span>`:''}<span class="s">전체 ${items.length}건</span>`;
        $('#cnCnt').textContent=`· ${list.length}건`;
        const box=$('#cnList');
        if(!list.length){ box.innerHTML=`<div class="cn-empty">${icon('box')}<div style="margin-top:8px">해당 조건의 발주요청이 없습니다.</div></div>`; return; }
        box.innerHTML='';
        list.forEach(it=>{
          const iqCls=it.inquiry==='견적문의'?'iq1':'iq0';
          const canManage=isAdmin || it.author===u.loginId;
          const c=el('div','cn-item'+(it.done?' done':''));
          c.innerHTML=`
            <div>
              <div class="cn-tags">
                <span class="cn-b code">${esc(it.code)}</span>
                <span class="cn-b ${iqCls}">${esc(it.inquiry)}</span>
                <span class="cn-b rq">${esc(it.req)}</span>
                ${it.qty?`<span class="cn-b qty">${it.qty}개</span>`:''}
                <span class="cn-b ${it.done?'st-done':'st-open'}">${it.done?'✓ 완료':'처리 대기'}</span>
                ${it.payreq?`<span class="cn-b pay">${icon('stamp')}결제요청</span>`:''}
              </div>
              ${it.name?`<div class="cn-nm">${esc(it.name)}</div>`:''}
              ${it.content?`<div class="cn-ct">${esc(it.content)}</div>`:''}
              ${it.payreq?`<div class="cn-pay">결제요청 ${esc(it.payreq.date||'')} · ${esc(it.payreq.vendor||'')} <b>${won(it.payreq.amount)}원</b>${it.payreq.account?' · '+esc(it.payreq.account):''} · 등록 ${esc(it.payreq.byName||it.payreq.by||'')}</div>`:''}
              <div class="cn-meta">${it.customer?'고객 '+esc(it.customer)+' · ':''}${esc(it.authorName||it.author||'-')} · ${esc(fmtD(it.createdAt))}${it.done&&it.doneByName?' · 완료: '+esc(it.doneByName):''}</div>
            </div>
            <div class="cn-act">
              <button class="btn ${it.done?'ghost':'ok'} sm" data-done>${it.done?'완료 취소':icon('check')+'완료'}</button>
              ${payActHtml(it)}
              ${canManage?`<button class="btn ghost sm" data-del>${icon('trash')}</button>`:''}
            </div>`;
          c.querySelector('[data-done]').onclick=()=>toggleDone(it);
          const pb=c.querySelector('[data-pay]'); if(pb) pb.onclick=()=>openPayModal(it);
          const pc=c.querySelector('[data-paycancel]'); if(pc) pc.onclick=()=>cancelPayreq(it);
          const db=c.querySelector('[data-del]'); if(db) db.onclick=()=>remove(it);
          box.appendChild(c);
        });
      }

      async function load(){
        const raw=await api.list();
        if(!root.isConnected) return;
        if(raw===null){ $('#cnList').innerHTML=`<div class="cn-empty">공용 저장소에 연결되지 않았습니다. (배포 환경에서 표시됩니다)</div>`; return; }
        items=raw; draw();
      }
      $('#fInq').onchange=e=>{ filt.inquiry=e.target.value; draw(); };
      $('#fReq').onchange=e=>{ filt.req=e.target.value; draw(); };
      $('#fStatus').onchange=e=>{ filt.status=e.target.value; draw(); };
      load();
    }
  };
  // 하위 호환 — 예전 주소는 shell 의 ROUTE_MOVED 가 새 주소로 보낸다.
  // 여기 별칭은 '최근 본 화면'·검색 팔레트에 남아 있는 구 키의 제목이 비지 않도록 남겨 둔다.
  MODULES['cs.china']=MODULES['logi.china'];
})();
