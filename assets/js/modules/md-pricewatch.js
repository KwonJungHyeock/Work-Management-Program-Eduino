/* ===========================================================================
   MD · 가격비교 (업체별 판매가 모니터링) — 확장형
   - 상단 탭 = 비교 대상 업체(현재 '엔티렉스'). 업체가 늘면 VENDORS 에 추가만 하면 됨.
   - 업체별: 가격 변동 알림 / 취급 상품(담당자 추가·수정) / 메일 양식(관리자)
   - VPS 크롤러가 매일 각 업체 사이트의 현재 판매가를 확인 → 기준가와 다르면 KV(coll)로 올림
   ========================================================================= */
(function(){
  const NF = window.NTREX_FIELDS || ['ed','ntx','name','price','supply','retail','note'];
  const toObj = a => Array.isArray(a) ? NF.reduce((o,k,i)=>(o[k]=a[i],o),{}) : a;

  // ── 비교 대상 업체 레지스트리 (업체 추가 시 여기에 항목만 추가) ──
  const VENDORS = [{
    key:'ntrex', name:'엔티렉스',
    bundled:(window.NTREX_PRODUCTS||[]).map(toObj),
    productsKey:'eduino.ntrex.products',      // 담당자 추가/수정분(팀 공유)
    mailKey:(STORE&&STORE.ntrexMailCfg)||'eduino.ntrex.mailcfg',
    mailDefault:(typeof NTREX_MAIL_DEFAULT!=='undefined')?NTREX_MAIL_DEFAULT:{to:'',subject:'',body:''},
    coll:'ntrex',
    site:(ntx)=>ntx?`https://www.devicemart.co.kr/goods/view?no=${encodeURIComponent(ntx)}`:'',
    siteName:'디바이스마트',
  }];

  const won = n => Number(n||0).toLocaleString();
  const parseNum = v => Number(String(v==null?'':v).replace(/[^\d.-]/g,''))||0;
  const isAdmin = ()=>!!(Auth.isAdmin&&Auth.isAdmin());
  const canEdit = ()=> isAdmin() || ((Auth.user&&Auth.user()||{}).dept==='md');

  async function collGet(coll){ try{ const r=await fetch('/api/store?type=coll&coll='+coll); if(!r.ok) throw 0; const d=await r.json(); return (d&&d.items)||[]; }catch(e){ return null; } }
  // 메일 자동발송 서버 설정(SMTP 연결 여부·보내는이·회신주소) — 1회 조회 후 캐시
  let _mailSvc=null;
  async function loadMailSvc(){ if(_mailSvc) return _mailSvc;
    try{ const r=await fetch('/api/sendmail'); _mailSvc=r.ok?await r.json():{ok:false,configured:false}; }
    catch(e){ _mailSvc={ok:false,configured:false}; } return _mailSvc; }

  // 취급 상품 = 번들(공급가표) + 담당자 오버라이드(추가/수정/삭제) · ntx(엔티렉스코드) 기준
  function effectiveProducts(v){
    const base={}; v.bundled.forEach(p=>{ if(p.ntx) base[String(p.ntx)]=p; });
    const ov=store(v.productsKey).get({})||{};
    Object.keys(ov).forEach(k=>{ const o=ov[k]; if(o&&o._del) delete base[k]; else if(o) base[k]={...(base[k]||{}),...o,ntx:k}; });
    return Object.values(base);
  }
  const saveOverride=(v,ntx,rec)=>{ const ov=store(v.productsKey).get({})||{}; ov[String(ntx)]=rec; store(v.productsKey).set(ov); };
  const mailCfg=v=> Object.assign({}, v.mailDefault, store(v.mailKey).get({})||{});
  function fillMail(cfg,p,link){ const rep=s=>String(s||'').replace(/\{ntx\}/g,p.ntx||'').replace(/\{name\}/g,p.name||'').replace(/\{ed\}/g,p.ed||'').replace(/\{link\}/g,link||'');
    return { to:cfg.to, subject:rep(cfg.subject), body:rep(cfg.body) }; }

  MODULES['md.pricewatch'] = {
    title:'가격비교', icon:'chart',
    render(root){
      let vKey=VENDORS[0].key, section='alerts', q='', addOpen=false, editNtx=null;
      const vendor=()=>VENDORS.find(x=>x.key===vKey)||VENDORS[0];
      root.innerHTML=`
      <style>
        .pw-seg{display:inline-flex;border:1px solid var(--line-2);border-radius:9px;overflow:hidden;margin-bottom:16px}
        .pw-seg button{border:0;background:var(--panel);padding:8px 15px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer;border-left:1px solid var(--line-2)}
        .pw-seg button:first-child{border-left:0}
        .pw-seg button.on{background:var(--active-bg);color:var(--red)}
        .nx-kpi{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}
        .nx-k{flex:1 1 0;min-width:150px;border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--sh-sm);padding:13px 16px}
        .nx-k .l{font-size:11.5px;font-weight:700;color:var(--muted)} .nx-k .v{font-size:23px;font-weight:800;margin-top:3px}
        .nx-k.warn .v{color:var(--warn)} .nx-k.red .v{color:var(--red)}
        .nx-card{border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--sh-sm);padding:14px 16px;margin-bottom:12px;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center}
        .nx-card.demo{border-style:dashed;opacity:.92}
        .nx-code{font-family:var(--mono);font-weight:800;font-size:13px}
        .nx-nm{font-size:14px;font-weight:600;color:var(--ink);margin:3px 0;line-height:1.4}
        .nx-nm a{color:var(--ink);text-decoration:none;border-bottom:1px dashed var(--line-2)}
        .nx-price{display:flex;gap:14px;flex-wrap:wrap;align-items:baseline;font-size:13px;color:var(--ink-2)}
        .nx-price .old{color:var(--muted);text-decoration:line-through} .nx-price .new{font-weight:800;color:var(--ink)}
        .nx-price .up{color:var(--red);font-weight:800} .nx-price .down{color:var(--ok);font-weight:800}
        .nx-badge{font-size:11px;font-weight:800;padding:2px 8px;border-radius:6px;background:var(--warn-bg);color:var(--warn)}
        .nx-empty{padding:40px;text-align:center;color:var(--muted)}
        table.nx-t{border-collapse:collapse;width:100%;font-size:12.5px}
        table.nx-t th{position:sticky;top:0;background:var(--panel-2);color:var(--ink-2);font-size:11px;font-weight:800;text-align:left;padding:8px 10px;border-bottom:1px solid var(--line-2);white-space:nowrap}
        table.nx-t td{padding:7px 10px;border-bottom:1px solid var(--line);color:var(--ink-2)}
        table.nx-t td.num{text-align:right;font-variant-numeric:tabular-nums}
        table.nx-t input{width:100%;font:inherit;border:1px solid var(--line-2);border-radius:6px;padding:5px 7px}
        table.nx-t input.num{text-align:right}
        .nx-wrap{border:1px solid var(--line);border-radius:12px;overflow:auto;max-height:calc(100vh - 380px);background:var(--panel)}
        .nx-note{border-left:4px solid var(--info);background:var(--info-bg);border-radius:0 10px 10px 0;padding:12px 16px;margin-bottom:14px;font-size:13px;color:var(--ink-2)}
        .nx-ta{width:100%;min-height:150px;font:inherit;border:1px solid var(--line-2);border-radius:8px;padding:10px;line-height:1.6}
        .nx-usr{font-size:10.5px;font-weight:800;color:var(--info);background:var(--info-bg);border-radius:5px;padding:1px 6px;margin-left:6px}
        /* 일일 리포트 */
        .rp-card{border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--sh-sm);margin-bottom:11px;overflow:hidden}
        .rp-hd{display:flex;align-items:center;gap:14px;padding:12px 16px;cursor:pointer;flex-wrap:wrap}
        .rp-hd:hover{background:var(--hover)}
        .rp-date{font-weight:800;font-size:14px;color:var(--ink);min-width:96px;font-variant-numeric:tabular-nums}
        .rp-stats{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:var(--ink-2);align-items:baseline}
        .rp-stats b{color:var(--ink);font-weight:800} .rp-chg b{color:var(--red)}
        .rp-rev{margin-left:auto;display:flex;align-items:center;gap:6px}
        .rp-ok{font-size:11.5px;font-weight:800;color:var(--ok);background:var(--ok-bg);border-radius:6px;padding:3px 9px;white-space:nowrap}
        .rp-bd{border-top:1px solid var(--line);padding:4px 6px 6px}
        .rp-cv{margin-left:6px;color:var(--muted);font-size:12px;transition:transform .15s}
      </style>
      <div class="mhead">
        <div class="tt">가격비교</div>
        <div class="ds">업체별 판매가를 매일 확인해 <b>변동된 상품</b>을 알려드립니다. 확인 후 <b>[공급가 요청]</b>으로 담당자에게 메일을 보내세요.</div>
        <div class="mtabs">${VENDORS.map(v=>`<div class="t" data-v="${v.key}">${esc(v.name)}</div>`).join('')}</div>
      </div>
      <div class="mbody wide" id="pwBody"><div class="muted" style="padding:18px">불러오는 중…</div></div>`;
      const body=root.querySelector('#pwBody');
      root.querySelectorAll('.mtabs .t').forEach(t=>{ t.classList.toggle('on',t.dataset.v===vKey);
        t.onclick=()=>{ vKey=t.dataset.v; section='alerts'; addOpen=false; editNtx=null; root.querySelectorAll('.mtabs .t').forEach(x=>x.classList.toggle('on',x.dataset.v===vKey)); load(); }; });

      let diffs=[], apDay='', history=[];
      const REVIEWED_KEY='eduino.ntrex.reviewed';   // 일일 리포트 확인 표시(담당자·날짜) · MD 공유
      function draw(){
        const v=vendor();
        const secBar=`<div class="pw-seg">
          <button data-s="alerts" class="${section==='alerts'?'on':''}">가격 변동 알림</button>
          <button data-s="report" class="${section==='report'?'on':''}">일일 리포트${history.length?` (${history.length})`:''}</button>
          <button data-s="list" class="${section==='list'?'on':''}">취급 상품 (${effectiveProducts(v).length})</button>
          ${isAdmin()?`<button data-s="mail" class="${section==='mail'?'on':''}">메일 양식</button>`:''}</div>`;
        body.innerHTML=secBar+`<div id="pwSec"></div>`;
        body.querySelectorAll('.pw-seg button').forEach(b=>b.onclick=()=>{ section=b.dataset.s; addOpen=false; editNtx=null; draw(); });
        const sec=body.querySelector('#pwSec');
        if(section==='alerts') drawAlerts(sec,v); else if(section==='report') drawReport(sec,v); else if(section==='list') drawList(sec,v); else drawMail(sec,v);
      }

      /* -------- 일일 리포트 (날짜별 수집 결과 보관 · 담당자 확인) -------- */
      function drawReport(sec,v){
        const me=(Auth.user&&Auth.user())||{};
        const days=history;
        if(!days.length){ sec.innerHTML=`<div class="nx-note">${icon('info')} 아직 수집 리포트가 없습니다. 크롤러가 매일 실행되면 이곳에 <b>일자별 리포트</b>가 자동으로 쌓입니다.</div>`; return; }
        sec.innerHTML=`<div class="nx-note">매일 자동 수집된 결과를 <b>날짜별로 보관</b>합니다. 날짜를 눌러 변동 내역을 확인하고, <b>[확인]</b>으로 검토 표시를 남기세요. (일일결산용 · MD 공유)</div><div id="rpList"></div>`;
        const listEl=sec.querySelector('#rpList');
        function paint(){
          const rv=store(REVIEWED_KEY).get({})||{};
          listEl.innerHTML=days.map((d,i)=>{
            const st=rv[d.day]; const open=(i===0);
            const checked=(d.checked!=null?d.checked:(d.total!=null?d.total:null));
            const total=(d.total!=null?d.total:null);
            const cnt=(d.count!=null?d.count:(d.items||[]).length);
            const np=(d.noprice!=null?d.noprice:'-'), fa=(d.failed!=null?d.failed:'-');
            const rows=(d.items||[]);
            return `<div class="rp-card">
              <div class="rp-hd" data-toggle>
                <span class="rp-date">${esc(d.day||'')}</span>
                <span class="rp-stats">
                  <span>검사 <b>${checked!=null?checked:'-'}${total!=null?` / ${total}`:''}</b></span>
                  <span class="rp-chg">변동 <b>${cnt}</b>건</span>
                  <span class="muted">무가격 ${np} · 실패 ${fa}</span>
                </span>
                <span class="rp-rev">${ st?`<span class="rp-ok">✔ ${esc(st.by||'')} 확인</span>`:`<button class="btn ghost sm" data-a="review" data-day="${esc(d.day)}">확인</button>` }
                  <span class="rp-cv">${open?'▲':'▼'}</span></span>
              </div>
              <div class="rp-bd" style="display:${open?'block':'none'}">
                ${ rows.length?`<table class="nx-t"><thead><tr><th>에듀이노코드</th><th>상품명</th><th style="text-align:right">기존가</th><th style="text-align:right">현재가</th><th style="text-align:right">변동</th></tr></thead><tbody>${rows.map(it=>{ const diff=(Number(it.newPrice)||0)-(Number(it.oldPrice)||0); const up=diff>0; return `<tr><td class="nx-code">${esc(it.ed||'')}</td><td>${esc(it.name||'')}</td><td class="num">${won(it.oldPrice)}원</td><td class="num"><b>${won(it.newPrice)}원</b></td><td class="num" style="color:${up?'var(--danger)':'var(--ok)'};font-weight:800">${up?'▲':'▼'} ${won(Math.abs(diff))}</td></tr>`; }).join('')}</tbody></table>`:`<div class="nx-empty" style="padding:22px">${icon('check2')}<div>이 날은 가격 변동이 없습니다.</div></div>` }
              </div></div>`;
          }).join('');
          listEl.querySelectorAll('.rp-hd[data-toggle]').forEach(h=>h.onclick=(e)=>{ if(e.target.closest('[data-a=review]')) return;
            const bd=h.parentElement.querySelector('.rp-bd'), cv=h.querySelector('.rp-cv');
            const show=bd.style.display==='none'; bd.style.display=show?'block':'none'; if(cv) cv.textContent=show?'▲':'▼'; });
          listEl.querySelectorAll('[data-a=review]').forEach(b=>b.onclick=(e)=>{ e.stopPropagation();
            const rv2=store(REVIEWED_KEY).get({})||{}; rv2[b.dataset.day]={ by:me.name||me.loginId||'', at:nowISO() };
            store(REVIEWED_KEY).set(rv2); toast('확인 표시했습니다 (MD 공유)'); paint(); });
        }
        paint();
      }

      /* -------- 가격 변동 알림 -------- */
      // 메일 앱 열기(mailto) — 자동발송 미설정/실패 시 대체 경로
      function openMailApp(m){ const url=`mailto:${encodeURIComponent(m.to)}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
        try{ const a=document.createElement('a'); a.href=url; a.click(); }catch(e){ location.href=url; } }
      // 발송 전 확인 팝업 — 미리보기 확인 후에만 실제 발송(오발송 방지)
      // 여러 상품을 한 통에 담는 일괄 공급가 요청 본문
      function fillMailBatch(cfg, list, v){
        const lines=list.map((p,i)=>`${i+1}. ${p.name||''}  (엔티렉스 ${p.ntx||''}${p.ed?` · ${p.ed}`:''})${v.site(p.ntx)?`\n   ${v.site(p.ntx)}`:''}`).join('\n');
        const head=String(cfg.body||'').replace(/\{[^}]+\}/g,'').replace(/\n{3,}/g,'\n\n').trim();   // 템플릿 인사말(토큰 제거)
        const body=`${head?head+'\n\n':''}아래 상품들의 최신 공급가 확인 부탁드립니다. (총 ${list.length}건)\n\n${lines}\n\n감사합니다.`;
        const subject=`[에듀이노] 공급가 확인 요청 · ${list.length}건`;
        return { to:cfg.to, subject, body };
      }
      async function confirmSend(v,p,batch){
        const isBatch=Array.isArray(batch)&&batch.length; const cfg=mailCfg(v); const toName=cfg.toName||'';
        const link=isBatch?'':v.site(p.ntx); const m=isBatch?fillMailBatch(cfg,batch,v):fillMail(cfg,p,link);
        const svc=await loadMailSvc();
        const configured=!!(svc&&svc.configured);
        const fromLine=configured
          ? `${esc(svc.fromName||svc.from||'')} &lt;${esc(svc.from||'')}&gt;${svc.replyTo?` <span class="muted">· 회신 → ${esc(svc.replyTo)}</span>`:''}`
          : `<span class="muted">메일 앱(mailto) — 로그인된 계정에서 발송</span>`;
        const ov=el('div','modal-ov'); ov.style.cssText='position:fixed;inset:0;background:rgba(16,24,40,.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px';
        ov.innerHTML=`<div style="background:var(--panel);border:1px solid var(--line);border-radius:16px;max-width:560px;width:96%;max-height:calc(100vh - 48px);display:flex;flex-direction:column;box-shadow:var(--sh-lg)">
          <div style="padding:18px 22px 12px;border-bottom:1px solid var(--line)">
            <div style="font-size:16px;font-weight:800">${icon('mail')} 공급가 요청 메일을 보냅니다</div>
            <div class="muted" style="font-size:12.5px;margin-top:4px">아래 내용을 확인하고 <b>[이대로 보내기]</b>를 눌러야 실제로 발송됩니다.</div>
          </div>
          <div style="padding:16px 22px;overflow-y:auto">
            <div style="display:grid;grid-template-columns:64px 1fr;gap:6px 10px;font-size:13px;margin-bottom:12px">
              <div class="muted">받는사람</div><div><b>${esc(toName)}</b> ${esc(m.to||'(미지정)')}</div>
              <div class="muted">보내는이</div><div>${fromLine}</div>
              <div class="muted">대상상품</div><div>${isBatch?`<b>${batch.length}건</b> <span class="muted">일괄 요청 (본문 목록 참조)</span>`:`<b class="mono">${esc(p.ed||'-')}</b> · ${esc(p.name||'')} <span class="muted">(${esc(v.name)} ${esc(p.ntx||'')})</span>`}</div>
            </div>
            <div class="muted" style="font-size:11.5px;font-weight:700;margin-bottom:4px">제목 <span style="font-weight:500">(수정 가능)</span></div>
            <input id="csSubj" value="${esc(m.subject||'')}" style="width:100%;font:inherit;font-size:13px;border:1px solid var(--line-2);border-radius:8px;padding:9px 11px;margin-bottom:12px">
            <div class="muted" style="font-size:11.5px;font-weight:700;margin-bottom:4px">본문 <span style="font-weight:500">(수정 가능 — 보내기 전에 여기서 바로 고칠 수 있어요)</span></div>
            <textarea id="csBody" style="width:100%;min-height:200px;font:inherit;font-size:12.8px;line-height:1.6;border:1px solid var(--line-2);border-radius:8px;padding:11px 13px;background:var(--panel);resize:vertical">${esc(m.body||'')}</textarea>
            ${configured?'':'<div class="nx-note" style="margin:12px 0 0">자동발송이 아직 설정되지 않아 <b>메일 앱</b>으로 엽니다. 서버에 SMTP를 설정하면 이 버튼이 <b>원클릭 자동발송</b>으로 바뀝니다.</div>'}
            <div id="csMsg" class="muted" style="font-size:12.5px;margin-top:10px;min-height:16px"></div>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;padding:14px 22px;border-top:1px solid var(--line)">
            <button class="btn ghost" id="csCancel">취소</button>
            ${configured?`<button class="btn ghost" id="csMailto">메일 앱으로 열기</button><button class="btn pri" id="csSend">${icon('mail')}이대로 보내기</button>`
                        :`<button class="btn pri" id="csMailto">${icon('mail')}메일 앱으로 열기</button>`}
          </div></div>`;
        document.body.appendChild(ov);
        const close=()=>ov.remove();
        // 팝업에서 수정된 제목·본문을 실제 발송값으로 사용
        const edited=()=>({ to:m.to, subject:(ov.querySelector('#csSubj').value||'').trim()||m.subject, body:ov.querySelector('#csBody').value });
        ov.onclick=e=>{ if(e.target===ov) close(); };
        ov.querySelector('#csCancel').onclick=close;
        const mailtoBtn=ov.querySelector('#csMailto'); if(mailtoBtn) mailtoBtn.onclick=()=>{ openMailApp(edited()); toast('메일 작성 화면을 열었습니다'); close(); };
        const sendBtn=ov.querySelector('#csSend');
        if(sendBtn) sendBtn.onclick=async()=>{
          const msg=ov.querySelector('#csMsg'); sendBtn.disabled=true; ov.querySelector('#csCancel').disabled=true;
          msg.innerHTML='<span style="color:var(--info)">발송 중…</span>';
          try{
            const who=(Auth.user&&Auth.user()||{}); const actor=who.name||who.loginId||''; const ed=edited();
            const r=await fetch('/api/sendmail',{method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({op:'send',to:ed.to,toName,subject:ed.subject,body:ed.body,actor})});
            let d=null; try{d=await r.json();}catch(e){}
            if(r.ok&&d&&d.ok){ toast('공급가 요청 메일을 발송했습니다'); close(); }
            else{ const em=(d&&d.error)||('발송 실패('+r.status+')'); msg.innerHTML=`<span style="color:var(--danger)">${esc(em)}</span> · <a href="#" id="csFallback">메일 앱으로 열기</a>`;
              sendBtn.disabled=false; ov.querySelector('#csCancel').disabled=false;
              const fb=ov.querySelector('#csFallback'); if(fb) fb.onclick=e=>{ e.preventDefault(); openMailApp(edited()); close(); }; }
          }catch(e){ msg.innerHTML='<span style="color:var(--danger)">서버 연결 실패</span>'; sendBtn.disabled=false; ov.querySelector('#csCancel').disabled=false; }
        };
      }
      function diffRow(v,d,demo){ const prodMap={}; effectiveProducts(v).forEach(p=>prodMap[String(p.ntx)]=p);
        const p=prodMap[String(d.ntx)]||d; const up=(d.newPrice||0)>=(d.oldPrice||0); const link=v.site(d.ntx);
        return `<div class="nx-card${demo?' demo':''}" style="align-items:flex-start">
          ${demo?'':`<label style="display:flex;align-items:center;padding-top:2px;margin-right:2px" title="일괄 요청 선택"><input type="checkbox" class="nx-cb" data-ntx="${esc(d.ntx||'')}" style="width:17px;height:17px;cursor:pointer"></label>`}
          <div style="flex:1;min-width:0">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span class="nx-code">${esc(p.ed||'-')}</span><span class="muted" style="font-size:12px">${esc(v.name)} ${esc(d.ntx||'')}</span>
              ${demo?'<span class="nx-badge">예시(크롤러 연동 전 미리보기)</span>':'<span class="nx-badge">판매가 변동</span>'}
              <span class="muted" style="font-size:11px">공급가 <b style="color:#FF0000">${won(p.supply)}원</b> · 소비자가 <b style="color:#0070C0">${won(p.retail)}원</b></span></div>
            <div class="nx-nm">${link?`<a href="${esc(link)}" target="_blank" rel="noopener">${esc(p.name||d.name||'')}</a>`:esc(p.name||d.name||'')}</div>
            <div class="nx-price"><span>${esc(v.name)} 판매가 <span class="old">${won(d.oldPrice)}원</span> → <span class="new">${won(d.newPrice)}원</span></span>
              <span class="${up?'up':'down'}">${up?'▲':'▼'} ${won(Math.abs((d.newPrice||0)-(d.oldPrice||0)))}원</span></div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
            <button class="btn pri sm" data-a="mail" data-ntx="${esc(d.ntx||'')}">${icon('mail')}공급가 요청</button>
            ${demo?'':`<button class="btn sm" data-a="apply" data-ntx="${esc(d.ntx||'')}" style="background:#eef7f0;color:#12886a;border:1px solid #bfe3d3">${icon('check')}단가 반영</button>`}
            <div style="display:flex;gap:6px">
              <button class="btn ghost sm" data-a="copy" data-ntx="${esc(d.ntx||'')}">${icon('copy')}메일 복사</button>
              ${demo?'':`<button class="btn ghost sm" data-a="del" data-ntx="${esc(d.ntx||'')}" title="이 알림 삭제(처리 완료 등)">${icon('trash')}</button>`}
            </div></div>
        </div>`; }
      // 단가 반영 — 회신받은 공급가/소비자가를 취급 상품에 자동 반영하고 알림 정리
      function openApplyPrice(v,p,d){
        const ov=el('div','modal-ov'); ov.style.cssText='position:fixed;inset:0;background:rgba(16,24,40,.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px';
        ov.innerHTML=`<div style="background:var(--panel);border:1px solid var(--line);border-radius:16px;max-width:440px;width:96%;box-shadow:var(--sh-lg)">
          <div style="padding:16px 20px 10px;border-bottom:1px solid var(--line)"><div style="font-size:15.5px;font-weight:800">${icon('check')} 단가 반영</div>
            <div class="muted" style="font-size:12px;margin-top:3px">회신받은 단가를 입력하면 <b>취급 상품</b>에 바로 반영됩니다.</div></div>
          <div style="padding:16px 20px">
            <div style="font-size:13px;margin-bottom:10px"><b class="mono">${esc(p.ed||'-')}</b> · ${esc(p.name||'')} <span class="muted">(${esc(v.name)} ${esc(p.ntx||'')})</span>${d?`<div class="muted" style="font-size:12px;margin-top:3px">크롤링 판매가 ${won(d.newPrice)}원</div>`:''}</div>
            <div style="display:flex;gap:12px">
              <label class="fld" style="flex:1">공급가 <span style="color:#FF0000">●</span><input id="apSupply" inputmode="numeric" value="${esc(p.supply||'')}" placeholder="공급가" style="text-align:right"></label>
              <label class="fld" style="flex:1">소비자가 <span style="color:#0070C0">●</span><input id="apRetail" inputmode="numeric" value="${esc(p.retail||'')}" placeholder="소비자가" style="text-align:right"></label>
            </div>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;padding:12px 20px;border-top:1px solid var(--line)">
            <button class="btn ghost" id="apCancel">취소</button><button class="btn pri" id="apSave">${icon('check')}취급상품 반영</button></div>
        </div>`;
        document.body.appendChild(ov); const close=()=>ov.remove(); ov.onclick=e=>{ if(e.target===ov) close(); };
        ov.querySelector('#apCancel').onclick=close;
        ov.querySelector('#apSave').onclick=()=>{ const supply=parseNum(ov.querySelector('#apSupply').value), retail=parseNum(ov.querySelector('#apRetail').value);
          saveOverride(v, p.ntx, {...p, ntx:p.ntx, supply, retail});
          const dm=dismissedMap(); if(d){ dm[dkey(d)]=1; store(DISMISS_KEY).set(dm); }   // 반영 완료 → 알림 정리
          toast('취급 상품에 단가를 반영했습니다'); close(); load();
        };
      }
      // 처리/불필요한 알림 삭제 = 팀 공유(다시 안 뜸) · 키 = 확인일|엔티렉스코드
      const DISMISS_KEY='eduino.ntrex.dismissed';
      const dismissedMap=()=>store(DISMISS_KEY).get({})||{};
      const dkey=(d)=>`${apDay||''}|${String(d.ntx||'')}`;
      function drawAlerts(sec,v){ const prods=effectiveProducts(v);
        const dm=dismissedMap(); const liveDiffs=(diffs||[]).filter(d=>!dm[dkey(d)]);
        const real=liveDiffs.length; const hidden=(diffs||[]).length-liveDiffs.length;
        let demo=false, rows=liveDiffs;
        if(!real){ const s=prods.find(p=>p.price>0); demo=!!s; rows=s?[{ntx:s.ntx,name:s.name,oldPrice:s.price,newPrice:Math.round(s.price*1.05)}]:[]; }
        sec.innerHTML=`${apDay?`<div class="nx-note">최근 확인: <b>${esc(apDay)}</b> · 변동 <b>${(diffs||[]).length}</b>건${hidden?` · 처리/삭제 <b>${hidden}</b>건`:''}</div>`:
          `<div class="nx-note">${icon('alert')} 아직 크롤러가 연동되지 않아 <b>예시 미리보기</b>입니다. VPS 크롤러가 ${esc(v.siteName)}의 판매가를 매일 확인하면 실제 변동분이 자동 표시됩니다.</div>`}
          <div class="nx-kpi">
            <div class="nx-k red"><div class="l">가격 변동</div><div class="v">${real}<span style="font-size:14px">건</span></div></div>
            <div class="nx-k"><div class="l">취급 상품</div><div class="v">${prods.length}</div></div>
            <div class="nx-k warn"><div class="l">기준가 없음(비교대기)</div><div class="v">${prods.filter(p=>!p.price).length}</div></div>
          </div>
          ${(!demo&&rows.length)?`<div class="nx-bulk" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:2px 0 10px;padding:9px 12px;border:1px solid var(--line);border-radius:10px;background:var(--panel-2,#f6f8fc)">
            <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;cursor:pointer"><input type="checkbox" id="nxAll" style="width:16px;height:16px">전체 선택</label>
            <span class="muted" id="nxSelCnt" style="font-size:12px">0건 선택</span>
            <button class="btn pri sm" id="nxBulkReq" style="margin-left:auto" disabled>${icon('mail')}선택 상품 공급가 일괄요청</button>
          </div>`:''}
          <div>${rows.length?rows.map(d=>diffRow(v,d,demo)).join(''):`<div class="nx-empty">${icon('check2')}<div>표시할 가격 변동이 없습니다.</div></div>`}</div>`;
        const pm={}; prods.forEach(p=>pm[String(p.ntx)]=p);
        const diffByNtx={}; (diffs||[]).forEach(d=>diffByNtx[String(d.ntx)]=d);
        // 선택(체크박스) → 일괄 공급가요청
        const cbs=()=>[...sec.querySelectorAll('.nx-cb')];
        const selectedProds=()=>cbs().filter(c=>c.checked).map(c=>pm[c.dataset.ntx]||{ntx:c.dataset.ntx});
        const refreshSel=()=>{ const n=cbs().filter(c=>c.checked).length; const cnt=sec.querySelector('#nxSelCnt'), req=sec.querySelector('#nxBulkReq'), all=sec.querySelector('#nxAll');
          if(cnt) cnt.textContent=`${n}건 선택`; if(req){ req.disabled=!n; req.innerHTML=`${icon('mail')}선택 ${n?n+'건 ':''}공급가 일괄요청`; } if(all) all.checked=n>0&&n===cbs().length; };
        cbs().forEach(c=>c.onchange=refreshSel);
        { const all=sec.querySelector('#nxAll'); if(all) all.onchange=()=>{ cbs().forEach(c=>c.checked=all.checked); refreshSel(); }; }
        { const req=sec.querySelector('#nxBulkReq'); if(req) req.onclick=()=>{ const list=selectedProds(); if(!list.length){ toast('상품을 선택하세요'); return; } confirmSend(v,null,list); }; }
        sec.querySelectorAll('[data-a=apply]').forEach(b=>b.onclick=()=>{ openApplyPrice(v, pm[b.dataset.ntx]||{ntx:b.dataset.ntx}, diffByNtx[b.dataset.ntx]); });
        sec.querySelectorAll('[data-a=mail]').forEach(b=>b.onclick=()=>{ confirmSend(v,pm[b.dataset.ntx]||{ntx:b.dataset.ntx}); });
        sec.querySelectorAll('[data-a=copy]').forEach(b=>b.onclick=()=>{ const m=fillMail(mailCfg(v),pm[b.dataset.ntx]||{ntx:b.dataset.ntx},v.site(b.dataset.ntx)); copyText(`받는사람: ${m.to}\n제목: ${m.subject}\n\n${m.body}`); toast('메일 내용을 복사했습니다'); });
        sec.querySelectorAll('[data-a=del]').forEach(b=>b.onclick=()=>{ const d=diffByNtx[b.dataset.ntx]||{ntx:b.dataset.ntx};
          if(!confirm('이 가격 변동 알림을 목록에서 삭제할까요?\n(처리 완료 등 · 팀 전체에서 사라지며 되돌리려면 크롤러가 다시 감지해야 합니다)')) return;
          const dm2=dismissedMap(); dm2[dkey(d)]=1; store(DISMISS_KEY).set(dm2); toast('알림을 삭제했습니다'); drawAlerts(sec,v); });
      }

      /* -------- 취급 상품(담당자 추가·수정) -------- */
      function blankRow(){ return {ed:'',ntx:'',name:'',price:'',supply:'',retail:'',note:''}; }
      function formCells(r,mode){ // mode: 'add'|'edit'
        const f=(k,ph,cls)=>`<input data-k="${k}" class="${cls||''}" value="${esc(r[k]==null?'':r[k])}" placeholder="${ph||''}" ${k==='ntx'&&mode==='edit'?'readonly style=background:var(--panel-2)':''}>`;
        return `<td>${f('ed','P-Txxx')}</td><td>${f('ntx','엔티렉스코드')}</td><td>${f('name','상품명')}</td>
          <td>${f('price','기준판매가','num')}</td><td>${f('supply','공급가','num')}</td><td>${f('retail','소비자가','num')}</td><td>${f('note','비고')}</td>`;
      }
      function drawList(sec,v){ const editable=canEdit(); const ov=store(v.productsKey).get({})||{};
        sec.innerHTML=`
          <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
            <input type="search" id="nxQ" placeholder="에듀이노코드·엔티렉스코드·상품명 검색" style="height:40px;flex:1;min-width:240px;max-width:460px;border:1px solid var(--line-2);border-radius:8px;padding:0 12px" value="${esc(q)}">
            ${editable?`<button class="btn pri" id="nxAdd" style="margin-left:auto">${icon('plus')}상품 추가</button>`:''}</div>
          <div class="nx-wrap"><table class="nx-t">
            <thead><tr><th>에듀이노코드</th><th>엔티렉스코드</th><th>상품명</th><th style="text-align:right">판매가(기준)</th><th style="text-align:right">공급가</th><th style="text-align:right">소비자가</th><th>비고</th>${editable?'<th></th>':''}</tr></thead>
            <tbody id="nxTb"></tbody></table></div>`;
        const tb=sec.querySelector('#nxTb');
        function readForm(tr){ const r={}; tr.querySelectorAll('[data-k]').forEach(i=>{ r[i.dataset.k]=['price','supply','retail'].includes(i.dataset.k)?parseNum(i.value):i.value.trim(); }); return r; }
        function paint(){ const s=q.trim().toLowerCase(); const list=effectiveProducts(v)
            .filter(p=>!s||[p.ed,p.ntx,p.name].some(x=>String(x).toLowerCase().includes(s)))
            .sort((a,b)=>String(a.ed).localeCompare(String(b.ed))).slice(0,1500);
          let html='';
          if(addOpen && editable){ html+=`<tr data-add>${formCells(blankRow(),'add')}<td style="white-space:nowrap"><button class="btn pri sm" data-a="addsave">${icon('check')}</button> <button class="btn ghost sm" data-a="addcancel">취소</button></td></tr>`; }
          html+=list.map(p=>{ const isUser=!!ov[String(p.ntx)]&&!ov[String(p.ntx)]._del;
            if(editNtx===String(p.ntx)) return `<tr>${formCells(p,'edit')}<td style="white-space:nowrap"><button class="btn pri sm" data-a="save" data-ntx="${esc(p.ntx)}">${icon('check')}</button> <button class="btn ghost sm" data-a="cancel">취소</button></td></tr>`;
            return `<tr><td class="nx-code">${esc(p.ed)}${isUser?'<span class="nx-usr">담당자</span>':''}</td><td>${esc(p.ntx)}</td><td>${esc(p.name)}</td>
              <td class="num">${p.price?won(p.price)+'원':'<span class="muted">-</span>'}</td><td class="num" style="color:#FF0000;font-weight:700">${won(p.supply)}원</td><td class="num" style="color:#0070C0;font-weight:700">${won(p.retail)}원</td><td class="muted">${esc(p.note||'')}</td>
              ${editable?`<td style="white-space:nowrap"><button class="btn ghost sm" data-a="edit" data-ntx="${esc(p.ntx)}">수정</button> <button class="btn ghost sm" data-a="del" data-ntx="${esc(p.ntx)}" data-ed="${esc(p.ed)}">${icon('trash')}</button></td>`:''}</tr>`;
          }).join('') || (addOpen?'':`<tr><td colspan="${editable?8:7}" class="nx-empty">검색 결과가 없습니다.</td></tr>`);
          tb.innerHTML=html; wire();
        }
        function wire(){
          const add=sec.querySelector('#nxAdd'); if(add) add.onclick=()=>{ addOpen=true; editNtx=null; paint(); };
          const asv=tb.querySelector('[data-a=addsave]'); if(asv) asv.onclick=()=>{ const r=readForm(tb.querySelector('[data-add]'));
            if(!r.ntx||!r.name){ toast('엔티렉스코드와 상품명은 필수입니다'); return; }
            saveOverride(v,r.ntx,r); addOpen=false; toast('상품을 추가했습니다'); draw(); };
          const acl=tb.querySelector('[data-a=addcancel]'); if(acl) acl.onclick=()=>{ addOpen=false; paint(); };
          tb.querySelectorAll('[data-a=edit]').forEach(b=>b.onclick=()=>{ editNtx=String(b.dataset.ntx); addOpen=false; paint(); });
          tb.querySelectorAll('[data-a=cancel]').forEach(b=>b.onclick=()=>{ editNtx=null; paint(); });
          tb.querySelectorAll('[data-a=save]').forEach(b=>b.onclick=(e)=>{ const r=readForm(e.currentTarget.closest('tr')); r.ntx=b.dataset.ntx;
            saveOverride(v,b.dataset.ntx,r); editNtx=null; toast('수정했습니다'); draw(); });
          tb.querySelectorAll('[data-a=del]').forEach(b=>b.onclick=()=>{ if(!confirm(`'${b.dataset.ed||b.dataset.ntx}' 상품을 목록에서 삭제할까요?`)) return;
            const cur=store(v.productsKey).get({})||{}; const inBundle=v.bundled.some(p=>String(p.ntx)===String(b.dataset.ntx));
            if(inBundle) cur[String(b.dataset.ntx)]={_del:true}; else delete cur[String(b.dataset.ntx)];
            store(v.productsKey).set(cur); toast('삭제했습니다'); draw(); });
        }
        sec.querySelector('#nxQ').oninput=e=>{ q=e.target.value; paint(); };
        paint();
      }

      /* -------- 메일 양식(관리자) -------- */
      function drawMail(sec,v){ const c=mailCfg(v);
        sec.innerHTML=`<div class="nx-note">공급가 요청 메일 양식. 토큰 <b>{ntx}</b>(엔티렉스코드)·<b>{name}</b>(상품명)·<b>{ed}</b>(에듀이노코드)·<b>{link}</b>(상품링크)는 전송 시 실제 값으로 치환됩니다.</div>
          <div style="max-width:720px;display:flex;flex-direction:column;gap:12px">
            <label class="fld">받는사람(${esc(v.name)} 담당자)<input type="text" id="mTo" value="${esc(c.to)}"></label>
            <label class="fld">제목<input type="text" id="mSub" value="${esc(c.subject)}"></label>
            <label class="fld">내용<textarea id="mBody" class="nx-ta">${esc(c.body)}</textarea></label>
            <div style="display:flex;gap:8px;align-items:center"><button class="btn pri" id="mSave">${icon('save')}저장(MD 공유)</button><button class="btn" id="mPrev">미리보기</button><span class="muted" id="mStat" style="font-size:12.5px"></span></div>
            <div id="mPrevBox"></div></div>`;
        sec.querySelector('#mSave').onclick=()=>{ store(v.mailKey).set({ to:sec.querySelector('#mTo').value.trim(), toName:c.toName, subject:sec.querySelector('#mSub').value, body:sec.querySelector('#mBody').value });
          sec.querySelector('#mStat').innerHTML='<span style="color:var(--ok)">저장됨(MD 공유)</span>'; toast('메일 양식 저장'); };
        sec.querySelector('#mPrev').onclick=()=>{ const s=effectiveProducts(v).find(p=>p.price>0)||{ntx:'0000',name:'샘플상품',ed:'P-T000'};
          const m=fillMail({to:sec.querySelector('#mTo').value.trim(),subject:sec.querySelector('#mSub').value,body:sec.querySelector('#mBody').value},s,v.site(s.ntx));
          sec.querySelector('#mPrevBox').innerHTML=`<div class="nx-card" style="display:block"><div class="muted" style="font-size:12px">받는사람: ${esc(m.to)} · 제목: ${esc(m.subject)}</div><pre style="white-space:pre-wrap;font:inherit;margin:8px 0 0">${esc(m.body)}</pre></div>`; };
      }

      async function load(){ const v=vendor(); const items=await collGet(v.coll);
        if(!root.isConnected) return;
        const list=(items||[]).filter(d=>d&&d.type!=='mailcfg'&&d.day); list.sort((a,b)=>String(b.day||'').localeCompare(String(a.day||'')));
        history=list; const latest=list[0]; diffs=(latest&&latest.items)||[]; apDay=(latest&&latest.day)||''; draw();
      }
      load();
    }
  };
})();
