/* ===========================================================================
   [관리자] 매출 데이터 — 기간 집계 + 그래프
   - CS 견적/발주/후불(sheet cs/postpay): 구분별 금액 합계
   - MD 입점사 발주(sheet md/orders): 정산구분(선결제·월정산)별 발주금액 합계
   - 기간 옵션(이번 달·3/6/12개월·올해·직접설정) + 월별 추이 그래프
   - 색상 규칙: CS=파랑 계열 · MD=보라 계열 (카드·막대·추이 동일색 → 직관적 연결)
   ========================================================================= */
(function(){
  const won = n => Number(n||0).toLocaleString();
  const parseNum = v => Number(String(v==null?'':v).replace(/[^\d.-]/g,''))||0;
  const pad = n => String(n).padStart(2,'0');
  const ymOf = d => d.getFullYear()+'-'+pad(d.getMonth()+1);
  const addMonth = (ym,delta)=>{ const [y,m]=ym.split('-').map(Number); return ymOf(new Date(y,(m-1)+delta,1)); };
  const rangeMonths = (from,to)=>{ const a=[]; let c=from; let guard=0; while(c<=to && guard++<60){ a.push(c); c=addMonth(c,1); } return a.length?a:[from]; };
  const monthRecs = async (dept,sheet,ym)=>{ try{ return (window.Records&&Records.month)?((await Records.month(dept,sheet,ym))||[]):[]; }catch(e){ return []; } };
  const lastDay = ym=>{ const [y,m]=ym.split('-').map(Number); return ym+'-'+pad(new Date(y,m,0).getDate()); };   // 그 달 마지막 날 (YYYY-MM-DD)
  const dayOf = r=>String(r.day||r.date||r.rdate||'').slice(0,10);   // 레코드 일자 (YYYY-MM-DD)
  const normSettle = s=>{ s=String(s||'').trim(); if(s==='원'||s==='월'||s==='월정산') return '월정산'; if(s==='선'||s==='선결제') return '선결제'; return s||'기타'; };
  const csGroup = g=>{ g=String(g||'').trim(); return (g==='견적'||g==='발주'||g==='후불')?g:'기타'; };

  // CS=파랑 계열 · MD=보라 계열 (같은 계열=같은 파트)
  const CS_GROUPS=[{k:'견적',c:'#1f6feb'},{k:'발주',c:'#4d9bff'},{k:'후불',c:'#86bbff'},{k:'기타',c:'#c2d9f5'}];
  const MD_GROUPS=[{k:'선결제',c:'#7a5af8'},{k:'월정산',c:'#a58bff'},{k:'기타',c:'#d3c8ff'}];
  const CS_COLOR='#1f6feb', MD_COLOR='#7a5af8';

  /* ── CAFE24 매출통계 — 월별 CSV 업로드 → 분류 집계(판매처·공급처·상품·고객유형) ── */
  const CAFE_COLL='cafe24_sales';
  async function cafeGet(){ try{ const r=await fetch('/api/store?type=coll&coll='+CAFE_COLL); if(!r.ok) throw 0; const d=await r.json(); return (d&&d.items||[]).filter(x=>x&&x.id); }catch(e){ return null; } }
  async function cafePush(item){ try{ const r=await fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collPush',coll:CAFE_COLL,item})}); return r.ok; }catch(e){ return false; } }
  async function cafeDel(id){ try{ const r=await fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collDel',coll:CAFE_COLL,id})}); return r.ok; }catch(e){ return false; } }
  // 분류 규칙 — 대표님 정의
  const CAFE_PARTNERS=['샘활코딩','생활코딩','아이스크림','엔티렉스','ntrex'];
  const chClass=v=>{ const s=String(v||'').replace(/\s/g,'');
    if(/후불/.test(s)) return '후불'; if(/쿠팡/.test(s)) return '쿠팡';
    if(/기타발주|업체/.test(s)) return '기업';
    if(CAFE_PARTNERS.some(p=>s.includes(p.replace(/\s/g,'')))) return '파트너사';
    if(/카페24|cafe24/i.test(s)) return '카페24'; if(/스마트스토어/.test(s)) return '스마트스토어';
    if(/전화/.test(s)) return '전화주문'; return String(v||'').trim()||'(미지정)'; };
  const supClass=v=>/자사/.test(String(v||''))?'자사':'입점사';
  const prodClass=code=>{ const c=String(code||'').trim().toUpperCase().charAt(0);
    if(c&&'ABCDE'.includes(c)) return '자사 부품'; if('FGHJ'.includes(c)) return '자사키트';
    if(c==='S') return '자사 과학키트'; if(c==='P') return '입점사'; return '기타'; };
  const custClass=addr=>{ const a=String(addr||'');
    if(/대학교|대학원|대학|캠퍼스/.test(a)) return '대학'; if(/고등학교|고교/.test(a)) return '고등';
    if(/중학교/.test(a)) return '중등'; if(/초등학교|초교/.test(a)) return '초등';
    if(/유치원|어린이집/.test(a)) return '유아'; return '개인·기업'; };
  const CAFE_DIMS=[['ch','판매처'],['sup','공급처'],['prod','상품분류'],['cust','고객유형(주소)']];
  /* 파일 → 표(2차원 배열) → 4축 분류 집계
     카페24는 받는 메뉴마다 파일 모양이 제각각이라(엑셀·CSV·탭구분·HTML표, 제목줄 유무,
     열 이름 변형) 형태를 먼저 표로 통일한 뒤 같은 로직으로 집계한다.
     어떤 열을 금액으로 썼는지는 업로드 미리보기에 그대로 보여 주어 눈으로 확인하게 한다. */
  const CF_CH  =['판매처','쇼핑몰','몰명','유입경로','주문경로','마켓','채널'];
  const CF_AMT =['합계금액','실결제금액','실매출액','총결제금액','결제금액','판매금액','상품금액','매출액','주문금액','금액'];
  const CF_SUP =['공급처','공급업체','제조사','브랜드'];
  const CF_PROD=['사입상품','상품코드','자체상품코드','상품명','상품'];
  const CF_ADDR=['수령자주소','수취인주소','배송지','주소'];
  // 금액으로 잡으면 안 되는 열(할인·취소·배송비 등) — 이게 먼저 걸리면 매출이 0이거나 엉뚱해진다
  const CF_AMT_BAD=/할인|취소|환불|반품|적립|포인트|쿠폰|마일리지|배송비|부가세|수수료/;
  const CF_HEAD_MAX=24;   // 열 이름 최대 길이 — 이보다 길면 안내 문장으로 보고 헤더에서 제외
  const cfNorm=s=>String(s==null?'':s).replace(/\(.*?\)|\s|["']/g,'');

  /* 텍스트(CSV·TSV) → 표 : 구분자(쉼표·세미콜론·탭) 자동 감지 */
  function cafeTextRows(text){
    const lines=String(text||'').split(/\r?\n/).filter(l=>l.trim().length);
    if(!lines.length) return [];
    const s0=lines[0], n=c=>(s0.split(c).length-1);
    const cand=[[',',n(',')],[';',n(';')],['\t',n('\t')]].sort((x,y)=>y[1]-x[1]);
    const delim=cand[0][1]?cand[0][0]:',';
    const cell=l=>{ const out=[]; let cur='',q=false; for(let i=0;i<l.length;i++){ const ch=l[i];
      if(q){ if(ch==='"'){ if(l[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=ch; }
      else { if(ch==='"') q=true; else if(ch===delim){ out.push(cur); cur=''; } else cur+=ch; } } out.push(cur); return out; };
    return lines.map(cell);
  }
  /* HTML 표 → 표 : 확장자만 .xls 이고 내용은 HTML인 파일(카페24가 종종 이렇게 내려줌) */
  function cafeHtmlRows(text){
    try{ const doc=new DOMParser().parseFromString(String(text||''),'text/html');
      return [...doc.querySelectorAll('tr')].map(tr=>[...tr.querySelectorAll('th,td')].map(td=>td.textContent.trim()))
        .filter(r=>r.some(c=>c)); }catch(e){ return []; }
  }

  function parseCafeSheet(rows){
    rows=(rows||[]).filter(r=>Array.isArray(r)&&r.some(c=>String(c==null?'':c).trim()));
    if(rows.length<2) return { err:'표에서 읽을 내용이 없습니다.' };
    /* 헤더 행 찾기 — 카페24 통계 파일은 위에 안내문이 여러 줄 붙는데, 그 문장에도
       '금액' 같은 낱말이 들어 있어 헤더로 오인되기 쉽다. 그래서 헤더 후보를
       ① 칸이 3개 이상이고 ② 칸 이름이 짧은(문장이 아닌) 행으로 제한한다. */
    const hit=(h,cands)=>cands.some(c=>h.some(x=>x.length<=CF_HEAD_MAX && x.includes(c)));
    const headLike=h=>h.filter(x=>x).length>=3;
    const scan=(need2)=>{ for(let i=0;i<Math.min(20,rows.length-1);i++){ const h=rows[i].map(cfNorm);
        if(!headLike(h)) continue;
        if(hit(h,CF_AMT) && (!need2||hit(h,CF_CH))) return { i, h }; } return null; };
    const found = scan(true) || scan(false);
    if(!found) return { err:'금액 열을 찾지 못했습니다.', headers:(rows.find(r=>r.filter(c=>String(c||'').trim()).length>=3)||rows[0]).map(cfNorm) };
    const hRow=found.i, head=found.h;
    const fit=h=>h.length<=CF_HEAD_MAX;
    // 숫자 열(상품구매금액 등)이 '상품'·'주소' 같은 이름 조각에 걸리지 않게 거른다
    const NUMISH=/금액|수량|건수|주문수|품목수|률|율/;
    const idx=cands=>{ for(const c of cands){ const i=head.findIndex(h=>fit(h)&&h.includes(c)&&!NUMISH.test(h)); if(i>=0) return i; } return -1; };
    const idxAmt=()=>{ for(const c of CF_AMT){ const i=head.findIndex(h=>fit(h)&&h.includes(c)&&!CF_AMT_BAD.test(h)); if(i>=0) return i; }
                       for(const c of CF_AMT){ const i=head.findIndex(h=>fit(h)&&h.includes(c)); if(i>=0) return i; } return -1; };
    const iCh=idx(CF_CH), iSup=idx(CF_SUP), iProd=idx(CF_PROD), iAmt=idxAmt(), iAddr=idx(CF_ADDR);
    if(iAmt<0) return { err:'금액 열을 찾지 못했습니다.', headers:head };
    const used={ 판매처:iCh>=0?head[iCh]:'', 금액:head[iAmt], 공급처:iSup>=0?head[iSup]:'', 상품:iProd>=0?head[iProd]:'', 주소:iAddr>=0?head[iAddr]:'' };
    const dims={ch:{},sup:{},prod:{},cust:{}}; let total=0,count=0;
    const add=(m,k,a)=>{ const o=m[k]=m[k]||{amount:0,count:0}; o.amount+=a; o.count++; };
    const cellOf=(c,i)=>String(i>=0&&c[i]!=null?c[i]:'').trim();
    for(let i=hRow+1;i<rows.length;i++){ const c=rows[i];
      const amtRaw=cellOf(c,iAmt);
      const amt=Number(amtRaw.replace(/[^\d.-]/g,''))||0;
      const chv=cellOf(c,iCh), pv=cellOf(c,iProd);
      if(!amtRaw && !chv && !pv) continue;                    // 완전히 빈 행만 건너뜀
      add(dims.ch, iCh>=0?chClass(chv||'(미지정)'):'(판매처 열 없음)', amt);
      add(dims.sup, supClass(cellOf(c,iSup)), amt);
      add(dims.prod, prodClass(pv), amt);
      add(dims.cust, custClass(cellOf(c,iAddr)), amt);
      total+=amt; count++; }
    const sample=rows[hRow+1]?cellOf(rows[hRow+1],iAmt):'';   // 첫 데이터 행의 금액 원본값(0원일 때 원인 확인용)
    return { dims, total, count, used, headers:head, sample };
  }
  const ymFromName=name=>{ const m=String(name||'').match(/(20\d{2})[\-_.]?(0[1-9]|1[0-2])/); return m?`${m[1]}-${m[2]}`:''; };

  function aggregate(recs, kind){
    const groups = kind==='cs'?CS_GROUPS:MD_GROUPS;
    const by={}; groups.forEach(g=>by[g.k]={amount:0,count:0});
    let total=0;
    (recs||[]).forEach(r=>{ const amt=parseNum(r.amount); const key=kind==='cs'?csGroup(r.gubun):normSettle(r.settle);
      if(!by[key]) by[key]={amount:0,count:0}; by[key].amount+=amt; by[key].count++; total+=amt; });
    return { total, by, groups };
  }

  const PRESETS=[['m1','이번 달'],['m3','최근 3개월'],['m6','최근 6개월'],['m12','최근 12개월'],['ytd','올해'],['custom','직접설정']];
  function presetRange(p, cym){
    const y=cym.slice(0,4);
    if(p==='m1') return [cym,cym];
    if(p==='m3') return [addMonth(cym,-2),cym];
    if(p==='m6') return [addMonth(cym,-5),cym];
    if(p==='m12') return [addMonth(cym,-11),cym];
    if(p==='ytd') return [y+'-01',cym];
    return [cym,cym];
  }

  // 차트(svg.chart-svg) 호버 툴팁 배선 — [data-tip] 히트영역에 커서 올리면 해당 월 매출 표시
  function attachChartTips(scope){
    (scope||document).querySelectorAll('svg.chart-svg').forEach(svg=>{
      const box=svg.closest('.sl-trend')||svg.parentElement; if(!box) return;
      box.style.position='relative';
      let tip=box.querySelector(':scope > .chart-tip');
      if(!tip){ tip=document.createElement('div'); tip.className='chart-tip'; box.appendChild(tip); }
      const move=e=>{ const r=box.getBoundingClientRect(); tip.style.left=(e.clientX-r.left)+'px'; tip.style.top=(e.clientY-r.top)+'px'; };
      svg.querySelectorAll('[data-tip]').forEach(h=>{
        h.addEventListener('mouseenter',e=>{ tip.textContent=h.getAttribute('data-tip')||''; tip.classList.add('on'); move(e); });
        h.addEventListener('mousemove',move);
        h.addEventListener('mouseleave',()=>tip.classList.remove('on'));
      });
    });
  }

  MODULES['md.sales']={
    title:'매출 데이터', icon:'chart',
    render(root){
      const now=new Date(); const cym=ymOf(now); const cday=cym+'-'+pad(now.getDate());
      let preset='m1', from=cym, to=cym;   // 프리셋: YYYY-MM · 직접설정(custom): YYYY-MM-DD
      // 유형별 분석 상태 — 소스(CS · MD) × 구분 필터(CS: 전체/발주/견적/후불) × 분석 축 · 기간 필터 데이터 캐시
      let bkSrc='cs', bkDim='custType', bkGubun='all', _csAll=[], _mdAll=[];
      root.innerHTML=`
      <style>
        .sl-period{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:16px}
        .sl-period .seg{display:inline-flex;border:1px solid var(--line-2);border-radius:9px;overflow:hidden}
        .sl-period .seg button{border:0;background:var(--panel);padding:8px 13px;font-size:12.5px;font-weight:700;color:var(--muted);cursor:pointer;border-left:1px solid var(--line-2)}
        .sl-period .seg button:first-child{border-left:0}
        .sl-period .seg button.on{background:var(--active-bg);color:var(--red)}
        .sl-period input[type=month],.sl-period input[type=date]{font:inherit;font-size:12.5px;border:1px solid var(--line-2);border-radius:8px;padding:6px 9px}
        .sl-audit{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:14px 16px;margin-bottom:14px;box-shadow:var(--sh-sm)}
        .sl-audit .au-hd{display:flex;align-items:center;gap:8px;font-weight:800;font-size:13.5px;padding-bottom:10px;border-bottom:1px solid var(--line-2);margin-bottom:12px}
        .sl-audit .au-sec{font-size:13px;font-weight:800;margin-bottom:16px}
        .sl-audit .au-sec:last-child{margin-bottom:0}
        .sl-audit .au-d{font-size:12px;font-weight:600;color:var(--muted);margin:4px 0 8px;line-height:1.55}
        .sl-audit .hi{color:var(--danger)}
        .sl-audit .au-ok{font-size:12.5px;font-weight:600;color:var(--ok);background:var(--ok-bg,#e8f8ef);border-radius:8px;padding:7px 11px}
        .sl-audit .au-t{width:100%;border-collapse:collapse;font-size:12.5px;font-weight:600}
        .sl-audit .au-t th{text-align:left;font-size:11px;color:var(--muted);font-weight:700;padding:6px 9px;border-bottom:1px solid var(--line);background:var(--panel-2);white-space:nowrap}
        .sl-audit .au-t td{padding:6px 9px;border-bottom:1px solid var(--line-2)}
        .sl-audit .au-t th.n,.sl-audit .au-t td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
        .sl-audit .au-t td.ex{color:var(--muted);font-weight:500}
        .sl-audit .au-l{margin:0;padding-left:18px;font-size:12.5px;font-weight:600;line-height:1.75}
        .sl-audit .au-l li{color:var(--ink-2)}
        .sl-period .rng{display:flex;align-items:center;gap:6px}
        .sl-period .tot{margin-left:auto;font-size:12.5px;color:var(--muted)} .sl-period .tot b{color:var(--ink)}
        .sl-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        @media(max-width:820px){.sl-grid{grid-template-columns:1fr}}
        /* 사무적 KPI 카드 — 상단 액센트 바 + 평면 헤더 */
        .sl-card{--ac:#516070;border:1px solid var(--line);border-top:3px solid var(--ac);border-radius:10px;background:var(--panel);box-shadow:var(--sh-sm);overflow:hidden}
        .sl-card.cs{--ac:#1f6feb} .sl-card.md{--ac:#6a5acd}
        .sl-card .hd{padding:13px 18px 14px;background:var(--panel-2);border-bottom:1px solid var(--line)}
        .sl-card .hd h3{margin:0;font-size:12.5px;font-weight:700;color:var(--muted);letter-spacing:.02em;display:flex;align-items:center;gap:7px;text-transform:none}
        .sl-card .hd h3 .ic{color:var(--ac)}
        .sl-card .hd .sub{font-size:11px;color:var(--muted);margin-top:2px}
        .sl-card .hd .tot{font-size:25px;font-weight:800;margin-top:9px;color:var(--ink);font-variant-numeric:tabular-nums;letter-spacing:-.01em}
        .sl-card .hd .tot small{font-size:12.5px;color:var(--muted);font-weight:600;margin-left:2px}
        .sl-card .bd{padding:14px 18px}
        .sl-row{display:grid;grid-template-columns:60px 1fr 130px;gap:10px;align-items:center;margin:9px 0;font-size:13px}
        .sl-row .lbl{font-weight:700;color:var(--ink-2);display:flex;align-items:center;gap:6px}
        .sl-row .dot{width:10px;height:10px;border-radius:3px;flex:none}
        .sl-bar{height:14px;background:var(--zebra);border-radius:7px;overflow:hidden}
        .sl-bar i{display:block;height:100%;border-radius:7px;transition:width .3s}
        .sl-amt{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}
        .sl-amt small{color:var(--muted);font-weight:600;font-size:11px}
        .sl-trend{margin-top:16px;border:1px solid var(--line);border-radius:14px;background:var(--panel);box-shadow:var(--sh-sm);padding:16px 18px}
        .sl-trend h3{margin:0 0 2px;font-size:14.5px;font-weight:800;display:flex;align-items:center;gap:8px}
        .sl-trend .sub{font-size:11.5px;color:var(--muted);margin-bottom:8px}
        /* 그래프 호버 툴팁 — 마우스 올린 월의 매출 표시 */
        .chart-tip{position:absolute;pointer-events:none;background:#1a2230;color:#fff;font-size:11.5px;font-weight:700;line-height:1.5;padding:6px 10px;border-radius:8px;white-space:pre-line;box-shadow:0 6px 18px rgba(16,24,40,.28);opacity:0;transform:translate(-50%,calc(-100% - 12px));transition:opacity .09s;z-index:6}
        .chart-tip.on{opacity:1}
        svg.chart-svg [data-tip]{cursor:default}
        svg.chart-svg [data-tip]:hover{fill:rgba(31,111,235,.06)}
        .sl-legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--ink-2);margin-top:10px}
        .sl-legend span{display:inline-flex;align-items:center;gap:6px}
        .sl-legend i{width:12px;height:12px;border-radius:3px;display:inline-block}
        .sl-empty{padding:22px;text-align:center;color:var(--muted);font-size:13px}
        .sl-note{color:var(--muted);font-size:11.5px;margin-top:12px}
        /* 유형별 분석 컨트롤 */
        .bk-ctrl{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}
        .bk-ctrl .seg{display:inline-flex;border:1px solid var(--line-2);border-radius:9px;overflow:hidden}
        .bk-ctrl .seg button{border:0;background:var(--panel);padding:6px 11px;font-size:12px;font-weight:700;color:var(--muted);cursor:pointer;border-left:1px solid var(--line-2)}
        .bk-ctrl .seg button:first-child{border-left:0}
        .bk-ctrl .seg.bk-src button.on{background:#0a3d62;color:#fff}
        .bk-ctrl .seg.bk-dim button.on{background:var(--active-bg);color:var(--red)}
        .bk-ctrl .seg.bk-gb button.on{background:#0a3d62;color:#fff}
        .bk-ctrl.bk-sub{margin-top:-4px}
        .bk-bars{display:flex;flex-direction:column;gap:2px}
        /* 반반 배치 — 좌 월별추이 / 우 유형별분석 */
        .sl-grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px;align-items:start}
        @media(max-width:980px){.sl-grid2{grid-template-columns:1fr}}
        .sl-grid2 .sl-trend{margin-top:0}
        .bk-row{grid-template-columns:92px 1fr 112px!important;margin:7px 0}
        .bk-row .lbl{min-width:0}
        .bk-row .lbl .bk-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .bk-row .sl-amt small{font-size:10px}
        .cf-months{display:flex;flex-wrap:wrap;gap:8px}
        .cf-mchip{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:700;color:var(--ink-2);background:var(--panel-2);border:1px solid var(--line-2);border-radius:9px;padding:5px 11px}
        .cf-mchip button{border:0;background:transparent;color:var(--muted);cursor:pointer;font-size:13px;line-height:1;padding:0 2px;border-radius:5px}
        .cf-mchip button:hover{background:#fdecea;color:#c0392b}
        /* 사무적 탭 — 절제된 세그먼트 컨트롤 */
        #slTabs{display:inline-flex;gap:0;background:var(--panel-2);border:1px solid var(--line-2);border-radius:9px;padding:3px;margin-top:10px}
        #slTabs .t{border:0;background:transparent;padding:7px 15px;font-size:12.5px;font-weight:700;color:var(--muted);cursor:pointer;border-radius:7px;transition:background .12s,color .12s}
        #slTabs .t.on{background:var(--panel);color:var(--red);box-shadow:var(--sh-sm)}
      </style>
      <div class="mhead">
        <div class="tt">매출 데이터</div>
        <div class="ds">내부(발주/후불) 매출과 CAFE24 매출통계를 기간·유형별로 집계합니다.</div>
        <div class="mtabs" id="slTabs"><div class="t on" data-t="internal">발주/후불 매출 데이터</div><div class="t" data-t="cafe24">전체 매출</div></div>
      </div>
      <div class="mbody wide" id="slBody"><div class="muted" style="padding:18px">불러오는 중…</div></div>
      <div class="mbody wide" id="slCafe" style="display:none"></div>`;
      const body=root.querySelector('#slBody');
      const cafeHost=root.querySelector('#slCafe');
      let cafeLoaded=false;
      root.querySelectorAll('#slTabs .t').forEach(t=>t.onclick=()=>{ const k=t.dataset.t;
        root.querySelectorAll('#slTabs .t').forEach(x=>x.classList.toggle('on',x===t));
        body.style.display=k==='internal'?'':'none'; cafeHost.style.display=k==='cafe24'?'':'none';
        if(k==='cafe24' && !cafeLoaded){ cafeLoaded=true; renderCafe24(cafeHost); } });

      function barRows(agg){
        const max=Math.max(1,...agg.groups.map(g=>agg.by[g.k]?agg.by[g.k].amount:0));
        return agg.groups.map(g=>{ const d=agg.by[g.k]||{amount:0,count:0};
          return `<div class="sl-row"><div class="lbl"><span class="dot" style="background:${g.c}"></span>${g.k}</div>
            <div class="sl-bar"><i style="width:${Math.max(d.amount?4:0,Math.round(d.amount/max*100))}%;background:${g.c}"></i></div>
            <div class="sl-amt">${won(d.amount)}<small>원 · ${d.count}건</small></div></div>`; }).join('');
      }

      // 월별 추이 — CS(파랑)/MD(보라) 그룹 막대 · 값축 눈금 + 상단 최댓값
      function trendChart(months, csT, mdT){
        const W=680,H=190,padL=10,padR=10,padT=22,padB=30; const n=months.length||1;
        const max=Math.max(1,...csT,...mdT);
        const slot=(W-padL-padR)/n, bw=Math.min(22,Math.max(6,slot/3));
        const yBase=H-padB, ih=H-padT-padB;
        const hOf=v=>ih*(v/max);
        let bars='',labels='',hits=''; const csPts=[], mdPts=[];
        const showEvery=Math.ceil(n/12);
        months.forEach((m,i)=>{ const cx=padL+slot*i+slot/2;
          const csY=yBase-hOf(csT[i]), mdY=yBase-hOf(mdT[i]);
          bars+=`<rect x="${(cx-bw-2).toFixed(1)}" y="${csY.toFixed(1)}" width="${bw}" height="${hOf(csT[i]).toFixed(1)}" rx="3" fill="${CS_COLOR}" opacity="0.82"/>`;
          bars+=`<rect x="${(cx+2).toFixed(1)}" y="${mdY.toFixed(1)}" width="${bw}" height="${hOf(mdT[i]).toFixed(1)}" rx="3" fill="${MD_COLOR}" opacity="0.82"/>`;
          csPts.push([cx-2-bw/2,csY]); mdPts.push([cx+2+bw/2,mdY]);
          hits+=`<rect x="${(padL+slot*i).toFixed(1)}" y="${(padT-6).toFixed(1)}" width="${slot.toFixed(1)}" height="${(yBase-padT+6).toFixed(1)}" fill="transparent" pointer-events="all" data-tip="${esc(m+'\nCS '+won(csT[i])+'원 · MD '+won(mdT[i])+'원\n합계 '+won(csT[i]+mdT[i])+'원')}"></rect>`;
          if(i%showEvery===0) labels+=`<text x="${cx.toFixed(1)}" y="${H-9}" text-anchor="middle" font-size="10.5" fill="var(--muted)">${esc(m.slice(2))}</text>`;
        });
        const gy=yBase-ih*0.5;
        // 각 계열의 막대 꼭짓점을 잇는 추세선 + 점
        const lineOf=(pts,c)=> (n>1?`<polyline fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(p=>`${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}"/>`:'')
          + pts.map(p=>`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="#fff" stroke="${c}" stroke-width="1.8"/>`).join('');
        const trend=lineOf(csPts,'#123a6b')+lineOf(mdPts,'#4a2f9e');
        return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" width="100%" style="height:auto;font-family:inherit" xmlns="http://www.w3.org/2000/svg">
          <text x="${padL}" y="14" font-size="10.5" fill="var(--muted)">최대 ${won(max)}원</text>
          <line x1="${padL}" y1="${gy}" x2="${W-padR}" y2="${gy}" stroke="var(--line)" stroke-dasharray="3 3"/>
          <line x1="${padL}" y1="${yBase}" x2="${W-padR}" y2="${yBase}" stroke="var(--line)"/>${bars}${trend}${labels}${hits}</svg>
          <div class="sl-legend"><span><i style="background:${CS_COLOR}"></i>CS 견적/발주/후불</span><span><i style="background:${MD_COLOR}"></i>MD 입점사 발주</span></div>`;
      }

      // ── 유형별 분석 — 발주/후불 매출·입점사 매입을 선택 축으로 분해 ──
      const BK_PALETTE=['#1f6feb','#7a5af8','#12886a','#c9781a','#d24d86','#0e7d9c','#6a8f1a','#b0295a','#4457c9','#5b6b7f','#e0567f','#2f9e6f','#8a6d3b'];
      // 축 정의 [id, 라벨, 값 후보키(보드별 필드명 차이 흡수)] — cs.postpay 담당자=agent, 고객유형=custType 등
      const bkDims=()=> bkSrc==='cs'
        ? [['custType','고객유형',['custType','customerType']],['route','주문경로',['route']],['agent','담당자',['agent','whoName','who']]]
        : [['vendor','입점사',['vendor']],['settle','정산구분',['settle']],['agent','담당자',['whoName','who','handler']]];
      const bkKeys=()=>{ const d=bkDims().find(x=>x[0]===bkDim); return d?d[2]:[bkDim]; };
      const pick=(r,keys)=>{ for(const k of keys){ const v=r[k]; if(v!=null && String(v).trim()) return String(v).trim(); } return '(미지정)'; };
      function breakdown(recs, keys){ const by={};
        (recs||[]).forEach(r=>{ const k=pick(r,keys); const amt=parseNum(r.amount);
          const o=by[k]=by[k]||{amount:0,count:0}; o.amount+=amt; o.count++; });
        return Object.keys(by).map(k=>({k,amount:by[k].amount,count:by[k].count})).sort((a,b)=>b.amount-a.amount); }
      function renderBreakCard(){ const host=body.querySelector('#slBreakCard'); if(!host) return;
        let src = bkSrc==='cs' ? _csAll.filter(r=>r.gubun==='발주'||r.gubun==='견적'||r.gubun==='후불') : _mdAll.slice();
        if(bkSrc==='cs' && bkGubun!=='all') src=src.filter(r=>r.gubun===bkGubun);
        let rows=breakdown(src, bkKeys());
        if(rows.length>12){ const tail=rows.slice(12); const etc=tail.reduce((o,r)=>({amount:o.amount+r.amount,count:o.count+r.count}),{amount:0,count:0});
          rows=rows.slice(0,12).concat([{k:'기타 '+tail.length+'종',amount:etc.amount,count:etc.count}]); }
        const total=rows.reduce((s,r)=>s+r.amount,0), maxA=Math.max(1,...rows.map(r=>r.amount));
        const dimLabel=(bkDims().find(d=>d[0]===bkDim)||['',''])[1];
        host.innerHTML=`
          <div class="bk-ctrl">
            <span class="seg bk-src">${[['cs','CS 견적/발주/후불'],['md','MD 입점사 발주']].map(([v,l])=>`<button data-src="${v}" class="${bkSrc===v?'on':''}">${l}</button>`).join('')}</span>
            <span class="seg bk-dim">${bkDims().map(([v,l])=>`<button data-dim="${v}" class="${bkDim===v?'on':''}">${l}</button>`).join('')}</span></div>
          <div class="bk-ctrl bk-sub">
            ${bkSrc==='cs'?`<span class="muted" style="font-size:11.5px">구분</span><span class="seg bk-gb">${[['all','전체'],['발주','발주'],['견적','견적'],['후불','후불']].map(([v,l])=>`<button data-gb="${v}" class="${bkGubun===v?'on':''}">${l}</button>`).join('')}</span>`:''}
            <span class="tot" style="margin-left:auto;font-size:12px;color:var(--muted)"><b style="color:var(--ink)">${esc(dimLabel)}별</b> 합계 <b style="color:var(--ink)">${won(total)}원</b></span></div>
          ${rows.length?`<div class="bk-bars">${rows.map((r,i)=>{ const c=BK_PALETTE[i%BK_PALETTE.length]; const pct=Math.max(r.amount?3:0,Math.round(r.amount/maxA*100));
            return `<div class="sl-row bk-row"><div class="lbl" title="${esc(r.k)}"><span class="dot" style="background:${c}"></span><span class="bk-nm">${esc(r.k)}</span></div>
              <div class="sl-bar"><i style="width:${pct}%;background:${c}"></i></div>
              <div class="sl-amt">${won(r.amount)}<small> · ${r.count}건</small></div></div>`; }).join('')}</div>`
            :'<div class="sl-empty">이 기간·기준의 데이터가 없습니다.</div>'}`;
        host.querySelectorAll('.bk-src button').forEach(b=>b.onclick=()=>{ if(bkSrc===b.dataset.src) return; bkSrc=b.dataset.src; bkDim=bkDims()[0][0]; renderBreakCard(); });
        host.querySelectorAll('.bk-dim button').forEach(b=>b.onclick=()=>{ bkDim=b.dataset.dim; renderBreakCard(); });
        host.querySelectorAll('.bk-gb button').forEach(b=>b.onclick=()=>{ bkGubun=b.dataset.gb; renderBreakCard(); });
      }

      async function load(){
        body.innerHTML=`<div class="muted" style="padding:18px">불러오는 중…</div>`;
        // from/to 를 일(day) 경계로 정규화 — 프리셋(월)은 월 시작~말일, 직접설정은 선택 일자 그대로
        const fromDay = from.length>7 ? from : from+'-01';
        const toDay   = to.length>7 ? to : lastDay(to);
        const months=rangeMonths(from.slice(0,7), to.slice(0,7));
        const [csPacks, mdPacks]=await Promise.all([
          Promise.all(months.map(m=>monthRecs('cs','postpay',m))),
          Promise.all(months.map(m=>monthRecs('md','orders',m))),
        ]);
        if(!root.isConnected) return;
        const inRange=r=>{ const d=dayOf(r); return d && d>=fromDay && d<=toDay; };   // 선택 기간(일 단위) 필터
        const csAll=csPacks.flat().filter(inRange), mdAll=mdPacks.flat().filter(inRange);
        _csAll=csAll; _mdAll=mdAll;   // 유형별 분석 카드가 재조회 없이 축만 바꿔 다시 그림
        // 월별 추이용 — 필터된 레코드를 월로 재분류
        const csByM={}, mdByM={}; months.forEach(m=>{ csByM[m]=[]; mdByM[m]=[]; });
        csAll.forEach(r=>{ const m=dayOf(r).slice(0,7); if(csByM[m]) csByM[m].push(r); });
        mdAll.forEach(r=>{ const m=dayOf(r).slice(0,7); if(mdByM[m]) mdByM[m].push(r); });
        const csAgg=aggregate(csAll,'cs'), mdAgg=aggregate(mdAll,'md');
        // CS 매출 합계 = 발주 + 후불만 (견적은 견적서 단계라 합계 제외 · 아래 구분 행에는 그대로 표시)
        const csSalesOf=a=>(a.by['발주']?a.by['발주'].amount:0)+(a.by['후불']?a.by['후불'].amount:0);
        const csSales=csSalesOf(csAgg);
        const csT=months.map(m=>csSalesOf(aggregate(csByM[m],'cs'))), mdT=months.map(m=>aggregate(mdByM[m],'md').total);
        const rangeLabel = preset==='custom'
          ? (fromDay===toDay?fromDay:`${fromDay} ~ ${toDay}`)
          : (from===to?from:`${from} ~ ${to} · ${months.length}개월`);

        body.innerHTML=`
          <div class="sl-period">
            <div class="seg">${PRESETS.map(([p,l])=>`<button data-p="${p}" class="${preset===p?'on':''}">${l}</button>`).join('')}</div>
            ${preset==='custom'?`<span class="rng"><input type="date" id="slFrom" value="${esc(fromDay)}"> ~ <input type="date" id="slTo" value="${esc(toDay)}"></span>`:''}
            <span class="tot">${esc(rangeLabel)} · 매출 <b>${won(csSales)}원</b>
              <span class="muted" style="font-weight:600">(매입 ${won(mdAgg.total)}원 별도)</span></span>
            <button class="btn ghost sm" id="slAudit" style="margin-left:8px">${icon('search')||''}누락 점검</button>
          </div>
          <div id="slAuditBox"></div>
          <div class="sl-grid">
            <div class="sl-card cs"><div class="hd"><h3>${icon('truck')} 발주/후불 매출</h3>
              <div class="sub">CS 견적/발주/후불에 <b>수기 입력</b>한 건 중 구분이 '발주'·'후불' · ${csAll.length}건</div><div class="tot">${won(csSales)}<small> 원</small></div></div>
              <div class="bd">${csAgg.total||csAll.length?barRows(csAgg):'<div class="sl-empty">이 기간의 기록이 없습니다.</div>'}</div></div>
            <div class="sl-card md"><div class="hd"><h3>${icon('box')} 입점사 발주 매입</h3>
              <div class="sub">MD 입점사 발주의 <b>매입 원가</b>(입고단가×수량) · 매출 아님 · ${mdAll.length}건</div><div class="tot">${won(mdAgg.total)}<small> 원</small></div></div>
              <div class="bd">${mdAgg.total||mdAll.length?barRows(mdAgg):'<div class="sl-empty">이 기간의 기록이 없습니다.</div>'}</div></div>
          </div>
          <div class="sl-grid2">
            <div class="sl-trend"><h3>${icon('chart')} 월별 매출 추이</h3><div class="sub">${esc(rangeLabel)} · 파랑=CS · 보라=MD</div>
              ${trendChart(months,csT,mdT)}</div>
            <div class="sl-trend"><h3>${icon('grid')} 유형별 분석</h3>
              <div class="sub">${esc(rangeLabel)} · CS 견적/발주/후불 · MD 입점사 발주를 고객유형·입점사 등으로 분해</div>
              <div id="slBreakCard"></div></div>
          </div>
          <div class="sl-note">※ 상단 매출 카드의 CS 합계는 <b>발주+후불</b>만 집계합니다(견적 제외). <b>유형별 분석</b>은 CS 견적/발주/후불을 <b>구분 필터</b>로 골라 고객유형(초·중·고·대·기관·개인·업체·입점사·파트너사)·경로·담당자로, MD는 입점사·정산구분·담당자로 분해합니다. 입점사 발주 '매입'은 발주(입고)금액 기준입니다.</div>`;
        renderBreakCard();
        attachChartTips(body);

        body.querySelectorAll('.sl-period .seg button').forEach(b=>b.onclick=()=>{ preset=b.dataset.p;
          if(preset!=='custom'){ [from,to]=presetRange(preset,cym); } else { from=cym+'-01'; to=cday; }   // 직접설정 초기값: 이번 달 1일 ~ 오늘
          load(); });
        const fEl=body.querySelector('#slFrom'), tEl=body.querySelector('#slTo');
        if(fEl) fEl.onchange=()=>{ from=fEl.value||from; if(from>to) to=from; load(); };
        if(tEl) tEl.onchange=()=>{ to=tEl.value||to; if(to<from) from=to; load(); };
        const auditBtn=body.querySelector('#slAudit');
        if(auditBtn) auditBtn.onclick=()=>runAudit(body.querySelector('#slAuditBox'), fromDay, toDay, months, csAll);
      }

      /* ───────────────── 매출 누락 점검 ─────────────────
         "합계가 실제와 안 맞는다"는 상황에서, 어떤 건이 왜 빠졌는지 찾아 준다.
         ① 매출에 안 잡히는 구분(견적·개인결제·결제요청·기타) 금액
         ② 금액칸에 글자가 있는데 숫자로 못 읽은 건
         ③ 접수일자는 기간 안인데 귀속일이 달라 다른 달로 넘어간 건 ← 조회 자체가 안 되던 건
         ④ 금액 상위 건 (눈으로 대조용) */
      async function runAudit(box, fromDay, toDay, months, csIn){
        if(!box) return;
        box.innerHTML=`<div class="sl-audit"><div class="muted">점검 중… (앞뒤 달까지 훑는 중)</div></div>`;
        // 귀속일이 어긋나 다른 달 버킷에 들어간 건을 찾기 위해 앞뒤 2개월을 더 읽는다
        const wide=[...new Set([addMonth(months[0],-2), addMonth(months[0],-1), ...months,
          addMonth(months[months.length-1],1), addMonth(months[months.length-1],2)])];
        const packs=await Promise.all(wide.map(m=>monthRecs('cs','postpay',m)));
        const all=packs.flat();
        const rdOf=r=>String(r.rdate||'').slice(0,10);
        const inRangeBy=(d)=>d && d>=fromDay && d<=toDay;

        const SALES=['발주','후불'];
        const excluded={}, badAmt=[], dayGap=[];
        csIn.forEach(r=>{
          const g=String(r.gubun||'').trim()||'(빈칸)';
          if(SALES.indexOf(g)<0){ const o=excluded[g]=excluded[g]||{amount:0,count:0,rows:[]};
            o.amount+=parseNum(r.amount); o.count++; if(o.rows.length<5) o.rows.push(r); }
          const raw=String(r.amount==null?'':r.amount).trim();
          if(raw && !parseNum(r.amount)) badAmt.push(r);              // 글자는 있는데 0원으로 읽힘
        });
        all.forEach(r=>{
          const rd=rdOf(r), dy=dayOf(r);
          if(rd && inRangeBy(rd) && !inRangeBy(dy)) dayGap.push(r);   // 접수일은 기간 안, 귀속일은 밖
        });
        const exRows=Object.keys(excluded).map(k=>({k,...excluded[k]})).sort((a,b)=>b.amount-a.amount);
        const exTotal=exRows.reduce((t,x)=>t+x.amount,0);
        const gapTotal=dayGap.reduce((t,r)=>t+parseNum(r.amount),0);
        const top=csIn.slice().sort((a,b)=>parseNum(b.amount)-parseNum(a.amount)).slice(0,10);
        const line=r=>`${esc(dayOf(r))} · ${esc(r.gubun||'-')} · ${esc(r.vendor||r.name||'-')} · ${esc(String(r.content||'').slice(0,26))} · <b>${won(parseNum(r.amount))}원</b>`;

        box.innerHTML=`<div class="sl-audit">
          <div class="au-hd">${icon('search')||''} 누락 점검 · ${esc(fromDay)} ~ ${esc(toDay)}
            <span class="muted" style="font-weight:600;font-size:11.5px">— CS 견적/발주/후불 <b>수기 입력분만</b> 점검(카페24 업로드분·MD 발주는 대상 아님)</span>
            <button class="btn ghost sm" id="auCsv" style="margin-left:auto">${icon('download')||''}의심 건 CSV</button>
            <button class="btn ghost sm" id="auClose">닫기</button></div>

          <div class="au-sec">① 매출 합계에 <b>안 잡히는 구분</b> — 합계 <b class="hi">${won(exTotal)}원</b> · ${exRows.reduce((t,x)=>t+x.count,0)}건
            <div class="au-d">매출 카드는 <b>발주 + 후불</b>만 더합니다. 아래 구분으로 입력된 건은 금액이 있어도 합계에서 빠집니다.</div>
            ${exRows.length?`<table class="au-t"><thead><tr><th>구분</th><th class="n">건수</th><th class="n">금액</th><th>예시</th></tr></thead><tbody>
              ${exRows.map(x=>`<tr><td><b>${esc(x.k)}</b></td><td class="n">${x.count}건</td><td class="n">${won(x.amount)}원</td>
                <td class="ex">${x.rows.map(r=>esc(String(r.content||r.vendor||'').slice(0,18))).join(' / ')||'-'}</td></tr>`).join('')}
              </tbody></table>`:'<div class="au-ok">해당 없음</div>'}</div>

          <div class="au-sec">② <b>금액을 숫자로 읽지 못한 건</b> — ${badAmt.length}건
            <div class="au-d">금액칸에 글자가 들어가 0원으로 계산된 건입니다(예: "견적서 참조", "협의", "120만").</div>
            ${badAmt.length?`<ul class="au-l">${badAmt.slice(0,20).map(r=>`<li>${esc(dayOf(r))} · ${esc(r.gubun||'-')} · ${esc(r.vendor||r.name||'-')} · 입력값 "<b>${esc(String(r.amount))}</b>"</li>`).join('')}
              ${badAmt.length>20?`<li class="muted">… 외 ${badAmt.length-20}건</li>`:''}</ul>`:'<div class="au-ok">해당 없음</div>'}</div>

          <div class="au-sec">③ <b>접수일은 이 기간인데 다른 달로 잡힌 건</b> — ${dayGap.length}건 · <b class="hi">${won(gapTotal)}원</b>
            <div class="au-d">접수일자를 비운 채 저장했거나 나중에 접수일만 고친 건입니다. 이 건들은 <b>이 기간 조회에서 아예 빠집니다.</b>
              해당 건의 <b>접수일자를 다시 저장</b>하면(견적/발주/후불 화면에서 수정 → 저장) 제자리로 돌아갑니다.</div>
            ${dayGap.length?`<ul class="au-l">${dayGap.slice(0,20).map(r=>`<li>접수 ${esc(rdOf(r))} → 귀속 <b>${esc(dayOf(r))}</b> · ${esc(r.gubun||'-')} · ${esc(r.vendor||r.name||'-')} · <b>${won(parseNum(r.amount))}원</b></li>`).join('')}
              ${dayGap.length>20?`<li class="muted">… 외 ${dayGap.length-20}건</li>`:''}</ul>`:'<div class="au-ok">해당 없음</div>'}</div>

          <div class="au-sec">④ 이 기간 <b>금액 상위 10건</b> <span class="au-d" style="display:inline">— 실제 장부와 눈으로 대조해 보세요</span>
            ${top.length?`<ul class="au-l">${top.map(r=>`<li>${line(r)}</li>`).join('')}</ul>`:'<div class="au-ok">기록 없음</div>'}</div>
        </div>`;
        box.querySelector('#auClose').onclick=()=>{ box.innerHTML=''; };
        box.querySelector('#auCsv').onclick=()=>{
          const rows=[['유형','접수일자','귀속일','구분','거래처','이름','내용','금액(입력값)','금액(인식값)']];
          exRows.forEach(x=>x.rows.forEach(r=>rows.push(['매출제외구분',r.rdate||'',dayOf(r),r.gubun||'',r.vendor||'',r.name||'',r.content||'',String(r.amount||''),parseNum(r.amount)])));
          badAmt.forEach(r=>rows.push(['금액인식실패',r.rdate||'',dayOf(r),r.gubun||'',r.vendor||'',r.name||'',r.content||'',String(r.amount||''),parseNum(r.amount)]));
          dayGap.forEach(r=>rows.push(['귀속일불일치',r.rdate||'',dayOf(r),r.gubun||'',r.vendor||'',r.name||'',r.content||'',String(r.amount||''),parseNum(r.amount)]));
          const csv='\ufeff'+rows.map(a=>a.map(v=>`"${String(v==null?'':v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
          downloadBlob(new Blob([csv],{type:'text/csv;charset=utf-8'}), `매출점검_${fromDay}_${toDay}.csv`);
        };
      }

      /* ================= CAFE24 매출통계 탭 ================= */
      function renderCafe24(host){
        const st={preset:'all', dim:'ch', docs:[], from:'', to:''};
        const CF_PRESETS=[['all','전체'],['m12','최근 12개월'],['m6','최근 6개월'],['m3','최근 3개월'],['m1','최신 월'],['custom','직접설정']];
        const inPreset=(ym,months)=>{ if(!months.length) return false; const last=months[months.length-1];
          if(st.preset==='all') return true; if(st.preset==='m1') return ym===last;
          if(st.preset==='custom'){ const f=st.from||months[0], t=st.to||last; return ym>=f && ym<=t; }
          const back={m3:-2,m6:-5,m12:-11}[st.preset]; return back!=null ? ym>=addMonth(last,back) : true; };
        const mergeDims=sel=>{ const out={ch:{},sup:{},prod:{},cust:{}};
          sel.forEach(d=>['ch','sup','prod','cust'].forEach(K=>{ const m=(d.dims&&d.dims[K])||{}; Object.keys(m).forEach(k=>{ const o=out[K][k]=out[K][k]||{amount:0,count:0}; o.amount+=m[k].amount||0; o.count+=m[k].count||0; }); })); return out; };
        function cfTrend(months, vals){ if(!months.length) return '<div class="sl-empty">표시할 월이 없습니다.</div>';
          const W=680,H=190,padL=10,padR=10,padT=22,padB=30,n=months.length,max=Math.max(1,...vals);
          const slot=(W-padL-padR)/n, bw=Math.min(30,Math.max(8,slot*0.5)), yBase=H-padB, ih=H-padT-padB; let bars='',labels='',hits=''; const showEvery=Math.ceil(n/12);
          const pts=[]; // 막대 위 꼭짓점(선그래프용)
          months.forEach((m,i)=>{ const cx=padL+slot*i+slot/2, h=ih*(vals[i]/max); const ty=yBase-h;
            bars+=`<rect x="${(cx-bw/2).toFixed(1)}" y="${ty.toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" rx="3" fill="${CS_COLOR}" opacity="0.82"/>`;
            pts.push([cx,ty]);
            hits+=`<rect x="${(padL+slot*i).toFixed(1)}" y="${(padT-6).toFixed(1)}" width="${slot.toFixed(1)}" height="${(yBase-padT+6).toFixed(1)}" fill="transparent" pointer-events="all" data-tip="${esc(m+'\n'+won(vals[i])+'원')}"></rect>`;
            if(i%showEvery===0) labels+=`<text x="${cx.toFixed(1)}" y="${H-9}" text-anchor="middle" font-size="10.5" fill="var(--muted)">${esc(m.slice(2))}</text>`; });
          const gy=yBase-ih*0.5;
          // 막대 꼭짓점을 잇는 선 + 데이터 포인트(점) — 추세를 선그래프로 함께 표시
          const line = n>1 ? `<polyline fill="none" stroke="#123a6b" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(p=>`${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}"/>` : '';
          const dots = pts.map(p=>`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.4" fill="#fff" stroke="#123a6b" stroke-width="2"/>`).join('');
          return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" width="100%" style="height:auto"><text x="${padL}" y="14" font-size="10.5" fill="var(--muted)">최대 ${won(max)}원</text>
            <line x1="${padL}" y1="${gy}" x2="${W-padR}" y2="${gy}" stroke="var(--line)" stroke-dasharray="3 3"/>
            <line x1="${padL}" y1="${yBase}" x2="${W-padR}" y2="${yBase}" stroke="var(--line)"/>${bars}${line}${dots}${labels}${hits}</svg>`; }
        function emptyHtml(){ return `<div class="sl-empty" style="padding:40px">${icon('upload')}<div style="margin:10px 0 14px">아직 업로드된 CAFE24 매출이 없습니다.</div>
          <button class="btn pri" id="cfUpEmpty">${icon('upload')} CSV 업로드</button>
          <div class="muted" style="font-size:12px;margin-top:12px">CAFE24 매출 CSV(판매처명·공급처명·상품코드·합계금액·수령자주소)를 월별로 올리세요.</div></div>`; }
        function draw(){ const docs=st.docs;
          if(!docs.length){ host.innerHTML=emptyHtml(); wire(); return; }
          const months=docs.map(d=>d.ym); const last=months[months.length-1]; const sel=docs.filter(d=>inPreset(d.ym,months));
          const total=sel.reduce((s,d)=>s+(d.total||0),0), cnt=sel.reduce((s,d)=>s+(d.count||0),0);
          const dims=mergeDims(sel); const dimMap=dims[st.dim]||{};
          let rows=Object.keys(dimMap).map(k=>({k,amount:dimMap[k].amount,count:dimMap[k].count})).sort((a,b)=>b.amount-a.amount);
          if(rows.length>12){ const tail=rows.slice(12); const etc=tail.reduce((o,r)=>({amount:o.amount+r.amount,count:o.count+r.count}),{amount:0,count:0}); rows=rows.slice(0,12).concat([{k:'기타 '+tail.length+'종',amount:etc.amount,count:etc.count}]); }
          const maxA=Math.max(1,...rows.map(r=>r.amount)); const dimLabel=(CAFE_DIMS.find(d=>d[0]===st.dim)||['',''])[1];
          host.innerHTML=`
            <div class="sl-period">
              <div class="seg">${CF_PRESETS.map(([p,l])=>`<button data-cp="${p}" class="${st.preset===p?'on':''}">${l}</button>`).join('')}</div>
              ${st.preset==='custom'?`<span class="rng"><input type="month" id="cfFrom" value="${esc(st.from||months[0]||'')}" min="${esc(months[0]||'')}" max="${esc(last||'')}"> ~ <input type="month" id="cfTo" value="${esc(st.to||last||'')}" min="${esc(months[0]||'')}" max="${esc(last||'')}"></span>`:''}
              <span class="tot">업로드 <b>${docs.length}</b>개월 · 표시 <b>${sel.length}</b>개월</span>
              <button class="btn pri sm" id="cfUp" style="margin-left:8px">${icon('upload')} CSV 업로드</button></div>
            <div class="sl-grid" style="grid-template-columns:1fr 1fr 1fr">
              <div class="sl-card" style="--ac:#1f6feb"><div class="hd"><h3>${icon('chart')} 총 매출</h3><div class="sub">CAFE24 · ${sel.length}개월</div><div class="tot">${won(total)}<small> 원</small></div></div></div>
              <div class="sl-card" style="--ac:#12886a"><div class="hd"><h3>${icon('box')} 주문 건수</h3><div class="sub">라인 수</div><div class="tot">${won(cnt)}<small> 건</small></div></div></div>
              <div class="sl-card" style="--ac:#7a5af8"><div class="hd"><h3>${icon('check2')} 업로드 월</h3><div class="sub">최신 ${esc(months[months.length-1]||'-')}</div><div class="tot">${docs.length}<small> 개월</small></div></div></div>
            </div>
            <div class="sl-grid2">
              <div class="sl-trend"><h3>${icon('chart')} 월별 매출 추이</h3><div class="sub">CAFE24 · 업로드된 월</div>${cfTrend(sel.map(d=>d.ym),sel.map(d=>d.total||0))}</div>
              <div class="sl-trend"><h3>${icon('grid')} 유형별 분석</h3><div class="sub">판매처·공급처·상품분류·고객유형(주소)</div>
                <div class="bk-ctrl"><span class="seg bk-dim">${CAFE_DIMS.map(([v,l])=>`<button data-cd="${v}" class="${st.dim===v?'on':''}">${l}</button>`).join('')}</span>
                  <span class="tot" style="margin-left:auto;font-size:12px;color:var(--muted)"><b style="color:var(--ink)">${esc(dimLabel)}별</b> 합계 <b style="color:var(--ink)">${won(rows.reduce((s,r)=>s+r.amount,0))}원</b></span></div>
                ${rows.length?`<div class="bk-bars">${rows.map((r,i)=>{ const c=BK_PALETTE[i%BK_PALETTE.length]; const pct=Math.max(r.amount?3:0,Math.round(r.amount/maxA*100));
                  return `<div class="sl-row bk-row"><div class="lbl" title="${esc(r.k)}"><span class="dot" style="background:${c}"></span><span class="bk-nm">${esc(r.k)}</span></div>
                    <div class="sl-bar"><i style="width:${pct}%;background:${c}"></i></div><div class="sl-amt">${won(r.amount)}<small> · ${r.count}건</small></div></div>`; }).join('')}</div>`
                  :'<div class="sl-empty">데이터가 없습니다.</div>'}</div>
            </div>
            <div class="sl-trend" style="margin-top:16px"><h3>${icon('clipboard')} 업로드 월 관리</h3>
              <div class="cf-months" style="margin-top:8px">${docs.slice().reverse().map(d=>`<span class="cf-mchip" title="${esc([d.file?'파일: '+d.file:'', d.uploadedBy?'올린 사람: '+d.uploadedBy:'', d.uploadedAt?'올린 시각: '+String(d.uploadedAt).slice(0,16).replace('T',' '):''].filter(Boolean).join('\n'))}">
                  <b>${esc(d.ym)}</b> · ${won(d.total||0)}원 · ${d.count||0}건
                  ${(d.file||d.uploadedBy)?`<span class="muted" style="font-weight:600;font-size:11px">${esc(String(d.file||'').slice(0,22))}${d.uploadedBy?` · ${esc(d.uploadedBy)}`:''}</span>`:''}
                  <button data-del="${esc(d.id)}" title="삭제">✕</button></span>`).join('')}</div></div>
            <div class="sl-note">※ 분류 — 판매처: 후불·쿠팡·기업(기타발주)·파트너사(샘활코딩/아이스크림/엔티렉스)·카페24·스마트스토어 / 공급처: 자사·입점사 / 상품: A~E 자사부품·F,G,H,J 자사키트·S 자사과학키트·P 입점사 / 고객유형: 주소의 초·중·고·대, 그 외 개인·기업.</div>`;
          wire();
          attachChartTips(host);
        }
        function wire(){
          host.querySelectorAll('[data-cp]').forEach(b=>b.onclick=()=>{ st.preset=b.dataset.cp;
            if(st.preset==='custom'){ const ms=st.docs.map(d=>d.ym); if(!st.from) st.from=ms[0]||''; if(!st.to) st.to=ms[ms.length-1]||''; } draw(); });
          host.querySelectorAll('[data-cd]').forEach(b=>b.onclick=()=>{ st.dim=b.dataset.cd; draw(); });
          const cf=host.querySelector('#cfFrom'), ct=host.querySelector('#cfTo');
          if(cf) cf.onchange=()=>{ st.from=cf.value||st.from; if(st.from>st.to) st.to=st.from; draw(); };
          if(ct) ct.onchange=()=>{ st.to=ct.value||st.to; if(st.to<st.from) st.from=st.to; draw(); };
          const up=host.querySelector('#cfUp')||host.querySelector('#cfUpEmpty'); if(up) up.onclick=openUpload;
          host.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{ if(!confirm('이 달 CAFE24 매출을 삭제할까요?')) return; await cafeDel(b.dataset.del); await loadC(); });
        }
        function openUpload(){ let parsed=null, fname='';
          const ov=el('div','modal-ov'); ov.style.cssText='position:fixed;inset:0;background:rgba(16,24,40,.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px';
          ov.innerHTML=`<div style="background:var(--panel);border:1px solid var(--line);border-radius:16px;max-width:520px;width:97%;box-shadow:var(--sh-lg)">
            <div style="padding:16px 20px 10px;border-bottom:1px solid var(--line)"><div style="font-size:16px;font-weight:800">${icon('upload')} CAFE24 월별 CSV 업로드</div>
              <div class="muted" style="font-size:12px;margin-top:3px">CAFE24 주문 내역을 <b>엑셀(.xlsx/.xls) 또는 CSV</b>로 내려받아 올리세요 · 판매처·금액 열 자동 인식</div></div>
            <div style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">
              <input type="file" id="cfFile" accept=".csv,.xlsx,.xls,.tsv,.txt,text/csv">
              <div id="cfDup" style="margin-top:10px"></div>
              <label class="fld">대상 월<input type="month" id="cfYm"></label>
              <div id="cfPrev" class="muted" style="font-size:12.5px;line-height:1.6"></div></div>
            <div style="display:flex;gap:8px;justify-content:flex-end;padding:12px 20px;border-top:1px solid var(--line)">
              <button class="btn ghost" id="cfCancel">취소</button><button class="btn pri" id="cfSave" disabled>저장</button></div></div>`;
          document.body.appendChild(ov); const close=()=>ov.remove(); ov.onclick=e=>{ if(e.target===ov) close(); }; ov.querySelector('#cfCancel').onclick=close;
          const prev=ov.querySelector('#cfPrev'), save=ov.querySelector('#cfSave'), ymEl=ov.querySelector('#cfYm');
          ov.querySelector('#cfFile').onchange=async e=>{ const f=e.target.files[0]; if(!f) return; fname=f.name;
            const guess=ymFromName(f.name); if(guess) ymEl.value=guess;
            prev.innerHTML='<span class="muted">파일 읽는 중…</span>'; save.disabled=true;
            let rows=[], how='';
            try{
              const buf=await f.arrayBuffer(), u8=new Uint8Array(buf);
              const isZip = u8[0]===0x50&&u8[1]===0x4B;                                  // .xlsx
              const isOle = u8[0]===0xD0&&u8[1]===0xCF&&u8[2]===0x11&&u8[3]===0xE0;      // 구형 .xls
              if(isZip && window.XlsxLite){ rows=((await XlsxLite.parseSheets(f))[0]||{}).rows||[]; how='엑셀(xlsx)'; }
              else if(isOle && window.XlsLite){ rows=((await XlsLite.parseSheets(buf))[0]||{}).rows||[]; how='엑셀(xls)'; }
              else {
                let txt=''; try{ txt=new TextDecoder('euc-kr').decode(u8); }catch(_){ txt=''; }
                if(!txt || /\uFFFD/.test(txt.slice(0,300))){ try{ txt=new TextDecoder('utf-8').decode(u8); }catch(__){} }
                if(/<t(able|r)[\s>]/i.test(txt.slice(0,3000))){ rows=cafeHtmlRows(txt); how='엑셀(HTML 표)'; }
                else { rows=cafeTextRows(txt); how='CSV/텍스트'; }
              }
            }catch(err){ rows=[]; }
            parsed = rows.length ? parseCafeSheet(rows) : { err:'파일을 읽지 못했습니다. 엑셀(.xlsx/.xls) 또는 CSV로 내려받아 올려주세요.' };
            if(!parsed||parsed.err){
              const hs=(parsed&&parsed.headers)||[];
              prev.innerHTML=`<span style="color:var(--danger);font-weight:700">${esc((parsed&&parsed.err)||'파싱 실패')}</span>
                ${how?`<div class="muted" style="font-size:11.5px;margin-top:5px">읽은 형식: ${esc(how)} · ${rows.length}줄</div>`:''}
                ${hs.length?`<div class="muted" style="font-size:11.5px;margin-top:5px;line-height:1.6">이 파일에서 읽은 열 이름: <b>${hs.slice(0,14).map(h=>esc(h||'(빈칸)')).join(' · ')}</b>${hs.length>14?` 외 ${hs.length-14}개`:''}</div>`:''}
                <div class="muted" style="font-size:11.5px;margin-top:5px;line-height:1.6">카페24 <b>주문 내역(주문 리스트)</b>을 내려받아 올려주세요.
                  일별·월별 <b>매출 통계 리포트</b>에는 판매처·금액 열이 없어 집계할 수 없습니다.</div>`;
              save.disabled=true; return; }
            const top=Object.entries(parsed.dims.ch).sort((x,y)=>y[1].amount-x[1].amount).slice(0,5).map(([k,v])=>`${esc(k)} ${won(v.amount)}`).join(' · ');
            const u=parsed.used||{};
            const zero=!parsed.total;
            prev.innerHTML=`총 <b style="color:${zero?'var(--danger)':'var(--ink)'}">${won(parsed.total)}원</b> · ${parsed.count}건
              <span class="muted" style="font-size:11.5px">(${esc(how)})</span><br><span class="muted">판매처: ${top||'-'}</span>
              <div class="muted" style="font-size:11.5px;margin-top:6px">인식한 열 — 금액 <b>${esc(u['금액']||'')}</b>${u['판매처']?` · 판매처 <b>${esc(u['판매처'])}</b>`:''}${u['공급처']?` · 공급처 <b>${esc(u['공급처'])}</b>`:''}${u['상품']?` · 상품 <b>${esc(u['상품'])}</b>`:''}</div>
              ${zero?`<div style="font-size:11.5px;margin-top:6px;color:var(--danger);font-weight:700;line-height:1.6">합계가 0원입니다 — <b>금액 열을 잘못 잡았을 수 있습니다.</b><br>
                     첫 줄의 '${esc(u['금액']||'')}' 값: "<b>${esc(parsed.sample||'(빈칸)')}</b>"<br>
                     이 파일의 열: ${(parsed.headers||[]).slice(0,14).map(h=>esc(h||'(빈칸)')).join(' · ')}</div>`
                   :`<div class="muted" style="font-size:11.5px;margin-top:5px">금액이 실제와 맞는지 확인한 뒤 저장하세요.</div>`}
              ${!u['판매처']?`<div style="font-size:11.5px;margin-top:5px;color:var(--warn);font-weight:700">※ 판매처 열이 없어 총액만 집계됩니다(판매처별 분석 불가).</div>`:''}`;
            save.disabled=zero; };
          const warnDup=()=>{ const ym=ymEl.value; const prevDoc=(st.docs||[]).find(d=>d.ym===ym);
            const box=ov.querySelector('#cfDup'); if(!box) return;
            box.innerHTML = prevDoc
              ? `<div style="font-size:12px;font-weight:700;color:var(--warn);background:var(--warn-bg);border-radius:8px;padding:9px 11px;line-height:1.6">
                   ${icon('alert')||''} <b>${esc(ym)}</b>에는 이미 올린 자료가 있습니다 —
                   ${esc(prevDoc.file||'(파일명 없음)')} · ${won(prevDoc.total||0)}원${prevDoc.uploadedBy?` · ${esc(prevDoc.uploadedBy)}`:''}<br>
                   저장하면 <b>기존 자료를 덮어씁니다.</b> 한 달에 여러 출처(카페24·셀메이트 등)를 따로 보관할 수는 없습니다.</div>`
              : ''; };
          ymEl.onchange=warnDup; warnDup();
          save.onclick=async()=>{ if(!parsed||parsed.err) return; const ym=ymEl.value; if(!ym){ toast('대상 월을 선택하세요'); return; }
            const prevDoc=(st.docs||[]).find(d=>d.ym===ym);
            if(prevDoc && !confirm(`${ym}에 이미 올린 자료(${prevDoc.file||'파일명 없음'} · ${won(prevDoc.total||0)}원)를 덮어씁니다. 계속할까요?`)) return;
            save.disabled=true; save.textContent='저장 중…'; const me=(Auth.user&&Auth.user())||{};
            const doc={ id:'cafe24:'+ym, ym, uploadedAt:new Date().toISOString(), uploadedBy:me.name||me.loginId||'', file:fname, total:parsed.total, count:parsed.count, dims:parsed.dims };
            const ok=await cafePush(doc); if(ok){ toast(`${ym} CAFE24 매출 저장됨`); close(); await loadC(); } else { toast('저장 실패'); save.disabled=false; save.textContent='저장'; } };
        }
        async function loadC(){ const items=await cafeGet(); if(!host.isConnected) return; st.docs=(items||[]).filter(d=>d&&d.ym).sort((a,b)=>String(a.ym).localeCompare(String(b.ym))); draw(); }
        loadC();
      }

      load();
    }
  };
})();
