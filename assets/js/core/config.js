/* ===========================================================================
   설정/데이터 레이어  (DB 연동 전까지 이 파일이 기준값)
   =========================================================================== */

/* 로그인은 서버(api/auth.js) + 관리자 발급 계정으로 처리합니다.
   (초기 관리자: 아이디 admin / 접속코드는 Vercel 환경변수 ADMIN_CODE, 미설정 시 robodyne12) */

/* 구분/상태 값 색상 태그 — 후불/발주·교환/반품·처리상태·분류 등 선택 항목을 값별로 색 구분
   · 의미 있는 값(완료=초록, 반품/품절=빨강 등)은 고정, 나머지는 값 해시로 안정적 배정
   · 앱 전반(결재함 상세·현황판 목록·기록 뷰)에서 window.tagColor(값)로 공유 사용 */
const TAG_PALETTE = [
  { bg:'#e8f0fe', fg:'#1f6feb' }, // 0 blue
  { bg:'#fdeef0', fg:'#e0313b' }, // 1 red
  { bg:'#e6f6ee', fg:'#0b8a4b' }, // 2 green
  { bg:'#fef1e0', fg:'#b26a00' }, // 3 amber
  { bg:'#f0eafe', fg:'#7b3ff2' }, // 4 purple
  { bg:'#e4f6f8', fg:'#0e8a9c' }, // 5 teal
  { bg:'#fdeaf4', fg:'#c02a83' }, // 6 pink
  { bg:'#eef1f6', fg:'#5b6675' }, // 7 gray
  { bg:'#eaf3e0', fg:'#5c8a1b' }, // 8 olive
  { bg:'#e8ecfb', fg:'#3f51b5' }, // 9 indigo
];
/* 같은 칸(구분/분류/상태)에 함께 나오는 값들이 서로 다른 색이 되도록 배정 */
const TAG_SEMANTIC = {
  // 완료/정상 = 초록
  '완료':2,'승인':2,'판매':2,'정상':2,'지급완료':2,'발주완료':2,
  // 발주 진행여부
  '발주전':7,'발주중':3,
  // 부정/위험 = 빨강
  '반품':1,'품절':1,'취소':1,'긴급':1,'발주취소':1,
  // 진행/주의 = 앰버
  '환불':3,'가격':3,'처리중':3,'진행':3,'진행중':3,'대기':3,'프로모션':3,'프로모션 현황':3,
  // 중립 = 회색
  '보류':7,'기타':7,'아카이브':7,'단종':7,'-':7,
  // 후불/발주·상품관리 구분값(같은 칸 내 구분)
  '발주':0,'신규상품':0,'신규':0,'신규입점':0,'접수':0,
  '견적':9,
  '후불':4,'상세페이지':4,
  '결제요청':6,'주문/배송':6,'썸네일':6,'누락':6,
  '대량견적':5,'교환':5,'월말정산':5,
  '상품/재고':8,'사고':8,'오배송':8,
  '선결제':3,
};
function tagColor(val){ const v=String(val==null?'':val).trim(); if(!v) return null;
  let idx = TAG_SEMANTIC[v];
  if(idx==null){ let h=0; for(let i=0;i<v.length;i++) h=(h*31+v.charCodeAt(i))>>>0; idx=h%TAG_PALETTE.length; }
  return TAG_PALETTE[idx]; }
/* HTML 배지(span) 생성 — extraClass 로 기존 클래스 유지 가능 */
function tagBadge(val, cls){ const v=String(val==null?'':val).trim(); if(!v) return '';
  const c=tagColor(v); const esc2=(typeof esc==='function')?esc:(x=>x);
  return `<span class="${cls||''}" style="background:${c.bg};color:${c.fg}">${esc2(v)}</span>`; }
if(typeof window!=='undefined'){ window.tagColor=tagColor; window.tagBadge=tagBadge; }

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
   · 상품에 개별 배송비가 있으면 그 값이 우선 · 전 직원 기본 탑재값은 vendors-ship-data.js(=integrations/source-data/입점사_배송정보.csv 자동생성)
   · 관리자가 [입점사 정보]에서 저장/임포트하면 그 값이 우선(팀 동기화). 번들 기본값 덕분에 동기화 전에도 배송비가 정확히 표시됨 */
const DEFAULT_MD_VENDORS = (typeof window!=='undefined' && Array.isArray(window.MD_VENDORS_DEFAULT) && window.MD_VENDORS_DEFAULT.length)
  ? window.MD_VENDORS_DEFAULT
  : [
      { name:'자사',       ship:3000, policy:'자사 상품 (모두 3,000원)', manager:'', contact:'', email:'', note:'' },
      { name:'아이씨뱅큐', ship:2700, policy:'2,700원 - 5만원 이상 구매', manager:'', contact:'', email:'', note:'' },
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
const CS_PRODUCT_CATEGORIES = ['자사키트','자사부품','입점사키트','입점사부품','에듀테크']; // 시트 '상품분류'
/* 고객 데이터베이스(원장) 타겟 = 고객유형. 값은 데이터시트 00_요약 집계(COUNTIF)와 정확히 일치해야 함(가운뎃점 · 포함) */
const CUSTDB_TARGETS = ['대학','고등','중등','초등','유아','공공기관','기업·학원','개인','파트너·입점사','미분류'];
/* CS 입력용 고객유형(친숙한 표기) → 원장 타겟(00_요약 집계값) 변환.
   CS는 유치원/초등학교/… 로 입력하고, 원장(21_거래내역)엔 유아/초등/… 로 저장되어 요약과 매칭됨 */
const CUSTTYPE_TO_TARGET = {
  '유치원':'유아', '어린이집':'유아', '초등학교':'초등', '중학교':'중등', '고등학교':'고등', '대학교':'대학',
  '기관':'공공기관', '개인':'개인', '업체':'기업·학원', '학원':'기업·학원',
  '입점사':'파트너·입점사', '파트너사':'파트너·입점사',
};
function custTypeToTarget(v){ v=String(v||'').trim(); return CUSTTYPE_TO_TARGET[v] || (CUSTDB_TARGETS.indexOf(v)>=0?v:(v?'미분류':'')); }
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
      { key:'home.mytasks', name:'업무·요청',   icon:'inbox' },   // [업무요청]+[받은 업무] 통합(구 '요청하기' 흡수)
      { key:'home.alerts', name:'알림',        icon:'bell' },
      { key:'home.notice', name:'공지사항',   icon:'megaphone' },
      { key:'home.calendar', name:'일정·달력',  icon:'check2' },
  ]},
  { dept:'cs', name:'CS', full:'고객 상담', icon:'headset', items:[
      { key:'cs.notes',     name:'CS상담 메모',   icon:'clipboard' },
      { key:'cs.postpay',   name:'견적/발주/후불', icon:'truck' },
      { key:'cs.exchange',  name:'교환/반품/환불', icon:'refresh' },
      { key:'cs.china',     name:'중국 발주요청', icon:'box' },
      { key:'cs.templates', name:'답변·메일 템플릿', icon:'chat' },
      { key:'cs.lookup',    name:'상품 조회',   icon:'search' },
      { key:'cs.custdb',    name:'고객 정보 검색', icon:'search' },
      { key:'cs.partners',  name:'파트너사 관리', icon:'folder' },
      { key:'cs.settle',    name:'일일결산',    icon:'check2' },
      { key:'cs.manual',    name:'업무 매뉴얼', icon:'clipboard' },
  ]},
  { dept:'md', name:'MD', full:'상품 기획', icon:'box', items:[
      { key:'md.order',     name:'입점사 발주',        icon:'truck' },
      { key:'md.payreq',    name:'결제요청',           icon:'stamp' },
      { key:'md.vendormgmt', name:'입점사 관리',        icon:'truck' },
      { key:'md.prodhub',   name:'상품·품절 관리',     icon:'grid' },
      { key:'md.pricewatch', name:'가격비교',           icon:'chart' },
      { key:'md.tsnotes',   name:'TS상담 메모',        icon:'clipboard' },
      { key:'md.tstpl',     name:'기술상담 템플릿',     icon:'chat' },
      { key:'md.sales',     name:'매출 데이터',        icon:'chart' },
      { key:'md.settle',    name:'일일결산',           icon:'check2' },
      { key:'md.extra',     name:'부가기능',           icon:'grid' },
      { key:'md.manual',    name:'업무 매뉴얼',        icon:'clipboard' },
  ]},
  { dept:'logi', name:'물류', full:'물류 관리', icon:'truck', items:[
      { key:'logi.mouserin', name:'자사제품 입고', icon:'box' },
      { key:'logi.manual', name:'업무 매뉴얼', icon:'clipboard' },
  ]},
  { dept:'admin', name:'관리자', full:'계정·현황', icon:'shield', adminOnly:true, items:[
      { key:'admin.approvals', name:'결재함', icon:'inbox' },
      { key:'admin.insights', name:'업무 현황', icon:'chart' },
      { key:'admin.team', name:'팀 설정', icon:'users' },
      { key:'admin.share', name:'공유 범위', icon:'share' },
      { key:'admin.audit', name:'감사 로그', icon:'clipboard' },
  ]},
];
/* 디자인·경리는 개발 예정 — 사이드바에서 숨김 */

/* 직무 자동열람 기능 — 해당 부서 구성원이면 별도 권한 부여 없이 열람 가능(관리자는 전체).
   누적 시트(전 직원 공유 기록)는 부서 기본 열람으로 둔다. */
const DEPT_OPEN_KEYS = ['cs.records', 'cs.lookup', 'cs.custdb', 'cs.china', 'cs.exchange', 'cs.postpay', 'cs.settle', 'cs.partners', 'cs.manual', 'md.records', 'md.payreq', 'md.tsnotes', 'md.tsrecords',
  'md.vendorchg', 'md.vendormgmt', 'md.vendorcards', 'md.stock', 'md.inspect', 'md.prodmgmt', 'md.prodhub', 'md.pricewatch', 'md.tstpl', 'md.settle', 'md.manual',
  'logi.mouserin', 'logi.manual'];

/* 게시판별 '수정 권한' — 관리자이거나, 계정에 editPerms로 명시 부여된 경우 true.
   (부서원의 자기 부서 기본 수정 권한과 별개로 그 위에 더해지는 교차 부여 · 관리자가 계정 화면에서 페이지별로 부여) */
function canEditKey(key){
  const u=(typeof Auth!=='undefined' && Auth.user && Auth.user())||null; if(!u) return false;
  if(u.role==='admin') return true;
  return Array.isArray(u.editPerms) && u.editPerms.includes(key);
}

const STORE = {
  session:  'eduino.session',   // { device, code, ts }
  device:   'eduino.device',    // 기기 이름 (이 PC에 고정 저장)
  platforms:'eduino.platforms', // 플랫폼 세팅 오버라이드
  mdPresets:'eduino.md.presets', // 플랫폼 프리셋
  mdProducts:'eduino.md.products', // 상품 마스터
  mdVendors:'eduino.md.vendors',   // 입점사 배송비
  mdOrderCfg:'eduino.md.order.cfg', // 발주 구글시트 연동 설정
  csTplTabs:'eduino.cs.tpltabs',      // CS 템플릿 탭 목록(작업자가 추가/삭제) — 팀 공유
  csTplData:'eduino.cs.tpldata',      // CS 사용자 추가 탭의 템플릿 데이터 { 탭키:[…] }
  tsTplTabs:'eduino.ts.tpltabs',      // 기술상담 템플릿 탭 목록 — 팀 공유
  tsTplData:'eduino.ts.tpldata',      // 기술상담 사용자 추가 탭의 템플릿 데이터
  csTpl:    'eduino.cs.templates',
  csMailTpl:'eduino.cs.mailtpl',      // 메일 템플릿(고객 메일용)
  csSmsTpl: 'eduino.cs.smstpl',       // 문자 템플릿(고객 SMS용)
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
  tsMailTpl:'eduino.ts.mailtpl',         // TS 기술상담 메일 답변 템플릿
  tsChatTpl:'eduino.ts.chattpl',         // TS 기술상담 채팅 답변 템플릿
  syncCfg:  'eduino.sync.cfg',       // 공용 저장소(구글) 연동 { url, autoPull }
  shareMap: 'eduino.share.map',      // 공유 범위 오버라이드 { settingKey: 'all'|'cs'|'md' } (전사 공유)
  catMap:   'eduino.md.catmap',      // 이카운트 코드→이름표 { vendor:{코드:구매처명}, category:{코드:분류명} }
  optSets:  'eduino.optsets',        // 시트별 옵션칩 오버라이드 { '<setKey>':[...] } — 관리자 편집·팀 공유
  settleCfg:'eduino.settle.cfg',     // 일일결산 구글시트 연동 { sheetUrl } — 팀 공유
  custDbCfg:'eduino.custdb.cfg',     // 고객 데이터베이스(원장) 연동 { sheetUrl } — 후불/발주/견적이 21_거래내역으로 append · 팀 공유
  ntrexMailCfg:'eduino.ntrex.mailcfg', // 엔티렉스 공급가 요청 메일 양식 { to, toName, subject, body } · 관리자 편집 · 팀 공유
};

/* 엔티렉스 공급가 요청 메일 기본 양식 (담당자 제공 · 관리자가 [엔티렉스 가격비교]에서 편집)
   치환 토큰: {ntx}=엔티렉스 상품코드 · {name}=엔티렉스 상품명 · {ed}=에듀이노코드 · {link}=상품링크 */
const NTREX_MAIL_DEFAULT = {
  to:'n4812@ntrex.co.kr', toName:'유명한',
  subject:'[(주)로보다인시스템/에듀이노] 상품 공급가 문의드립니다',
  body:'안녕하세요.\n(주)로보다인시스템의 에듀이노 입니다.\n\n하기 상품 가격변동이 확인되어 공급가 요청드립니다.\n\n*상품정보\n{ntx}\n{name}\n\n*상품링크\n{link}\n\n감사합니다.',
};

/* 옵션칩 레지스트리 — 시트별 선택 버튼(고객유형·상품분류·주문경로 등)을 관리자가 편집하면
   팀 전체에 자동 반영(SHARED_SETTING_KEYS 로 공용 저장소 동기화). 오버라이드가 없으면 코드 기본값 사용. */
window.OptionSets = {
  all(){ try{ return store(STORE.optSets).get({}) || {}; }catch(e){ return {}; } },
  /* setKey 예: 'cs.notes.customerType' · defaults=코드 기본 배열 */
  get(setKey, defaults){ const m=this.all(); const v=m[setKey];
    return (Array.isArray(v) && v.length) ? v.slice() : (defaults||[]).slice(); },
  set(setKey, arr){ const m=this.all(); m[setKey]=(arr||[]).slice(); store(STORE.optSets).set(m); return m[setKey]; },
  add(setKey, defaults, val){ const cur=this.get(setKey, defaults); const v=String(val||'').trim();
    if(!v || cur.includes(v)) return { ok:false, list:cur }; cur.push(v); this.set(setKey, cur); return { ok:true, list:cur }; },
  remove(setKey, defaults, val){ const cur=this.get(setKey, defaults).filter(x=>x!==val); this.set(setKey, cur); return cur; },
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
  [STORE.csTpl]:'cs', [STORE.csMailTpl]:'cs', [STORE.csSmsTpl]:'cs', [STORE.csTplTabs]:'cs', [STORE.csTplData]:'cs', [STORE.csNoteCfg]:'cs', [STORE.csAgents]:'cs',
  [STORE.csTypes]:'cs', [STORE.csSumTpl]:'cs',
  [STORE.tsNoteCfg]:'md', [STORE.tsAgents]:'md', [STORE.tsTypes]:'md', [STORE.tsSumTpl]:'md',
  [STORE.tsMailTpl]:'md', [STORE.tsChatTpl]:'md', [STORE.tsTplTabs]:'md', [STORE.tsTplData]:'md',
  'eduino.board.exchange.cfg':'cs', 'eduino.board.postpay.cfg':'cs',
  'eduino.board.vendorchg.cfg':'md', 'eduino.board.stockmgmt.cfg':'md', 'eduino.board.inspect.cfg':'md', 'eduino.board.prodmgmt.cfg':'md',
  [STORE.shareMap]:'all',            // 범위 표 자체는 전사 공유(모두 같은 규칙을 봄)
  [STORE.optSets]:'all',             // 옵션칩 오버라이드 = 전사 공유(모두 같은 버튼을 봄)
  [STORE.settleCfg]:'all',           // 일일결산 시트 URL = 전사 공유
  [STORE.custDbCfg]:'all',           // 고객DB 원장 URL = 전사 공유
  [STORE.ntrexMailCfg]:'md',         // 엔티렉스 공급가 요청 메일 양식 = MD 공유
  'eduino.ntrex.products':'md',      // 가격비교 취급상품 담당자 추가/수정 = MD 공유
  'eduino.ntrex.dismissed':'md',     // 가격 변동 알림 중 처리/삭제한 건 = MD 공유
  'eduino.ntrex.reviewed':'md',      // 일일 리포트 확인 표시(담당자·날짜) = MD 공유
  'eduino.manual.cs':'cs',           // CS 업무 매뉴얼 = CS 공유
  'eduino.manual.md':'md',           // MD 업무 매뉴얼 = MD 공유
  'eduino.manual.logi':'all',        // 물류 업무 매뉴얼 = 전사 버킷 동기화(부서 스코프 미추가 · 페이지 접근은 부서/관리자로 제어)
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
  STORE.mdOrderCfg, STORE.csTpl, STORE.csMailTpl, STORE.csSmsTpl, STORE.csTplTabs, STORE.csTplData, STORE.tsTplTabs, STORE.tsTplData, STORE.csNoteCfg, STORE.csAgents,
  STORE.csTypes, STORE.csSumTpl, STORE.tsNoteCfg, STORE.tsAgents, STORE.tsTypes, STORE.tsSumTpl, STORE.tsMailTpl, STORE.tsChatTpl,
  STORE.shareMap, STORE.catMap, STORE.optSets, STORE.settleCfg, STORE.custDbCfg, STORE.ntrexMailCfg, 'eduino.ntrex.products', 'eduino.ntrex.dismissed', 'eduino.ntrex.reviewed',
  'eduino.manual.cs', 'eduino.manual.md', 'eduino.manual.logi',
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
  [STORE.csTplTabs]:'CS 템플릿 탭 구성',
  [STORE.csTplData]:'CS 추가 탭 템플릿',
  [STORE.tsTplTabs]:'기술상담 템플릿 탭 구성',
  [STORE.tsTplData]:'기술상담 추가 탭 템플릿',
  [STORE.csTpl]:'CS 답변 템플릿',
  [STORE.csMailTpl]:'CS 메일 템플릿',
  [STORE.csSmsTpl]:'CS 문자 템플릿',
  [STORE.csNoteCfg]:'CS 상담시트 연동 URL',
  [STORE.csAgents]:'상담사 목록',
  [STORE.csTypes]:'CS 분류',
  [STORE.csSumTpl]:'결산 저장 양식',
  [STORE.tsNoteCfg]:'TS 상담시트 연동 URL',
  [STORE.tsAgents]:'TS 담당자 목록',
  [STORE.tsTypes]:'TS 문의플랫폼',
  [STORE.tsSumTpl]:'TS 결산 저장 양식',
  [STORE.tsMailTpl]:'TS 메일 템플릿',
  [STORE.tsChatTpl]:'TS 채팅 템플릿',
  'eduino.board.exchange.cfg':'교환/반품 시트 연동 URL',
  'eduino.board.postpay.cfg':'후불/발주 시트 연동 URL',
  'eduino.board.vendorchg.cfg':'입점사 신규/변동 시트 연동 URL',
  'eduino.board.stockmgmt.cfg':'품절관리 시트 연동 URL',
  'eduino.board.inspect.cfg':'제품검수 시트 연동 URL',
  'eduino.board.prodmgmt.cfg':'상품관리 시트 연동 URL',
  [STORE.shareMap]:'공유 범위 규칙',
  [STORE.catMap]:'이카운트 구매처·분류 이름표',
  [STORE.custDbCfg]:'고객DB 원장 URL',
  [STORE.ntrexMailCfg]:'엔티렉스 공급가 요청 메일 양식',
  'eduino.ntrex.products':'가격비교 취급상품(담당자 편집)',
  'eduino.ntrex.dismissed':'가격비교 처리/삭제한 알림',
  'eduino.ntrex.reviewed':'가격비교 일일 리포트 확인 표시',
  'eduino.manual.cs':'CS 업무 매뉴얼',
  'eduino.manual.md':'MD 업무 매뉴얼',
  'eduino.manual.logi':'물류 업무 매뉴얼',
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
