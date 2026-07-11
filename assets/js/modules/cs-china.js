/* ===========================================================================
   CS · 중국 발주요청  — 고객이 발주한 중국 제품의 재고/입고 요청 리스트
   ① 주문완료 · 입고대기 : 고객 결제완료 후 자사 상품 입고를 기다리는 건
   ② 견적문의 · 입고요청 : 재고 부족으로 상담만 하고 발주로 이어지지 않은 건(Loss 방지)
   공용 컬렉션 'chinaorders'(팀 공유) — CS가 기록, MD/구매가 열람·발주 후 완료 처리
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

  MODULES['cs.china']={
    title:'중국 발주요청', icon:'box',
    render(root){
      const u=meU(); const isAdmin=!!(Auth.isAdmin&&Auth.isAdmin());
      const form={ code:'', name:'', inquiry:'주문완료', req:'입고대기', customer:'', content:'' };
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
        .cn-b.code{font-family:var(--mono);background:var(--panel-2);color:var(--ink);border:1px solid var(--line)}
        .cn-b.st-open{background:var(--red-soft);color:var(--red)}
        .cn-b.st-done{background:var(--ok-bg);color:var(--ok)}
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
          <div class="ds">고객이 발주한 중국 제품 중 <b>재고가 없어 대기</b>(주문완료·입고대기)하거나, <b>재고 부족으로 상담만 하고 발주로 이어지지 않은</b>(견적문의·입고요청) 건을 기록해 팀과 공유합니다. MD·구매가 발주 후 <b>완료 처리</b>합니다.</div></div>
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
                <div class="cn-fld"><span class="cap">고객명 <em>선택</em></span>
                  <input type="text" id="cCust" placeholder="예: 홍길동 / 에듀이노초"></div>
                <div class="cn-fld"><span class="cap">내용 <em>선택</em></span>
                  <textarea id="cContent" rows="3" placeholder="재고 상황 · 수량 · 요청사항 등"></textarea></div>
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
      $('#cContent').oninput=e=>form.content=e.target.value;

      async function save(){
        if(!form.code.trim()){ toast('상품코드를 입력하세요'); $('#cCode').focus(); return; }
        const btn=$('#cSave'); btn.disabled=true;
        const item={ id:uuid(), code:form.code.trim(), name:form.name||'', inquiry:form.inquiry, req:form.req,
          customer:form.customer.trim(), content:form.content.trim(),
          author:u.loginId, authorName:u.name, dept:u.dept, createdAt:nowISO(), done:false };
        await api.push(item);
        toast('발주요청을 등록했습니다');
        form.code=''; form.name=''; form.customer=''; form.content='';
        $('#cCode').value=''; $('#cCust').value=''; $('#cContent').value='';
        $('#cLook').className='cn-look'; $('#cLook').textContent='상품코드를 입력하면 품명이 자동 조회됩니다.';
        btn.disabled=false;
        await load(); $('#cCode').focus();
      }
      $('#cnForm').addEventListener('submit',e=>{ e.preventDefault(); save(); });
      $('#cnForm').addEventListener('keydown',e=>{ if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){ e.preventDefault(); save(); } });

      async function toggleDone(it){ it.done=!it.done; it.doneBy=it.done?u.loginId:''; it.doneByName=it.done?u.name:''; it.doneAt=it.done?nowISO():'';
        await api.push(it); toast(it.done?'완료 처리했습니다':'대기 상태로 되돌렸습니다'); load(); }
      async function remove(it){ if(!confirm('이 발주요청을 삭제할까요?')) return; await api.del(it.id); load(); }

      function draw(){
        const list=items.filter(it=>
          (!filt.inquiry||it.inquiry===filt.inquiry) &&
          (!filt.req||it.req===filt.req) &&
          (filt.status===''||(filt.status==='done'?it.done:!it.done))
        ).sort((a,b)=>(a.done?1:0)-(b.done?1:0) || String(b.createdAt).localeCompare(String(a.createdAt)));
        const openN=items.filter(it=>!it.done).length;
        $('#cnSum').innerHTML=`<span class="s">처리 대기 <b>${openN}</b>건</span><span class="s">전체 ${items.length}건</span>`;
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
                <span class="cn-b ${it.done?'st-done':'st-open'}">${it.done?'✓ 완료':'처리 대기'}</span>
              </div>
              ${it.name?`<div class="cn-nm">${esc(it.name)}</div>`:''}
              ${it.content?`<div class="cn-ct">${esc(it.content)}</div>`:''}
              <div class="cn-meta">${it.customer?'고객 '+esc(it.customer)+' · ':''}${esc(it.authorName||it.author||'-')} · ${esc(fmtD(it.createdAt))}${it.done&&it.doneByName?' · 완료: '+esc(it.doneByName):''}</div>
            </div>
            <div class="cn-act">
              <button class="btn ${it.done?'ghost':'ok'} sm" data-done>${it.done?'완료 취소':icon('check')+'완료'}</button>
              ${canManage?`<button class="btn ghost sm" data-del>${icon('trash')}</button>`:''}
            </div>`;
          c.querySelector('[data-done]').onclick=()=>toggleDone(it);
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
})();
