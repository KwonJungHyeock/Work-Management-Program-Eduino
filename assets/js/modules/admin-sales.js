/* ===========================================================================
   [관리자] 매출 데이터 — 월 단위 집계 + 그래프
   - CS 견적/발주/후불(sheet cs/postpay): 구분(견적·발주·후불)별 금액 합계
   - MD 입점사 발주(sheet md/orders): 정산구분(선결제·월정산)별 발주금액 합계
   - 월 선택 + 최근 6개월 추이 그래프. (모두 서버 시트 기록 기반)
   ========================================================================= */
(function(){
  const won = n => Number(n||0).toLocaleString();
  const parseNum = v => Number(String(v==null?'':v).replace(/[^\d.-]/g,''))||0;
  const pad = n => String(n).padStart(2,'0');
  const ymOf = d => d.getFullYear()+'-'+pad(d.getMonth()+1);
  const addMonth = (ym,delta)=>{ const [y,m]=ym.split('-').map(Number); return ymOf(new Date(y,(m-1)+delta,1)); };
  const lastMonths = (ym,n)=>{ const a=[]; for(let i=n-1;i>=0;i--) a.push(addMonth(ym,-i)); return a; };
  const monthRecs = async (dept,sheet,ym)=>{ try{ return (window.Records&&Records.month)?((await Records.month(dept,sheet,ym))||[]):[]; }catch(e){ return []; } };

  // 정산구분 옛 표기 정규화 (원/월 → 월정산, 선 → 선결제)
  const normSettle = s=>{ s=String(s||'').trim(); if(s==='원'||s==='월'||s==='월정산') return '월정산'; if(s==='선'||s==='선결제') return '선결제'; return s||'기타'; };

  const CS_GROUPS=[{k:'견적',c:'#1f6feb'},{k:'발주',c:'#1a9d5a'},{k:'후불',c:'#e8833a'},{k:'기타',c:'#8a94a6'}];
  const MD_GROUPS=[{k:'선결제',c:'#7a5af8'},{k:'월정산',c:'#12a5a5'},{k:'기타',c:'#8a94a6'}];

  // CS 구분 → 그룹 매핑 (견적/발주/후불은 그대로, 결제요청/기타 등은 '기타')
  const csGroup = g=>{ g=String(g||'').trim(); return (g==='견적'||g==='발주'||g==='후불')?g:'기타'; };

  function aggregate(recs, kind){
    // returns { total, byGroup:{k:{amount,count}}, groups:[...] }
    const groups = kind==='cs'?CS_GROUPS:MD_GROUPS;
    const by={}; groups.forEach(g=>by[g.k]={amount:0,count:0});
    let total=0;
    recs.forEach(r=>{
      const amt = parseNum(r.amount);
      const key = kind==='cs'?csGroup(r.gubun):normSettle(r.settle);
      if(!by[key]) by[key]={amount:0,count:0};
      by[key].amount+=amt; by[key].count++; total+=amt;
    });
    return { total, by, groups };
  }

  MODULES['admin.sales']={
    title:'매출 데이터', icon:'chart',
    render(root){
      let ym = ymOf(new Date());
      root.innerHTML=`
      <style>
        .sl-nav{display:flex;align-items:center;gap:10px;margin-bottom:18px}
        .sl-nav .m{font-size:18px;font-weight:800;min-width:120px;text-align:center}
        .sl-nav button{border:1px solid var(--line-2);background:var(--panel);border-radius:9px;width:36px;height:36px;font-size:16px;cursor:pointer;color:var(--ink-2)}
        .sl-nav button:hover{background:var(--panel-2)}
        .sl-nav .today{width:auto;padding:0 12px;font-size:13px;font-weight:700}
        .sl-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        @media(max-width:820px){.sl-grid{grid-template-columns:1fr}}
        .sl-card{border:1px solid var(--line);border-radius:14px;background:var(--panel);box-shadow:var(--sh-sm);padding:18px 20px}
        .sl-card h3{margin:0 0 2px;font-size:15px;font-weight:800;display:flex;align-items:center;gap:8px}
        .sl-card .sub{font-size:12px;color:var(--muted);margin-bottom:14px}
        .sl-total{font-size:27px;font-weight:800;color:var(--ink);margin-bottom:2px}
        .sl-total small{font-size:14px;color:var(--muted);font-weight:700}
        .sl-row{display:grid;grid-template-columns:66px 1fr 120px;gap:10px;align-items:center;margin:9px 0;font-size:13px}
        .sl-row .lbl{font-weight:700;color:var(--ink-2)}
        .sl-bar{height:12px;background:var(--zebra);border-radius:7px;overflow:hidden}
        .sl-bar i{display:block;height:100%;border-radius:7px}
        .sl-amt{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}
        .sl-amt small{color:var(--muted);font-weight:600;font-size:11px}
        .sl-trend{margin-top:16px}
        .sl-legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--ink-2);margin-top:8px}
        .sl-legend span{display:inline-flex;align-items:center;gap:5px}
        .sl-legend i{width:11px;height:11px;border-radius:3px;display:inline-block}
        .sl-empty{padding:26px;text-align:center;color:var(--muted);font-size:13px}
      </style>
      <div class="mhead">
        <div class="tt">매출 데이터</div>
        <div class="ds">견적/발주/후불(구분별)·입점사 발주(정산구분별) 매출을 월 단위로 집계합니다.</div>
      </div>
      <div class="mbody wide" id="slBody"><div class="muted" style="padding:18px">불러오는 중…</div></div>`;
      const body=root.querySelector('#slBody');

      function barRows(agg){
        const max=Math.max(1,...agg.groups.map(g=>agg.by[g.k]?agg.by[g.k].amount:0));
        return agg.groups.map(g=>{ const d=agg.by[g.k]||{amount:0,count:0};
          return `<div class="sl-row"><div class="lbl">${g.k}</div>
            <div class="sl-bar"><i style="width:${Math.max(d.amount?3:0,Math.round(d.amount/max*100))}%;background:${g.c}"></i></div>
            <div class="sl-amt">${won(d.amount)}<small>원 · ${d.count}건</small></div></div>`; }).join('');
      }

      // 최근 6개월 추이 (총액) — CS/MD 두 계열 막대
      function trendChart(months, csT, mdT){
        const W=520,H=170,padL=6,padR=6,padT=14,padB=26; const n=months.length;
        const max=Math.max(1,...csT,...mdT);
        const slot=(W-padL-padR)/n, bw=Math.min(20,slot/3);
        const y=v=>padT+(H-padT-padB)*(1-v/max);
        let bars='',labels='';
        months.forEach((m,i)=>{ const cx=padL+slot*i+slot/2;
          const cH=(H-padT-padB)*(csT[i]/max), mH=(H-padT-padB)*(mdT[i]/max);
          bars+=`<rect x="${cx-bw-2}" y="${y(csT[i])}" width="${bw}" height="${cH}" rx="3" fill="#1f6feb"/>`;
          bars+=`<rect x="${cx+2}" y="${y(mdT[i])}" width="${bw}" height="${mH}" rx="3" fill="#7a5af8"/>`;
          labels+=`<text x="${cx}" y="${H-9}" text-anchor="middle" font-size="10.5" fill="var(--muted)">${esc(m.slice(2))}</text>`;
        });
        return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="height:auto;font-family:inherit" xmlns="http://www.w3.org/2000/svg">
          <line x1="${padL}" y1="${H-padB}" x2="${W-padR}" y2="${H-padB}" stroke="var(--line)"/>${bars}${labels}</svg>
          <div class="sl-legend"><span><i style="background:#1f6feb"></i>CS 견적/발주/후불</span><span><i style="background:#7a5af8"></i>MD 입점사 발주</span></div>`;
      }

      async function load(){
        body.innerHTML=`<div class="muted" style="padding:18px">불러오는 중…</div>`;
        const months=lastMonths(ym,6);
        // 6개월치 두 시트 조회 (선택월 상세는 마지막 달)
        const [csPacks, mdPacks]=await Promise.all([
          Promise.all(months.map(m=>monthRecs('cs','postpay',m))),
          Promise.all(months.map(m=>monthRecs('md','orders',m))),
        ]);
        if(!root.isConnected) return;
        const idx=months.indexOf(ym);
        const csAgg=aggregate(csPacks[idx]||[],'cs');
        const mdAgg=aggregate(mdPacks[idx]||[],'md');
        const csT=csPacks.map(p=>aggregate(p||[],'cs').total);
        const mdT=mdPacks.map(p=>aggregate(p||[],'md').total);
        const csCount=(csPacks[idx]||[]).length, mdCount=(mdPacks[idx]||[]).length;

        body.innerHTML=`
          <div class="sl-nav">
            <button id="slPrev" title="이전 달">‹</button>
            <div class="m">${esc(ym)}</div>
            <button id="slNext" title="다음 달">›</button>
            <button class="today" id="slToday">이번 달</button>
            <div class="muted" style="margin-left:auto;font-size:12.5px">합계 <b style="color:var(--ink)">${won(csAgg.total+mdAgg.total)}원</b></div>
          </div>
          <div class="sl-grid">
            <div class="sl-card">
              <h3>${icon('truck')} 견적/발주/후불 매출</h3><div class="sub">CS · 구분별 · ${csCount}건</div>
              <div class="sl-total">${won(csAgg.total)}<small> 원</small></div>
              ${csAgg.total||csCount?barRows(csAgg):'<div class="sl-empty">이 달의 기록이 없습니다.</div>'}
            </div>
            <div class="sl-card">
              <h3>${icon('box')} 입점사 발주 매출</h3><div class="sub">MD · 정산구분별(발주금액 기준) · ${mdCount}건</div>
              <div class="sl-total">${won(mdAgg.total)}<small> 원</small></div>
              ${mdAgg.total||mdCount?barRows(mdAgg):'<div class="sl-empty">이 달의 기록이 없습니다.</div>'}
            </div>
          </div>
          <div class="sl-card sl-trend">
            <h3>${icon('chart')} 최근 6개월 매출 추이</h3><div class="sub">월별 총액 (CS · MD)</div>
            ${trendChart(months,csT,mdT)}
          </div>
          <div class="muted" style="font-size:11.5px;margin-top:12px">※ 입점사 발주 '매출'은 발주(입고)금액 기준(수량×입고단가)입니다. CS 매출은 견적/발주/후불 기록의 '금액' 합계입니다.</div>`;

        body.querySelector('#slPrev').onclick=()=>{ ym=addMonth(ym,-1); load(); };
        body.querySelector('#slNext').onclick=()=>{ ym=addMonth(ym,1); load(); };
        body.querySelector('#slToday').onclick=()=>{ ym=ymOf(new Date()); load(); };
      }
      load();
    }
  };
})();
