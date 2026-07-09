/* ===========================================================================
   관리자 · 업무 현황(인사이트)  — 팀장 전용
   - 직원별(계정id–이름 연동) 일일 업무량을 리스트 + 그래프로 조회
   - 서버 누적(workstat)을 읽어 기간별 집계·추이·인사이트 자동 분석
   - CSV / 차트 PNG 로 저장(스냅샷)
   =========================================================================== */
(function(){
  const CHART={ cs:'#3b76e0', md:'#e8804a' };     // 데이터 시각화용(부서 구분) — UI 기본색과 분리
  const DLABEL={ cs:'CS', md:'MD' };

  /* 날짜 유틸 (todayStr 는 전역) */
  const ymd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const addDays=(s,n)=>{ const d=new Date(s+'T00:00:00'); d.setDate(d.getDate()+n); return ymd(d); };
  const diffDays=(a,b)=>Math.round((new Date(b+'T00:00:00')-new Date(a+'T00:00:00'))/86400000);
  const listDays=(from,to)=>{ const out=[]; let c=from; let guard=0; while(c<=to&&guard++<400){ out.push(c); c=addDays(c,1); } return out; };
  const mdLabel=s=>s.slice(5).replace('-','/');

  async function fetchStat(){ try{ const r=await fetch('/api/store?type=workstat&dept=cs,md'); if(!r.ok) throw 0; return await r.json(); }catch(e){ return null; } }
  async function fetchRoster(){ try{ const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'roster'})}); const d=await r.json(); return (d&&d.roster)||[]; }catch(e){ return []; } }

  /* 서버 응답 → 평탄한 레코드 [{dept,who,name,id,day,count}] */
  function toRecords(stat){
    const recs=[]; if(!stat||!stat.stats) return recs;
    ['cs','md'].forEach(dept=>{
      const s=stat.stats[dept]||{}, whoMap=(stat.who&&stat.who[dept])||{};
      Object.keys(s).forEach(field=>{
        const i=field.lastIndexOf('|'); if(i<0) return;
        const who=field.slice(0,i), day=field.slice(i+1); const count=Number(s[field])||0;
        if(!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
        const name=whoMap[who]||(who[0]==='@'?who.slice(1):who);
        recs.push({ dept, who, name, id:(who[0]==='@'?'':who), day, count });
      });
    });
    return recs;
  }

  MODULES['admin.insights']={
    title:'업무 현황', icon:'chart',
    render(root){
      if(!Auth.isAdmin()){
        root.innerHTML=`<div class="view"><div class="empty">${icon('shield')}<div style="font-size:14px">관리자(팀장)만 접근할 수 있는 화면입니다.</div></div></div>`;
        return;
      }
      root.innerHTML=`
      <style>
        .iv-ctrl{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;margin-bottom:6px}
        .seg{display:inline-flex;border:1px solid var(--line-2);border-radius:9px;overflow:hidden}
        .seg button{border:0;background:var(--panel);padding:7px 14px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer;border-left:1px solid var(--line-2)}
        .seg button:first-child{border-left:0}
        .seg button.on{background:var(--active-bg);color:var(--red)}
        .iv-dates{display:none;align-items:center;gap:7px;font-size:13px;color:var(--muted)}
        .iv-dates.on{display:inline-flex}
        .iv-dates input{height:34px;border:1px solid var(--line-2);border-radius:8px;padding:0 9px;font-size:13px}
        .iv-sp{flex:1}
        .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:16px 0 20px}
        .kpi{border:1px solid var(--line);border-radius:12px;background:#fff;padding:15px 16px;box-shadow:var(--sh-sm)}
        .kpi .kl{font-size:12.5px;color:var(--muted);font-weight:600}
        .kpi .kv{font-size:29px;font-weight:800;font-variant-numeric:tabular-nums;margin-top:5px;color:var(--ink)}
        .kpi .kv small{font-size:13.5px;font-weight:600;color:var(--muted);margin-left:3px}
        .kpi .kd{font-size:12px;font-weight:700;margin-top:4px}
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
        .emp-tbl tr.grp td{background:#f6f8fb;padding-top:11px;padding-bottom:7px;border-bottom:1px solid var(--line-2)}
        .emp-tbl .gsum{color:var(--muted);font-size:12px;font-weight:700;margin-left:7px}
      </style>
      <div class="mhead pad">
        <div class="tt">업무 현황 · 인사이트</div>
        <div class="ds">직원별 일일 업무량을 집계해 리스트·그래프로 보여줍니다. 매 상담/발주 저장 시 서버에 누적됩니다.</div>
      </div>
      <div class="mbody">
        <div class="iv-ctrl">
          <span class="seg" id="segRange">
            <button data-r="today">오늘</button><button data-r="7" class="on">7일</button>
            <button data-r="30">30일</button><button data-r="custom">지정</button></span>
          <span class="iv-dates" id="dates">
            <input type="date" id="dFrom"> ~ <input type="date" id="dTo"></span>
          <span class="seg" id="segDept">
            <button data-d="all" class="on">전체</button><button data-d="cs">CS</button><button data-d="md">MD</button></span>
          <span class="iv-sp"></span>
          <button class="btn ghost sm" id="btnCsv">${icon('download')}CSV</button>
          <button class="btn ghost sm" id="btnPng">${icon('image')}차트 PNG</button>
          <button class="btn ghost sm" id="btnReload">${icon('refresh')}</button>
        </div>
        <div class="kpis" id="kpis"></div>
        <div class="iv-grid">
          <div class="card"><div class="card-hd">${icon('chart')}<b>일자별 처리 추이</b>
            <span id="trendLgd" style="margin-left:auto"></span></div>
            <div class="card-bd" id="trend"></div></div>
          <div class="card"><div class="card-hd">${icon('users')}<b>직원별 업무량</b>
            <span class="muted" id="empCnt" style="margin-left:auto;font-size:12px"></span></div>
            <div class="card-bd" style="padding:0"><div id="emp"></div></div></div>
        </div>
        <p class="iv-note">※ CS는 선택된 상담사, MD는 로그인 계정 기준으로 집계됩니다. 계정 미매칭 이름은 ID가 빈칸으로 표시됩니다.</p>
      </div>`;

      const $=s=>root.querySelector(s);
      let records=[], roster=[], preset='7', dept='all', custom={from:todayStr(), to:todayStr()};

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
            <div class="kpi"><div class="kl">총 처리 건수</div><div class="kv">${A.total.toLocaleString()}<small>건</small></div>
              <div class="kd ${dcls}">${darrow} 이전 동기간 대비 ${diff>=0?'+':''}${diff}건 (${pct>=0?'+':''}${pct}%)</div></div>
            <div class="kpi"><div class="kl"><span class="dot" style="background:${CHART.cs}"></span>CS 일평균</div><div class="kv">${(csTotal/len).toFixed(1)}<small>건/일</small></div>
              <div class="kd flat">총 ${csTotal}건 · ${len}일</div></div>
            <div class="kpi"><div class="kl"><span class="dot" style="background:${CHART.md}"></span>MD 일평균</div><div class="kv">${(mdTotal/len).toFixed(1)}<small>건/일</small></div>
              <div class="kd flat">총 ${mdTotal}건 · ${len}일</div></div>
            <div class="kpi"><div class="kl">최다 담당자 · 직무별</div>
              <div class="kd" style="margin-top:9px;font-size:13.5px;line-height:2">
                <span class="dbadge" style="background:${CHART.cs}">CS</span> ${ct?esc(ct.name)+' <b style="color:var(--ink)">'+ct.count+'</b>건':'—'}<br>
                <span class="dbadge" style="background:${CHART.md}">MD</span> ${mt?esc(mt.name)+' <b style="color:var(--ink)">'+mt.count+'</b>건':'—'}</div></div>`;
        } else {
          const top=people[0];
          $('#kpis').innerHTML=`
            <div class="kpi"><div class="kl">총 처리 건수</div><div class="kv">${A.total.toLocaleString()}<small>건</small></div>
              <div class="kd ${dcls}">${darrow} 이전 동기간 대비 ${diff>=0?'+':''}${diff}건 (${pct>=0?'+':''}${pct}%)</div></div>
            <div class="kpi"><div class="kl">1일 평균</div><div class="kv">${(A.total/len).toFixed(1)}<small>건/일</small></div>
              <div class="kd flat">${len}일 · 활동 ${Object.keys(A.perDay).length}일</div></div>
            <div class="kpi"><div class="kl">최다 담당자</div><div class="kv" style="font-size:22px">${top?esc(top.name):'—'}</div>
              <div class="kd flat">${top?top.count+'건':'데이터 없음'}</div></div>
            <div class="kpi"><div class="kl">참여 인원</div><div class="kv">${people.length}<small>명</small></div>
              <div class="kd flat">${DLABEL[dept]||dept}</div></div>`;
        }

        // --- 추이 (선 그래프 · 전체는 CS/MD 2선) ---
        const depts = allMode?['cs','md']:[dept];
        $('#trend').innerHTML=lineSVG(days, A.perDay, depts);
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
      }

      /* 선 그래프 SVG (여러 직무면 각 직무 1선) */
      function lineSVG(days, perDay, depts){
        const W=560, H=220, padL=32, padB=26, padT=12, padR=12;
        const iw=W-padL-padR, ih=H-padT-padB, n=days.length;
        const max=Math.max(1,...days.map(d=>Math.max(...depts.map(dp=>(perDay[d]&&perDay[d][dp])||0))));
        const X=i=> n<=1? padL+iw/2 : padL+iw*i/(n-1);
        const Y=v=> padT+ih-(v/max)*ih;
        const grid=[0,.25,.5,.75,1].map(f=>{ const gy=padT+ih-f*ih;
          return `<line x1="${padL}" y1="${gy}" x2="${W-padR}" y2="${gy}" stroke="#eef0f3"/><text x="${padL-6}" y="${gy+3}" text-anchor="end" font-size="9" fill="#98a0ab">${Math.round(max*f)}</text>`; }).join('');
        const showEvery=Math.ceil(n/12); let labels='';
        days.forEach((d,i)=>{ if(i%showEvery===0||i===n-1) labels+=`<text x="${X(i).toFixed(1)}" y="${H-8}" text-anchor="middle" font-size="9" fill="#69727e">${mdLabel(d)}</text>`; });
        let series='';
        depts.forEach(dp=>{ const col=CHART[dp];
          const pts=days.map((d,i)=>[X(i),Y((perDay[d]&&perDay[d][dp])||0)]);
          const path=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
          series+=`<path d="${path}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
          pts.forEach((p,i)=>{ const v=(perDay[days[i]]&&perDay[days[i]][dp])||0;
            series+=`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${n>40?1.6:2.7}" fill="#fff" stroke="${col}" stroke-width="1.6"><title>${days[i]} ${DLABEL[dp]} ${v}건</title></circle>`; });
        });
        return `<svg id="ivChart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="width:100%;height:auto;font-family:inherit" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>${grid}${series}${labels}</svg>`;
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

      /* ---- 이벤트 ---- */
      $('#segRange').querySelectorAll('button').forEach(b=>b.onclick=()=>{
        preset=b.dataset.r; $('#segRange').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));
        $('#dates').classList.toggle('on',preset==='custom');
        if(preset==='custom'){ $('#dFrom').value=custom.from; $('#dTo').value=custom.to; }
        paint(); });
      $('#segDept').querySelectorAll('button').forEach(b=>b.onclick=()=>{
        dept=b.dataset.d; $('#segDept').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b)); paint(); });
      $('#dFrom').onchange=()=>{ custom.from=$('#dFrom').value||custom.from; paint(); };
      $('#dTo').onchange=()=>{ custom.to=$('#dTo').value||custom.to; paint(); };
      $('#btnCsv').onclick=exportCsv;
      $('#btnPng').onclick=exportPng;
      $('#btnReload').onclick=()=>load();

      async function load(){
        $('#kpis').innerHTML=`<div class="kpi"><div class="kl">불러오는 중…</div><div class="kv">·</div></div>`;
        const [stat,ros]=await Promise.all([fetchStat(), fetchRoster()]);
        if(stat===null){ $('#kpis').innerHTML=`<div class="iv-empty" style="grid-column:1/-1">서버(KV)에서 데이터를 불러오지 못했습니다. 연동을 확인하세요.</div>`; return; }
        records=toRecords(stat); roster=ros; paint();
      }
      load();
    }
  };
})();
