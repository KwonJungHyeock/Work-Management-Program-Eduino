/* ===========================================================================
   설정/데이터 레이어  (DB 연동 전까지 이 파일이 기준값)
   =========================================================================== */

/* 로그인은 서버(api/auth.js) + 관리자 발급 계정으로 처리합니다.
   (초기 관리자: 아이디 admin / 접속코드는 Vercel 환경변수 ADMIN_CODE, 미설정 시 robodyne12) */

/* 지원 이미지 포맷 (브라우저 Canvas 로 인코딩 가능한 것) */
const FORMATS = {
  jpg:  { label:'JPG',  mime:'image/jpeg', ext:'jpg',  quality:true,  desc:'범용·저용량 (쇼핑몰 표준)' },
  png:  { label:'PNG',  mime:'image/png',  ext:'png',  quality:false, desc:'투명 배경·텍스트 선명' },
  webp: { label:'WEBP', mime:'image/webp', ext:'webp', quality:true,  desc:'최신·저용량 (자사몰/네이버)' },
};
/* 원본 통이미지 포함 옵션의 키 */
const KEEP_ORIGINAL = 'orig';
/* JPG/WEBP 인코딩 품질 (설정 UI 없이 고정값) */
const IMG_QUALITY = 0.9;

/* 플랫폼 기본 세팅 (2026 조사 기준 · 사용자가 대시보드에서 편집 가능)
   width  : 권장 가로(px, 0=원본유지)
   maxH   : 1장 최대 세로(px, 0=제한없음) → 자동분할 기본 높이
   maxMB  : 업로드 용량 상한(참고 경고용)
   formats: 기본 출력 포맷 */
/* logo: 있으면 카드에 이미지로 표시(assets/platform-logos/), 로드 실패 시 short/color 모노그램으로 대체 */
/* 플랫폼 프리셋 (변환기 빠른 선택 · 사용자가 추가/수정 가능) */
const DEFAULT_PRESETS = [
  { id:'openmarket', name:'오픈마켓', ids:['naver','coupang','st11','gmarket','auction'] },
  { id:'ownmall',    name:'자사몰',   ids:['eduino'] },
];

const DEFAULT_PLATFORMS = [
  { id:'naver',  name:'네이버 스마트스토어', prefix:'네이버',  short:'N',  color:'#03c75a', logo:'assets/platform-logos/naver.svg',   width:860,  maxH:5000, maxMB:20, formats:['jpg','png'] },
  { id:'coupang',name:'쿠팡',              prefix:'쿠팡',   short:'쿠', color:'#f43142', logo:'assets/platform-logos/coupang.svg', width:1000, maxH:3000, maxMB:5,  formats:['jpg','png'] },
  { id:'st11',   name:'11번가',            prefix:'11번가', short:'11', color:'#e51b25', logo:'assets/platform-logos/st11.svg',    width:800,  maxH:0,    maxMB:10, formats:['jpg'] },
  { id:'gmarket',name:'G마켓',             prefix:'G마켓',  short:'G',  color:'#00a05a', logo:'assets/platform-logos/gmarket.svg', width:860,  maxH:4000, maxMB:10, formats:['jpg'] },
  { id:'auction',name:'옥션',              prefix:'옥션',   short:'A',  color:'#d0111b', logo:'assets/platform-logos/auction.svg', width:860,  maxH:3600, maxMB:10, formats:['jpg'] },
  { id:'eduino', name:'에듀이노 쇼핑몰',    prefix:'에듀이노',short:'E',  color:'#e31e24', logo:'',                                  width:860,  maxH:0,    maxMB:0,  formats:['jpg','png','webp'] },
];

/* 입점사 발주 자동화 --------------------------------------------------------- */
/* 구글시트 발주표 컬럼 순서 (실제 시트에 맞춰 수정) */
/* 발주표 컬럼: 카페24 자동 '상품코드'가 아니라 '자체상품코드'를 사용 */
const ORDER_SHEET_COLS = ['일자','구분','주문경로','주문자명','입점사명','정산구분','자체상품코드','품명','수량','출고송장/입고','발주','배송정보/비고'];
const SETTLE_TYPES = ['선결제','월정산'];

/* 구글시트 전송 문구 — CS·MD 공통 (워딩/방식 통일) */
const SHEET_MSG = {
  badgeDone:'전송됨', badgePending:'미전송',
  sending:  '시트로 전송 중…',
  ok:       n=>`시트에 전송했습니다 · ${n}건`,
  unconf:   n=>`시트로 전송함 · ${n}건 (시트에서 확인)`,
  fail:     e=>`시트 전송 실패 — 로컬에 보관됨${e?` · ${e}`:''}`,
  allSent:  '모든 항목이 시트에 전송되었습니다',
  noUrl:    '연동 설정에서 시트 URL을 먼저 등록하세요',
};
/* 상품 마스터 · selfCode(자체상품코드)가 기준 · code(카페24 상품코드)는 참고용(선택) · 실제 데이터는 임포트로 교체 */
const DEFAULT_MD_PRODUCTS = [
  { selfCode:'P-U22',  code:'', vendor:'아이씨뱅큐', settle:'월정산', name:'Nextion HMI LCD(정전식 터치, 7인치 NX8048P070-011C, 스마트형)', ship:'' },
  { selfCode:'P-BH31', code:'', vendor:'퓨나스',     settle:'월정산', name:'[LEGO] 스파이크 프라임 미디엄 앵글 모터', ship:'' },
  { selfCode:'P-BA10', code:'', vendor:'새온',       settle:'월정산', name:'[알티노] 언플러그드 크레용 / 교재', ship:'' },
  { selfCode:'P-AJ64', code:'', vendor:'삼쩜일사',   settle:'선결제', name:'[로봇과 함께하는 인공지능 교육 12차시 태블릿&크롬북 활용 교재] 카미봇파이 워크북', ship:'' },
];
/* 입점사 정보 (배송비 vat포함 + 무료배송조건/담당자/연락처/발주메일/특이사항)
   · 상품에 개별 배송비가 있으면 그 값이 우선 · 실제 목록은 data/입점사_배송정보.csv 임포트 */
const DEFAULT_MD_VENDORS = [
  { name:'자사',       ship:3000, policy:'자사 상품 (모두 3,000원)', manager:'', contact:'', email:'', note:'' },
  { name:'삼쩜일사',   ship:5100, policy:'',                    manager:'', contact:'', email:'', note:'' },
  { name:'아이씨뱅큐', ship:0,    policy:'무료배송',            manager:'', contact:'', email:'', note:'' },
  { name:'다산북스',   ship:2500, policy:'2,500원 - 3만원 이상 구매', manager:'김재민 본부장', contact:'070-4481-2631', email:'leehan011@dasanbooks.com', note:'' },
];

/* 프로그램 명칭 */
const APP_NAME = '에듀이노 통합 업무관리';
const APP_NAME_FULL = '에듀이노 통합 업무관리 프로그램';
const APP_VERSION = 'v1.0';

/* 상단 사내 바로가기 링크 (여기만 수정하면 버튼이 추가/변경됩니다) */
const QUICK_LINKS = [
  { name:'에듀이노몰',    short:'몰',  url:'https://eduino.kr' },
  { name:'카페24 관리자', short:'24', url:'https://eclogin.cafe24.com/Shop/?url=Init&login_mode=2&is_multi=F' },
];

/* CS 상담 메모 — 연동 구글시트 컬럼(날짜·분류·연락처·고객유형·주문자/학교/업체명·상품분류·상품코드·내용·답변·상담사)에 맞춘 값
   · 수정이 잦은 값은 상수로 분리 (분류는 사용자가 화면에서 편집 가능) */
const CS_INQUIRY_TYPES = ['후불','견적','대량견적','상품/재고','주문/배송','기타'];   // 시트 '분류'
const CS_CUSTOMER_TYPES = ['유치원','초등학교','중학교','고등학교','대학교','기관','개인','업체','입점사','파트너사']; // 시트 '고객유형' (학교 세분화)
const CS_PRODUCT_CATEGORIES = ['자사키트','자사부품','입점사키트','입점사부품']; // 시트 '상품분류'
const CS_ORDER_ROUTES = ['사이트','스팜','후불','발주'];                     // 시트 '주문경로'
const CS_AGENTS = ['함인영','신아름','송민희','박정길'];                      // 시트 '상담사'
/* 상담 메모 내부필드 → 구글시트 헤더 이름 매핑 (Apps Script가 헤더 이름으로 칸을 맞춤) */
const CS_SHEET_MAP = {
  date:'날짜', category:'분류', route:'주문경로', contact:'연락처', customerType:'고객유형',
  name:'주문자/학교/업체명', prodCategory:'상품분류', prodCode:'상품코드',
  content:'내용', answer:'답변', agent:'상담사',
};

/* TS 상담 메모(MD 파트) — 노션 시트 구조 그대로: 날짜·문의플랫폼·담당자·상품코드·상품구분·제품명·고객정보·문의사항·답변요약·답변원본·비고
   · 문의플랫폼/상품구분은 칩 토글(편집 가능) · 담당자 지정 · 상품코드 입력 시 제품명 자동연동 · 나머지는 수기입력 */
const TS_PLATFORMS = ['게시판','쿠팡','카카오톡','메일','네이버톡톡'];              // 시트 '문의플랫폼'
const TS_AGENTS = ['여미림','이진환'];                                              // 시트 '담당자'
const TS_PRODUCT_TYPES = ['제품추천','자사제품','자사키트','입점사키트','입점사부품']; // 시트 '상품구분'
/* TS 상담 메모 내부필드 → 구글시트 헤더 이름 매핑 */
const TS_SHEET_MAP = {
  date:'날짜', platform:'문의플랫폼', agent:'담당자', prodCode:'상품코드', prodType:'상품구분',
  prodName:'제품명', customer:'고객정보', content:'문의사항',
  answerSummary:'답변요약', answer:'답변원본', remark:'비고',
};

/* 좌측 내비게이션 구조 (활성: CS·MD / 예정: 디자인·경리)
   각 item.key 는 모듈 레지스트리(app.js MODULES) 키와 일치 */
const NAV = [
  { dept:'home', name:'홈', full:'공통', icon:'dashboard', common:true, items:[
      { key:'home.dash',   name:'홈 대시보드', icon:'dashboard' },
      { key:'home.alerts', name:'알림',        icon:'bell' },
      { key:'home.notice', name:'공지사항',   icon:'megaphone' },
      { key:'home.memo',   name:'업무 메모',   icon:'send' },
  ]},
  { dept:'cs', name:'CS', full:'고객 상담', icon:'headset', items:[
      { key:'cs.notes',     name:'CS상담 메모',   icon:'clipboard' },
      { key:'cs.records',   name:'CS상담 기록',   icon:'sheet' },
      { key:'cs.postpay',   name:'후불/발주',     icon:'truck' },
      { key:'cs.exchange',  name:'교환/반품',     icon:'refresh' },
      { key:'cs.china',     name:'중국 발주요청', icon:'box' },
      { key:'cs.templates', name:'답변 템플릿', icon:'chat' },
      { key:'cs.mailtpl',   name:'메일 템플릿', icon:'mail' },
      { key:'cs.lookup',    name:'상품 조회',   icon:'search' },
  ]},
  { dept:'md', name:'MD', full:'상품 기획', icon:'box', items:[
      { key:'md.order',     name:'입점사 발주',        icon:'truck' },
      { key:'md.records',   name:'발주 기록',          icon:'sheet' },
      { key:'md.vendorchg', name:'입점사 신규/변동',   icon:'truck' },
      { key:'md.stock',     name:'품절관리 현황',      icon:'box' },
      { key:'md.inspect',   name:'제품검수 현황',      icon:'check' },
      { key:'md.prodmgmt',  name:'상품관리 현황',      icon:'grid' },
      { key:'md.tsnotes',   name:'TS상담 메모',        icon:'clipboard' },
      { key:'md.tsrecords', name:'TS상담 기록',        icon:'sheet' },
      { key:'md.extra',     name:'부가기능',           icon:'grid' },
  ]},
  { dept:'admin', name:'관리자', full:'계정·현황', icon:'shield', adminOnly:true, items:[
      { key:'admin.insights', name:'업무 현황', icon:'chart' },
      { key:'admin.users', name:'팀원 계정', icon:'users' },
      { key:'admin.share', name:'공유 범위', icon:'share' },
      { key:'admin.audit', name:'감사 로그', icon:'clipboard' },
  ]},
];
/* 디자인·경리는 개발 예정 — 사이드바에서 숨김(백업은 backup/first-draft/에 보존) */

/* 직무 자동열람 기능 — 해당 부서 구성원이면 별도 권한 부여 없이 열람 가능(관리자는 전체).
   누적 시트(전 직원 공유 기록)는 부서 기본 열람으로 둔다. */
const DEPT_OPEN_KEYS = ['cs.records', 'cs.lookup', 'cs.china', 'cs.exchange', 'cs.postpay', 'md.records', 'md.tsrecords',
  'md.vendorchg', 'md.stock', 'md.inspect', 'md.prodmgmt'];

const STORE = {
  session:  'eduino.session',   // { device, code, ts }
  device:   'eduino.device',    // 기기 이름 (이 PC에 고정 저장)
  platforms:'eduino.platforms', // 플랫폼 세팅 오버라이드
  mdPresets:'eduino.md.presets', // 플랫폼 프리셋
  mdProducts:'eduino.md.products', // 상품 마스터
  mdVendors:'eduino.md.vendors',   // 입점사 배송비
  mdOrderCfg:'eduino.md.order.cfg', // 발주 구글시트 연동 설정
  csTpl:    'eduino.cs.templates',
  csMailTpl:'eduino.cs.mailtpl',      // 메일 템플릿(고객 메일용)
  csNotes:  'eduino.cs.notes',       // 상담 메모 레코드 배열
  csNoteCfg:'eduino.cs.notes.cfg',   // { sheetUrl, syncMode }
  csAgent:  'eduino.cs.notes.agent', // 마지막 선택 담당자
  csAgents: 'eduino.cs.notes.agents',// 상담사 목록(사용자 편집)
  csTypes:  'eduino.cs.notes.types', // 문의유형 목록(사용자 편집)
  csSumTpl: 'eduino.cs.notes.sumtpl',// 일일 결산 저장 양식(커스텀)
  tsNotes:  'eduino.ts.notes',           // TS 상담 메모 레코드 배열
  tsNoteCfg:'eduino.ts.notes.cfg',       // { sheetUrl, backup }
  tsAgent:  'eduino.ts.notes.agent',     // 마지막 선택 담당자
  tsAgents: 'eduino.ts.notes.agents',    // 담당자 목록(사용자 편집)
  tsTypes:  'eduino.ts.notes.platforms', // 문의플랫폼 목록(사용자 편집)
  tsSumTpl: 'eduino.ts.notes.sumtpl',    // TS 일일 결산 저장 양식(커스텀)
  syncCfg:  'eduino.sync.cfg',       // 공용 저장소(구글) 연동 { url, autoPull }
  shareMap: 'eduino.share.map',      // 공유 범위 오버라이드 { settingKey: 'all'|'cs'|'md' } (전사 공유)
  catMap:   'eduino.md.catmap',      // 이카운트 코드→이름표 { vendor:{코드:구매처명}, category:{코드:분류명} }
};

/* 공유 범위 — 설정마다 "누가 공유받는가"를 지정 (①부서 단위)
   all=전사 / cs=CS 부서 / md=MD 부서. 관리자가 [공유 범위] 화면에서 변경 가능. */
const SHARE_SCOPES = [
  { id:'all', label:'전사', dept:'home' },
  { id:'cs',  label:'CS',   dept:'cs' },
  { id:'md',  label:'MD',   dept:'md' },
];
/* 각 공유 설정의 기본 범위 (부서 전용 설정은 해당 부서끼리만) */
const SHARE_DEFAULT = {
  [STORE.platforms]:'md', [STORE.mdPresets]:'md', [STORE.mdProducts]:'md',
  [STORE.mdVendors]:'md', [STORE.mdOrderCfg]:'md', [STORE.catMap]:'all',
  [STORE.csTpl]:'cs', [STORE.csMailTpl]:'cs', [STORE.csNoteCfg]:'cs', [STORE.csAgents]:'cs',
  [STORE.csTypes]:'cs', [STORE.csSumTpl]:'cs',
  [STORE.tsNoteCfg]:'md', [STORE.tsAgents]:'md', [STORE.tsTypes]:'md', [STORE.tsSumTpl]:'md',
  'eduino.board.exchange.cfg':'cs', 'eduino.board.postpay.cfg':'cs',
  'eduino.board.vendorchg.cfg':'md', 'eduino.board.stockmgmt.cfg':'md', 'eduino.board.inspect.cfg':'md', 'eduino.board.prodmgmt.cfg':'md',
  [STORE.shareMap]:'all',            // 범위 표 자체는 전사 공유(모두 같은 규칙을 봄)
};
/* 설정 키의 현재 유효 범위 = 관리자 오버라이드(shareMap) > 기본값 > all */
function shareScopeOf(key){
  let ov={}; try{ ov=(store(STORE.shareMap).get({}))||{}; }catch(e){}
  const sc=ov[key]||SHARE_DEFAULT[key]||'all';
  return SHARE_SCOPES.some(s=>s.id===sc)?sc:'all';
}
/* 로그인 사용자가 받아볼 범위 목록 (관리자=전체, 팀원=전사+자기부서) */
function myShareScopes(){
  const u=(typeof Auth!=='undefined'&&Auth.user&&Auth.user())||null;
  if(u&&u.role==='admin') return ['all','cs','md'];
  if(u&&u.dept&&SHARE_SCOPES.some(s=>s.id===u.dept)) return ['all',u.dept];
  return ['all'];
}

/* 공용(구글) 동기화 대상 = 팀 공통 설정만 (기기/세션/상담·발주 거래데이터 제외) */
const SHARED_SETTING_KEYS = [
  STORE.platforms, STORE.mdPresets, STORE.mdProducts, STORE.mdVendors,
  STORE.mdOrderCfg, STORE.csTpl, STORE.csMailTpl, STORE.csNoteCfg, STORE.csAgents,
  STORE.csTypes, STORE.csSumTpl, STORE.tsNoteCfg, STORE.tsAgents, STORE.tsTypes, STORE.tsSumTpl,
  STORE.shareMap, STORE.catMap,
  // 현황판/CS 신설 페이지 구글시트 연동 URL (모듈별 · 팀 공유)
  'eduino.board.exchange.cfg', 'eduino.board.postpay.cfg',
  'eduino.board.vendorchg.cfg', 'eduino.board.stockmgmt.cfg', 'eduino.board.inspect.cfg', 'eduino.board.prodmgmt.cfg',
];
/* 동기화 항목의 사람이 읽는 이름 (무엇이 올라가는지 화면 표시용) */
const SHARED_LABELS = {
  [STORE.platforms]:'플랫폼 설정',
  [STORE.mdPresets]:'플랫폼 프리셋',
  [STORE.mdProducts]:'상품 마스터',
  [STORE.mdVendors]:'입점사 정보(배송비·정책)',
  [STORE.mdOrderCfg]:'발주 시트 연동 URL',
  [STORE.csTpl]:'CS 답변 템플릿',
  [STORE.csMailTpl]:'CS 메일 템플릿',
  [STORE.csNoteCfg]:'CS 상담시트 연동 URL',
  [STORE.csAgents]:'상담사 목록',
  [STORE.csTypes]:'CS 분류',
  [STORE.csSumTpl]:'결산 저장 양식',
  [STORE.tsNoteCfg]:'TS 상담시트 연동 URL',
  [STORE.tsAgents]:'TS 담당자 목록',
  [STORE.tsTypes]:'TS 문의플랫폼',
  [STORE.tsSumTpl]:'TS 결산 저장 양식',
  'eduino.board.exchange.cfg':'교환/반품 시트 연동 URL',
  'eduino.board.postpay.cfg':'후불/발주 시트 연동 URL',
  'eduino.board.vendorchg.cfg':'입점사 신규/변동 시트 연동 URL',
  'eduino.board.stockmgmt.cfg':'품절관리 시트 연동 URL',
  'eduino.board.inspect.cfg':'제품검수 시트 연동 URL',
  'eduino.board.prodmgmt.cfg':'상품관리 시트 연동 URL',
  [STORE.shareMap]:'공유 범위 규칙',
  [STORE.catMap]:'이카운트 구매처·분류 이름표',
};

/* 이카운트 코드→이름 치환 헬퍼 (구매처명·분류명) — 카탈로그엔 코드만, 이름은 팀 공유 이름표에서 */
function catNameMap(){ try{ const m=store(STORE.catMap).get({}); return { vendor:(m&&m.vendor)||{}, category:(m&&m.category)||{} }; }catch(e){ return {vendor:{},category:{}}; } }
const catCodeNorm = s => String(s||'').replace(/[^0-9a-z]/gi,'');
function catMapGet(map, code){ const k=catCodeNorm(code); return map[k] || map[k.replace(/^0+/,'')] || ''; }
/* 관리자 이름표(catMap) 우선 → 내장 거래처 기본값(VENDOR_DEFAULTS) → API vendor 폴백.
   내장 기본값은 이카운트 거래처등록 파일(거래처코드→거래처명)을 앱에 포함한 것 · 관리자가 [이카운트 매핑]에서 저장하면 그 값이 우선 */
function catVendorName(p){ if(!p) return '';
  return catMapGet(catNameMap().vendor, p.custCode)
      || catMapGet((typeof window!=='undefined'&&window.VENDOR_DEFAULTS)||{}, p.custCode)
      || p.vendor || ''; }
function catCategoryName(p){ if(!p) return ''; return catMapGet(catNameMap().category, p.classCode) || p.category || ''; }
