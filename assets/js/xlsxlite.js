/* ===========================================================================
   xlsxlite — 의존성 없는 초경량 표 파서 (엑셀 .xlsx / .csv / .tsv)
   - .xlsx: ZIP(중앙 디렉터리) 파싱 → DecompressionStream('deflate-raw')로 해제 →
            sharedStrings + 워크시트 XML을 읽어 첫 시트를 행 배열로 반환
   - .csv/.tsv/.txt: 구분자 자동 판별(탭·콤마·세미콜론)
   - 반환: Promise<{ rows: string[][], sheetName }>   (셀 값은 문자열)
   - 브라우저 전용(외부 라이브러리 불필요) · CS/MD 파일 업로드 공용
   =========================================================================== */
(function(){
  const dec = new TextDecoder('utf-8');

  function decodeEntities(s){
    if(s.indexOf('&')<0) return s;
    return s.replace(/&#x([0-9a-fA-F]+);/g, (_,h)=>{ try{ return String.fromCodePoint(parseInt(h,16)); }catch{ return _; } })
            .replace(/&#(\d+);/g, (_,d)=>{ try{ return String.fromCodePoint(+d); }catch{ return _; } })
            .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
  }

  async function inflateRaw(u8){
    if(typeof DecompressionStream==='undefined') throw new Error('이 브라우저는 파일 해제를 지원하지 않습니다(최신 브라우저 필요).');
    const ds = new DecompressionStream('deflate-raw');
    const blob = new Blob([u8]);
    const ab = await new Response(blob.stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(ab);
  }

  // ZIP 중앙 디렉터리에서 필요한 엔트리만 해제
  async function unzip(u8, wanted){
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    // EOCD 탐색
    let eocd=-1;
    for(let i=u8.length-22; i>=0 && i>=u8.length-22-65536; i--){ if(dv.getUint32(i,true)===0x06054b50){ eocd=i; break; } }
    if(eocd<0) throw new Error('올바른 엑셀(.xlsx) 파일이 아닙니다.');
    const cdCount = dv.getUint16(eocd+10,true), cdOff = dv.getUint32(eocd+16,true);
    const out = {};
    let p = cdOff;
    for(let n=0; n<cdCount; n++){
      if(dv.getUint32(p,true)!==0x02014b50) break;
      const method = dv.getUint16(p+10,true);
      const compSize = dv.getUint32(p+20,true);
      const nameLen = dv.getUint16(p+28,true), extraLen = dv.getUint16(p+30,true), commLen = dv.getUint16(p+32,true);
      const lho = dv.getUint32(p+42,true);
      const name = dec.decode(u8.subarray(p+46, p+46+nameLen));
      if(!wanted || wanted(name)){
        const lNameLen = dv.getUint16(lho+26,true), lExtraLen = dv.getUint16(lho+28,true);
        const ds = lho+30+lNameLen+lExtraLen;
        const comp = u8.subarray(ds, ds+compSize);
        out[name] = method===0 ? comp.slice() : await inflateRaw(comp);
      }
      p += 46+nameLen+extraLen+commLen;
    }
    return out;
  }

  function colToIdx(ref){ const m=ref.match(/^([A-Z]+)/); if(!m) return 0; let c=0; for(const ch of m[1]) c=c*26+(ch.charCodeAt(0)-64); return c-1; }

  // 워크시트 XML → 행 배열
  function sheetToRows(sx, ss){
    const rows=[];
    const reRow=/<row\b[^>]*>([\s\S]*?)<\/row>/g; let mr;
    while((mr=reRow.exec(sx))){
      const cells=[]; let maxi=-1;
      const reC=/<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g; let mc;
      while((mc=reC.exec(mr[1]))){
        const attr = mc[1]!=null?mc[1]:(mc[3]||'');
        const inner = mc[2]!=null?mc[2]:'';
        const rm = attr.match(/r="([A-Z]+\d+)"/); const ci = rm?colToIdx(rm[1]):(maxi+1);
        const isShared = /t="s"/.test(attr);
        let v='';
        const vm = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        if(vm){ v = isShared ? (ss[+vm[1]]||'') : decodeEntities(vm[1]); }
        else { const im = inner.match(/<t\b[^>]*>([\s\S]*?)<\/t>/); if(im) v=decodeEntities(im[1]); }
        cells[ci]=v; if(ci>maxi) maxi=ci;
      }
      for(let i=0;i<=maxi;i++) if(cells[i]==null) cells[i]='';
      rows.push(cells);
    }
    return rows;
  }
  // 모든 시트를 실제 탭 이름과 함께 반환: [{ name, rows }]
  async function parseAllSheets(u8){
    const files = await unzip(u8, n=> n==='xl/sharedStrings.xml' || n==='xl/workbook.xml'
      || n==='xl/_rels/workbook.xml.rels' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    const ss=[];
    if(files['xl/sharedStrings.xml']){
      const xml = dec.decode(files['xl/sharedStrings.xml']);
      const reSi=/<si\b[^>]*>([\s\S]*?)<\/si>/g; let m;
      while((m=reSi.exec(xml))){ let t=''; const reT=/<t\b[^>]*>([\s\S]*?)<\/t>/g; let mt; while((mt=reT.exec(m[1]))) t+=mt[1]; ss.push(decodeEntities(t)); }
    }
    // rId → worksheets/sheetN.xml
    const relMap={};
    if(files['xl/_rels/workbook.xml.rels']){ const rx=dec.decode(files['xl/_rels/workbook.xml.rels']);
      const reR=/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*>/g; let m;
      while((m=reR.exec(rx))) relMap[m[1]]=m[2].replace(/^\/?xl\//,'').replace(/^worksheets\//,'worksheets/'); }
    // workbook.xml: <sheet name r:id> (순서 보존)
    const order=[];
    if(files['xl/workbook.xml']){ const wx=dec.decode(files['xl/workbook.xml']);
      const reS=/<sheet\b[^>]*name="([^"]*)"[^>]*r:id="([^"]+)"[^>]*\/?>/g; let m;
      while((m=reS.exec(wx))){ const tgt=relMap[m[2]]||''; const key='xl/'+tgt.replace(/^xl\//,'');
        order.push({ name:decodeEntities(m[1]), key: key.replace('xl/worksheets','xl/worksheets') }); } }
    const out=[];
    if(order.length){
      for(const o of order){ const fk = Object.keys(files).find(k=>k===o.key || k.endsWith('/'+o.key.replace(/^xl\//,'')) || k==='xl/'+o.key.replace(/^xl\//,''));
        const key = files[o.key]?o.key:(fk||('xl/'+o.key.replace(/^xl\//,'')));
        if(files[key]) out.push({ name:o.name, rows: sheetToRows(dec.decode(files[key]), ss) }); }
    }
    if(!out.length){ // 폴백: 파일명 순서
      Object.keys(files).filter(k=>/^xl\/worksheets\/sheet\d+\.xml$/.test(k))
        .sort((a,b)=>(+a.match(/sheet(\d+)/)[1])-(+b.match(/sheet(\d+)/)[1]))
        .forEach(k=>out.push({ name:k.replace(/^.*\//,'').replace(/\.xml$/,''), rows: sheetToRows(dec.decode(files[k]), ss) }));
    }
    if(!out.length) throw new Error('워크시트를 찾을 수 없습니다.');
    return out;
  }
  async function parseXlsx(u8){ const sheets=await parseAllSheets(u8); return { rows: sheets[0].rows, sheetName: sheets[0].name, sheets }; }

  function parseCsv(text){
    const rows=[]; let row=[], cur='', q=false;
    // 구분자 자동 판별(첫 줄 기준)
    const firstLine = String(text).replace(/\r/g,'').split('\n')[0]||'';
    const sep = firstLine.includes('\t') ? '\t' : (firstLine.split(';').length>firstLine.split(',').length ? ';' : ',');
    const s=String(text).replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    for(let i=0;i<s.length;i++){ const ch=s[i];
      if(q){ if(ch==='"'){ if(s[i+1]==='"'){ cur+='"'; i++; } else q=false; } else cur+=ch; }
      else { if(ch==='"') q=true; else if(ch===sep){ row.push(cur); cur=''; } else if(ch==='\n'){ row.push(cur); rows.push(row); row=[]; cur=''; } else cur+=ch; }
    }
    if(cur!==''||row.length){ row.push(cur); rows.push(row); }
    return { rows: rows.map(r=>r.map(c=>c.trim())), sheetName:'csv' };
  }

  // File 또는 ArrayBuffer 를 받아 { rows, sheetName, sheets? } 반환 (첫 시트 rows + 전체 sheets)
  async function parseFile(file){
    const name = (file && file.name || '').toLowerCase();
    const buf = await file.arrayBuffer();
    if(name.endsWith('.xlsx')) return parseXlsx(new Uint8Array(buf));
    if(name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) return parseCsv(dec.decode(new Uint8Array(buf)));
    // 확장자 불명 — 시그니처로 판별(PK.. = zip)
    const u8=new Uint8Array(buf);
    if(u8[0]===0x50 && u8[1]===0x4b) return parseXlsx(u8);
    return parseCsv(dec.decode(u8));
  }
  // 모든 시트를 [{name, rows}] 로 반환 (xlsx 다중 시트) · csv 는 단일
  async function parseSheets(file){
    const name = (file && file.name || '').toLowerCase();
    const buf = await file.arrayBuffer(); const u8=new Uint8Array(buf);
    if(name.endsWith('.xlsx') || (u8[0]===0x50 && u8[1]===0x4b)) return parseAllSheets(u8);
    const r = parseCsv(dec.decode(u8)); return [{ name:'csv', rows:r.rows }];
  }

  window.XlsxLite = { parseFile, parseSheets, parseXlsx, parseCsv };
})();
