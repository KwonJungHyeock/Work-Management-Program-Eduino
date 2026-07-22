/* ===========================================================================
   MD · 결제요청 — 선결제 발주 매일 결제요청 집계
   - 입점사 발주에서 정산구분=선결제로 저장하면 이 시트에 자동으로 한 번 더 올라옴
     (발주 기록에도 그대로 남음 · 중복 기록 허용)
   - 택배운임·환불 등은 [수동 항목 추가]로 직접 등록
   - 항목: 날짜 · 구분 · 주문자명 · 업체명 · 내용 · 수량 · 금액 · 계좌정보
   - 수정/삭제는 파트장·관리자만
   ========================================================================= */
(function(){
  const meU=()=>(Auth.user&&Auth.user())||{};
  const isAdmin=()=>!!(Auth.isAdmin&&Auth.isAdmin());
  const canEdit=()=>{ const u=meU(); return isAdmin()||u.role==='lead'; };   // 파트장·관리자만 수정
  const canSubmit=()=>canEdit();                                             // 결제 상신도 파트장급
  // 결재 문서(결제요청 상신) — 일일결산과 동일 컬렉션 재사용, id 로 구분
  const COLL='settlements';
  const payDocId=date=>`payreq:md:${date}`;
  const PAYSTATUS={ none:{l:'미상신',c:'var(--muted)',bg:'var(--panel-2)'}, submitted:{l:'결제 상신됨',c:'var(--info)',bg:'var(--info-bg)'}, paid:{l:'결제 완료',c:'var(--ok)',bg:'var(--ok-bg)'} };
  async function collGetAll(){ try{ const r=await fetch('/api/store?type=coll&coll='+COLL); if(!r.ok) throw 0; const d=await r.json(); return (d&&d.items)||[]; }catch(e){ return null; } }
  async function collPush(item){ try{ return await fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collPush',coll:COLL,item})}).then(r=>r.json()); }catch(e){ return null; } }
  const won=n=>Number(n||0).toLocaleString();
  const parseAmt=v=>Number(String(v==null?'':v).replace(/[^\d.-]/g,''))||0;
  const ym=d=>String(d||'').slice(0,7);
  const KIND=['택배운임','환불','기타'];
  const kindColor=k=>({'발주':['var(--info)','var(--info-bg)'],'택배운임':['var(--warn)','var(--warn-bg)'],'환불':['var(--danger)','var(--danger-soft)']}[k]||['var(--muted)','var(--panel-2)']);
  const kindBadge=k=>{ if(!k) return ''; const [c,bg]=kindColor(k); return `<span style="display:inline-block;font-weight:800;font-size:11.5px;padding:2px 8px;border-radius:6px;color:${c};background:${bg}">${esc(k)}</span>`; };

  MODULES['md.payreq']={
    title:'결제요청', icon:'stamp',
    render(root){
      const editable=canEdit();
      let date=todayStr(), all=[], editId=null, apDoc=null;
      const blank=()=>({ id:'', kind:'택배운임', orderer:'', vendor:'', content:'', qty:'', amount:'', account:'' });
      let form=blank();
      root.innerHTML=`
      <style>
        .pq-wrap{border:1px solid var(--line);border-radius:12px;overflow:auto;background:var(--panel);box-shadow:var(--sh-sm)}
        table.pq{border-collapse:separate;border-spacing:0;width:100%;font-size:13px;min-width:920px}
        table.pq th{position:sticky;top:0;z-index:2;background:var(--panel-2);color:var(--ink-2);font-size:11.5px;font-weight:800;text-align:left;padding:9px 10px;border-bottom:1px solid var(--line-2);white-space:nowrap}
        table.pq td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top;color:var(--ink-2)}
        table.pq tr:nth-child(even) td{background:var(--zebra)}
        table.pq td.num{text-align:right;font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap}
        table.pq td.wrap{white-space:pre-wrap;word-break:break-word;min-width:200px;line-height:1.45}
        table.pq tfoot td{background:var(--panel-2);font-weight:800;border-top:2px solid var(--line-2)}
        table.pq tr.pq-gtop td{border-top:2px solid var(--line-2)}
        table.pq tr.pq-sub td{background:var(--panel-2);font-weight:800;color:var(--ink-2);border-bottom:1px solid var(--line-2)}
        table.pq tr.pq-sub td:first-child{text-align:right;color:var(--muted)}
        .pq-in{height:34px;font:inherit;border:1px solid var(--line-2);border-radius:7px;padding:0 9px;background:var(--panel);width:100%;min-width:90px}
        .pq-card{border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--sh-sm);padding:14px 16px;margin-bottom:16px}
        .pq-hdrow{display:flex;align-items:center;gap:10px;font-weight:800;font-size:14px;margin-bottom:12px}
        .pq-grid{display:grid;grid-template-columns:120px 150px 150px 1fr 84px 120px 1.2fr auto;gap:9px;align-items:end}
        @media(max-width:900px){.pq-grid{grid-template-columns:1fr 1fr}}
        .pq-f{display:flex;flex-direction:column;gap:5px}
        .pq-f label{font-size:11px;font-weight:700;color:var(--muted)}
        .pq-empty{padding:40px;text-align:center;color:var(--muted);font-size:14px}
        .pq-status{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--sh-sm);padding:12px 16px;margin-bottom:16px}
        .pq-status .pq-sp{flex:1}
        .pq-st-badge{font-size:12px;font-weight:800;border-radius:7px;padding:4px 11px}
      </style>
      <div class="mhead pad"><div class="mhead-row">
        <div><div class="tt">결제요청</div><div class="ds">입점사 발주를 <b>선결제</b>로 저장하면 여기에 자동 집계됩니다(발주 기록에도 남음). 택배운임·환불은 수동 추가하세요.${editable?'':' <b>수정·삭제는 파트장·관리자</b>만 가능합니다.'}</div></div>
        <div class="mhead-act"><label class="fld" style="margin:0">기준일 <input type="date" id="pqDate" value="${date}"></label></div>
      </div></div>
      <div class="mbody wide" id="pqBody"><div class="muted" style="padding:18px">불러오는 중…</div></div>`;
      const body=root.querySelector('#pqBody'), dateEl=root.querySelector('#pqDate');

      function addFormHtml(){
        if(!editable) return '';
        return `<div class="pq-card"><div class="pq-hdrow">${icon('plus')}수동 항목 추가 <span class="muted" style="font-weight:500;font-size:12.5px">· 택배운임 · 환불 등</span></div>
          <div class="pq-grid">
            <div class="pq-f"><label>구분</label><select class="pq-in" id="pfKind">${KIND.map(k=>`<option ${k===form.kind?'selected':''}>${k}</option>`).join('')}</select></div>
            <div class="pq-f"><label>주문자명</label><input class="pq-in" id="pfOrderer" value="${esc(form.orderer)}" placeholder="예: 스팜 김은정"></div>
            <div class="pq-f"><label>업체명</label><input class="pq-in" id="pfVendor" value="${esc(form.vendor)}" placeholder="예: 롯데택배"></div>
            <div class="pq-f"><label>내용</label><input class="pq-in" id="pfContent" value="${esc(form.content)}" placeholder="예: 쿠팡 반품 배송비"></div>
            <div class="pq-f"><label>수량</label><input class="pq-in" id="pfQty" value="${esc(form.qty)}" placeholder="예: 1" inputmode="numeric" style="width:70px;text-align:right"></div>
            <div class="pq-f"><label>금액</label><input class="pq-in" id="pfAmount" value="${esc(form.amount)}" placeholder="예: 3,200" inputmode="numeric" style="text-align:right"></div>
            <div class="pq-f"><label>계좌정보</label><input class="pq-in" id="pfAccount" value="${esc(form.account)}" placeholder="은행 / 계좌번호 / 예금주"></div>
            <div class="pq-f"><label>&nbsp;</label><button class="btn pri" id="pfAdd">${icon('check')}추가</button></div>
          </div></div>`;
      }
      function rowView(r, first){
        return `<tr class="${first?'pq-gtop':''}">
          <td style="white-space:nowrap">${esc(String(r.day||r.date||'').slice(5))}</td>
          <td>${kindBadge(r.kind||'발주')}</td>
          <td style="white-space:nowrap">${esc(r.orderer||'')}</td>
          <td style="white-space:nowrap;font-weight:600;color:var(--ink)">${esc(r.vendor||'')}</td>
          <td class="wrap">${esc(r.content||'')}${(Number(r.ship)||0)>0?`<div class="muted" style="font-size:11px;margin-top:2px">상품 ${won(Number(r.prodAmount)||parseAmt(r.amount)-(Number(r.ship)||0))} + 배송비 ${won(Number(r.ship)||0)}</div>`:''}</td>
          <td class="num">${(r.qty!=null&&r.qty!=='')?esc(r.qty):''}</td>
          <td class="num">${won(parseAmt(r.amount))}원</td>
          <td class="wrap" style="min-width:170px;font-size:12.5px">${esc(r.account||'')}</td>
          ${editable?`<td style="white-space:nowrap"><span style="display:flex;gap:4px;justify-content:flex-end">
            <button class="btn ghost sm" data-a="edit" data-id="${esc(r.id)}">수정</button>
            <button class="btn ghost sm" data-a="del" data-id="${esc(r.id)}" title="삭제">${icon('trash')}</button></span></td>`:''}
        </tr>`;
      }
      function rowEdit(r){
        return `<tr>
          <td style="white-space:nowrap">${esc(String(r.day||r.date||'').slice(5))}</td>
          <td><select class="pq-in" data-k="kind" style="min-width:90px">${['발주',...KIND].map(k=>`<option ${k===(r.kind||'발주')?'selected':''}>${k}</option>`).join('')}</select></td>
          <td><input class="pq-in" data-k="orderer" value="${esc(r.orderer||'')}" style="min-width:110px"></td>
          <td><input class="pq-in" data-k="vendor" value="${esc(r.vendor||'')}" style="min-width:110px"></td>
          <td><input class="pq-in" data-k="content" value="${esc(r.content||'')}" style="min-width:150px"></td>
          <td><input class="pq-in" data-k="qty" value="${esc(r.qty!=null?r.qty:'')}" style="width:56px;text-align:right"></td>
          <td><input class="pq-in" data-k="amount" value="${esc(r.amount||'')}" style="width:100px;text-align:right"></td>
          <td><input class="pq-in" data-k="account" value="${esc(r.account||'')}" style="min-width:150px"></td>
          <td style="white-space:nowrap"><span style="display:flex;gap:4px"><button class="btn pri sm" data-a="save" data-id="${esc(r.id)}">${icon('check')}</button><button class="btn ghost sm" data-a="cancel">취소</button></span></td>
        </tr>`;
      }
      // 같은 입점사(업체)끼리 묶어 표시 + 업체별 소계 (같은 날짜 기준 · 결제 통합용)
      function bodyRows(rows){
        let html='', i=0;
        while(i<rows.length){
          const v=String(rows[i].vendor||'').trim(); const grp=[]; let j=i;
          while(j<rows.length && String(rows[j].vendor||'').trim()===v){ grp.push(rows[j]); j++; }
          grp.forEach((r,idx)=>{ html+= editId===r.id?rowEdit(r):rowView(r, idx===0); });
          if(grp.length>1 && !grp.some(r=>r.id===editId)){
            const gt=grp.reduce((s,r)=>s+parseAmt(r.amount),0), gq=grp.reduce((s,r)=>s+(Number(r.qty)||0),0);
            html+=`<tr class="pq-sub"><td colspan="5">${esc(v||'(미지정)')} · ${grp.length}건 소계</td><td class="num">${gq||''}</td><td class="num">${won(gt)}원</td><td ${editable?'colspan="2"':''}></td></tr>`;
          }
          i=j;
        }
        return html;
      }
      function paint(){
        if(!root.isConnected) return;
        // 업체(입점사)별로 묶고, 그 안에서 발주 먼저·입력순 — 같은 날짜의 같은 입점사 주문이 인접+소계로 통합 표시
        const rows=all.slice().sort((a,b)=>
          String(a.vendor||'').localeCompare(String(b.vendor||''))
          || ((a.kind==='발주'?0:1)-(b.kind==='발주'?0:1))
          || String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
        const total=rows.reduce((s,r)=>s+parseAmt(r.amount),0);
        const qtyTotal=rows.reduce((s,r)=>s+(Number(r.qty)||0),0);
        const cols=editable?9:8;
        const st=PAYSTATUS[(apDoc&&apDoc.status)||'none']||PAYSTATUS.none;
        const paid=apDoc&&apDoc.status==='paid', submitted=apDoc&&apDoc.status==='submitted';
        const statusBar=`<div class="pq-status">
          <span class="pq-st-badge" style="color:${st.c};background:${st.bg}">${st.l}</span>
          ${submitted?`<span class="muted" style="font-size:12px">상신 ${esc(apDoc.submittedByName||'')} · ${esc((apDoc.submittedAt||'').slice(0,16).replace('T',' '))}</span>`:''}
          ${paid?`<span style="color:var(--ok);font-size:12.5px;font-weight:700">✓ 대표 결제완료 · ${esc(apDoc.paidByName||'')} · ${esc((apDoc.paidAt||'').slice(0,16).replace('T',' '))}</span>`:''}
          <span class="pq-sp"></span>
          ${canSubmit()&&!paid?`<button class="btn ok" id="pqSubmit"${rows.length?'':' disabled'}>${icon('stamp')}${submitted?'재상신(목록 갱신)':'결제 상신 → 대표 결재함'}</button>`:''}
          <span class="muted" id="pqSubMsg" style="font-size:12.5px"></span></div>`;
        body.innerHTML=`${statusBar}${addFormHtml()}
          <div class="bd-meta" style="font-size:12.5px;color:var(--muted);margin:0 0 8px;font-weight:600">${esc(date)} · 결제요청 ${rows.length}건 · 합계 <b style="color:var(--red)">${won(total)}원</b></div>
          <div class="pq-wrap"><table class="pq">
            <thead><tr><th>날짜</th><th>구분</th><th>주문자명</th><th>업체명</th><th>내용</th><th style="text-align:right">수량</th><th style="text-align:right">금액</th><th>계좌정보</th>${editable?'<th></th>':''}</tr></thead>
            <tbody>${rows.length?bodyRows(rows):`<tr><td class="pq-empty" colspan="${cols}">${esc(date)}에 결제요청 내역이 없습니다.${editable?' 선결제 발주를 저장하거나 위에서 수동 추가하세요.':''}</td></tr>`}</tbody>
            ${rows.length?`<tfoot><tr><td colspan="5">합계</td><td class="num">${qtyTotal||''}</td><td class="num">${won(total)}원</td><td ${editable?'colspan="2"':''}></td></tr></tfoot>`:''}
          </table></div>`;
        wire();
      }
      function wire(){
        // 결제 상신(파트장급) — 그 날짜 결제요청 목록을 스냅샷해 대표 결재함으로 올림
        const sub=body.querySelector('#pqSubmit');
        if(sub) sub.onclick=async()=>{ const msg=body.querySelector('#pqSubMsg'); sub.disabled=true; if(msg) msg.textContent='상신 중…';
          // 서버 최신 상태 재확인 — 화면을 열어둔 사이 대표가 이미 결제완료했으면 되돌리지 않음(lost-update 방지)
          const fresh=await collGetAll();
          if(!root.isConnected) return;
          const cur=(fresh||[]).find(d=>d.id===payDocId(date));
          if(cur && cur.status==='paid'){ apDoc=cur; if(msg) msg.textContent=''; toast('이미 대표 결제완료된 건입니다 — 재상신할 수 없습니다'); paint(); return; }
          const total=all.reduce((s,r)=>s+parseAmt(r.amount),0);
          const doc={ id:payDocId(date), type:'payreq', dept:'md', date, status:'submitted',
            items:all.map(r=>({kind:r.kind,orderer:r.orderer,vendor:r.vendor,content:r.content,qty:r.qty,amount:parseAmt(r.amount),account:r.account})),
            count:all.length, total, submittedBy:meU().loginId||meU().name, submittedByName:meU().name||meU().loginId, submittedAt:nowISO() };
          const r=await collPush(doc); if(r) apDoc=doc;   // 저장 성공 시에만 상태 반영(실패 시 이전 상태 유지)
          if(msg) msg.textContent=''; toast(r?'결제 상신 완료 — 대표 결재함으로 전송됐습니다':'상신 실패 — 서버 확인'); paint(); };
        const add=body.querySelector('#pfAdd');
        if(add){ ['pfKind','pfOrderer','pfVendor','pfContent','pfQty','pfAmount','pfAccount'].forEach(id=>{ const el2=body.querySelector('#'+id); if(el2) el2.oninput=el2.onchange=e=>{ form[id.replace('pf','').toLowerCase()==='kind'?'kind':({pfOrderer:'orderer',pfVendor:'vendor',pfContent:'content',pfQty:'qty',pfAmount:'amount',pfAccount:'account'})[id]]=e.target.value; }; });
          add.onclick=async()=>{
            if(!form.vendor.trim() && !form.content.trim()){ toast('업체명 또는 내용을 입력하세요'); return; }
            const rec={ id:uuid(), day:date, date:date, kind:form.kind, orderer:form.orderer.trim(), vendor:form.vendor.trim(),
              content:form.content.trim(), qty:String(form.qty||'').trim(), amount:parseAmt(form.amount), account:form.account.trim(),
              whoName:meU().name||'', who:meU().loginId||meU().name||'', createdAt:nowISO() };
            all.push(rec); form=blank(); paint();
            if(window.Records) await Records.pushRaw('md','payreq',rec);
            toast('결제요청에 추가했습니다');
          }; }
        body.querySelectorAll('[data-a=edit]').forEach(b=>b.onclick=()=>{ editId=b.dataset.id; paint(); });
        body.querySelectorAll('[data-a=cancel]').forEach(b=>b.onclick=()=>{ editId=null; paint(); });
        body.querySelectorAll('[data-a=save]').forEach(b=>b.onclick=async(e)=>{
          const tr=e.currentTarget.closest('tr'); const old=all.find(x=>x.id===editId); if(!old) return;
          const rec={...old}; tr.querySelectorAll('[data-k]').forEach(inp=>{ rec[inp.dataset.k]= inp.dataset.k==='amount'?parseAmt(inp.value):inp.value; });
          e.currentTarget.disabled=true; Object.assign(old,rec); editId=null; paint();
          if(window.Records) await Records.pushRaw('md','payreq',rec); toast('수정했습니다');
        });
        body.querySelectorAll('[data-a=del]').forEach(b=>b.onclick=async()=>{
          if(!confirm('이 결제요청 항목을 삭제할까요?')) return;
          const r=all.find(x=>x.id===b.dataset.id); if(!r) return;
          all=all.filter(x=>x.id!==b.dataset.id); paint();
          if(window.Records) await Records.del('md','payreq',r.id,String(r.day||r.date||date).slice(0,7),r.who,r.day||r.date);
          toast('삭제했습니다');
        });
      }
      async function load(){
        date=dateEl.value||todayStr();
        body.innerHTML=`<div class="muted" style="padding:18px">불러오는 중…</div>`;
        const [recs, coll]=await Promise.all([ window.Records?Records.month('md','payreq',ym(date)):null, collGetAll() ]);
        if(!root.isConnected) return;
        if(recs===null){ body.innerHTML=`<div class="empty">${icon('alert')}<div>서버에 연결되지 않았습니다. (배포 환경에서 동작)</div></div>`; return; }
        all=recs.filter(r=>String(r.day||r.date||'').slice(0,10)===date);
        apDoc=(coll||[]).find(d=>d.id===payDocId(date))||null;   // 결제 상신/완료 상태
        editId=null; paint();
      }
      dateEl.onchange=load; load();
    }
  };
})();
