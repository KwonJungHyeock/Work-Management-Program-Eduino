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
const DEFAULT_PLATFORMS = [
  { id:'naver',  name:'네이버 스마트스토어', prefix:'네이버',  short:'N',  color:'#03c75a', width:860,  maxH:5000, maxMB:20, formats:['jpg','png'] },
  { id:'coupang',name:'쿠팡',              prefix:'쿠팡',   short:'쿠', color:'#f43142', width:1000, maxH:3000, maxMB:5,  formats:['jpg','png'] },
  { id:'st11',   name:'11번가',            prefix:'11번가', short:'11', color:'#ff2e2e', width:800,  maxH:0,    maxMB:10, formats:['jpg'] },
  { id:'gmarket',name:'G마켓',             prefix:'G마켓',  short:'G',  color:'#00a05a', width:860,  maxH:4000, maxMB:10, formats:['jpg'] },
  { id:'eduino', name:'에듀이노 쇼핑몰',    prefix:'에듀이노',short:'E',  color:'#e31e24', width:860,  maxH:0,    maxMB:0,  formats:['jpg','png','webp'] },
];

/* 좌측 내비게이션 구조 (활성: CS·MD / 예정: 디자인·경리)
   각 item.key 는 모듈 레지스트리(app.js MODULES) 키와 일치 */
const NAV = [
  { dept:'cs', name:'CS', full:'고객 상담', icon:'headset', items:[
      { key:'cs.templates', name:'답변 템플릿', icon:'chat' },
  ]},
  { dept:'md', name:'MD', full:'상품 기획', icon:'box', items:[
      { key:'md.product', name:'상품 데이터 관리', icon:'grid' },
      { key:'md.image',   name:'상세이미지 변환기', icon:'image' },
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
  csTpl:    'eduino.cs.templates',
};
