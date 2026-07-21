/* ===========================================================================
   직무 지도(Responsibility Map) — 데이터 + 키워드 매칭 엔진
   - 직원 1명 = { name, dept, role, sections:[{label,w,groups:[{name,items:[]}]}] }
     · label: 상시-공통 / 상시-담당 / 담당 / 서브 (자유 라벨)
     · w(가중치): 상시 3 · 담당 2 · 서브 1  → 지시 매칭 점수에 반영
   - window.DUTY_SEED: 초기 5명(경리/CS/MD) 시드. 서버 컬렉션(duties)이 비어있을 때만 사용
   - window.Duties: load()/save()/match(text) — 팀 전체 공유(coll), 브라우저 내 매칭
   ========================================================================= */
(function(){
  // 시드 헬퍼: g(그룹명, ...세부업무) / S(라벨, 가중치, [g,...]) / P(이름,부서,역할, [S,...])
  const g = (name, ...items)=>({ name, items });
  const S = (label, w, groups)=>({ label, w, groups });
  const P = (name, dept, role, sections)=>({ name, dept, role, sections });

  const DUTY_SEED = [
    P('송민희','acct','member',[
      S('상시-경리',3,[
        g('계산서 관리','입점사 선결제 및 월정산 전자세금계산서 발행 확인','카페24 전자세금계산서 발행처리'),
        g('학교장터/나라장터','학교장터 주문접수 처리','학교/기관 계약서류 작성 및 날인'),
        g('후불','후불 입금 매칭 및 결제 일정 확인','서류 발행','후불결제 관리대장 관리','후불 배송 관리(발송지연/교환/반품/출고 일정안내)'),
      ]),
      S('담당',2,[
        g('세무','부가세/법인세 준비','세무 증빙자료 관리','팀장들 법카 영수증 관리'),
        g('인사-근태/연차','메일플러그 근태 월 정산','연차 관리'),
        g('금융기관 대외 대응','은행/기관 서류 업무처리'),
      ]),
      S('서브',1,[
        g('CS보조-주문관리','CS연차 대체근무','카페24/오픈마켓 주문관리','채널 상담(카카오/네이버톡톡)','배송 관리(발송지연/교환/반품/출고 일정안내)'),
        g('정부지원금','내일채움공제, 육휴, 고용 등 인건비 지원'),
        g('비품','탕비실, 사무용품 재고 관리'),
        g('사무실 방문 응대','고객/거래처/손님 등 사무실 방문 응대'),
      ]),
    ]),
    P('신아름','cs','member',[
      S('상시-CS공통',3,[
        g('주문관리-카페24/오픈마켓','채널 상담(카카오/네이버톡톡)','배송 관리(발송지연/교환/반품/출고 일정안내)','게시글 관리(견적문의/서류요청/묻고답하기/후기)','회원관리(티처십/B2B)','적립금 지급'),
        g('고객DB관리','카페24 회원(등급/단골) 관리','구글시트 고객DB 구축','메일플러그 연락처(학교/기관) DB관리'),
      ]),
      S('상시-담당',3,[
        g('학교/기관 견적 및 발주','예산 맞춤 견적 등 및 납기 안내','입금확인, 거래명세서 발급','배송관리(납기체크, 교환/반품)'),
        g('후불-경리대행','후불 입금 매칭 및 결제 일정 확인','서류 발행','후불결제 관리대장 관리','후불 배송 관리(발송지연/교환/반품/출고 일정안내)'),
        g('쿠팡','고객 문의 답변','취소/교환/반품/배송 관리'),
        g('파트너사-플랫폼','티처몰/아이스크림몰/쌤활용품점/DS스토어','이카운트 매출입력 및 결산 기록','파트너사 공문발송(신규/단종/판매가변동 등)'),
        g('일일 결산','결산 파일 업로드 및 누락 사항 확인 마감'),
      ]),
      S('서브',1,[
        g('택배','택배 운임 월정산'),
        g('카페24-고객','후기 적립금 지급'),
        g('입점사-고객','모노플로우 라이센스 안내 메일 발송'),
      ]),
    ]),
    P('함인영','cs','lead',[
      S('상시-CS공통',3,[
        g('주문관리-카페24/오픈마켓','채널 상담(카카오/네이버톡톡)','배송 관리(발송지연/교환/반품/출고 일정안내)','게시글 관리(견적문의/서류요청/묻고답하기/후기)','회원관리(티처십/B2B)','적립금 지급'),
        g('고객DB관리','카페24 회원(등급/단골) 관리','구글시트 고객DB 구축','메일플러그 연락처(파트너사) DB관리'),
      ]),
      S('상시-담당',3,[
        g('B2B/개인 견적 및 발주','예산 맞춤 견적 및 납기 안내','입금확인, 거래명세서, 전자세금계산서 발급','배송관리(납기체크, 교환/반품)'),
        g('학교장터','신규 상품등록 및 상품관리','주문접수 및 서류 발송'),
        g('G마켓&옥션/11번가','고객 문의 답변','취소/교환/반품/배송 관리'),
        g('파트너사 주문관리','파트너사 공문발송(신규/단종/판매가변동 등)','파트너사 최저가 검수','A등급(아이씨뱅큐/엔티렉스) 일일 거래명세서 발송','A등급(아이씨뱅큐/엔티렉스) 월말 거래원장 발송 및 전자세금계산서 발행'),
      ]),
      S('서브',1,[
        g('경리대행(임시)','입점사 선결제 및 월말정산 전자세금계산서 발행 확인','쿠팡 전자세금계산서 발행','학교장터 주문접수','학교/기관 계약서류 작성 및 날인','카페24 전자세금계산서 발행'),
      ]),
    ]),
    P('여미림','md','member',[
      S('상시-MD공통',3,[
        g('쇼핑몰 운영/관리','카페24/스마트스토어/EMS/11번가/쿠팡로켓배송 상품 관리','상품 큐레이션 태깅','SEO최적화(키워드, 상세)'),
        g('고객별 제품추천리스트','학교 고객 Case를 구분하고 제품을 추천해주는 리스트를 구축/관리하여 CS를 서포트'),
      ]),
      S('상시-담당',3,[
        g('입점사-월정산업체','발주 관리','재고/납기일/공급가 조정'),
      ]),
      S('담당',2,[
        g('CRM마케팅','카페(아두이노스토리) 운영 담당','카페 서포터즈 담당','이프두 CRM 관리','GEO젠투 관리(가이드라인)'),
        g('자사 상품관리','카페24','파트너사(플랫폼)-ESM/11번가/토스쇼핑'),
        g('입점사 상품관리','카페24/스마트스토어 상품관리','입점사 자료 관리'),
        g('입점사 DB관리-월정산업체','입점사상품 자료(강의, Datasheet, 사업자)','메일플러그 연락처 DB관리'),
        g('프로모션','[할인전] 프로모션 기획 및 관리','자사 메인 배너 기획'),
      ]),
      S('서브',1,[
        g('상품소싱-에듀테크/피지컬AI','신규 입점사 유치','기존 입점사 신제품'),
        g('자사 입고검수','자사제품 입품시 검수'),
        g('기술문의 TS','자사 TS 보조'),
        g('매출 데이터 분석','월별 매출데이터 취합 및 관리','상/하반기 매출데이터'),
      ]),
    ]),
    P('이진환','md','lead',[
      S('상시-MD공통',3,[
        g('쇼핑몰 운영/관리','카페24/스마트스토어/EMS/11번가/쿠팡로켓배송 상품 관리','상품 큐레이션 태깅','SEO최적화(키워드, 상세)'),
        g('고객별 제품추천리스트','학교 고객 Case를 구분하고 제품을 추천해주는 리스트를 구축/관리하여 CS를 서포트'),
      ]),
      S('상시-담당',3,[
        g('입점사-선결제업체','발주 관리','재고/납기일/공급가 조정'),
        g('기술문의 TS','자사 TS 담당'),
      ]),
      S('담당',2,[
        g('블로그 바이럴마케팅','네이버-에듀이노랩, 티스토리','매크로 바이럴마케팅'),
        g('자사 상품관리','카페24/스마트스토어','파트너사(플랫폼)-아이스크림몰/쌤에듀테크/티처몰/DS스토어/칭찬나라큰나라'),
        g('자사-쿠팡','쿠팡 Wing','쿠팡로켓배송'),
        g('입점사 DB관리-선결제업체','입점사상품 자료(강의, Datasheet, 사업자)','메일플러그 연락처 DB관리'),
        g('입점사 DB관리-보드 카테고리','입점사상품 자료(강의, Datasheet, 사업자)','공급가 주기적 모니터링 & 업데이트'),
        g('SEO/GEO최적화','상품명, 상세페이지, 키워드, 색인'),
      ]),
      S('서브',1,[
        g('상품소싱-보드/센서/전자부품','보드/센서/부품 카테고리 담당'),
        g('자사 입고검수','자사제품 입품시 검수','검수제품 기록 관리'),
        g('신규 프로젝트-마우저','마우저 통한 SeedStudio 상품 입점 추진'),
      ]),
    ]),
  ];

  // 부서 라벨
  const DEPT_LABEL = { hq:'에듀이노 총괄', acct:'경리', cs:'CS', md:'MD', logi:'물류', admin:'대표' };

  /* ── 키워드 토크나이저 ─────────────────────────────────────────────
     한글/영문/숫자 토막을 뽑아 길이 2+ 만 사용. 조사·초일반 단어는 제외. */
  const STOP = new Set(['관리','처리','확인','업무','담당','기타','관련','사항','안내','대응','지원','서포트','및','등','신규','기존','월정','기준']);
  function tokens(text){
    const s = String(text||'').toLowerCase();
    const raw = s.split(/[^0-9a-z가-힣]+/i).filter(Boolean);
    const out = new Set();
    for(let w of raw){
      // 흔한 조사 꼬리 제거(간단 휴리스틱)
      w = w.replace(/(으로|에서|에게|이나|하고|해줘|해주|처리|합니다|한다|하는|들어온|들어)$/,'');
      if(w.length<2) continue;
      if(STOP.has(w)) continue;
      out.add(w);
    }
    return out;
  }

  const uid = ()=> 'd'+Date.now().toString(36)+Math.floor(Math.random()*1e4).toString(36);
  function withIds(list){
    return (list||[]).map(p=>({
      id: p.id||uid(), name:p.name, dept:p.dept||'', role:p.role||'member',
      sections: (p.sections||[]).map(sec=>({ label:sec.label, w:sec.w||1,
        groups:(sec.groups||[]).map(gr=>({ name:gr.name, items:Array.isArray(gr.items)?gr.items.slice():[] })) })),
      updatedBy:p.updatedBy||'', updatedAt:p.updatedAt||''
    }));
  }

  /* ── 서버 컬렉션 연동(coll='duties') ── */
  async function collGet(){ try{ const r=await fetch('/api/store?type=coll&coll=duties'); if(!r.ok) throw 0; const d=await r.json(); return (d&&d.items)||[]; }catch(e){ return null; } }
  async function collPush(item){ try{ const r=await fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collPush',coll:'duties',item})}); return r.ok; }catch(e){ return false; } }
  async function collDel(id){ try{ const r=await fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collDel',coll:'duties',id})}); return r.ok; }catch(e){ return false; } }

  let cache=null;
  async function load(force){
    if(cache && !force) return cache;
    const items = await collGet();
    // 서버에 없으면 시드 사용(읽기 전용 폴백 — 저장 시 서버로 승격)
    cache = (items && items.length) ? withIds(items) : withIds(DUTY_SEED);
    cache._seeded = !(items && items.length);
    return cache;
  }
  async function save(person){ const ok=await collPush(person); if(ok) cache=null; return ok; }
  async function remove(id){ const ok=await collDel(id); if(ok) cache=null; return ok; }
  // 시드를 서버로 1회 승격(관리자가 처음 저장할 때)
  async function seedToServer(){ let n=0; for(const p of withIds(DUTY_SEED)){ if(await collPush(p)) n++; } cache=null; return n; }

  /* ── 매칭 엔진 ──────────────────────────────────────────────────────
     - 각 세부업무를 토큰화, 전 직원 대상 idf(희소 토큰 가중) 계산
     - 질의 토큰과 겹치는 업무들의 (섹션가중치 × Σidf) 합으로 인물 점수화
     - 반환: [{ person, score, hits:[{section,group,item,w}] }] 점수 내림차순 */
  function buildIndex(people){
    const df = new Map(); const N = { items:0 };
    const idxPeople = people.map(p=>{
      const items=[];
      (p.sections||[]).forEach(sec=>(sec.groups||[]).forEach(gr=>(gr.items||[]).forEach(it=>{
        const tk = tokens(gr.name+' '+it);
        items.push({ section:sec.label, w:sec.w||1, group:gr.name, item:it, tk });
        N.items++; tk.forEach(t=>df.set(t,(df.get(t)||0)+1));
      })));
      // 그룹명 자체도 약한 매칭 대상(세부업무 없이 그룹만 매칭될 때)
      (p.sections||[]).forEach(sec=>(sec.groups||[]).forEach(gr=>{
        if(!(gr.items||[]).length){ const tk=tokens(gr.name); items.push({section:sec.label,w:sec.w||1,group:gr.name,item:'',tk}); N.items++; tk.forEach(t=>df.set(t,(df.get(t)||0)+1)); }
      }));
      return { p, items };
    });
    const idf = t => Math.log((N.items+1)/((df.get(t)||0)+1)) + 1;
    return { idxPeople, idf };
  }

  function match(text, opt){
    opt = opt||{};
    const people = (cache||withIds(DUTY_SEED)).filter(p=>!opt.dept || opt.dept==='all' || p.dept===opt.dept);
    const Q = tokens(text);
    if(!Q.size) return [];
    const { idxPeople, idf } = buildIndex(people);
    const res=[];
    idxPeople.forEach(({p, items})=>{
      let score=0; const hits=[];
      items.forEach(it=>{
        let s=0, common=0;
        it.tk.forEach(t=>{ if(Q.has(t)){ s+=idf(t); common++; } });
        if(common>0){ const w=it.w*s; score+=w; hits.push({ section:it.section, group:it.group, item:it.item, w }); }
      });
      if(score>0){ hits.sort((a,b)=>b.w-a.w); res.push({ person:p, score, hits:hits.slice(0,3), hitCount:hits.length }); }
    });
    res.sort((a,b)=>b.score-a.score);
    return res;
  }

  window.DUTY_SEED = DUTY_SEED;
  window.Duties = { load, save, remove, seedToServer, match, tokens, DEPT_LABEL, withIds };

  /* =========================================================================
     업무 지시(Assignments) — 팀장/관리자 → 담당자 지시, 상태 추적
     상태: sent(요청) → accepted(진행) → submitted(완료보고) → done(완료)
           · 지시자가 완료보고를 반려하면 feedback 남기고 accepted 로 복귀
     저장: 서버 공용 컬렉션 'assignments'
     ======================================================================= */
  const STATUS = { sent:'요청', accepted:'진행', submitted:'완료보고', done:'완료' };
  async function aGet(){ try{ const r=await fetch('/api/store?type=coll&coll=assignments'); if(!r.ok) throw 0; const d=await r.json(); return (d&&d.items||[]).filter(x=>x&&x.id); }catch(e){ return null; } }
  async function aPush(item){ try{ const r=await fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collPush',coll:'assignments',item})}); return r.ok; }catch(e){ return false; } }
  async function aDel(id){ try{ const r=await fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collDel',coll:'assignments',id})}); return r.ok; }catch(e){ return false; } }
  const nowISO = ()=> new Date().toISOString();

  const Assign = {
    STATUS,
    all: aGet,
    async send(rec){
      const id = 'a'+Date.now().toString(36)+Math.floor(Math.random()*1e4).toString(36);
      const full = { id, title:rec.title||'', detail:rec.detail||'', reportFormat:rec.reportFormat||'',
        fromId:rec.fromId||'', fromName:rec.fromName||'', toId:rec.toId||'', toName:rec.toName||'', toDept:rec.toDept||'',
        priority:rec.priority||'normal', due:rec.due||'', status:'sent', createdAt:nowISO(),
        acceptedAt:'', submittedAt:'', doneAt:'', progressNote:'', feedback:'',
        timeline:[{ at:nowISO(), by:rec.fromId||'', byName:rec.fromName||'', act:'sent', note:'' }] };
      const ok = await aPush(full); return ok?full:null;
    },
    // 상태 전이(현재 레코드를 받아 patch 후 저장) — 호출부가 최신 레코드 보유
    async transition(rec, act, opt){
      opt=opt||{}; const t={ at:nowISO(), by:opt.by||'', byName:opt.byName||'', act, note:opt.note||'' };
      const r={ ...rec, timeline:(rec.timeline||[]).concat([t]) };
      if(act==='accepted'){ r.status='accepted'; r.acceptedAt=nowISO(); }
      else if(act==='progress'){ r.status='accepted'; r.progressNote=opt.note||r.progressNote; }
      else if(act==='submitted'){ r.status='submitted'; r.submittedAt=nowISO(); r.progressNote=opt.note||r.progressNote; }
      else if(act==='feedback'){ r.status='accepted'; r.feedback=opt.note||''; }   // 반려 → 다시 진행
      else if(act==='done'){ r.status='done'; r.doneAt=nowISO(); }
      const ok=await aPush(r); return ok?r:null;
    },
    async remove(id){ return aDel(id); },
    async saveRaw(rec){ const ok=await aPush(rec); return ok?rec:null; },   // 과정기록 등 부분 갱신 저장
    mine(list, me){ const id=me.loginId, nm=me.name; return (list||[]).filter(a=>a.toId===id || (nm&&a.toName===nm)); },
    fromMe(list, me){ const id=me.loginId, nm=me.name; return (list||[]).filter(a=>a.fromId===id || (nm&&a.fromName===nm)); },
  };
  window.Assign = Assign;
})();
