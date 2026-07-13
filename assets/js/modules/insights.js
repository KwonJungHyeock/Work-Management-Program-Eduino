/* ===========================================================================
   관리자 · 업무 현황(인사이트)  — 팀장 전용
   - 직원별(계정id–이름 연동) 일일 업무량을 리스트 + 그래프로 조회
   - 실제 직무 시트(상담/발주 기록)를 읽어 기간별 집계·추이·인사이트 자동 분석
     → 시트에서 기록을 삭제하면 집계에도 즉시 반영됨
   - CSV / 차트 PNG 로 저장(스냅샷)
   =========================================================================== */
(function(){
  const CHART={ cs:'#3b76e0', md:'#e8804a' };     // 데이터 시각화용(부서 구분) — UI 기본색과 분리
  const DLABEL={ cs:'CS', md:'MD' };
  const GEO={ W:560, H:220, padL:32, padB:26, padT:12, padR:12 };   // 선그래프 좌표계(그리기·툴팁 공용)
  const WD=['일','월','화','수','목','금','토'];
  const wdOf=day=>WD[new Date(day+'T00:00:00').getDay()];

  /* 날짜 유틸 (todayStr 는 전역) */
  const ymd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const addDays=(s,n)=>{ const d=new Date(s+'T00:00:00'); d.setDate(d.getDate()+n); return ymd(d); };
  const diffDays=(a,b)=>Math.round((new Date(b+'T00:00:00')-new Date(a+'T00:00:00'))/86400000);
  const listDays=(from,to)=>{ const out=[]; let c=from; let guard=0; while(c<=to&&guard++<400){ out.push(c); c=addDays(c,1); } return out; };
  const mdLabel=s=>s.slice(5).replace('-','/');
  const monthsBetween=(from,to)=>{ const out=[]; let y=Number(from.slice(0,4)), m=Number(from.slice(5,7));
    const ey=Number(to.slice(0,4)), em=Number(to.slice(5,7)); let g=0;
    while((y<ey||(y===ey&&m<=em))&&g++<60){ out.push(`${y}-${String(m).padStart(2,'0')}`); m++; if(m>12){m=1;y++;} } return out; };
  const SHEET_OF={ cs:'notes', md:'orders' };

  async function fetchRoster(){ try{ const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'roster'})}); const d=await r.json(); return (d&&d.roster)||[]; }catch(e){ return []; } }

  /* 시트 레코드 1건 → 인사이트 레코드(건수 1). 집계는 실제 시트가 기준이라 삭제도 즉시 반영됨 */
  function fromSheet(dept, r){
    const day=r.day||r.date; if(!day||!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    const who=r.who||('@'+(r.whoName||r.agent||'?'));
    const name=r.whoName||r.agent||(who[0]==='@'?who.slice(1):who);
    const rec={ dept, who, name, id:(who[0]==='@'?'':who), day, count:1 };
    if(dept==='cs'){ rec.category=(r.category||'').trim(); rec.customerType=(r.customerType||'').trim(); rec.route=(r.route||'').trim(); rec.callback=!!r.callback; }
    else { rec.route=(r.route||'').trim(); rec.vendor=(r.vendor||'').trim(); rec.settle=(r.settle||'').trim(); }
    return rec;
  }

  MODULES['admin.insights']={
    title:'업무 현황', icon:'chart',
    render(root){
      const meU=(Auth.user&&Auth.user())||{};
      const isAdminV=!!(Auth.isAdmin&&Auth.isAdmin());
      const leadDept=(meU.role==='lead'&&(meU.dept==='cs'||meU.dept==='md'))?meU.dept:null;
      const leadOnly = !isAdminV && !!leadDept;   // 파트장(비관리자) — 자기 부서만
      if(!isAdminV && !leadDept){
        root.innerHTML=`<div class="view"><div class="empty">${icon('shield')}<div style="font-size:14px">관리자(팀장) 또는 파트장만 접근할 수 있는 화면입니다.</div></div></div>`;
        return;
      }
      root.innerHTML=`
      <style>
        .iv-ctrl{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;margin-bottom:6px}
        .seg{display:inline-flex;border:1px solid var(--line-2);border-radius:9px;overflow:hidden}
        .seg button{border:0;background:var(--panel);padding:7px 14px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer;border-left:1px solid var(--line-2)}
        .seg button:first-child{border-left:0}
        .seg button.on{background:var(--active-bg);color:var(--red)}
        /* 기간 지정 입력은 별도 줄로 — 클릭 시 상단 탭이 밀리지 않도록 */
        .iv-dates{display:none;align-items:center;gap:8px;font-size:13px;color:var(--muted);margin:0 0 8px;
          background:var(--panel-2);border:1px solid var(--line);border-radius:9px;padding:8px 12px;width:fit-content}
        .iv-dates.on{display:flex}
        .iv-dates input{height:32px;border:1px solid var(--line-strong);border-radius:8px;padding:0 9px;font-size:13px;background:var(--panel)}
        .iv-sp{flex:1}
        .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(158px,1fr));gap:12px;margin:16px 0 22px}
        .kpi .kl svg{width:13px;height:13px;vertical-align:-2px;opacity:.65;margin-left:2px}
        .kpi.kpi-china:hover{border-color:color-mix(in srgb,var(--danger) 45%,var(--line));box-shadow:var(--sh-lg)}
        /* 요약 KPI — 좌측 바 클리셰 제거, 큰 숫자 + 강조 색 + 은은한 컬러 워시로 임팩트 강화 */
        .kpi{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:14px;
          background:linear-gradient(150deg,color-mix(in srgb,var(--kc,var(--d1)) 11%,var(--panel)),var(--panel) 56%);
          padding:18px 20px 17px;box-shadow:var(--sh)}
        .kpi .kl{font-size:12px;color:var(--muted);font-weight:800;letter-spacing:.01em}
        .kpi .kv{font-size:41px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.02;letter-spacing:-.035em;margin-top:11px;color:var(--ink)}
        .kpi .kv small{font-size:15px;font-weight:700;color:var(--muted);margin-left:4px;letter-spacing:0}
        .kpi .kd{font-size:12.5px;font-weight:700;margin-top:9px}
        .up{color:var(--ok)} .down{color:var(--danger)} .flat{color:var(--muted)}
        .iv-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:16px;align-items:start}
        @media(max-width:1000px){.iv-grid{grid-template-columns:1fr}}
        .emp-tbl{width:100%;border-collapse:collapse}
        .emp-tbl th,.emp-tbl td{padding:9px 10px;font-size:13.5px;border-bottom:1px solid var(--line)}
        .emp-tbl th{font-size:11.5px;font-weight:800;letter-spacing:.03em;color:var(--muted);text-align:left;text-transform:uppercase}
        .emp-tbl td.num{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}
        .emp-name{font-weight:700;color:var(--ink)}
        .emp-id{font-size:11.5px;color:var(--faint);font-family:var(--mono)}
        .dbadge{display:inline-block;font-size:10.5px;font-weight:800;padding:1px 6px;border-radius:5px;color:#fff}
        .bar-wrap{background:var(--zebra);border-radius:6px;height:9px;overflow:hidden;min-width:80px}
        .bar-in{height:100%;border-radius:6px}
        .iv-empty{padding:40px;text-align:center;color:var(--muted);font-size:14px}
        .iv-note{font-size:12px;color:var(--faint);margin-top:12px}
        .lgd{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);font-weight:600;margin-left:12px}
        .lgd i{width:10px;height:10px;border-radius:3px;display:inline-block}
        .kpi .kl .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:middle}
        .emp-tbl tr.grp td{background:var(--panel-2);padding-top:11px;padding-bottom:7px;border-bottom:1px solid var(--line-2)}
        .emp-tbl .gsum{color:var(--muted);font-size:12px;font-weight:700;margin-left:7px}
        /* 자동 인사이트 하이라이트 */
        .hl-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin:0 0 20px}
        .hl{display:flex;gap:11px;align-items:flex-start;border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:13px 14px;box-shadow:var(--sh-sm)}
        .hl .hi{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:18px;flex:0 0 auto}
        .hl .ht{font-size:13px;line-height:1.5;color:var(--ink-2)}
        .hl .ht b{color:var(--ink);font-weight:800}
        .hl.up .hi{background:var(--ok-bg,#e8f6ee)} .hl.down .hi{background:#fdecee} .hl.flat .hi{background:var(--panel-2)}
        /* 차트 hover 툴팁 */
        #trend{position:relative}
        .iv-tip{position:absolute;pointer-events:none;display:none;z-index:6;background:var(--panel);border:1px solid var(--line-2);
          border-radius:9px;box-shadow:0 8px 24px rgba(16,24,40,.18);padding:8px 11px;font-size:12px;min-width:128px}
        .iv-tip .tp-d{font-weight:800;color:var(--ink);margin-bottom:6px}
        .iv-tip .tp-row{display:flex;justify-content:space-between;gap:16px;line-height:1.75}
        .iv-tip .tp-row span{color:var(--muted);display:flex;align-items:center;gap:5px}
        .iv-tip .tp-row i{width:9px;height:9px;border-radius:2px;display:inline-block}
        .iv-tip .tp-row b{color:var(--ink);font-variant-numeric:tabular-nums;font-weight:800}
        .iv-tip .tp-tot{border-top:1px solid var(--line);margin-top:5px;padding-top:5px}
        #ivChart{cursor:crosshair}
        /* 분포 막대 */
        .dist-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
        @media(max-width:1000px){.dist-grid{grid-template-columns:1fr}}
        .dist-row{display:flex;align-items:center;gap:10px;padding:5px 0}
        .dist-k{width:112px;flex:none;font-size:13px;font-weight:600;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .dist-bar{flex:1;height:10px;background:var(--zebra);border-radius:6px;overflow:hidden}
        .dist-bar i{display:block;height:100%;border-radius:6px}
        .dist-v{width:66px;flex:none;text-align:right;font-size:12.5px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--ink)}
        .dist-v small{font-weight:600;color:var(--muted);margin-left:4px}
        /* 재미 포인트 */
        .fun-card{border:1px solid var(--line);border-radius:var(--r-lg);background:linear-gradient(180deg,var(--panel), var(--panel-2));box-shadow:var(--sh-sm);overflow:hidden}
        .fun-hd{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--line);font-weight:800;font-size:14.5px}
        .fun-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;padding:14px 16px}
        .fun{display:flex;align-items:center;gap:11px;padding:11px 13px;border:1px solid var(--line);border-radius:10px;background:var(--panel)}
        .fun .fe{font-size:22px;line-height:1;flex:none}
        .fun .fl{font-size:11px;color:var(--muted);font-weight:700;letter-spacing:.03em;text-transform:uppercase}
        .fun .fv{font-size:15px;font-weight:800;color:var(--ink);margin-top:2px;line-height:1.2}
        .iv-secttl{font-size:12px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin:20px 2px 10px}
        /* 심화 분석(기간 비교·입점사 성과) 표 */
        .cmp-tbl{width:100%;border-collapse:collapse}
        .cmp-tbl th,.cmp-tbl td{padding:9px 12px;font-size:13.5px;border-bottom:1px solid var(--line);text-align:left}
        .cmp-tbl th{font-size:11px;font-weight:800;letter-spacing:.03em;color:var(--muted);text-transform:uppercase;background:var(--panel-2)}
        .cmp-tbl td.num{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}
        .cmp-tbl td.emp-name{font-weight:700}
        .cmp-tbl tbody tr:last-child td{border-bottom:0}
        .cmp-tbl tr.tot td{background:var(--panel-2);font-weight:800}
        .cmp-tbl .up{color:var(--ok)} .cmp-tbl .down{color:var(--danger)} .cmp-tbl .flat{color:var(--muted)}
        /* 이상 탐지 하이라이트 강조 */
        .hl.warn{border-color:color-mix(in srgb,var(--warn) 45%,var(--line));background:var(--warn-bg)}
        .hl.warn .hi{background:color-mix(in srgb,var(--warn) 22%,transparent)}
        /* 중국 발주요청 분석 탭 */
        .cn-tblwrap{overflow-x:auto;border:1px solid var(--line);border-radius:11px;box-shadow:var(--sh-sm)}
        .cn-tbl{min-width:760px} .cn-tbl th{white-space:nowrap}
        .cn2{display:inline-block;font-size:11px;font-weight:800;border-radius:5px;padding:2px 7px;letter-spacing:.02em}
        .cn2.iq0{background:var(--ok-bg);color:var(--ok)} .cn2.iq1{background:var(--warn-bg);color:var(--warn)}
        .cn2.rq{background:var(--info-bg);color:var(--info)}
        .cn2.st-open{background:var(--danger-soft);color:var(--danger)} .cn2.st-done{background:var(--ok-bg);color:var(--ok)}
      </style>
      <div class="mhead pad">
        <div class="tt">업무 현황 · 인사이트</div>
        <div class="ds"><b>종합 / CS / MD / 중국발주</b> 탭으로 나눠 KPI·추이·직원별 실적과 <b>분포 분석</b>·<b>데이터 기반 추측</b>, 그리고 <b>중국 발주요청 현황·재고확보 필요</b>를 보여줍니다. 실제 저장 기록 기준(삭제 시 즉시 반영).</div>
      </div>
      <div class="mbody">
        <div class="iv-ctrl">
          <span class="seg" id="segRange">
            <button data-r="today">오늘</button><button data-r="7" class="on">7일</button>
            <button data-r="30">30일</button><button data-r="custom">지정</button></span>
          <span class="seg" id="segDept">
            <button data-d="all" class="on">종합</button><button data-d="cs">CS</button><button data-d="md">MD</button><button data-d="china">중국발주</button></span>
          <span class="iv-sp"></span>
          ${isAdminV?`<button class="btn ghost sm" id="btnCsv">${icon('download')}CSV</button>
          <button class="btn ghost sm" id="btnPng">${icon('image')}차트 PNG</button>`:''}
          <button class="btn ghost sm" id="btnPrint">${icon('sheet')}인쇄</button>
          <button class="btn ghost sm" id="btnReload">${icon('refresh')}</button>
        </div>
        <div class="iv-dates" id="dates"><span style="font-size:12px;font-weight:700">기간 지정</span>
          <input type="date" id="dFrom"> ~ <input type="date" id="dTo"></div>
        <div id="ivNormal">
          <div class="kpis" id="kpis"></div>
          <div class="hl-row" id="hl"></div>
          <div class="iv-grid">
            <div class="card"><div class="card-hd">${icon('chart')}<b>일자별 처리 추이</b>
              <span id="trendLgd" style="margin-left:auto"></span></div>
              <div class="card-bd" id="trend"></div></div>
            <div class="card"><div class="card-hd">${icon('users')}<b>직원별 업무량</b>
              <span class="muted" id="empCnt" style="margin-left:auto;font-size:12px"></span></div>
              <div class="card-bd" style="padding:0"><div id="emp"></div></div></div>
          </div>
          <div id="detail"></div>
          <p class="iv-note">※ CS는 선택된 상담사, MD는 로그인 계정 기준으로 집계됩니다. 계정 미매칭 이름은 ID가 빈칸으로 표시됩니다. 분포·재미 포인트는 실제 기록 필드 기반입니다.</p>
        </div>
        <div id="ivChina" style="display:none"></div>
      </div>`;

      const $=s=>root.querySelector(s);
      let records=[], roster=[], preset='7', dept=leadOnly?leadDept:'all', custom={from:todayStr(), to:todayStr()};
      let chinaStat={ open:0, total:0 };   // 중국 발주요청 처리대기/전체 (종합 KPI용)
      // 파트장은 자기 부서만 — 부서 전환 세그먼트 숨김 + 제목 조정
      if(leadOnly){ const sd=$('#segDept'); if(sd) sd.style.display='none';
        const tt=root.querySelector('.mhead .tt'); if(tt) tt.textContent=`우리 파트 현황 · ${DLABEL[leadDept]||''}`;
        const ds=root.querySelector('.mhead .ds'); if(ds) ds.textContent=`${DLABEL[leadDept]||''} 파트의 일일 업무량을 집계해 보여줍니다. 매 상담/발주 저장 시 서버에 누적됩니다.`; }

      function curRange(){
        const to=todayStr();
        if(preset==='today') return { from:to, to };
        if(preset==='7') return { from:addDays(to,-6), to };
        if(preset==='30') return { from:addDays(to,-29), to };
        return { from:custom.from<=custom.to?custom.from:custom.to, to:custom.from<=custom.to?custom.to:custom.from };
      }

      function aggregate(from,to){
        const inR=r=>(dept==='all'||r.dept===dept)&&r.day>=from&&r.day<=to;
        const rows=records.filter(inR);
        const perPerson={}, perDay={}; let total=0;
        rows.forEach(r=>{ const k=r.dept+'|'+r.who;
          (perPerson[k]=perPerson[k]||{dept:r.dept,who:r.who,name:r.name,id:r.id,count:0}).count+=r.count;
          const pd=perDay[r.day]=perDay[r.day]||{cs:0,md:0,total:0}; pd[r.dept]+=r.count; pd.total+=r.count;
          total+=r.count; });
        return { rows, perPerson, perDay, total };
      }

      function paint(){
        if(!root.isConnected || !$('#kpis')) return;   // 다른 화면으로 이동한 뒤의 지연 렌더 방지
        const isChina = dept==='china';
        $('#ivNormal').style.display = isChina?'none':'';
        $('#ivChina').style.display = isChina?'':'none';
        $('#segRange').style.visibility = isChina?'hidden':'';   // 중국발주 탭은 기간 무관(전체 누적)
        if($('#dates')) $('#dates').classList.toggle('on', !isChina && preset==='custom');
        if(isChina){ paintChina(); return; }
        const {from,to}=curRange();
        const days=listDays(from,to);
        const A=aggregate(from,to);
        const len=days.length; const pTo=addDays(from,-1), pFrom=addDays(pTo,-(len-1));
        const P=aggregate(pFrom,pTo);
        const allMode = dept==='all';

        const deptTotal=d=>days.reduce((s,day)=>s+((A.perDay[day]&&A.perDay[day][d])||0),0);
        const csTotal=deptTotal('cs'), mdTotal=deptTotal('md');
        let people=Object.values(A.perPerson).sort((a,b)=>b.count-a.count);
        const topOf=d=>people.filter(p=>p.dept===d)[0];
        const diff=A.total-P.total; const pct=P.total?Math.round(diff/P.total*100):(A.total?100:0);
        const dcls=diff>0?'up':diff<0?'down':'flat'; const darrow=diff>0?'▲':diff<0?'▼':'–';

        // --- KPI (전체=직무별 분리 / 단일=해당 직무) ---
        if(allMode){
          const ct=topOf('cs'), mt=topOf('md');
          $('#kpis').innerHTML=`
            <div class="kpi" style="--kc:var(--d1)"><div class="kl">총 처리 건수</div><div class="kv">${A.total.toLocaleString()}<small>건</small></div>
              <div class="kd ${dcls}">${darrow} 이전 동기간 대비 ${diff>=0?'+':''}${diff}건 (${pct>=0?'+':''}${pct}%)</div></div>
            <div class="kpi" style="--kc:${CHART.cs}"><div class="kl"><span class="dot" style="background:${CHART.cs}"></span>CS 일평균</div><div class="kv">${(csTotal/len).toFixed(1)}<small>건/일</small></div>
              <div class="kd flat">총 ${csTotal}건 · ${len}일</div></div>
            <div class="kpi" style="--kc:${CHART.md}"><div class="kl"><span class="dot" style="background:${CHART.md}"></span>MD 일평균</div><div class="kv">${(mdTotal/len).toFixed(1)}<small>건/일</small></div>
              <div class="kd flat">총 ${mdTotal}건 · ${len}일</div></div>
            <div class="kpi" style="--kc:var(--d4)"><div class="kl">최다 담당자 · 직무별</div>
              <div class="kd" style="margin-top:9px;font-size:13.5px;line-height:2">
                <span class="dbadge" style="background:${CHART.cs}">CS</span> ${ct?esc(ct.name)+' <b style="color:var(--ink)">'+ct.count+'</b>건':'—'}<br>
                <span class="dbadge" style="background:${CHART.md}">MD</span> ${mt?esc(mt.name)+' <b style="color:var(--ink)">'+mt.count+'</b>건':'—'}</div></div>
            <div class="kpi kpi-china" style="--kc:var(--danger);cursor:pointer" title="중국 발주요청 탭 열기">
              <div class="kl">중국발주 대기 ${icon('box')}</div><div class="kv">${chinaStat.open}<small>건</small></div>
              <div class="kd flat">전체 ${chinaStat.total}건 · 클릭 시 상세</div></div>`;
          const kc=$('#kpis').querySelector('.kpi-china');
          if(kc) kc.onclick=()=>{ dept='china'; $('#segDept').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x.dataset.d==='china')); paint(); };
        } else {
          const top=people[0];
          $('#kpis').innerHTML=`
            <div class="kpi" style="--kc:var(--d1)"><div class="kl">총 처리 건수</div><div class="kv">${A.total.toLocaleString()}<small>건</small></div>
              <div class="kd ${dcls}">${darrow} 이전 동기간 대비 ${diff>=0?'+':''}${diff}건 (${pct>=0?'+':''}${pct}%)</div></div>
            <div class="kpi" style="--kc:var(--d2)"><div class="kl">1일 평균</div><div class="kv">${(A.total/len).toFixed(1)}<small>건/일</small></div>
              <div class="kd flat">${len}일 · 활동 ${Object.keys(A.perDay).length}일</div></div>
            <div class="kpi" style="--kc:var(--d4)"><div class="kl">최다 담당자</div><div class="kv" style="font-size:22px">${top?esc(top.name):'—'}</div>
              <div class="kd flat">${top?top.count+'건':'데이터 없음'}</div></div>
            <div class="kpi" style="--kc:var(--d5)"><div class="kl">참여 인원</div><div class="kv">${people.length}<small>명</small></div>
              <div class="kd flat">${DLABEL[dept]||dept}</div></div>`;
        }

        // --- 자동 인사이트 하이라이트 (이상 탐지 우선 노출) ---
        const anomalies=detectAnomalies(A, P, dept);
        const hs=[...anomalies, ...buildHighlights(days, A.perDay, A, P, Object.values(A.perPerson), allMode)].slice(0,5);
        $('#hl').innerHTML = hs.length
          ? hs.map(h=>`<div class="hl ${h.tone}"><div class="hi">${h.icon}</div><div class="ht">${h.text}</div></div>`).join('')
          : `<div class="hl flat"><div class="hi">💡</div><div class="ht">데이터가 더 쌓이면 자동 인사이트가 여기에 표시됩니다.</div></div>`;

        // --- 추이 (선 그래프 · 전체는 CS/MD 2선) + hover 툴팁 ---
        const depts = allMode?['cs','md']:[dept];
        $('#trend').innerHTML=lineSVG(days, A.perDay, depts)+`<div class="iv-tip" id="ivTip"></div>`;
        wireChartHover(days, A.perDay, depts);
        $('#trendLgd').innerHTML = allMode
          ? `<span class="lgd"><i style="background:${CHART.cs}"></i>CS</span><span class="lgd"><i style="background:${CHART.md}"></i>MD</span>`
          : `<span class="lgd"><i style="background:${CHART[dept]||CHART.cs}"></i>${DLABEL[dept]||dept}</span>`;

        // --- 직원별 리스트 (전체=직무별로 구분) · 활동 0 인 로스터원 포함 ---
        const seen=new Set(people.map(p=>p.dept+'|'+p.who));
        roster.forEach(m=>{ if((allMode||m.dept===dept)&&!seen.has(m.dept+'|'+m.loginId)&&(m.dept==='cs'||m.dept==='md'))
          people.push({dept:m.dept,who:m.loginId,name:m.name,id:m.loginId,count:0}); });
        $('#empCnt').textContent=`${from} ~ ${to}`;
        const groups = allMode?['cs','md']:[dept];
        let html='<table class="emp-tbl"><thead><tr><th style="width:34px">#</th><th>담당자</th>'+
          '<th style="width:60px" class="num">건수</th><th style="width:40%">비중</th><th style="width:62px" class="num">일평균</th></tr></thead><tbody>';
        let any=false;
        groups.forEach(g=>{
          const gp=people.filter(p=>p.dept===g).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
          if(!gp.length) return;
          const gmax=Math.max(1,...gp.map(p=>p.count));
          if(allMode) html+=`<tr class="grp"><td></td><td colspan="4"><span class="dbadge" style="background:${CHART[g]}">${DLABEL[g]}</span><span class="gsum">${gp.reduce((s,p)=>s+p.count,0)}건 · ${gp.length}명</span></td></tr>`;
          gp.forEach((p,i)=>{ any=true; html+=`<tr>
            <td class="num" style="color:var(--faint)">${i+1}</td>
            <td><div class="emp-name">${esc(p.name)}</div><div class="emp-id">${p.id?esc(p.id):'계정 미연동'}</div></td>
            <td class="num">${p.count}</td>
            <td><div class="bar-wrap"><div class="bar-in" style="width:${Math.round(p.count/gmax*100)}%;background:${CHART[p.dept]}"></div></div></td>
            <td class="num" style="color:var(--muted)">${(p.count/len).toFixed(1)}</td></tr>`; });
        });
        html+='</tbody></table>';
        $('#emp').innerHTML = any? html : `<div class="iv-empty">해당 기간·부서의 업무 기록이 없습니다.</div>`;

        // --- 상세: 분포 분석 + 기간비교 + 교차 + 재미 포인트 (탭별) ---
        renderDetail(A, P, days, dept);
      }

      /* 필드별 분포 [{key,count}] · 상위 N + 기타 */
      function distByField(rows, field, topN){
        const m={}; rows.forEach(r=>{ const k=(r[field]||'').trim()||'(미지정)'; m[k]=(m[k]||0)+1; });
        let arr=Object.entries(m).map(([key,count])=>({key,count})).sort((a,b)=>b.count-a.count||a.key.localeCompare(b.key));
        if(topN && arr.length>topN){ const top=arr.slice(0,topN); const rest=arr.slice(topN).reduce((s,i)=>s+i.count,0); if(rest) top.push({key:'기타',count:rest}); arr=top; }
        return arr;
      }
      const PALETTE6=['var(--d1)','var(--d2)','var(--d3)','var(--d4)','var(--d5)','var(--d6)'];
      function distCard(title, items, iconName){
        const max=Math.max(1,...items.map(i=>i.count)); const total=items.reduce((s,i)=>s+i.count,0);
        return `<div class="card"><div class="card-hd">${icon(iconName||'grid')}<b>${esc(title)}</b><span class="muted" style="margin-left:auto;font-size:12px">${total.toLocaleString()}건</span></div>
          <div class="card-bd" style="padding:12px 16px 14px">${ items.length? items.map((it,i)=>`
            <div class="dist-row"><span class="dist-k" title="${esc(it.key)}">${esc(it.key)}</span>
              <span class="dist-bar"><i style="width:${Math.max(3,Math.round(it.count/max*100))}%;background:${PALETTE6[i%6]}"></i></span>
              <span class="dist-v">${it.count}<small>${Math.round(it.count/(total||1)*100)}%</small></span></div>`).join('')
            : '<div class="iv-empty" style="padding:18px">기록이 없습니다.</div>' }</div></div>`;
      }
      /* 데이터 기반 재미 포인트 + 추측 */
      function funFacts(A, days, deptSel){
        const facts=[]; const rows=A.rows||[];
        const byWd={}, wdCount={}; days.forEach(d=>{ const w=wdOf(d); byWd[w]=(byWd[w]||0)+((A.perDay[d]&&A.perDay[d].total)||0); wdCount[w]=(wdCount[w]||0)+1; });
        const wdArr=Object.keys(byWd).map(w=>({w,avg:byWd[w]/(wdCount[w]||1)})).sort((a,b)=>b.avg-a.avg);
        if(wdArr.length && wdArr[0].avg>0) facts.push({e:'📅',l:'가장 바쁜 요일',v:`${wdArr[0].w}요일`});
        const top=Object.values(A.perPerson).sort((a,b)=>b.count-a.count)[0];
        if(top&&top.count>0) facts.push({e:'👑',l:deptSel==='cs'?'상담왕':deptSel==='md'?'발주왕':'이 기간 MVP',v:`${top.name} · ${top.count}건`});
        let peak=null; days.forEach(d=>{ const t=(A.perDay[d]&&A.perDay[d].total)||0; if(!peak||t>peak.t) peak={d,t}; });
        if(peak&&peak.t>0) facts.push({e:'🚀',l:'하루 최고 기록',v:`${peak.t}건 · ${mdLabel(peak.d)}(${wdOf(peak.d)})`});
        const today=todayStr();
        if(days.includes(today)){ const mDays=days.filter(d=>d.slice(0,7)===today.slice(0,7));
          if(mDays.length>=2){ const mTotal=mDays.reduce((s,d)=>s+((A.perDay[d]&&A.perDay[d].total)||0),0);
            const elapsed=Number(today.slice(8,10)), dim=new Date(Number(today.slice(0,4)),Number(today.slice(5,7)),0).getDate();
            if(elapsed>0) facts.push({e:'🔮',l:'이번 달 예상',v:`~${Math.round(mTotal/elapsed*dim).toLocaleString()}건`}); } }
        if(deptSel==='cs'){ const c=distByField(rows,'category',99).filter(x=>x.key!=='(미지정)')[0]; if(c) facts.push({e:'🏷️',l:'최다 문의유형',v:c.key});
          const cb=rows.filter(r=>r.callback).length; if(rows.length) facts.push({e:'📞',l:'콜백 비율',v:`${Math.round(cb/rows.length*100)}%`}); }
        else if(deptSel==='md'){ const v=distByField(rows,'vendor',99).filter(x=>x.key!=='(미지정)')[0]; if(v) facts.push({e:'🏢',l:'최다 구매처',v:v.key});
          const rt=distByField(rows,'route',99).filter(x=>x.key!=='(미지정)')[0]; if(rt) facts.push({e:'🧭',l:'최다 주문경로',v:rt.key}); }
        else { const cs=days.reduce((s,d)=>s+((A.perDay[d]&&A.perDay[d].cs)||0),0), md=days.reduce((s,d)=>s+((A.perDay[d]&&A.perDay[d].md)||0),0);
          if(cs+md>0){ const g=(a,b)=>b?g(b,a%b):a; const dv=g(cs,md)||1; facts.push({e:'⚖️',l:'CS : MD 비율',v:`${cs/dv} : ${md/dv}`}); } }
        return facts.slice(0,6);
      }
      /* 필드값별 현재/이전 기간 건수 비교 [{key,count,prev,delta}] */
      function deltaByField(rows, prevRows, field, topN){
        const cur={}, prev={};
        rows.forEach(r=>{ const k=(r[field]||'').trim()||'(미지정)'; cur[k]=(cur[k]||0)+1; });
        prevRows.forEach(r=>{ const k=(r[field]||'').trim()||'(미지정)'; prev[k]=(prev[k]||0)+1; });
        let arr=Object.keys(cur).map(k=>({key:k,count:cur[k],prev:prev[k]||0,delta:cur[k]-(prev[k]||0)}))
          .sort((a,b)=>b.count-a.count||a.key.localeCompare(b.key));
        if(topN&&arr.length>topN) arr=arr.slice(0,topN);
        return arr;
      }
      /* 이상 탐지 — 이번 기간 특정 문의유형/구매처가 이전 대비 급증(원인 확인 시그널) */
      function detectAnomalies(A, P, deptSel){
        const out=[];
        const specs = deptSel==='cs' ? [{f:'category',lbl:'문의유형',dept:'cs'}]
          : deptSel==='md' ? [{f:'vendor',lbl:'구매처',dept:'md'}]
          : [{f:'category',lbl:'CS 문의유형',dept:'cs'},{f:'vendor',lbl:'MD 구매처',dept:'md'}];
        specs.forEach(sp=>{
          const cur=(A.rows||[]).filter(r=>r.dept===sp.dept), prev=(P.rows||[]).filter(r=>r.dept===sp.dept);
          if(cur.length<4) return;                                   // 표본 너무 적으면 스킵(오탐 방지)
          const d=deltaByField(cur, prev, sp.f).filter(x=>x.key!=='(미지정)');
          const hot=d.find(x=>x.count>=3 && (x.prev===0 ? x.count>=3 : x.count>=x.prev*2));
          if(hot){ const share=Math.round(hot.count/cur.length*100);
            const how = hot.prev===0 ? `이전 기간엔 없다가 <b>${hot.count}건</b>으로 발생` : `이전 대비 <b>${hot.prev}→${hot.count}건</b>`;
            out.push({icon:'🔺', tone:'warn', text:`${sp.lbl} <b>‘${esc(hot.key)}’</b> 급증 — ${how} (전체 ${share}%). 재고·배송·이벤트 등 원인 확인이 필요해요`}); }
        });
        return out;
      }
      /* 기간 비교 리포트 — 이번 기간 vs 이전 동기간 */
      function compareCard(A, P, len, deptSel){
        const spec = deptSel==='all' ? [{k:'cs',lbl:'CS'},{k:'md',lbl:'MD'},{k:'total',lbl:'합계',tot:true}] : [{k:deptSel,lbl:DLABEL[deptSel],tot:true}];
        const cnt=(agg,k)=> k==='total'?agg.total : (agg.rows||[]).filter(r=>r.dept===k).length;
        const body=spec.map(s=>{ const c=cnt(A,s.k), p=cnt(P,s.k), d=c-p, pct=p?Math.round(d/p*100):(c?100:0);
          const cls=d>0?'up':d<0?'down':'flat', arw=d>0?'▲':d<0?'▼':'–';
          return `<tr class="${s.tot&&deptSel==='all'?'tot':''}"><td>${s.lbl}</td><td class="num">${p}</td><td class="num">${c}</td>
            <td class="num ${cls}">${arw} ${d>=0?'+':''}${d}</td><td class="num ${cls}">${pct>=0?'+':''}${pct}%</td></tr>`; }).join('');
        return `<div class="card"><div class="card-hd">${icon('chart')}<b>기간 비교</b>
            <span class="muted" style="margin-left:auto;font-size:12px">이전 동기간(${len}일) 대비</span></div>
          <div class="card-bd" style="padding:0"><table class="cmp-tbl">
            <thead><tr><th>구분</th><th class="num">이전</th><th class="num">이번</th><th class="num">증감</th><th class="num">%</th></tr></thead>
            <tbody>${body}</tbody></table></div></div>`;
      }
      /* 입점사(구매처)별 성과 — 발주 건수·비중·이전 대비 증감 */
      function vendorPerfCard(A, P){
        const cur=(A.rows||[]).filter(r=>r.dept==='md'), prev=(P.rows||[]).filter(r=>r.dept==='md');
        const d=deltaByField(cur, prev, 'vendor', 8).filter(x=>x.key!=='(미지정)'); const total=cur.length;
        const rows=d.map((x,i)=>{ const share=Math.round(x.count/(total||1)*100);
          const cls=x.delta>0?'up':x.delta<0?'down':'flat', arw=x.delta>0?'▲':x.delta<0?'▼':'–';
          return `<tr><td class="num" style="color:var(--faint)">${i+1}</td><td class="emp-name">${esc(x.key)}</td>
            <td class="num">${x.count}</td><td class="num" style="color:var(--muted);font-weight:600">${share}%</td>
            <td class="num ${cls}">${arw} ${x.delta>=0?'+':''}${x.delta}</td></tr>`; }).join('');
        return `<div class="card"><div class="card-hd">${icon('truck')}<b>입점사(구매처) 성과</b>
            <span class="muted" style="margin-left:auto;font-size:12px">발주 건수·비중·이전 대비</span></div>
          <div class="card-bd" style="padding:0">${ d.length
            ? `<table class="cmp-tbl"><thead><tr><th style="width:34px">#</th><th>입점사</th><th class="num">발주</th><th class="num">비중</th><th class="num">증감</th></tr></thead><tbody>${rows}</tbody></table>`
            : '<div class="iv-empty" style="padding:20px">입점사 발주 기록이 없습니다.</div>' }</div></div>`;
      }
      /* CS ↔ MD 교차 — 같은 기간 CS 핫이슈와 MD 핫이슈를 나란히 */
      function crossCard(A){
        const cs=(A.rows||[]).filter(r=>r.dept==='cs'), md=(A.rows||[]).filter(r=>r.dept==='md');
        return `<div class="iv-secttl">CS ↔ MD 교차</div><div class="dist-grid">
          ${distCard('CS 문의유형 TOP', distByField(cs,'category',6).filter(x=>x.key!=='(미지정)'),'chat')}
          ${distCard('MD 구매처 TOP', distByField(md,'vendor',6).filter(x=>x.key!=='(미지정)'),'truck')}</div>`;
      }
      function renderDetail(A, P, days, deptSel){
        const box=$('#detail'); if(!box) return; const rows=A.rows||[]; const len=days.length;
        let dist='';
        if(deptSel==='cs'){
          dist=`<div class="iv-secttl">CS 분포 분석</div><div class="dist-grid">
            ${distCard('문의유형별', distByField(rows,'category',8),'chat')}
            ${distCard('고객유형별', distByField(rows,'customerType',8),'users')}</div>`;
        } else if(deptSel==='md'){
          dist=`<div class="iv-secttl">MD 분포 분석</div><div class="dist-grid">
            ${vendorPerfCard(A, P)}
            ${distCard('주문경로별', distByField(rows,'route',8),'chart')}</div>
            <div class="dist-grid" style="margin-top:12px">
            ${distCard('정산구분별', distByField(rows,'settle',6),'grid')}</div>`;
        } else {
          dist=crossCard(A);
        }
        // 심화: 기간 비교(전 탭 공통)
        const compare=`<div class="iv-secttl">기간 비교</div>${compareCard(A, P, len, deptSel)}`;
        const facts=funFacts(A, days, deptSel);
        const fun = facts.length? `<div class="iv-secttl">재미 포인트</div>
          <div class="fun-card"><div class="fun-hd">🎉 데이터 재미 포인트 <span class="muted" style="margin-left:auto;font-weight:600;font-size:12px">기록 기반 자동 분석</span></div>
            <div class="fun-grid">${facts.map(f=>`<div class="fun"><span class="fe">${f.e}</span><div><div class="fl">${esc(f.l)}</div><div class="fv">${esc(f.v)}</div></div></div>`).join('')}</div></div>` : '';
        box.innerHTML = dist + compare + fun;
      }

      /* 선 그래프 SVG (여러 직무면 각 직무 1선) + hover 가이드/포커스 레이어 */
      function chartMax(days, perDay, depts){ return Math.max(1,...days.map(d=>Math.max(...depts.map(dp=>(perDay[d]&&perDay[d][dp])||0)))); }
      function chartX(i,n){ const {padL,W,padR}=GEO, iw=W-padL-padR; return n<=1? padL+iw/2 : padL+iw*i/(n-1); }
      function chartY(v,max){ const {padT,H,padB}=GEO, ih=H-padT-padB; return GEO.padT+ih-(v/max)*ih; }
      function lineSVG(days, perDay, depts){
        const {W,H,padL,padB,padT,padR}=GEO;
        const iw=W-padL-padR, ih=H-padT-padB, n=days.length;
        const max=chartMax(days,perDay,depts);
        const X=i=>chartX(i,n), Y=v=>chartY(v,max);
        // 다크모드 대응: 축·격자·라벨색을 현재 테마 토큰에서 읽어 반영(배경은 투명 → 카드색 사용)
        const cs=getComputedStyle(document.documentElement);
        const cGrid=cs.getPropertyValue('--line').trim()||'#eef0f3';
        const cAxis=cs.getPropertyValue('--faint').trim()||'#98a0ab';
        const cLbl=cs.getPropertyValue('--muted').trim()||'#69727e';
        const grid=[0,.25,.5,.75,1].map(f=>{ const gy=padT+ih-f*ih;
          return `<line x1="${padL}" y1="${gy}" x2="${W-padR}" y2="${gy}" stroke="${cGrid}"/><text x="${padL-6}" y="${gy+3}" text-anchor="end" font-size="9" fill="${cAxis}">${Math.round(max*f)}</text>`; }).join('');
        const showEvery=Math.ceil(n/12); let labels='';
        days.forEach((d,i)=>{ if(i%showEvery===0||i===n-1) labels+=`<text x="${X(i).toFixed(1)}" y="${H-8}" text-anchor="middle" font-size="9" fill="${cLbl}">${mdLabel(d)}</text>`; });
        let series='';
        depts.forEach(dp=>{ const col=CHART[dp];
          const pts=days.map((d,i)=>[X(i),Y((perDay[d]&&perDay[d][dp])||0)]);
          const path=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
          // 면적 살짝 채워 추이 강조
          const area=`${path} L ${pts[pts.length-1][0].toFixed(1)} ${(padT+ih).toFixed(1)} L ${pts[0][0].toFixed(1)} ${(padT+ih).toFixed(1)} Z`;
          series+=`<path d="${area}" fill="${col}" opacity="0.06"/>`;
          series+=`<path d="${path}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
          if(n<=40) pts.forEach(p=>{ series+=`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.7" fill="#fff" stroke="${col}" stroke-width="1.6"/>`; });
        });
        return `<svg id="ivChart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="width:100%;height:auto;font-family:inherit" xmlns="http://www.w3.org/2000/svg">
          ${grid}
          <line id="ivGuide" x1="0" x2="0" y1="${padT}" y2="${(padT+ih).toFixed(1)}" stroke="#b9c0ca" stroke-width="1" stroke-dasharray="4 3" style="display:none"/>
          ${series}<g id="ivFocus"></g>${labels}</svg>`;
      }
      /* 차트 hover 인터랙션 — 가이드선·포커스점·플로팅 툴팁 */
      function wireChartHover(days, perDay, depts){
        const svg=$('#ivChart'), tip=$('#ivTip'), guide=$('#ivGuide'), focus=$('#ivFocus');
        if(!svg||!tip) return;
        const {W,padL,padR}=GEO, iw=W-padL-padR, n=days.length, max=chartMax(days,perDay,depts);
        function show(i){ const day=days[i]; if(day==null) return; const gx=chartX(i,n);
          guide.setAttribute('x1',gx); guide.setAttribute('x2',gx); guide.style.display='';
          focus.innerHTML=depts.map(dp=>{ const v=(perDay[day]&&perDay[day][dp])||0;
            return `<circle cx="${gx.toFixed(1)}" cy="${chartY(v,max).toFixed(1)}" r="4.2" fill="${CHART[dp]}" stroke="#fff" stroke-width="1.7"/>`; }).join('');
          const total=depts.reduce((s,dp)=>s+((perDay[day]&&perDay[day][dp])||0),0);
          const rows=depts.map(dp=>`<div class="tp-row"><span><i style="background:${CHART[dp]}"></i>${DLABEL[dp]}</span><b>${(perDay[day]&&perDay[day][dp])||0}건</b></div>`).join('');
          tip.innerHTML=`<div class="tp-d">${mdLabel(day)} (${wdOf(day)})</div>${rows}${depts.length>1?`<div class="tp-row tp-tot"><span>합계</span><b>${total}건</b></div>`:''}`;
          const rect=svg.getBoundingClientRect(), scale=rect.width/W; tip.style.display='block';
          const ox=svg.offsetLeft, oy=svg.offsetTop, tw=tip.offsetWidth;
          let left=ox+gx*scale-tw/2; left=Math.min(Math.max(left,ox+2), ox+rect.width-tw-2);
          tip.style.left=left+'px'; tip.style.top=(oy+6)+'px';
        }
        function at(clientX){ const rect=svg.getBoundingClientRect(), scale=rect.width/W;
          const mx=(clientX-rect.left)/scale; let i=Math.round((mx-padL)/(iw/Math.max(1,n-1)));
          show(Math.max(0,Math.min(n-1,i))); }
        svg.onmousemove=e=>at(e.clientX);
        svg.onmouseleave=()=>{ tip.style.display='none'; guide.style.display='none'; focus.innerHTML=''; };
        svg.ontouchstart=svg.ontouchmove=e=>{ if(e.touches&&e.touches[0]){ at(e.touches[0].clientX); e.preventDefault(); } };
      }
      /* ---- 중국 발주요청 분석 탭 ---- */
      let chinaCache=null;
      async function fetchChina(){ if(chinaCache) return chinaCache;
        try{ const r=await fetch('/api/store?type=coll&coll=chinaorders'); if(!r.ok) throw 0; const d=await r.json(); chinaCache=(d&&d.items)||[]; }catch{ chinaCache=[]; } return chinaCache; }
      const cnFmt=iso=>{ try{ const d=new Date(iso); return (d.getMonth()+1)+'/'+d.getDate(); }catch{ return ''; } };
      async function paintChina(){
        const box=$('#ivChina'); if(!box) return;
        box.innerHTML=`<div class="muted" style="padding:16px">불러오는 중…</div>`;
        const items=await fetchChina(); if(!root.isConnected || dept!=='china') return;
        const open=items.filter(i=>!i.done), done=items.filter(i=>i.done);
        const loss=items.filter(i=>i.inquiry==='견적문의' && i.req==='입고요청' && !i.done);
        const withStatus=items.map(i=>({...i, status:i.done?'완료':'처리 대기'}));
        const kpis=`<div class="kpis">
          <div class="kpi" style="--kc:var(--danger)"><div class="kl">처리 대기</div><div class="kv">${open.length}<small>건</small></div><div class="kd flat">발주·입고 대기 중</div></div>
          <div class="kpi" style="--kc:var(--ok)"><div class="kl">완료</div><div class="kv">${done.length}<small>건</small></div><div class="kd flat">발주·입고 처리됨</div></div>
          <div class="kpi" style="--kc:var(--d3)"><div class="kl">재고확보 필요</div><div class="kv">${loss.length}<small>건</small></div><div class="kd flat">견적문의·입고요청(Loss 위험)</div></div>
          <div class="kpi" style="--kc:var(--d1)"><div class="kl">전체 등록</div><div class="kv">${items.length}<small>건</small></div><div class="kd flat">누적</div></div></div>`;
        const hl = loss.length
          ? `<div class="hl-row"><div class="hl warn"><div class="hi">📦</div><div class="ht">재고확보가 필요한 <b>견적문의·입고요청</b> 건이 <b>${loss.length}건</b> 있어요 — 발주 검토가 필요합니다</div></div>${done.length&&items.length?`<div class="hl flat"><div class="hi">✅</div><div class="ht">처리율 <b>${Math.round(done.length/items.length*100)}%</b> (완료 ${done.length}/${items.length}건)</div></div>`:''}</div>`
          : (items.length?`<div class="hl-row"><div class="hl flat"><div class="hi">✅</div><div class="ht">현재 재고확보 필요(견적문의·입고요청) 건이 없습니다. 처리율 <b>${Math.round(done.length/items.length*100)}%</b></div></div></div>`:'');
        const dist=`<div class="iv-secttl">중국 발주요청 분포</div><div class="dist-grid">
          ${distCard('문의유형별', distByField(items,'inquiry',9),'chat')}
          ${distCard('발주요청별', distByField(items,'req',9),'box')}
          ${distCard('상태별', distByField(withStatus,'status',9),'grid')}
          ${distCard('상품 TOP', distByField(items,'code',8),'box')}</div>`;
        const sorted=[...open,...done].sort((a,b)=>(a.done?1:0)-(b.done?1:0)||String(b.createdAt).localeCompare(String(a.createdAt)));
        const iqCls=i=>i.inquiry==='견적문의'?'iq1':'iq0';
        const rows=sorted.map(it=>`<tr>
            <td><b class="mono">${esc(it.code)}</b></td><td>${esc(it.name||'-')}</td>
            <td><span class="cn2 ${iqCls(it)}">${esc(it.inquiry||'-')}</span></td>
            <td><span class="cn2 rq">${esc(it.req||'-')}</span></td>
            <td><span class="cn2 ${it.done?'st-done':'st-open'}">${it.done?'완료':'대기'}</span></td>
            <td class="num">${it.qty?esc(String(it.qty))+'개':'-'}</td>
            <td>${esc(it.customer||'-')}</td><td>${esc(it.authorName||it.author||'-')}</td><td class="num">${cnFmt(it.createdAt)}</td></tr>`).join('');
        const table=`<div class="iv-secttl">전체 목록 <span style="font-weight:600;color:var(--muted);text-transform:none;letter-spacing:0">· ${items.length}건 (기간 무관 누적)</span></div>
          <div class="cn-tblwrap"><table class="cmp-tbl cn-tbl"><thead><tr><th>상품코드</th><th>품명</th><th>문의유형</th><th>발주요청</th><th>상태</th><th class="num">수량</th><th>고객</th><th>작성자</th><th class="num">등록</th></tr></thead>
          <tbody>${rows||'<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:22px">등록된 발주요청이 없습니다.</td></tr>'}</tbody></table></div>`;
        box.innerHTML=kpis+hl+dist+table;
      }
      /* 데이터에서 사람이 읽는 인사이트 문장 자동 생성 */
      function buildHighlights(days, perDay, A, P, people, allMode){
        const out=[]; const len=days.length; if(!len) return out;
        const totalOf=day=>(perDay[day]&&perDay[day].total)||0;
        const avg=A.total/len;
        // 1) 이전 동기간 대비 증감
        if(P.total>0){ const diff=A.total-P.total, pct=Math.round(diff/P.total*100);
          if(Math.abs(pct)>=5) out.push({icon:diff>=0?'📈':'📉', tone:diff>=0?'up':'down',
            text:`이전 동기간보다 처리량이 <b>${diff>=0?'+':''}${pct}%</b> ${diff>=0?'늘었어요':'줄었어요'} (${P.total}→${A.total}건)`}); }
        // 2) 오늘 vs 일평균 (오늘이 기간에 포함되고 3일 이상)
        const today=todayStr();
        if(len>=3 && days.includes(today) && avg>0){ const tt=totalOf(today); const r=tt/avg;
          if(tt>0 && r>=1.3) out.push({icon:'🔥', tone:'up', text:`오늘 벌써 <b>${tt}건</b> — 평소(일평균 ${avg.toFixed(1)}건)보다 <b>${Math.round((r-1)*100)}%</b> 많아요!`});
          else if(r<=0.5) out.push({icon:'🌤️', tone:'down', text:`오늘은 <b>${tt}건</b>으로 평소(일평균 ${avg.toFixed(1)}건)보다 한산해요`}); }
        // 3) 가장 바쁜 날
        let peak=null; days.forEach(d=>{ const t=totalOf(d); if(!peak||t>peak.t) peak={d,t}; });
        if(peak && peak.t>0 && len>=3) out.push({icon:'🏆', tone:'flat', text:`가장 바쁜 날은 <b>${mdLabel(peak.d)}(${wdOf(peak.d)})</b> · ${peak.t}건`});
        // 4) 최다 담당자 비중
        const top=[...people].filter(p=>p.count>0).sort((a,b)=>b.count-a.count)[0];
        if(top && A.total>0){ const share=Math.round(top.count/A.total*100);
          if(share>=35) out.push({icon:'⭐', tone:'flat', text:`<b>${esc(top.name)}</b>님이 전체의 <b>${share}%</b>(${top.count}건)를 처리했어요`}); }
        // 5) 최근 추세 (뒤 절반 vs 앞 절반 일평균)
        if(len>=6){ const h=Math.floor(len/2);
          const first=days.slice(0,h).reduce((s,d)=>s+totalOf(d),0)/h;
          const last=days.slice(len-h).reduce((s,d)=>s+totalOf(d),0)/h;
          if(first>0){ const pct=Math.round((last-first)/first*100);
            if(pct>=20) out.push({icon:'🚀', tone:'up', text:`기간 후반 들어 처리량이 <b>+${pct}%</b> 상승 추세예요`});
            else if(pct<=-20) out.push({icon:'🔻', tone:'down', text:`기간 후반 처리량이 <b>${pct}%</b> 둔화됐어요`}); } }
        // 6) 무기록일
        const zero=days.filter(d=>totalOf(d)===0).length;
        if(len>=5 && zero>0 && zero<len) out.push({icon:'🗓️', tone:'flat', text:`기간 ${len}일 중 <b>${zero}일</b>은 기록이 없어요`});
        return out.slice(0,4);
      }

      /* ---- 저장 ---- */
      function exportCsv(){
        const {from,to}=curRange(); const A=aggregate(from,to);
        const people=Object.values(A.perPerson).sort((a,b)=>b.count-a.count);
        const rows=[['기간',from+' ~ '+to],['부서필터',dept==='all'?'전체':DLABEL[dept]],[],
          ['부서','이름','계정ID','총건수','일평균']];
        const len=Math.max(1,diffDays(from,to)+1);
        people.forEach(p=>rows.push([DLABEL[p.dept],p.name,p.id||'',p.count,(p.count/len).toFixed(1)]));
        rows.push([]); rows.push(['일자','CS','MD','합계']);
        listDays(from,to).forEach(d=>{ const pd=A.perDay[d]||{cs:0,md:0,total:0}; rows.push([d,pd.cs,pd.md,pd.total]); });
        const csv='﻿'+rows.map(r=>r.map(c=>{ c=String(c==null?'':c); return /[",\n]/.test(c)?'"'+c.replace(/"/g,'""')+'"':c; }).join(',')).join('\r\n');
        downloadBlob(new Blob([csv],{type:'text/csv'}), `업무현황_${from}_${to}.csv`);
        toast('CSV로 저장했습니다');
      }
      function exportPng(){
        const svg=$('#ivChart'); if(!svg){ toast('차트가 없습니다'); return; }
        const xml=new XMLSerializer().serializeToString(svg);
        const url='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(xml)));
        const img=new Image();
        img.onload=()=>{ const sc=2, w=svg.viewBox.baseVal.width||560, h=svg.viewBox.baseVal.height||220;
          const c=document.createElement('canvas'); c.width=w*sc; c.height=h*sc;
          const ctx=c.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,c.width,c.height); ctx.drawImage(img,0,0,c.width,c.height);
          c.toBlob(b=>{ const {from,to}=curRange(); downloadBlob(b,`업무추이_${from}_${to}.png`); toast('차트 이미지를 저장했습니다'); }); };
        img.onerror=()=>toast('이미지 변환 실패');
        img.src=url;
      }

      /* ---- 데이터: 실제 직무 시트에서 집계 (삭제 즉시 반영) ---- */
      const cache={};   // 'dept|YYYY-MM' → 시트 레코드[]
      let loadErr=false;
      function rebuild(){ records=[];
        Object.keys(cache).forEach(k=>{ const dp=k.split('|')[0];
          (cache[k]||[]).forEach(r=>{ const rec=fromSheet(dp,r); if(rec) records.push(rec); }); }); }
      async function ensure(from,to){
        const need=[]; ['cs','md'].forEach(dp=>monthsBetween(from,to).forEach(m=>{ const k=dp+'|'+m; if(!(k in cache)) need.push([dp,m,k]); }));
        if(!need.length) return;
        const res=await Promise.all(need.map(([dp,m])=>Records.month(dp, SHEET_OF[dp], m)));
        need.forEach(([dp,m,k],i)=>{ if(res[i]===null) loadErr=true; cache[k]=res[i]||[]; });
        rebuild();
      }
      async function refresh(){
        const {from,to}=curRange(); const len=listDays(from,to).length; const pFrom=addDays(from,-len);
        await ensure(pFrom, to);
        if(!root.isConnected || !$('#kpis')) return;
        if(loadErr && !records.length){ $('#kpis').innerHTML=`<div class="iv-empty" style="grid-column:1/-1">서버에서 시트를 불러오지 못했습니다. 연동을 확인하세요.</div>`; return; }
        paint();
      }

      /* ---- 이벤트 ---- */
      $('#segRange').querySelectorAll('button').forEach(b=>b.onclick=()=>{
        preset=b.dataset.r; $('#segRange').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));
        $('#dates').classList.toggle('on',preset==='custom');
        if(preset==='custom'){ $('#dFrom').value=custom.from; $('#dTo').value=custom.to; }
        refresh(); });
      $('#segDept').querySelectorAll('button').forEach(b=>b.onclick=()=>{
        dept=b.dataset.d; $('#segDept').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b)); paint(); });
      $('#dFrom').onchange=()=>{ custom.from=$('#dFrom').value||custom.from; refresh(); };
      $('#dTo').onchange=()=>{ custom.to=$('#dTo').value||custom.to; refresh(); };
      if($('#btnCsv')) $('#btnCsv').onclick=exportCsv;   // 다운로드는 관리자만(버튼도 관리자만 노출)
      if($('#btnPng')) $('#btnPng').onclick=exportPng;
      $('#btnPrint').onclick=()=>window.print();
      $('#btnReload').onclick=()=>{ Object.keys(cache).forEach(k=>delete cache[k]); chinaCache=null; loadErr=false; if(dept==='china') paintChina(); else load(); };

      async function load(){
        if($('#kpis')) $('#kpis').innerHTML=Array.from({length:5}).map(()=>`<div class="kpi" style="--kc:var(--line-strong)"><div class="skel skel-line" style="width:54%"></div><div class="skel skel-line" style="width:40%;height:24px;margin-top:10px"></div></div>`).join('');
        roster=await fetchRoster();
        try{ const cn=await fetchChina(); chinaStat={ open:cn.filter(i=>!i.done).length, total:cn.length }; }catch(e){}
        if(!root.isConnected) return;
        await refresh();
      }
      load();
    }
  };
})();
