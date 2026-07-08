/* ===========================================================================
   설정/데이터 레이어  (DB 연동 전까지 이 파일이 기준값)
   =========================================================================== */

/* 사내 접속코드 (10자리). 나중에 서버/관리자설정으로 교체할 지점. */
const ACCESS_CODE = 'robodyne12';

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
/* 상품 마스터 · selfCode(자체상품코드)가 기준 · code(카페24 상품코드)는 참고용(선택) · 실제 데이터는 임포트로 교체 */
const DEFAULT_MD_PRODUCTS = [
  { selfCode:'P-U22',  code:'', vendor:'아이씨뱅큐', settle:'월정산', name:'Nextion HMI LCD(정전식 터치, 7인치 NX8048P070-011C, 스마트형)', ship:'' },
  { selfCode:'P-BH31', code:'', vendor:'퓨나스',     settle:'월정산', name:'[LEGO] 스파이크 프라임 미디엄 앵글 모터', ship:'' },
  { selfCode:'P-BA10', code:'', vendor:'새온',       settle:'월정산', name:'[알티노] 언플러그드 크레용 / 교재', ship:'' },
  { selfCode:'P-AJ64', code:'', vendor:'삼쩜일사',   settle:'선결제', name:'[로봇과 함께하는 인공지능 교육 12차시 태블릿&크롬북 활용 교재] 카미봇파이 워크북', ship:'' },
];
/* 입점사별 배송비(vat포함) · 상품에 개별 배송비가 있으면 그 값이 우선 */
const DEFAULT_MD_VENDORS = [
  { name:'삼쩜일사',   ship:5100 },
  { name:'아이씨뱅큐', ship:3000 },
  { name:'퓨나스',     ship:3000 },
  { name:'새온',       ship:3000 },
];

/* 프로그램 명칭 */
const APP_NAME = '에듀이노 통합 업무관리';
const APP_NAME_FULL = '에듀이노 통합 업무관리 프로그램';

/* 상단 사내 바로가기 링크 (여기만 수정하면 버튼이 추가/변경됩니다) */
const QUICK_LINKS = [
  { name:'에듀이노몰',    short:'몰',  url:'https://eduino.kr' },
  { name:'카페24 관리자', short:'24', url:'https://eclogin.cafe24.com/Shop/?url=Init&login_mode=2&is_multi=F' },
];

/* CS 상담 메모 — 수정이 잦은 값은 상수로 분리 */
const CS_INQUIRY_TYPES = ['상품추천','후불','견적','기타'];
const CS_AGENTS = ['김상담','이응대','박고객','최문의'];

/* 좌측 내비게이션 구조 (활성: CS·MD / 예정: 디자인·경리)
   각 item.key 는 모듈 레지스트리(app.js MODULES) 키와 일치 */
const NAV = [
  { dept:'cs', name:'CS', full:'고객 상담', icon:'headset', items:[
      { key:'cs.templates', name:'답변 템플릿', icon:'chat' },
      { key:'cs.notes',     name:'상담 메모',   icon:'clipboard' },
  ]},
  { dept:'md', name:'MD', full:'상품 기획', icon:'box', items:[
      { key:'md.product', name:'상품 데이터 관리', icon:'grid' },
      { key:'md.image',   name:'상세이미지 변환기', icon:'image' },
      { key:'md.order',   name:'입점사 발주',      icon:'truck' },
  ]},
  { dept:'design', name:'디자인', full:'디자인', icon:'palette', soon:true, items:[
      { key:'design.asset',  name:'에셋 관리', soon:true },
      { key:'design.banner', name:'배너 문구', soon:true },
  ]},
  { dept:'acct', name:'경리', full:'회계/정산', icon:'calc', soon:true, items:[
      { key:'acct.ledger', name:'매출·매입 집계', soon:true },
      { key:'acct.settle', name:'정산표', soon:true },
  ]},
];

const STORE = {
  session:  'eduino.session',   // { device, code, ts }
  device:   'eduino.device',    // 기기 이름 (이 PC에 고정 저장)
  platforms:'eduino.platforms', // 플랫폼 세팅 오버라이드
  mdPresets:'eduino.md.presets', // 플랫폼 프리셋
  mdProducts:'eduino.md.products', // 상품 마스터
  mdVendors:'eduino.md.vendors',   // 입점사 배송비
  mdOrderCfg:'eduino.md.order.cfg', // 발주 구글시트 연동 설정
  csTpl:    'eduino.cs.templates',
  csNotes:  'eduino.cs.notes',       // 상담 메모 레코드 배열
  csNoteCfg:'eduino.cs.notes.cfg',   // { sheetUrl, syncMode }
  csAgent:  'eduino.cs.notes.agent', // 마지막 선택 담당자
  csTypes:  'eduino.cs.notes.types', // 문의유형 목록(사용자 편집)
};
