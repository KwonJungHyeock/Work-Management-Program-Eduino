/* ===========================================================================
   요청(Requests) — 팀원 → 부서장/관리자 데이터수정·권한·마스터·기능 요청
     라우팅: 부서장(해당 부서 lead/manager) 우선 → 관리자(전체 열람·처리)
     상태:  sent(접수) → doing(처리중) → done(완료)  ·  rejected(반려)
     저장:  서버 공용 컬렉션 'requests'
   범위 카탈로그(REQ_CATS)가 "팀원이 무엇을 요청할 수 있는지"의 정의이자 UI 소스.
   =========================================================================== */
(function(){
  const COLL='requests';
  const nowISO=()=> new Date().toISOString();
  async function rGet(){ try{ const r=await fetch('/api/store?type=coll&coll='+COLL); if(!r.ok) throw 0; const d=await r.json(); return (d&&d.items||[]).filter(x=>x&&x.id); }catch(e){ return null; } }
  async function rPush(item){ try{ const r=await fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collPush',coll:COLL,item})}); return r.ok; }catch(e){ return false; } }
  async function rDel(id){ try{ const r=await fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collDel',coll:COLL,id})}); return r.ok; }catch(e){ return false; } }

  const STATUS={ sent:'접수', doing:'처리중', done:'완료', rejected:'반려' };
  const OPEN=s=> s==='sent'||s==='doing';   // 처리 대기 상태

  // ── 요청 가능 범위(카탈로그) ── 관리자/부서장이 조치해줄 수 있는 항목 = 팀원이 요청 가능한 항목
  //  ref: 처리자가 [바로가기]로 이동할 기능 키(hash) · tab: 그 기능 내 탭 · needTarget: 대상 페이지 선택 필요(권한요청)
  const REQ_CATS=[
    { key:'datafix', name:'데이터 수정/삭제', icon:'clipboard', color:'#0a63c2',
      desc:'발주·상담 기록의 특정 건 정정·삭제 요청',
      types:[
        { key:'order-settle', label:'발주 정산구분(월/선결제) 정정', ref:'md.records' },
        { key:'order-vendor', label:'발주 입점사 연동 정정',          ref:'md.records' },
        { key:'order-status', label:'발주여부·송장 상태 정정',        ref:'md.records' },
        { key:'record-del',   label:'기록 삭제 요청(오등록 등)',      ref:'md.records' },
        { key:'cs-fix',       label:'상담/견적/후불 기록 정정',       ref:'cs.records' },
      ] },
    { key:'perm', name:'권한 요청', icon:'shield', color:'#7c4dd6',
      desc:'특정 페이지의 열람 또는 수정 권한 부여 요청', needTarget:true,
      types:[
        { key:'perm-view', label:'페이지 열람 권한',  ref:'admin.team', permMode:'view' },
        { key:'perm-edit', label:'페이지 수정 권한',  ref:'admin.team', permMode:'edit' },
      ] },
    { key:'master', name:'마스터 데이터', icon:'truck', color:'#12886a',
      desc:'입점사·이카운트 매핑·상품 연결 등 기준정보 정비 요청',
      types:[
        { key:'vendor-add',   label:'입점사 등록/배송비·정산 수정', ref:'md.order', tab:'vendor' },
        { key:'ecount-map',   label:'이카운트 구매처 매핑(입점사 미지정 해소)', ref:'md.order', tab:'catmap' },
        { key:'product-link', label:'상품·옵션 연결(코드 미등록)',  ref:'md.order', tab:'entry' },
      ] },
    { key:'feature', name:'기능개선·버그신고', icon:'chat', color:'#b4530a',
      desc:'프로그램 개선 아이디어·오류 신고',
      types:[
        { key:'bug',     label:'오류/버그 신고', ref:'' },
        { key:'improve', label:'개선 제안',      ref:'' },
      ] },
  ];
  const catOf=k=> REQ_CATS.find(c=>c.key===k)||null;
  const typeOf=(catKey,typeKey)=>{ const c=catOf(catKey); return c? (c.types.find(t=>t.key===typeKey)||null):null; };

  const Req={
    STATUS, OPEN, CATS:REQ_CATS, catOf, typeOf,
    all:rGet,
    isHandler(me){ me=me||{}; return me.role==='admin'||me.role==='manager'||me.role==='lead'; },
    async create(rec){
      const id='r'+Date.now().toString(36)+Math.floor(Math.random()*1e4).toString(36);
      const full={ id, cat:rec.cat||'', type:rec.type||'', typeLabel:rec.typeLabel||'', title:rec.title||'',
        detail:rec.detail||'', refKey:rec.refKey||'', refTab:rec.refTab||'', refId:rec.refId||'', refLabel:rec.refLabel||'',
        targetKey:rec.targetKey||'', targetName:rec.targetName||'', permMode:rec.permMode||'',
        // 처리 담당자 지정(선택) — 비우면 기존처럼 부서장 → 관리자 순으로 전달
        toId:rec.toId||'', toName:rec.toName||'', toRole:rec.toRole||'',
        fromId:rec.fromId||'', fromName:rec.fromName||'', fromDept:rec.fromDept||'',
        status:'sent', createdAt:nowISO(), resolution:'', resolvedBy:'', resolvedName:'', resolvedAt:'',
        timeline:[{ at:nowISO(), by:rec.fromId||'', byName:rec.fromName||'', act:'sent', note:'' }] };
      const ok=await rPush(full); return ok?full:null;
    },
    async transition(rec, act, opt){ opt=opt||{};
      const t={ at:nowISO(), by:opt.by||'', byName:opt.byName||'', act, note:opt.note||'' };
      const r={ ...rec, timeline:(rec.timeline||[]).concat([t]) };
      if(act==='doing') r.status='doing';
      else if(act==='done'){ r.status='done'; r.resolvedBy=opt.by||''; r.resolvedName=opt.byName||''; r.resolvedAt=nowISO(); r.resolution=opt.note||r.resolution; }
      else if(act==='rejected'){ r.status='rejected'; r.resolvedBy=opt.by||''; r.resolvedName=opt.byName||''; r.resolvedAt=nowISO(); r.resolution=opt.note||r.resolution; }
      else if(act==='reopen') r.status='sent';
      const ok=await rPush(r); return ok?r:null;
    },
    async remove(id){ return rDel(id); },
    // 내가 보낸 요청
    fromMe(list, me){ const id=me.loginId, nm=me.name; return (list||[]).filter(a=>a.fromId===id || (nm&&a.fromName===nm)); },
    /* 내가 처리해야 하는 요청
       · 담당자를 지정한 요청(toId) → 지정된 사람에게만 (관리자는 전체 감독을 위해 계속 열람)
       · 지정하지 않은 요청 → 기존과 동일하게 부서장(자기 부서) → 관리자 */
    inbox(list, me){ if(!Req.isHandler(me)) return [];
      if(me.role==='admin') return (list||[]).slice();
      return (list||[]).filter(a=> a.toId ? a.toId===me.loginId
        : (a.fromDept && a.fromDept===me.dept)); },
    /* 나에게 '지정'된 요청인지 — 처리함에서 강조 표시용 */
    isAssignedTo(rec, me){ return !!(rec && rec.toId && me && rec.toId===me.loginId); },
  };
  if(typeof window!=='undefined') window.Req=Req;
})();
