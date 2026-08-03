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

  MODULES['admin.sales']={
    title:'매출 데이터', icon:'chart',
    render(root){
      const now=new Date(); const cym=ymOf(now); const cday=cym+'-'+pad(now.getDate());
      let preset='m1', from=cym, to=cym;   // 프리셋: YYYY-MM · 직접설정(custom): YYYY-MM-DD
      // 유형별 분석 상태 — 소스(CS 발주/후불 · MD 매입) × 분석 축 · 기간 필터된 데이터 캐시
      let bkSrc='cs', bkDim='custType', _csAll=[], _mdAll=[];
      root.innerHTML=`
      <style>
        .sl-period{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:16px}
        .sl-period .seg{display:inline-flex;border:1px solid var(--line-2);border-radius:9px;overflow:hidden}
        .sl-period .seg button{border:0;background:var(--panel);padding:8px 13px;font-size:12.5px;font-weight:700;color:var(--muted);cursor:pointer;border-left:1px solid var(--line-2)}
        .sl-period .seg button:first-child{border-left:0}
        .sl-period .seg button.on{background:var(--active-bg);color:var(--red)}
        .sl-period input[type=month],.sl-period input[type=date]{font:inherit;font-size:12.5px;border:1px solid var(--line-2);border-radius:8px;padding:6px 9px}
        .sl-period .rng{display:flex;align-items:center;gap:6px}
        .sl-period .tot{margin-left:auto;font-size:12.5px;color:var(--muted)} .sl-period .tot b{color:var(--ink)}
        .sl-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        @media(max-width:820px){.sl-grid{grid-template-columns:1fr}}
        .sl-card{border:1px solid var(--line);border-radius:14px;background:var(--panel);box-shadow:var(--sh-sm);overflow:hidden}
        .sl-card .hd{padding:14px 18px 12px;color:#fff}
        .sl-card.cs .hd{background:linear-gradient(135deg,#1a5fd0,#3f8bff)}
        .sl-card.md .hd{background:linear-gradient(135deg,#6b4be6,#9578ff)}
        .sl-card .hd h3{margin:0;font-size:14.5px;font-weight:800;display:flex;align-items:center;gap:8px}
        .sl-card .hd .sub{font-size:11.5px;opacity:.9;margin-top:3px}
        .sl-card .hd .tot{font-size:26px;font-weight:800;margin-top:8px}.sl-card .hd .tot small{font-size:13px;opacity:.85;font-weight:700}
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
        .bk-bars{display:flex;flex-direction:column;gap:2px}
      </style>
      <div class="mhead">
        <div class="tt">매출 데이터</div>
        <div class="ds">견적/발주/후불(구분별) 매출 · 입점사 발주(정산구분별) 매입을 기간별로 집계합니다.</div>
      </div>
      <div class="mbody wide" id="slBody"><div class="muted" style="padding:18px">불러오는 중…</div></div>`;
      const body=root.querySelector('#slBody');

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
        let bars='',labels='';
        const showEvery=Math.ceil(n/12);
        months.forEach((m,i)=>{ const cx=padL+slot*i+slot/2;
          bars+=`<rect x="${(cx-bw-2).toFixed(1)}" y="${(yBase-hOf(csT[i])).toFixed(1)}" width="${bw}" height="${hOf(csT[i]).toFixed(1)}" rx="3" fill="${CS_COLOR}"/>`;
          bars+=`<rect x="${(cx+2).toFixed(1)}" y="${(yBase-hOf(mdT[i])).toFixed(1)}" width="${bw}" height="${hOf(mdT[i]).toFixed(1)}" rx="3" fill="${MD_COLOR}"/>`;
          if(i%showEvery===0) labels+=`<text x="${cx.toFixed(1)}" y="${H-9}" text-anchor="middle" font-size="10.5" fill="var(--muted)">${esc(m.slice(2))}</text>`;
        });
        const gy=yBase-ih*0.5;
        return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="height:auto;font-family:inherit" xmlns="http://www.w3.org/2000/svg">
          <text x="${padL}" y="14" font-size="10.5" fill="var(--muted)">최대 ${won(max)}원</text>
          <line x1="${padL}" y1="${gy}" x2="${W-padR}" y2="${gy}" stroke="var(--line)" stroke-dasharray="3 3"/>
          <line x1="${padL}" y1="${yBase}" x2="${W-padR}" y2="${yBase}" stroke="var(--line)"/>${bars}${labels}</svg>
          <div class="sl-legend"><span><i style="background:${CS_COLOR}"></i>CS 견적/발주/후불</span><span><i style="background:${MD_COLOR}"></i>MD 입점사 발주</span></div>`;
      }

      // ── 유형별 분석 — 발주/후불 매출·입점사 매입을 선택 축으로 분해 ──
      const BK_PALETTE=['#1f6feb','#7a5af8','#12886a','#c9781a','#d24d86','#0e7d9c','#6a8f1a','#b0295a','#4457c9','#5b6b7f','#e0567f','#2f9e6f','#8a6d3b'];
      // 축 정의 [id, 라벨, 값 후보키(보드별 필드명 차이 흡수)] — cs.postpay 담당자=agent, 고객유형=custType 등
      const bkDims=()=> bkSrc==='cs'
        ? [['custType','고객유형',['custType','customerType']],['route','주문경로',['route']],['agent','담당자',['agent','whoName','who']],['gubun','구분',['gubun']]]
        : [['settle','정산구분',['settle']],['gubun','구분',['gubun']],['whoName','담당자',['whoName','who','handler']],['vendor','입점사',['vendor']]];
      const bkKeys=()=>{ const d=bkDims().find(x=>x[0]===bkDim); return d?d[2]:[bkDim]; };
      const pick=(r,keys)=>{ for(const k of keys){ const v=r[k]; if(v!=null && String(v).trim()) return String(v).trim(); } return '(미지정)'; };
      function breakdown(recs, keys){ const by={};
        (recs||[]).forEach(r=>{ const k=pick(r,keys); const amt=parseNum(r.amount);
          const o=by[k]=by[k]||{amount:0,count:0}; o.amount+=amt; o.count++; });
        return Object.keys(by).map(k=>({k,amount:by[k].amount,count:by[k].count})).sort((a,b)=>b.amount-a.amount); }
      function renderBreakCard(){ const host=body.querySelector('#slBreakCard'); if(!host) return;
        const src = bkSrc==='cs' ? _csAll.filter(r=>r.gubun==='발주'||r.gubun==='후불') : _mdAll;
        let rows=breakdown(src, bkKeys());
        if(rows.length>12){ const tail=rows.slice(12); const etc=tail.reduce((o,r)=>({amount:o.amount+r.amount,count:o.count+r.count}),{amount:0,count:0});
          rows=rows.slice(0,12).concat([{k:'기타 '+tail.length+'종',amount:etc.amount,count:etc.count}]); }
        const total=rows.reduce((s,r)=>s+r.amount,0), maxA=Math.max(1,...rows.map(r=>r.amount));
        const dimLabel=(bkDims().find(d=>d[0]===bkDim)||['',''])[1];
        const srcLabel=bkSrc==='cs'?'발주+후불 매출':'입점사 발주 매입';
        host.innerHTML=`
          <div class="bk-ctrl">
            <span class="seg bk-src">${[['cs','CS 발주/후불'],['md','MD 입점사 발주']].map(([v,l])=>`<button data-src="${v}" class="${bkSrc===v?'on':''}">${l}</button>`).join('')}</span>
            <span class="seg bk-dim">${bkDims().map(([v,l])=>`<button data-dim="${v}" class="${bkDim===v?'on':''}">${l}</button>`).join('')}</span>
            <span class="tot" style="margin-left:auto;font-size:12.5px;color:var(--muted)">${esc(srcLabel)} · <b style="color:var(--ink)">${esc(dimLabel)}별</b> 합계 <b style="color:var(--ink)">${won(total)}원</b></span></div>
          ${rows.length?`<div class="bk-bars">${rows.map((r,i)=>{ const c=BK_PALETTE[i%BK_PALETTE.length];
            return `<div class="sl-row" style="grid-template-columns:110px 1fr 150px"><div class="lbl"><span class="dot" style="background:${c}"></span>${esc(r.k)}</div>
              <div class="sl-bar"><i style="width:${Math.max(r.amount?4:0,Math.round(r.amount/maxA*100))}%;background:${c}"></i></div>
              <div class="sl-amt">${won(r.amount)}<small>원 · ${r.count}건</small></div></div>`; }).join('')}</div>`
            :'<div class="sl-empty">이 기간·기준의 데이터가 없습니다.</div>'}`;
        host.querySelectorAll('.bk-src button').forEach(b=>b.onclick=()=>{ if(bkSrc===b.dataset.src) return; bkSrc=b.dataset.src; bkDim=bkDims()[0][0]; renderBreakCard(); });
        host.querySelectorAll('.bk-dim button').forEach(b=>b.onclick=()=>{ bkDim=b.dataset.dim; renderBreakCard(); });
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
            <span class="tot">${esc(rangeLabel)} · 합계 <b>${won(csSales+mdAgg.total)}원</b></span>
          </div>
          <div class="sl-grid">
            <div class="sl-card cs"><div class="hd"><h3>${icon('truck')} 발주/후불 매출</h3>
              <div class="sub">CS · 발주+후불 합계 · ${csAll.length}건</div><div class="tot">${won(csSales)}<small> 원</small></div></div>
              <div class="bd">${csAgg.total||csAll.length?barRows(csAgg):'<div class="sl-empty">이 기간의 기록이 없습니다.</div>'}</div></div>
            <div class="sl-card md"><div class="hd"><h3>${icon('box')} 입점사 발주 매입</h3>
              <div class="sub">MD · 정산구분별(발주금액 기준) · ${mdAll.length}건</div><div class="tot">${won(mdAgg.total)}<small> 원</small></div></div>
              <div class="bd">${mdAgg.total||mdAll.length?barRows(mdAgg):'<div class="sl-empty">이 기간의 기록이 없습니다.</div>'}</div></div>
          </div>
          <div class="sl-trend"><h3>${icon('chart')} 월별 매출 추이</h3><div class="sub">${esc(rangeLabel)} · 파랑=CS · 보라=MD</div>
            ${trendChart(months,csT,mdT)}</div>
          <div class="sl-trend" style="margin-top:16px"><h3>${icon('grid')} 유형별 분석</h3>
            <div class="sub">${esc(rangeLabel)} · 발주/후불 매출·입점사 매입을 선택한 기준(고객유형·경로·담당자 등)으로 분해</div>
            <div id="slBreakCard"></div></div>
          <div class="sl-note">※ CS 매출 합계는 <b>발주+후불</b>만 집계합니다(견적은 견적서 단계라 합계 제외 · 구분 행에는 그대로 표시). 입점사 발주 '매입'은 발주(입고)금액 기준(수량×입고단가)입니다. 유형별 분석의 CS는 <b>발주+후불</b>만 대상입니다.</div>`;
        renderBreakCard();

        body.querySelectorAll('.sl-period .seg button').forEach(b=>b.onclick=()=>{ preset=b.dataset.p;
          if(preset!=='custom'){ [from,to]=presetRange(preset,cym); } else { from=cym+'-01'; to=cday; }   // 직접설정 초기값: 이번 달 1일 ~ 오늘
          load(); });
        const fEl=body.querySelector('#slFrom'), tEl=body.querySelector('#slTo');
        if(fEl) fEl.onchange=()=>{ from=fEl.value||from; if(from>to) to=from; load(); };
        if(tEl) tEl.onchange=()=>{ to=tEl.value||to; if(to<from) from=to; load(); };
      }
      load();
    }
  };
})();
